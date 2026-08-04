import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type {
  AgentKind,
  OwnedAgentSession,
  TerminalSession,
  TermLayout,
  WorkspacesInfo,
  FleetTemplateTerminal
} from '../shared/types'

interface WorkspaceData {
  terminals: TerminalSession[]
}

interface SessionFileV2 {
  version: 2
  counter: number
  active: string
  workspaces: Record<string, WorkspaceData>
}

const DEFAULT_WS = 'General'
/** Máximo de sesiones de agente asociadas que se recuerdan por terminal */
const MAX_OWNED_SESSIONS = 20

export class SessionStore {
  private file: string
  private data: SessionFileV2 = {
    version: 2,
    counter: 1,
    active: DEFAULT_WS,
    workspaces: { [DEFAULT_WS]: { terminals: [] } }
  }
  private saveTimer: NodeJS.Timeout | null = null

  constructor() {
    this.file = join(app.getPath('userData'), 'session.json')
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      if (parsed?.version === 2 && parsed.workspaces) {
        this.data = parsed as SessionFileV2
        if (!this.data.workspaces[this.data.active]) {
          this.data.active = Object.keys(this.data.workspaces)[0] ?? DEFAULT_WS
          if (!this.data.workspaces[this.data.active]) {
            this.data.workspaces[DEFAULT_WS] = { terminals: [] }
            this.data.active = DEFAULT_WS
          }
        }
      } else if (Array.isArray(parsed?.terminals)) {
        // Migración del formato v1 (un solo espacio de trabajo)
        this.data = {
          version: 2,
          counter: parsed.counter ?? parsed.terminals.length + 1,
          active: DEFAULT_WS,
          workspaces: { [DEFAULT_WS]: { terminals: parsed.terminals } }
        }
        this.save()
      }
    } catch (err) {
      console.error('[session] no se pudo leer session.json:', err)
    }
  }

  private get activeWs(): WorkspaceData {
    return this.data.workspaces[this.data.active]
  }

  get terminals(): TerminalSession[] {
    return this.activeWs.terminals
  }

  get workspacesInfo(): WorkspacesInfo {
    return { active: this.data.active, names: Object.keys(this.data.workspaces) }
  }

  /** Terminales de un workspace específico (no necesariamente el activo) */
  terminalsOf(workspace: string): TerminalSession[] {
    return this.data.workspaces[workspace]?.terminals ?? []
  }

  /** Nombre del workspace que contiene la terminal */
  workspaceOf(id: string): string | null {
    for (const [name, ws] of Object.entries(this.data.workspaces)) {
      if (ws.terminals.some((t) => t.id === id)) return name
    }
    return null
  }

  /** Busca en todos los workspaces (los ptys pueden seguir vivos en segundo plano) */
  get(id: string): TerminalSession | undefined {
    for (const ws of Object.values(this.data.workspaces)) {
      const t = ws.terminals.find((s) => s.id === id)
      if (t) return t
    }
    return undefined
  }

  create(partial: Omit<TerminalSession, 'id' | 'createdAt' | 'color'>): TerminalSession {
    const id = `t${this.data.counter++}`
    const session: TerminalSession = {
      ...partial,
      id,
      color: (this.data.counter - 1) % 6,
      createdAt: Date.now()
    }
    this.activeWs.terminals.push(session)
    this.save()
    return session
  }

  remove(id: string): void {
    for (const ws of Object.values(this.data.workspaces)) {
      ws.terminals = ws.terminals.filter((t) => t.id !== id)
    }
    this.save()
  }

  updateCwd(id: string, cwd: string): void {
    const t = this.get(id)
    if (t && t.cwd !== cwd) {
      t.cwd = cwd
      this.save()
    }
  }

  updateTitle(id: string, title: string): void {
    const t = this.get(id)
    if (t) {
      t.title = title
      this.save()
    }
  }

  updateStartupCmd(id: string, cmd: string): void {
    const t = this.get(id)
    if (t) {
      const clean = cmd.trim()
      if (clean) t.startupCmd = clean
      else delete t.startupCmd
      this.save()
    }
  }

  updateModel(id: string, model: string): void {
    const t = this.get(id)
    if (t && t.model !== model) {
      t.model = model
      this.save()
    }
  }

  clearModel(id: string): void {
    const t = this.get(id)
    if (t && t.model !== undefined) {
      delete t.model
      this.save()
    }
  }

  updateFontSize(id: string, fontSize: number): void {
    const t = this.get(id)
    if (t) {
      t.fontSize = fontSize
      this.save()
    }
  }

  updatePinned(id: string, pinned: boolean): void {
    const t = this.get(id)
    if (t) {
      if (pinned) t.pinned = true
      else delete t.pinned
      this.save()
    }
  }

  updateDescription(id: string, text: string): void {
    const t = this.get(id)
    if (t) {
      const clean = text.trim()
      if (clean) t.description = clean
      else delete t.description
      this.save()
    }
  }

  /**
   * Asocia una sesión de agente a esta terminal. Si otra terminal ya la tenía
   * (p. ej. se retomó acá una sesión ajena), la propiedad se transfiere.
   */
  claimAgentSession(termId: string, agent: AgentKind, sessionId: string): void {
    const target = this.get(termId)
    if (!target) return
    for (const ws of Object.values(this.data.workspaces)) {
      for (const t of ws.terminals) {
        if (t.id === termId || !t.agentSessions) continue
        const rest = t.agentSessions.filter((s) => !(s.agent === agent && s.id === sessionId))
        if (rest.length !== t.agentSessions.length) {
          if (rest.length > 0) t.agentSessions = rest
          else delete t.agentSessions
        }
      }
    }
    const rest = (target.agentSessions ?? []).filter(
      (s) => !(s.agent === agent && s.id === sessionId)
    )
    target.agentSessions = [{ agent, id: sessionId, at: Date.now() }, ...rest].slice(
      0,
      MAX_OWNED_SESSIONS
    )
    this.save()
  }

  /** Terminal dueña de esa sesión de agente, o null si nadie la reclamó */
  ownerOf(agent: AgentKind, sessionId: string): string | null {
    for (const ws of Object.values(this.data.workspaces)) {
      for (const t of ws.terminals) {
        if (t.agentSessions?.some((s) => s.agent === agent && s.id === sessionId)) return t.id
      }
    }
    return null
  }

  /** Sesiones de agente asociadas a la terminal (más reciente primero) */
  ownedSessionsOf(termId: string): OwnedAgentSession[] {
    return this.get(termId)?.agentSessions ?? []
  }

  setResumeOverlay(id: string, mode: 'auto' | 'never'): void {
    const t = this.get(id)
    if (t) {
      if (mode === 'auto') delete t.resumeOverlay
      else t.resumeOverlay = mode
      this.save()
    }
  }

  // ── Cola de prompts ─────────────────────────────

  queueAdd(id: string, prompt: string): TerminalSession | undefined {
    const t = this.get(id)
    if (!t) return undefined
    const clean = prompt.trim()
    if (!clean) return t
    t.queue = [...(t.queue ?? []), clean]
    this.save()
    return t
  }

  /** Igual que queueAdd, pero al frente — para mensajes de arranque que deben ir primero */
  queueUnshift(id: string, prompt: string): TerminalSession | undefined {
    const t = this.get(id)
    if (!t) return undefined
    const clean = prompt.trim()
    if (!clean) return t
    t.queue = [clean, ...(t.queue ?? [])]
    this.save()
    return t
  }

  queueRemove(id: string, index: number): TerminalSession | undefined {
    const t = this.get(id)
    if (!t?.queue) return t
    t.queue = t.queue.filter((_, i) => i !== index)
    this.save()
    return t
  }

  queuePause(id: string, paused: boolean): TerminalSession | undefined {
    const t = this.get(id)
    if (!t) return undefined
    t.queuePaused = paused
    this.save()
    return t
  }

  /** Extrae el próximo prompt de la cola (lo remueve) */
  queueShift(id: string): string | undefined {
    const t = this.get(id)
    if (!t?.queue || t.queue.length === 0) return undefined
    const [next, ...rest] = t.queue
    t.queue = rest
    this.save()
    return next
  }

  updateLayouts(items: ({ id: string } & TermLayout)[]): void {
    let changed = false
    for (const item of items) {
      const t = this.get(item.id)
      if (!t) continue
      const { x, y, w, h } = item
      if (t.layout.x !== x || t.layout.y !== y || t.layout.w !== w || t.layout.h !== h) {
        t.layout = { x, y, w, h }
        changed = true
      }
    }
    if (changed) this.save()
  }

  /** Terminales del workspace activo en forma de plantilla (para guardar) */
  captureActiveAsTemplate(): FleetTemplateTerminal[] {
    return this.activeWs.terminals.map((t) => ({
      shell: t.shell,
      cwd: t.cwd,
      title: t.title,
      startupCmd: t.startupCmd,
      layout: t.layout,
      color: t.color,
      description: t.description
    }))
  }

  /** Nombre libre a partir de `base` (agrega sufijo numérico si ya existe) */
  private freeWorkspaceName(base: string): string {
    if (!this.data.workspaces[base]) return base
    let n = 2
    while (this.data.workspaces[`${base} ${n}`]) n++
    return `${base} ${n}`
  }

  /** Crea un workspace nuevo y lo puebla con los terminales de una plantilla */
  launchTemplate(templateName: string, terminals: FleetTemplateTerminal[]): TerminalSession[] {
    const wsName = this.freeWorkspaceName(templateName)
    this.data.workspaces[wsName] = { terminals: [] }
    this.data.active = wsName
    for (const t of terminals) {
      const id = `t${this.data.counter++}`
      this.activeWs.terminals.push({
        id,
        title: t.title,
        shell: t.shell,
        cwd: t.cwd,
        layout: t.layout,
        color: t.color,
        createdAt: Date.now(),
        startupCmd: t.startupCmd,
        description: t.description
      })
    }
    this.save()
    return this.terminals
  }

  // ── Workspaces ──────────────────────────────────

  switchWorkspace(name: string): TerminalSession[] {
    if (this.data.workspaces[name]) {
      this.data.active = name
      this.save()
    }
    return this.terminals
  }

  createWorkspace(name: string): boolean {
    const clean = name.trim()
    if (!clean || this.data.workspaces[clean]) return false
    this.data.workspaces[clean] = { terminals: [] }
    this.data.active = clean
    this.save()
    return true
  }

  renameWorkspace(oldName: string, newName: string): boolean {
    const clean = newName.trim()
    if (!clean || !this.data.workspaces[oldName] || this.data.workspaces[clean]) return false
    const rebuilt: Record<string, WorkspaceData> = {}
    for (const [key, value] of Object.entries(this.data.workspaces)) {
      rebuilt[key === oldName ? clean : key] = value
    }
    this.data.workspaces = rebuilt
    if (this.data.active === oldName) this.data.active = clean
    this.save()
    return true
  }

  /** Devuelve los ids de terminales del workspace eliminado (para matar sus ptys) */
  deleteWorkspace(name: string): string[] {
    const ws = this.data.workspaces[name]
    if (!ws || Object.keys(this.data.workspaces).length === 0) return []
    const ids = ws.terminals.map((t) => t.id)
    delete this.data.workspaces[name]
    if (Object.keys(this.data.workspaces).length === 0) {
      this.data.workspaces[DEFAULT_WS] = { terminals: [] }
    }
    if (this.data.active === name) {
      this.data.active = Object.keys(this.data.workspaces)[0]
    }
    this.save()
    return ids
  }

  save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 400)
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    try {
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
    } catch (err) {
      console.error('[session] no se pudo guardar session.json:', err)
    }
  }
}
