import { app, BrowserWindow, ipcMain, dialog, Notification, shell, Tray, Menu, nativeImage } from 'electron'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { isAbsolute, join } from 'path'
import { homedir, setPriority, constants as osConstants } from 'os'
import type {
  ActivityEvent,
  AgentKind,
  AgentSessionRef,
  AppSettings,
  InitPayload,
  SessionScanResult,
  ShellKind,
  TermLayout
} from '../shared/types'
import { detectShells } from './shells'
import { SessionStore } from './session'
import { PtyManager } from './ptys'
import { ResourceMonitor } from './resources'
import { ActivityTracker } from './activity'
import { SettingsStore } from './settings'
import { TemplateStore } from './templates'
import { WindowStateStore } from './windowState'
import { WorkspaceBrainStore } from './brain'
import { analyzeClipboard, cleanupPastes, copyText } from './clipboard'
import {
  scanSessions,
  getInstalled,
  checkGraphifyInstalled,
  CLAUDE_QWEN_ID_RE,
  OPENCODE_ID_RE
} from './agentSessions'

// El producto se rebrandeó a "Wingdeck", pero la carpeta de datos de usuario sigue
// siendo "orq-terminal" para no perder sesiones/cerebros/plantillas ya guardados.
app.setPath('userData', join(app.getPath('appData'), 'orq-terminal'))

// Dos instancias compartirían (y se pisarían) el mismo session.json — SessionStore
// escribe el archivo completo sin re-leer, así que la segunda borraría terminales
// creadas por la primera. Si ya hay una instancia corriendo, esta simplemente cede.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    win?.show()
    win?.focus()
  })
}

const isSmoke = process.argv.includes('--smoke')

const AGENT_LABELS: Record<AgentKind, string> = {
  claude: '✳ Claude',
  qwen: '◆ Qwen',
  opencode: '⬡ OpenCode'
}

let win: BrowserWindow | null = null
let store: SessionStore
let ptys: PtyManager
let monitor: ResourceMonitor
let tracker: ActivityTracker
let settings: SettingsStore
let templates: TemplateStore
let brain: WorkspaceBrainStore
let tray: Tray | null = null
let isQuitting = false
const windowState = new WindowStateStore()
/** último agente detectado por terminal (viene del monitor de recursos) */
const lastAgents = new Map<string, AgentKind | null>()
/** rachas de CPU alta consecutivas y cooldown de alertas, por terminal */
const cpuStreak = new Map<string, number>()
const cpuCooldownUntil = new Map<string, number>()
/**
 * `cpu` en TermStats está normalizado contra TODOS los núcleos (igual que el
 * medidor global), así que un solo hilo saturado en una máquina de muchos
 * núcleos jamás llegaría a un 85% fijo (en una de 16 núcleos marcaría ~6%).
 * El umbral real es relativo a "un núcleo lleno": ~80% de 100/cores.
 */
const CPU_ALERT_FRACTION_OF_ONE_CORE = 0.8
const CPU_ALERT_STREAK = 3
const CPU_ALERT_COOLDOWN_MS = 60_000

/** Resuelve un asset del icono: repo/build sin empaquetar, resources/ ya empaquetado */
function resolveIconPath(name: string): string {
  if (!app.isPackaged) return join(app.getAppPath(), 'build', name)
  return join(process.resourcesPath, name)
}

function runSmokeTest(): void {
  // Verifica que el módulo nativo de pty funcione dentro de Electron.
  import('@lydell/node-pty')
    .then(({ spawn }) => {
      const p = spawn(process.env.ComSpec ?? 'cmd.exe', ['/c', 'echo SMOKE_OK'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: homedir(),
        env: process.env as { [key: string]: string }
      })
      let out = ''
      p.onData((d) => {
        out += d
        if (out.includes('SMOKE_OK')) {
          console.log('PTY_SMOKE_PASS')
          app.exit(0)
        }
      })
      setTimeout(() => {
        console.error('PTY_SMOKE_FAIL output:', JSON.stringify(out))
        app.exit(1)
      }, 10_000)
    })
    .catch((err) => {
      console.error('PTY_SMOKE_FAIL require:', err)
      app.exit(1)
    })
}

