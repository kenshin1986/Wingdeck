import { spawn, type IPty } from '@lydell/node-pty'
import { app, type WebContents } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { AppSettings, TerminalSession } from '../shared/types'
import { shellPath } from './shells'
import type { SessionStore } from './session'
import type { ActivityTracker } from './activity'
import type { WorkspaceBrainStore } from './brain'
import { branchFor } from './git'
import { hasAnyHistoryHint } from './agentSessions'
import { detectModel } from './modelDetect'

const MAX_BUFFER = 300_000
const PERSIST_INTERVAL_MS = 15_000
const GIT_POLL_MS = 10_000
/**
 * Flow control pty→renderer (estilo VS Code): sin esto, si los agentes producen
 * salida más rápido de lo que el renderer puede parsear, los mensajes `term:data`
 * sin entregar se acumulan SIN LÍMITE en el proceso main (observado: >10GB) y el
 * eco del tecleo queda detrás del backlog — todas las consolas parecen muertas.
 * Con más de HIGH_WATER chars sin ACKear se pausa el pty; se reanuda bajo LOW_WATER.
 */
const HIGH_WATER = 100_000
const LOW_WATER = 5_000
/** Coalescing del send: junta chunks ~5ms (o hasta FLUSH_MAX) antes de emitir */
const FLUSH_MS = 5
const FLUSH_MAX = 65_536
/**
 * Válvula de seguridad: si una pausa dura más que esto (ACK perdido — el canal
 * term:ack es send-and-forget, sin garantía de entrega), se auto-reanuda. Un ACK
 * perdido pasa de "terminal congelada para siempre" a un hipo de 5s; y con un
 * renderer genuinamente colgado el goteo queda acotado (~HIGH_WATER cada 5s),
 * nada que ver con el crecimiento sin límite del bug original.
 */
const PAUSE_GUARD_MS = 5_000
const RESUME_BANNER = '\r\n\x1b[2m── sesión anterior ──\x1b[0m\r\n'
const CWD_RE = /\x1b\]9;9;([^\x07\x1b]*)(?:\x07|\x1b\\)/g
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\r/g

interface Entry {
  pty: IPty | null
  buffer: string
  parseTail: string
  /** Cola rolling para detectModel, independiente de parseTail (cwd) */
  modelTail: string
  attached: boolean
  /** Chars enviados al renderer aún sin ACKear (flow control) */
  unackedChars: number
  /** Generación de flow: los ACKs de una card/spawn anterior traen un epoch viejo y se ignoran */
  flowEpoch: number
  /** Salida pendiente de coalescer en el próximo flush */
  pendingOut: string
  flushTimer: NodeJS.Timeout | null
  /** El pty está pausado por exceso de unackedChars */
  flowPaused: boolean
  /** Auto-resume si la pausa dura demasiado (ACK perdido) */
  pauseGuard: NodeJS.Timeout | null
  /** Se dispara en el primer prompt del shell (para el comando de arranque) */
  onFirstPrompt?: () => void
  /** Estado del escáner de BEL: 0=normal 1=ESC 2=en OSC 3=en OSC tras ESC */
  oscState: number
  /** El buffer cambió desde el último guardado en disco */
  dirty: boolean
  /** Última rama de git reportada al renderer (para no reenviar sin cambios) */
  lastBranch?: string | null
  /**
   * Snapshot limpio del terminal (vía @xterm/addon-serialize, generado en el
   * renderer). A diferencia de `buffer` —el flujo crudo de bytes del pty—, esto
   * reconstruye solo las filas finales visibles, así que persistirlo entre
   * reinicios no arrastra secuencias de cursor de redibujados en vivo que
   * corromperían el reemplay (p. ej. PSReadLine repintando el prompt).
   */
  serialized?: string
  /**
   * Comando de arranque retenido mientras se decide si ofrecer el overlay de
   * "retomar sesión" — null significa "retenido pero no había startupCmd".
   * undefined significa "no se retuvo nada" (comportamiento normal).
   */
  pendingStartup?: string | null
  /** Una sola liberación por spawn (releaseStartup es idempotente) */
  startupReleased?: boolean
  /** cwd ya resuelto del spawn (para enqueueStartupNudges al liberar más tarde) */
  resolvedCwd?: string
}