function createWindow(): void {
  const initial = windowState.initialBounds()
  win = new BrowserWindow({
    width: initial.width ?? 1500,
    height: initial.height ?? 950,
    x: initial.x,
    y: initial.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0e14',
    title: 'Wingdeck',
    autoHideMenuBar: true,
    icon: resolveIconPath('tray.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (windowState.wasMaximized()) win.maximize()

  // Sin esto, Chromium throttlea los setTimeout de xterm a ~1/s con la ventana
  // minimizada/oculta → los ACKs del flow control llegarían lentísimos y los
  // agentes quedarían casi pausados en segundo plano (el caso de uso central).
  win.webContents.setBackgroundThrottling(false)
  // Si el renderer muere/crashea o navega/recarga (Ctrl+R), ningún cleanup de
  // React corrió: despausar todos los ptys y marcar todo como detached para que
  // nada quede colgado esperando ACKs que ya no llegarán. Las cards del renderer
  // nuevo re-attachean al montar.
  win.webContents.on('render-process-gone', () => ptys?.resetFlowAll())
  win.webContents.on('did-start-loading', () => ptys?.resetFlowAll())

  win.on('ready-to-show', () => win?.show())
  win.on('focus', () => win?.flashFrame(false))
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`)
  })

  let saveStateTimer: NodeJS.Timeout | null = null
  const persistWindowState = (): void => {
    if (!win || win.isMinimized() || win.isFullScreen()) return
    const isMax = win.isMaximized()
    const bounds = isMax ? win.getNormalBounds() : win.getBounds()
    windowState.save(bounds, isMax)
  }
  const schedulePersist = (): void => {
    if (saveStateTimer) clearTimeout(saveStateTimer)
    saveStateTimer = setTimeout(persistWindowState, 400)
  }
  win.on('resize', schedulePersist)
  win.on('move', schedulePersist)
  win.on('maximize', schedulePersist)
  win.on('unmaximize', schedulePersist)

  win.on('close', (e) => {
    if (saveStateTimer) clearTimeout(saveStateTimer)
    persistWindowState()
    if (!isQuitting) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Pregunta antes de matar los ptys, salvo que el usuario haya pedido no preguntar más */
async function confirmQuit(): Promise<void> {
  const live = Object.keys(ptys?.pids() ?? {}).length
  if (!settings.get().askOnQuit || live === 0) {
    isQuitting = true
    app.quit()
    return
  }
  const working = tracker.states().filter((s) => s.state === 'working').length
  const opts = {
    type: 'question' as const,
    buttons: ['Seguir en segundo plano', 'Cerrar todo', 'Cancelar'],
    defaultId: 0,
    cancelId: 2,
    title: 'Wingdeck',
    message: `Hay ${live} consola(s) abierta(s)${working > 0 ? `, ${working} con un agente trabajando` : ''}.`,
    detail:
      'Seguir en segundo plano: Wingdeck se oculta en la bandeja y los agentes siguen corriendo.\n' +
      'Cerrar todo: se cierran las consolas y se detienen los agentes.',
    checkboxLabel: 'No volver a preguntar',
    checkboxChecked: false
  }
  const { response, checkboxChecked } = win
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts)
  if (response === 2) return
  if (checkboxChecked) settings.update({ askOnQuit: false })
  if (response === 0) {
    win?.hide()
    return
  }
  isQuitting = true
  app.quit()
}

function buildTrayMenu(): Menu {
  const count = tracker?.attentionCount() ?? 0
  return Menu.buildFromTemplate([
    {
      label: 'Mostrar Wingdeck',
      click: () => {
        win?.show()
        win?.focus()
      }
    },
    { label: count > 0 ? `${count} terminal(es) esperando` : 'Sin pendientes', enabled: false },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        void confirmQuit()
      }
    }
  ])
}

function createTray(): void {
  const icon = nativeImage.createFromPath(resolveIconPath('tray.png'))
  tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Wingdeck')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', () => {
    win?.show()
    win?.focus()
  })
}

/**
 * Reaplica la clase de prioridad de CPU a los árboles de proceso ya en marcha
 * al togglear "Priorizar la interfaz sobre los agentes" — sin esto, el cambio
 * solo afectaría a spawns futuros. Usa el último snapshot del monitor (hasta
 * 2.5s viejo) más los pids raíz de cada pty; los pids ya muertos fallan en
 * silencio (ESRCH), no son un error real.
 */
function applyAgentPriority(below: boolean): void {
  const cls = below ? osConstants.priority.PRIORITY_BELOW_NORMAL : osConstants.priority.PRIORITY_NORMAL
  const pids = new Set<number>()
  for (const pid of Object.values(ptys?.pids() ?? {})) pids.add(pid)
  for (const tree of Object.values(monitor?.trees() ?? {})) for (const pid of tree) pids.add(pid)
  for (const pid of pids) {
    try {
      setPriority(pid, cls)
    } catch {
      /* proceso ya no existe u otro dueño del handle — ignorar */
    }
  }
}

function updateTitle(): void {
  const count = tracker.attentionCount()
  win?.setTitle(count > 0 ? `(${count}) Wingdeck` : 'Wingdeck')
  tray?.setToolTip(count > 0 ? `Wingdeck — ${count} esperando` : 'Wingdeck')
  tray?.setContextMenu(buildTrayMenu())
}

/** Revisa CPU sostenida por terminal y emite una alerta (sin notificación de sistema) */
function checkCpuAlert(id: string, cpuPct: number, cores: number): void {
  const threshold = (100 / cores) * CPU_ALERT_FRACTION_OF_ONE_CORE
  if (cpuPct <= threshold) {
    cpuStreak.set(id, 0)
    return
  }
  const streak = (cpuStreak.get(id) ?? 0) + 1
  cpuStreak.set(id, streak)
  if (streak < CPU_ALERT_STREAK) return
  cpuStreak.set(id, 0)
  const now = Date.now()
  if ((cpuCooldownUntil.get(id) ?? 0) > now) return
  cpuCooldownUntil.set(id, now + CPU_ALERT_COOLDOWN_MS)

  const t = store.get(id)
  if (!t) return
  const ev: ActivityEvent = {
    id,
    title: t.title,
    workspace: store.workspaceOf(id) ?? '',
    agent: lastAgents.get(id) ?? null,
    at: now,
    type: 'cpu',
    snippet: `CPU sostenida: ${cpuPct.toFixed(0)}%`
  }
  win?.webContents.send('act:done', ev)
}

function notifyDone(ev: ActivityEvent): void {
  const cfg = settings.get()
  updateTitle()
  const focused = win?.isFocused() ?? false
  if (cfg.flash && !focused) win?.flashFrame(true)
  if (cfg.systemNotif && !focused && Notification.isSupported()) {
    const label = ev.agent ? AGENT_LABELS[ev.agent] : 'La terminal'
    const body = ev.snippet
      ? `"${ev.title}" — ${ev.workspace}\n${ev.snippet}`
      : `"${ev.title}" — workspace ${ev.workspace}`
    const notif = new Notification({ title: `${label} terminó`, body })
    notif.on('click', () => {
      win?.show()
      win?.focus()
      win?.webContents.send('act:focus', { id: ev.id, workspace: ev.workspace })
    })
    notif.show()
  }
}

/** Intenta enviar el próximo prompt en cola; true si lo hizo (la terminal sigue "atendida") */
function dispatchQueue(id: string): boolean {
  const t = store.get(id)
  if (!t || t.queuePaused || !t.queue || t.queue.length === 0) return false
  const next = store.queueShift(id)
  if (!next) return false
  ptys.write(id, next + '\r')
  const remaining = store.get(id)?.queue?.length ?? 0
  const ev: ActivityEvent = {
    id,
    title: t.title,
    workspace: store.workspaceOf(id) ?? '',
    agent: lastAgents.get(id) ?? null,
    at: Date.now(),
    type: 'queue',
    snippet: `▶ ${next}`,
    remaining
  }
  win?.webContents.send('act:done', ev)
  return true
}

/** Cortafuegos: la terminal nunca queda colgada esperando una decisión que no llega */
const SESSION_SCAN_TIMEOUT_MS = 3000

// ── Asociación terminal ↔ sesiones de agente ─────────────────────────────────

/**
 * Filtra un escaneo de sesiones a las PROPIAS de la terminal. Sin propias (o si
 * ninguna de las propias sigue existiendo en disco), cae a la lista completa del
 * cwd — así el historial previo a esta feature sigue accesible y se va
 * repartiendo solo a medida que cada terminal retoma/crea sesiones.
 */
function sessionsFor(termId: string, result: SessionScanResult): SessionScanResult {
  const owned = store.ownedSessionsOf(termId)
  if (owned.length === 0) return result
  const keys = new Set(owned.map((o) => `${o.agent}:${o.id}`))
  const mine = result.sessions.filter((s) => keys.has(`${s.agent}:${s.id}`))
  return mine.length > 0 ? { ...result, sessions: mine } : result
}

/**
 * Vigía de "sesión nueva": cuando arranca un agente en una terminal, se espera a
 * que aparezca su sesión en disco (el CLI la crea al ratito) y se reclama para
 * esa terminal. Cubre Claude/Qwen/OpenCode con el mismo mecanismo (scanSessions).
 */
interface ClaimWatch {
  termId: string
  cwd: string
  agent: AgentKind
  startedAt: number
  timer: NodeJS.Timeout
}
const claimWatches = new Map<string, ClaimWatch>()
const CLAIM_POLL_MS = 10_000
const CLAIM_TIMEOUT_MS = 180_000
/** Margen: el archivo de sesión puede nacer un poco antes de que el monitor detecte el agente */
const CLAIM_SLACK_MS = 15_000

function startClaimWatch(termId: string, agent: AgentKind): void {
  const session = store.get(termId)
  if (!session) return
  stopClaimWatch(termId)
  const watch: ClaimWatch = {
    termId,
    cwd: session.cwd,
    agent,
    startedAt: Date.now(),
    timer: setInterval(() => void pollClaim(watch), CLAIM_POLL_MS)
  }
  claimWatches.set(termId, watch)
}

function stopClaimWatch(termId: string): void {
  const w = claimWatches.get(termId)
  if (w) {
    clearInterval(w.timer)
    claimWatches.delete(termId)
  }
}

/**
 * Nacimiento de la sesión: birthtime del archivo (o time_created de la DB). El
 * mtime NO sirve para decidir si es "nueva": una sesión externa viva en el mismo
 * cwd (p. ej. un Claude Code corriendo fuera de Wingdeck) también tiene mtime
 * fresco, y el watch se la apropiaría por error — verificado en E2E real.
 */
function sessionBornAt(s: AgentSessionRef): number | null {
  return s.createdAt ?? null
}

/**
 * Si varias terminales del mismo cwd vigilan a la vez, cada sesión nueva se la
 * lleva la vigía cuyo arranque quedó más cerca (por debajo) de su creación.
 */
function bestWatcherFor(s: AgentSessionRef, cwd: string): string | null {
  const born = sessionBornAt(s)
  if (born === null) return null
  let best: ClaimWatch | null = null
  for (const w of claimWatches.values()) {
    if (w.agent !== s.agent || w.cwd !== cwd) continue
    if (w.startedAt - CLAIM_SLACK_MS > born) continue
    if (!best || w.startedAt > best.startedAt) best = w
  }
  return best?.termId ?? null
}

async function pollClaim(watch: ClaimWatch): Promise<void> {
  if (Date.now() - watch.startedAt > CLAIM_TIMEOUT_MS) {
    stopClaimWatch(watch.termId)
    return
  }
  try {
    const result = await scanSessions(watch.cwd)
    const candidates = result.sessions.filter((s) => {
      if (s.agent !== watch.agent || store.ownerOf(s.agent, s.id) !== null) return false
      // Solo sesiones NACIDAS después del arranque del agente en esta terminal;
      // sin fecha de creación no hay forma segura de atribuir — no se reclama.
      const born = sessionBornAt(s)
      return born !== null && born >= watch.startedAt - CLAIM_SLACK_MS
    })
    const mine = candidates.filter((s) => bestWatcherFor(s, watch.cwd) === watch.termId)
    if (mine.length === 0) return
    store.claimAgentSession(watch.termId, mine[0].agent, mine[0].id)
    stopClaimWatch(watch.termId)
  } catch {
    /* best-effort: el próximo poll reintenta */
  }
}

/**
 * Se llama cuando `ptys` retiene un arranque en un cold spawn elegible. Escanea las
 * sesiones previas de ese cwd; si encuentra alguna, ofrece el overlay al renderer y
 * la decisión de escribir queda en manos del usuario. Si no encuentra nada, tarda
 * demasiado o falla, libera el arranque original sin más (la terminal nunca queda
 * colgada por esta feature).
 */
function handleColdSpawnEligible(id: string, cwd: string): void {
  let settled = false
  const releaseNow = (): void => {
    if (settled) return
    settled = true
    ptys.releaseStartup(id)
  }
  const timer = setTimeout(releaseNow, SESSION_SCAN_TIMEOUT_MS)
  scanSessions(cwd)
    .then((result) => {
      if (settled) return
      clearTimeout(timer)
      // Solo ofrecer las sesiones que corresponden a ESTA terminal
      const forTerm = sessionsFor(id, result)
      if (forTerm.sessions.length === 0) {
        releaseNow()
        return
      }
      settled = true
      win?.webContents.send('sessions:offer', { id, result: forTerm })
    })
    .catch((err) => {
      console.error('[sessions] escaneo falló, se libera el arranque normal:', err)
      releaseNow()
    })
}

/** Primera palabra de un comando (el binario) */
function firstWord(cmd: string): string {
  return cmd.trim().split(/\s+/)[0] ?? ''
}

/** true si hay un agente detectado corriendo en esa terminal ahora mismo */
/**
 * Solo mira la detección REAL de proceso (`lastAgents`, poblada por el monitor de
 * recursos). El estado `'working'` del tracker también es cierto en los primeros
 * instantes de CUALQUIER shell recién arrancado (banner de inicio, redibujado del
 * prompt) — usarlo acá daría falsos positivos justo en el caso que el mecanismo de
 * retención (hold) ya garantiza seguro: un cold spawn recién liberado.
 */
function agentIsRunning(id: string): boolean {
  return lastAgents.get(id) != null
}

function registerIpc(): void {
  // OJO: app:init debe seguir siendo un getter puro — las pruebas E2E (y cualquier
  // consumidor extra) lo llaman para leer el estado, y un reset acá desengancharía
  // terminales vivas sin re-attach. El reset por recarga vive en did-start-loading.
  ipcMain.handle('app:init', (): InitPayload => {
    return {
      shells: detectShells(),
      terminals: store.terminals,
      home: homedir(),
      workspaces: store.workspacesInfo
    }
  })

  ipcMain.handle('ws:switch', (_e, name: string) => {
    const terminals = store.switchWorkspace(name)
    return { terminals, workspaces: store.workspacesInfo }
  })

  ipcMain.handle('ws:create', (_e, name: string) => {
    store.createWorkspace(name)
    return { terminals: store.terminals, workspaces: store.workspacesInfo }
  })

  ipcMain.handle('ws:rename', (_e, oldName: string, newName: string) => {
    const ok = store.renameWorkspace(oldName, newName)
    if (ok) brain.rename(oldName, newName)
    return store.workspacesInfo
  })

  ipcMain.handle('ws:delete', (_e, name: string) => {
    const killedIds = store.deleteWorkspace(name)
    for (const id of killedIds) {
      stopClaimWatch(id)
      ptys.kill(id)
    }
    brain.delete(name)
    return { terminals: store.terminals, workspaces: store.workspacesInfo }
  })

  ipcMain.handle(
    'term:create',
    (_e, opts: { shell: ShellKind; cwd?: string; layout: TermLayout; title?: string }) => {
      const shells = detectShells()
      const label = shells.find((s) => s.kind === opts.shell)?.label ?? opts.shell
      return store.create({
        title: opts.title ?? label,
        shell: opts.shell,
        cwd: opts.cwd ?? homedir(),
        layout: opts.layout
      })
    }
  )


  ipcMain.handle('term:attach', (_e, id: string, cols: number, rows: number) => {
    try {
      return ptys.attach(id, cols, rows)
    } catch (err) {
      // epoch 0 nunca coincide con una entry viva (attach/spawn siempre lo suben
      // a ≥1), así que el ACK del replay de este mensaje de error se ignora solo.
      return {
        buffer: `\r\n\x1b[31m[Wingdeck] No se pudo iniciar la terminal: ${String(err)}\x1b[0m\r\n`,
        epoch: 0
      }
    }
  })

  ipcMain.on('term:input', (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on('term:ack', (_e, id: string, chars: number, epoch: number) => ptys.ack(id, chars, epoch))
  ipcMain.on('term:resize', (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))

  ipcMain.handle('term:restart', (_e, id: string, cols: number, rows: number) => {
    ptys.restart(id, cols, rows)
  })

  ipcMain.handle('term:close', (_e, id: string) => {
    stopClaimWatch(id)
    ptys.kill(id)
    store.remove(id)
  })

  ipcMain.on('term:title', (_e, id: string, title: string) => store.updateTitle(id, title))
  ipcMain.on('term:desc', (_e, id: string, text: string) => store.updateDescription(id, text))
  ipcMain.on('term:detach', (_e, id: string) => ptys.detach(id))
  ipcMain.on('term:startupCmd', (_e, id: string, cmd: string) => store.updateStartupCmd(id, cmd))
  ipcMain.on('term:fontSize', (_e, id: string, size: number) => store.updateFontSize(id, size))
  ipcMain.on('term:pinned', (_e, id: string, pinned: boolean) => store.updatePinned(id, pinned))
  ipcMain.on('term:persistBuffer', (_e, id: string, text: string) => ptys.updateSerialized(id, text))

  // ── Sesiones previas de agentes (retomar) ─────────
  ipcMain.handle('sessions:list', async (_e, id: string) => {
    const session = store.get(id)
    if (!session) return { cwd: '', sessions: [], installed: {}, scannedAt: Date.now() }
    return sessionsFor(id, await scanSessions(session.cwd))
  })

  ipcMain.handle(
    'sessions:resume',
    async (_e, id: string, agent: AgentKind, sessionId: string) => {
      const session = store.get(id)
      if (!session) return { ok: false, error: 'not-found' as const }
      if (agentIsRunning(id)) return { ok: false, error: 'agent-running' as const }
      const idRe = agent === 'opencode' ? OPENCODE_ID_RE : CLAUDE_QWEN_ID_RE
      if (!idRe.test(sessionId)) return { ok: false, error: 'invalid-id' as const }
      const flag = agent === 'opencode' ? '--session' : '--resume'
      const original = session.startupCmd?.trim()
      const sameBinary = original && firstWord(original) === agent
      const cmd = sameBinary ? `${original} ${flag} ${sessionId}` : `${agent} ${flag} ${sessionId}`
      const ok = ptys.releaseStartup(id, cmd)
      // Retomarla acá la vuelve propia de esta terminal (transfiere si era de otra)
      if (ok) store.claimAgentSession(id, agent, sessionId)
      return { ok }
    }
  )

  ipcMain.handle('sessions:startNew', async (_e, id: string, agent: AgentKind | null) => {
    const session = store.get(id)
    if (!session) return { ok: false, error: 'not-found' as const }
    if (agentIsRunning(id)) return { ok: false, error: 'agent-running' as const }
    const ok = agent === null ? ptys.releaseStartup(id) : ptys.releaseStartup(id, agent)
    // La sesión que este agente cree al arrancar será de esta terminal
    if (ok && agent) startClaimWatch(id, agent)
    return { ok }
  })

  ipcMain.on('sessions:dismiss', (_e, id: string, neverAgain: boolean) => {
    if (neverAgain) store.setResumeOverlay(id, 'never')
    ptys.releaseStartup(id)
  })

  ipcMain.handle('queue:add', (_e, id: string, prompt: string) => store.queueAdd(id, prompt))
  ipcMain.handle('queue:remove', (_e, id: string, index: number) => store.queueRemove(id, index))
  ipcMain.handle('queue:pause', (_e, id: string, paused: boolean) => store.queuePause(id, paused))

  ipcMain.handle('tpl:list', () => templates.list())
  ipcMain.handle('tpl:save', (_e, name: string) => {
    templates.save({ name: name.trim(), terminals: store.captureActiveAsTemplate() })
    return templates.list()
  })
  ipcMain.handle('tpl:delete', (_e, name: string) => {
    templates.delete(name)
    return templates.list()
  })
  ipcMain.handle('tpl:launch', (_e, name: string) => {
    const tpl = templates.list().find((t) => t.name === name)
    if (!tpl) return { terminals: store.terminals, workspaces: store.workspacesInfo }
    const terminals = store.launchTemplate(name, tpl.terminals)
    return { terminals, workspaces: store.workspacesInfo }
  })

  ipcMain.on('layout:update', (_e, items: ({ id: string } & TermLayout)[]) => {
    store.updateLayouts(items)
  })

  ipcMain.on('act:seen', (_e, id: string) => {
    tracker.seen(id)
    updateTitle()
  })

  ipcMain.handle('act:states', () => tracker.states())

  ipcMain.handle('clipboard:read', () => analyzeClipboard())
  ipcMain.on('clipboard:copy', (_e, text: string) => copyText(text))

  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:update', (_e, patch: Partial<AppSettings>) => {
    const before = settings.get().uiPriority
    const next = settings.update(patch)
    if ('uiPriority' in patch && patch.uiPriority !== before) {
      applyAgentPriority(patch.uiPriority ?? true)
    }
    return next
  })

  ipcMain.handle('onboarding:checkClis', () => getInstalled())
  ipcMain.handle('onboarding:checkGraphify', () => checkGraphifyInstalled())

  ipcMain.handle('open:inEditor', (_e, id: string, filePath: string, line?: number) => {
    const session = store.get(id)
    let resolved = filePath
    if (!isAbsolute(filePath) && session) resolved = join(session.cwd, filePath)
    if (!existsSync(resolved)) return { ok: false }
    const target = line ? `${resolved}:${line}` : resolved
    execFile('cmd', ['/c', 'code', '-g', target], (err) => {
      if (err) shell.openPath(resolved)
    })
    return { ok: true, resolved }
  })

  ipcMain.handle('graph:check', (_e, cwd: string) =>
    existsSync(join(cwd, 'graphify-out', 'graph.html'))
  )

  ipcMain.handle('graph:open', (_e, cwd: string) => {
    const target = join(cwd, 'graphify-out', 'graph.html')
    if (!existsSync(target)) return { ok: false }
    void shell.openPath(target)
    return { ok: true, resolved: target }
  })

  ipcMain.handle('brain:get', (_e, workspace: string) => {
    const seeds = store.terminalsOf(workspace).map((t) => ({ title: t.title, shell: t.shell, cwd: t.cwd }))
    return brain.read(workspace, seeds)
  })
  ipcMain.on('brain:save', (_e, workspace: string, content: string) => brain.save(workspace, content))
  ipcMain.handle('brain:getBackup', (_e, workspace: string) => brain.getBackup(workspace))
  ipcMain.handle('brain:restoreBackup', (_e, workspace: string) => brain.restoreBackup(workspace))

  ipcMain.handle('brain:broadcastReview', (_e, workspace: string) => {
    const brainPath = brain.path(workspace)
    const message = `Repasá el cerebro compartido del workspace en "${brainPath}" — puede haber cambiado desde que arrancaste. Actualizalo si corresponde.`
    let count = 0
    for (const t of store.terminalsOf(workspace)) {
      if (!t.startupCmd?.trim()) continue
      store.queueAdd(t.id, message)
      count++
    }
    return count
  })

  ipcMain.handle('dialog:pickFolder', async () => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Carpeta inicial de la terminal',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
}

app.whenReady().then(() => {
  if (isSmoke) {
    runSmokeTest()
    return
  }

  app.setAppUserModelId('com.kenshin1986.wingdeck')

  store = new SessionStore()
  settings = new SettingsStore()
  templates = new TemplateStore()
  brain = new WorkspaceBrainStore()
  cleanupPastes()

  tracker = new ActivityTracker({
    settings: () => settings.get(),
    getInfo: (id) => {
      const t = store.get(id)
      if (!t) return null
      return { title: t.title, workspace: store.workspaceOf(id) ?? '' }
    },
    getAgent: (id) => lastAgents.get(id) ?? null,
    getTail: (id) => ptys.tail(id),
    beforeAttention: (id) => dispatchQueue(id),
    emitState: (info) => win?.webContents.send('act:state', info),
    emitDone: (ev) => {
      win?.webContents.send('act:done', ev)
      notifyDone(ev)
    }
  })

  ptys = new PtyManager(
    store,
    () => win?.webContents ?? null,
    tracker,
    () => settings.get(),
    brain,
    handleColdSpawnEligible
  )
  monitor = new ResourceMonitor()

  registerIpc()
  createWindow()
  createTray()

  tracker.start()
  brain.start(
    () => store.workspacesInfo.active,
    (workspace) => win?.webContents.send('brain:updated', { workspace })
  )
  monitor.start(
    () => ptys.pids(),
    (snap) => {
      for (const [id, stats] of Object.entries(snap.terminals)) {
        tracker.updateCpu(id, stats.cpu)
        const prevAgent = lastAgents.get(id) ?? null
        lastAgents.set(id, stats.agent)
        // Arrancó un agente en esta terminal (por startupCmd, resume o tecleo
        // manual): vigilar la aparición de su sesión en disco para asociarla.
        if (stats.agent && stats.agent !== prevAgent) startClaimWatch(id, stats.agent)
        checkCpuAlert(id, stats.cpu, snap.global.cores)
      }
      win?.webContents.send('res:update', snap)
    }
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  if (isSmoke) return
  tracker?.stop()
  monitor?.stop()
  brain?.stop()
  ptys?.disposeAll()
  store?.flush()
  tray?.destroy()
})

app.on('window-all-closed', () => {
  app.quit()
})