/** Sugerencia de arranque para que el agente use el grafo Graphify del proyecto */
function graphifyNudge(exists: boolean): string {
  return exists
    ? `Este proyecto ya tiene un grafo Graphify en "graphify-out/graph.json". Preferí \`graphify query "<pregunta>"\`, \`graphify explain "<nodo>"\` y \`graphify path "A" "B"\` para entender el código antes que leer archivos sueltos o grepear. Si el código cambió mucho, regeneralo con \`graphify .\`.`
    : `Si en esta carpeta no existe todavía "graphify-out/graph.json", generá el grafo del proyecto corriendo \`graphify .\` (o \`/graphify .\` si lo tenés como skill/slash-command). Una vez que exista, preferí \`graphify query "<pregunta>"\`, \`graphify explain "<nodo>"\` y \`graphify path "A" "B"\` para entender el código antes que leer archivos sueltos o grepear.`
}

/** Convierte rutas estilo Git Bash (/c/Users/x) a Windows (C:\Users\x) */
function normalizeCwd(raw: string): string {
  const m = /^\/([a-zA-Z])(\/.*)?$/.exec(raw)
  if (m) return `${m[1].toUpperCase()}:${(m[2] ?? '\\').replace(/\//g, '\\')}`
  return raw
}

export class PtyManager {
  private entries = new Map<string, Entry>()
  private initPs1: string
  private bufferDir: string
  private persistTimer: NodeJS.Timeout
  private gitTimer: NodeJS.Timeout

  constructor(
    private store: SessionStore,
    private getWebContents: () => WebContents | null,
    private activity: ActivityTracker,
    private getSettings: () => AppSettings,
    private brain: WorkspaceBrainStore,
    /** Se llama en un cold spawn elegible para el overlay de "retomar sesión" */
    private onColdSpawnEligible?: (id: string, cwd: string) => void
  ) {
    this.initPs1 = join(app.getPath('userData'), 'orq-init.ps1')
    writeFileSync(
      this.initPs1,
      [
        '# Wingdeck: envuelve el prompt existente para reportar el directorio actual (OSC 9;9)',
        '$global:__orqPrevPrompt = $function:prompt',
        'function global:prompt {',
        '  $esc = [char]27; $bel = [char]7',
        '  [Console]::Write("$esc]9;9;$($executionContext.SessionState.Path.CurrentLocation.ProviderPath)$bel")',
        '  if ($global:__orqPrevPrompt) { & $global:__orqPrevPrompt } else { "PS $($PWD.Path)> " }',
        '}',
        ''
      ].join('\r\n'),
      'utf8'
    )
    this.bufferDir = join(app.getPath('userData'), 'buffers')
    if (!existsSync(this.bufferDir)) mkdirSync(this.bufferDir, { recursive: true })
    this.persistTimer = setInterval(() => this.persistDirty(), PERSIST_INTERVAL_MS)
    this.gitTimer = setInterval(() => this.pollGitBranches(), GIT_POLL_MS)
  }

  private checkGitBranch(id: string, entry: Entry, cwd: string): void {
    const branch = branchFor(cwd)
    if (branch !== entry.lastBranch) {
      entry.lastBranch = branch
      this.getWebContents()?.send('session:git', { id, branch })
    }
  }

  private pollGitBranches(): void {
    for (const [id, entry] of this.entries) {
      if (!entry.pty) continue
      const session = this.store.get(id)
      if (session) this.checkGitBranch(id, entry, session.cwd)
    }
  }

  private bufferFile(id: string): string {
    return join(this.bufferDir, `${id}.txt`)
  }

  private loadPersisted(id: string): string | null {
    try {
      const file = this.bufferFile(id)
      return existsSync(file) ? readFileSync(file, 'utf8') : null
    } catch {
      return null
    }
  }

  private persistDirty(): void {
    if (!this.getSettings().persistScrollback) return
    for (const [id, entry] of this.entries) {
      if (!entry.dirty) continue
      try {
        writeFileSync(this.bufferFile(id), entry.serialized ?? entry.buffer, 'utf8')
        entry.dirty = false
      } catch (err) {
        console.error(`[ptys] no se pudo persistir el buffer de ${id}:`, err)
      }
    }
  }

  /** Recibe un snapshot serializado desde el renderer (@xterm/addon-serialize) */
  updateSerialized(id: string, text: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.serialized = text
    entry.dirty = true
  }

  /** Guarda de inmediato todo lo pendiente (usar en before-quit) */
  flushPersisted(): void {
    this.persistDirty()
  }

  isAlive(id: string): boolean {
    return !!this.entries.get(id)?.pty
  }

  pid(id: string): number | null {
    return this.entries.get(id)?.pty?.pid ?? null
  }

  pids(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [id, e] of this.entries) {
      if (e.pty) out[id] = e.pty.pid
    }
    return out
  }

  private buildSpawn(session: TerminalSession): { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
    const file = shellPath(session.shell)
    if (!file) throw new Error(`Shell no disponible: ${session.shell}`)

    const env: NodeJS.ProcessEnv = { ...process.env, ORQ_TERMINAL: '1' }
    let args: string[] = []
    let cwd = session.cwd

    // Wingdeck es una app GUI, no se lanza desde una shell — hereda un process.env
    // sin TERM/COLORTERM. ConPTY ya soporta ANSI de por sí, pero algunas herramientas
    // (CLIs de Node, algunos tools de Python/Ruby) consultan estas variables para
    // decidir si emiten color. WSL gestiona su propio entorno Linux, no hace falta acá.
    if (session.shell !== 'wsl') {
      env.TERM = 'xterm-256color'
      env.COLORTERM = 'truecolor'

      // Claves de API configuradas en el asistente de configuración inicial (⚙ →
      // "Repetir configuración inicial"), para agentes que aceptan auth por variable
      // de entorno en vez de su login por navegador. Solo se setean si el usuario
      // cargó algo — así nunca pisan una clave que ya tuviera en su entorno real.
      // No aplica a WSL: wsl.exe no hereda el env de Windows salvo vía WSLENV.
      const { apiKeys } = this.getSettings()
      if (apiKeys?.anthropic) env.ANTHROPIC_API_KEY = apiKeys.anthropic
      if (apiKeys?.openai) env.OPENAI_API_KEY = apiKeys.openai
      if (apiKeys?.gemini) env.GEMINI_API_KEY = apiKeys.gemini
    }

    const isLinuxPath = cwd.startsWith('/')
    if (session.shell !== 'wsl' && (isLinuxPath || !existsSync(cwd))) cwd = homedir()

    switch (session.shell) {
      case 'pwsh':
      case 'powershell':
        args = ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', `. '${this.initPs1}'`]
        break
      case 'cmd':
        args = ['/K', 'set PROMPT=$E]9;9;$P$E\\$P$G']
        break
      case 'gitbash':
        args = ['--login', '-i']
        env.PROMPT_COMMAND = 'printf \'\\033]9;9;%s\\033\\\\\' "$PWD"'
        break
      case 'wsl':
        args = isLinuxPath ? ['--cd', session.cwd] : []
        cwd = homedir()
        break
    }

    return { file, args, cwd, env }
  }

  /**
   * Garantiza que exista un pty para la sesión y devuelve el buffer acumulado
   * más el epoch de flow control vigente (para ACKear contra la generación
   * correcta). A partir de aquí los datos también se emiten en vivo al renderer.
   */
  attach(id: string, cols: number, rows: number): { buffer: string; epoch: number } {
    const session = this.store.get(id)
    if (!session) return { buffer: '', epoch: 0 }
    let entry = this.entries.get(id)
    if (!entry) {
      const persisted = this.getSettings().persistScrollback ? this.loadPersisted(id) : null
      if (persisted) {
        this.entries.set(id, {
          pty: null,
          buffer: persisted + RESUME_BANNER,
          parseTail: '',
          modelTail: '',
          attached: false,
          unackedChars: 0,
          flowEpoch: 0,
          pendingOut: '',
          flushTimer: null,
          flowPaused: false,
          pauseGuard: null,
          oscState: 0,
          dirty: false
        })
      }
    }
    entry = this.entries.get(id)
    if (!entry || !entry.pty) {
      entry = this.spawnFor(session, cols, rows)
    }
    entry.attached = true
    // Generación nueva: descarta restos/ACKs de la card anterior y cuenta el
    // replay contra el flow control — un cambio de workspace con N replays de
    // 300KB pausa cada pty hasta que SU card terminó de parsear su replay.
    this.resetFlow(entry)
    entry.unackedChars = entry.buffer.length
    if (entry.unackedChars > HIGH_WATER && entry.pty) {
      this.pauseFlow(id, entry)
    }
    return { buffer: entry.buffer, epoch: entry.flowEpoch }
  }

  private spawnFor(session: TerminalSession, cols: number, rows: number): Entry {
    const { file, args, cwd, env } = this.buildSpawn(session)
    const pty = spawn(file, args, {
      name: 'xterm-256color',
      cols: Math.max(cols, 20),
      rows: Math.max(rows, 5),
      cwd,
      env: env as { [key: string]: string }
    })

    const prev = this.entries.get(session.id)
    const entry: Entry = {
      pty,
      buffer: prev?.buffer ?? '',
      parseTail: '',
      modelTail: '',
      attached: prev?.attached ?? false,
      unackedChars: 0,
      // Generación nueva: cualquier ACK dirigido al spawn anterior se ignora
      flowEpoch: (prev?.flowEpoch ?? 0) + 1,
      pendingOut: '',
      flushTimer: null,
      flowPaused: false,
      pauseGuard: null,
      oscState: 0,
      dirty: false
    }
    this.entries.set(session.id, entry)

    entry.resolvedCwd = cwd
    const startupCmd = session.startupCmd?.trim()
    // Cold spawn en una carpeta con historial de agentes: retenemos el arranque en
    // vez de dispararlo, para que el shell quede garantizado en su prompt mientras
    // se decide si ofrecer "retomar sesión" — escribir ahí es siempre seguro. Si
    // escribiéramos el comando y RECIÉN DESPUÉS detectáramos el agente corriendo,
    // ya sería tarde: el snapshot de recursos tarda 2.5-8s en resolver el proceso,
    // tiempo de sobra para que un `--resume` se mande como PROMPT a un agente vivo.
    const eligibleForOverlay =
      session.shell !== 'wsl' &&
      session.resumeOverlay !== 'never' &&
      hasAnyHistoryHint(cwd) &&
      !!this.onColdSpawnEligible
    if (eligibleForOverlay) {
      entry.pendingStartup = startupCmd || null
      this.onColdSpawnEligible!(session.id, cwd)
    } else if (startupCmd) {
      this.enqueueStartupNudges(session, cwd)
      this.armStartupFire(entry, startupCmd)
    }

    pty.onData((data) => {
      entry.buffer += data
      if (entry.buffer.length > MAX_BUFFER) entry.buffer = entry.buffer.slice(-MAX_BUFFER)
      entry.dirty = true
      this.parseCwd(session.id, entry, data)
      this.parseModel(session.id, entry, data)
      this.activity.onOutput(session.id, this.scanBel(entry, data))
      // Detached: no se acumula pendingOut ni se pausa nunca (invariante: un pty
      // sin card montada jamás queda pausado — sus ACKs no llegarían).
      if (!entry.attached) return
      entry.pendingOut += data
      if (entry.pendingOut.length >= FLUSH_MAX) {
        this.flushOut(session.id, entry)
      } else if (!entry.flushTimer) {
        entry.flushTimer = setTimeout(() => this.flushOut(session.id, entry), FLUSH_MS)
      }
    })

    pty.onExit(({ exitCode }) => {
      entry.pty = null
      // Si mientras tanto restart()/spawnFor() ya reemplazó esta entry por una nueva
      // (kill() en Windows dispara onExit de forma diferida, después de que el pty
      // nuevo ya está vivo), no avisar "proceso finalizado" — sería para el pty VIEJO,
      // no para el que el usuario está viendo ahora.
      if (this.entries.get(session.id) === entry) {
        // Que el último output pendiente llegue antes del aviso de salida
        this.flushOut(session.id, entry)
        this.getWebContents()?.send('term:exit', { id: session.id, code: exitCode })
      }
    })

    return entry
  }

  /** Encola el nudge de Graphify y, si corresponde, el del cerebro del workspace */
  private enqueueStartupNudges(session: TerminalSession, cwd: string): void {
    // Se encola antes que el cerebro para que, al ser queueUnshift (antepone),
    // el orden final de despacho quede [cerebro, graphify, ...prompts del usuario].
    const graphJson = join(cwd, 'graphify-out', 'graph.json')
    const graphExists = session.shell !== 'wsl' && existsSync(graphJson)
    this.store.queueUnshift(session.id, graphifyNudge(graphExists))
    const workspaceName = this.store.workspaceOf(session.id)
    if (workspaceName && this.brain.hasBrain(workspaceName)) {
      const brainPath = this.brain.path(workspaceName)
      // Se encola (no se escribe directo): el mismo mecanismo de "enviar cuando
      // el agente quede libre" ya espera a que el CLI del agente esté listo.
      this.store.queueUnshift(
        session.id,
        `Este workspace tiene memoria compartida en "${brainPath}". Leela antes de seguir para entender cómo se conectan los proyectos de este workspace, y actualizala si descubrís algo nuevo sobre cómo encajan las piezas.`
      )
      // WSL usa homedir de Windows como cwd de spawn (no la carpeta real del
      // proyecto en el filesystem de Linux), así que ahí no hay CLAUDE.md que enlazar.
      if (session.shell !== 'wsl') this.brain.linkProject(cwd, workspaceName)
    }
  }

  /** Instala el disparo del comando de arranque en el primer prompt (con respaldo por timeout) */
  private armStartupFire(entry: Entry, cmd: string, fallbackMs = 2500): void {
    let fired = false
    const fire = (): void => {
      if (fired || !entry.pty) return
      fired = true
      entry.pty.write(cmd + '\r')
    }
    entry.onFirstPrompt = fire
    // Respaldo para shells que no emiten OSC 9;9 (p. ej. WSL)
    setTimeout(fire, fallbackMs)
  }

  /**
   * Libera un arranque retenido por `eligibleForOverlay`: escribe `overrideCmd` si
   * se pasó (p. ej. "retomar sesión X"), o el `startupCmd` original si no. Idempotente
   * — una segunda llamada no hace nada. Devuelve false si la terminal no existe o ya
   * se liberó antes.
   */
  releaseStartup(id: string, overrideCmd?: string): boolean {
    const entry = this.entries.get(id)
    if (!entry || entry.startupReleased) return false
    entry.startupReleased = true
    const cmd = overrideCmd ?? entry.pendingStartup ?? undefined
    if (!cmd) return true // no había nada que ejecutar (p. ej. "Cerrar" sin ⚡ configurado)
    const session = this.store.get(id)
    if (session) this.enqueueStartupNudges(session, entry.resolvedCwd ?? session.cwd)
    // A esta altura el shell ya lleva un buen rato esperando en su prompt (el
    // usuario tardó en decidir desde el overlay) — a diferencia del arranque
    // inicial en spawnFor(), acá NO hace falta el respaldo largo de 2500ms
    // pensado para shells que todavía podrían estar iniciando (p. ej. WSL, que
    // de todos modos está excluido de este camino). Un respaldo corto evita que
    // "Retomar" se sienta como si no hubiera hecho nada.
    this.armStartupFire(entry, cmd, 200)
    return true
  }

  private parseCwd(id: string, entry: Entry, chunk: string): void {
    const text = entry.parseTail + chunk
    let match: RegExpExecArray | null
    let last: string | null = null
    CWD_RE.lastIndex = 0
    while ((match = CWD_RE.exec(text)) !== null) last = match[1]
    entry.parseTail = text.slice(-1024)
    if (last !== null && entry.onFirstPrompt) {
      const fire = entry.onFirstPrompt
      entry.onFirstPrompt = undefined
      fire()
    }
    if (last !== null) {
      const cwd = normalizeCwd(last.trim())
      const session = this.store.get(id)
      if (session && session.cwd !== cwd) {
        this.store.updateCwd(id, cwd)
        this.getWebContents()?.send('session:cwd', { id, cwd })
      }
      this.checkGitBranch(id, entry, cwd)
    }
  }

  /**
   * Detección best-effort del modelo activo (Sonnet/Opus/etc., o `provider/model` de
   * opencode) escaneando la salida cruda del pty — no hay canal OSC dedicado a esto
   * como con el cwd, así que esto puede fallar entre versiones de las CLIs (ver
   * modelDetect.ts).
   */
  private parseModel(id: string, entry: Entry, chunk: string): void {
    const text = (entry.modelTail + chunk).slice(-4000)
    entry.modelTail = text.slice(-1024)
    const detected = detectModel(text)
    if (!detected) return
    const session = this.store.get(id)
    if (session && session.model !== detected.label) {
      this.store.updateModel(id, detected.label)
      this.getWebContents()?.send('session:model', { id, model: detected.label })
    }
  }

  /** Emite el pendiente coalescido y pausa el pty si hay demasiado sin ACKear */
  private flushOut(id: string, entry: Entry): void {
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer)
      entry.flushTimer = null
    }
    // Entry reemplazada por un respawn, card desmontada o nada pendiente
    if (this.entries.get(id) !== entry || !entry.attached || !entry.pendingOut) return
    const data = entry.pendingOut
    entry.pendingOut = ''
    entry.unackedChars += data.length
    this.getWebContents()?.send('term:data', { id, data, epoch: entry.flowEpoch })
    if (!entry.flowPaused && entry.unackedChars > HIGH_WATER && entry.pty) {
      this.pauseFlow(id, entry)
    }
  }

  /** Pausa el pty y arma la válvula de auto-resume por si el ACK se pierde */
  private pauseFlow(id: string, entry: Entry): void {
    entry.flowPaused = true
    try {
      entry.pty?.pause()
    } catch {
      /* pty muerto */
    }
    if (entry.pauseGuard) clearTimeout(entry.pauseGuard)
    entry.pauseGuard = setTimeout(() => {
      entry.pauseGuard = null
      if (this.entries.get(id) !== entry || !entry.flowPaused) return
      console.error(`[ptys] pausa de ${id} sin ACK tras ${PAUSE_GUARD_MS}ms — auto-resume`)
      entry.unackedChars = 0
      this.resumeFlow(entry)
    }, PAUSE_GUARD_MS)
  }

  private resumeFlow(entry: Entry): void {
    entry.flowPaused = false
    if (entry.pauseGuard) {
      clearTimeout(entry.pauseGuard)
      entry.pauseGuard = null
    }
    try {
      entry.pty?.resume()
    } catch {
      /* pty muerto */
    }
  }

  /** ACK del renderer: ya parseó `chars` del epoch indicado */
  ack(id: string, chars: number, epoch: number): void {
    const entry = this.entries.get(id)
    // ACK huérfano (card o spawn anterior): la generación no coincide, ignorar
    if (!entry || epoch !== entry.flowEpoch || !Number.isFinite(chars)) return
    entry.unackedChars = Math.max(0, entry.unackedChars - chars)
    if (entry.flowPaused && entry.unackedChars < LOW_WATER) {
      this.resumeFlow(entry)
    }
  }

  /** Descarta pendientes, invalida ACKs en vuelo (epoch++) y despausa el pty */
  private resetFlow(entry: Entry): void {
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer)
      entry.flushTimer = null
    }
    entry.pendingOut = ''
    entry.unackedChars = 0
    entry.flowEpoch++
    if (entry.pauseGuard) {
      clearTimeout(entry.pauseGuard)
      entry.pauseGuard = null
    }
    if (entry.flowPaused) {
      this.resumeFlow(entry)
    }
  }

  /**
   * Desengancha todas las terminales y resetea su flow control. Para cuando el
   * renderer se recarga o muere: los cleanups de React nunca corrieron, así que
   * habría entries con attached=true (y ptys posiblemente pausados esperando
   * ACKs que ya no llegarán jamás).
   */
  resetFlowAll(): void {
    for (const [, entry] of this.entries) {
      entry.attached = false
      this.resetFlow(entry)
    }
  }

  /** Deja de emitir datos en vivo (el pty sigue vivo y acumulando buffer) */
  detach(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.attached = false
    // Los ACKs de la card desmontada no llegarán: nunca dejar un pty detached pausado
    this.resetFlow(entry)
  }

  /** Últimas líneas no vacías del buffer, sin secuencias ANSI/OSC (para resúmenes) */
  tail(id: string, maxLines = 3): string {
    const entry = this.entries.get(id)
    if (!entry) return ''
    const clean = entry.buffer.replace(ANSI_RE, '')
    const lines = clean
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    return lines.slice(-maxLines).join('\n')
  }

  /**
   * Detecta BEL "sueltos" (campana real) ignorando los que terminan secuencias
   * OSC (como nuestro propio OSC 9;9 del prompt). Mantiene estado entre chunks.
   */
  private scanBel(entry: Entry, data: string): boolean {
    let bel = false
    for (let i = 0; i < data.length; i++) {
      const ch = data[i]
      switch (entry.oscState) {
        case 0:
          if (ch === '\x1b') entry.oscState = 1
          else if (ch === '\x07') bel = true
          break
        case 1:
          if (ch === ']') entry.oscState = 2
          else if (ch !== '\x1b') entry.oscState = 0
          break
        case 2:
          if (ch === '\x07') entry.oscState = 0
          else if (ch === '\x1b') entry.oscState = 3
          break
        case 3:
          entry.oscState = ch === '\\' || ch === '\x07' ? 0 : 2
          break
      }
    }
    return bel
  }

  write(id: string, data: string): void {
    this.activity.onInput(id)
    this.entries.get(id)?.pty?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) {
      try {
        this.entries.get(id)?.pty?.resize(cols, rows)
      } catch {
        /* pty muerto entre el check y el resize */
      }
    }
  }

  restart(id: string, cols: number, rows: number): void {
    const session = this.store.get(id)
    if (!session) return
    const entry = this.entries.get(id)
    if (entry) this.resetFlow(entry)
    if (entry?.pty) {
      try {
        entry.pty.kill()
      } catch {
        /* ya muerto */
      }
      entry.pty = null
    }
    if (entry) entry.buffer = ''
    this.deletePersisted(id)
    if (session.model !== undefined) {
      this.store.clearModel(id)
      this.getWebContents()?.send('session:model', { id, model: '' })
    }
    this.spawnFor(session, cols, rows)
  }

  private deletePersisted(id: string): void {
    try {
      const file = this.bufferFile(id)
      if (existsSync(file)) unlinkSync(file)
    } catch {
      /* best-effort */
    }
  }

  kill(id: string): void {
    const entry = this.entries.get(id)
    if (entry) this.resetFlow(entry)
    if (entry?.pty) {
      try {
        entry.pty.kill()
      } catch {
        /* ya muerto */
      }
    }
    this.entries.delete(id)
    this.activity.remove(id)
    this.deletePersisted(id)
  }

  disposeAll(): void {
    clearInterval(this.persistTimer)
    clearInterval(this.gitTimer)
    this.flushPersisted()
    for (const [, entry] of this.entries) {
      if (entry.flushTimer) clearTimeout(entry.flushTimer)
      if (entry.pauseGuard) clearTimeout(entry.pauseGuard)
      try {
        entry.pty?.kill()
      } catch {
        /* ignorar */
      }
    }
    this.entries.clear()
  }
}
