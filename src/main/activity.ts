import type { ActivityEvent, ActivityInfo, ActivityState, AgentKind, AppSettings } from '../shared/types'

/** Racha mínima de salida continua para considerar que "un agente estuvo trabajando" */
const MIN_WORK_MS = 8000
/** CPU del árbol de procesos por debajo de esto se considera ocioso */
const CPU_IDLE_THRESHOLD = 5

interface TermActivity {
  lastOutputAt: number
  busySince: number
  state: ActivityState
  stateSince: number
}

interface TrackerDeps {
  settings: () => AppSettings
  getInfo: (id: string) => { title: string; workspace: string } | null
  getAgent: (id: string) => AgentKind | null
  getTail: (id: string) => string
  emitState: (info: ActivityInfo) => void
  emitDone: (ev: ActivityEvent) => void
  /**
   * Se llama antes de disparar "attention". Si devuelve true (p. ej. la cola de
   * prompts tenía algo pendiente y lo envió), la terminal se considera atendida
   * y NO se emite el evento de atención.
   */
  beforeAttention: (id: string) => boolean
}

export class ActivityTracker {
  private map = new Map<string, TermActivity>()
  private cpu = new Map<string, number>()
  private timer: NodeJS.Timeout | null = null

  constructor(private deps: TrackerDeps) {}

  start(): void {
    this.timer = setInterval(() => this.tick(), 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private setState(id: string, a: TermActivity, state: ActivityState): void {
    if (a.state === state) return
    a.state = state
    a.stateSince = Date.now()
    this.deps.emitState({ id, state, since: a.stateSince })
  }

  private entry(id: string): TermActivity {
    let a = this.map.get(id)
    if (!a) {
      const now = Date.now()
      a = { lastOutputAt: now, busySince: now, state: 'idle', stateSince: now }
      this.map.set(id, a)
    }
    return a
  }

  onOutput(id: string, hasBel: boolean): void {
    const a = this.entry(id)
    const now = Date.now()
    a.lastOutputAt = now
    if (a.state !== 'working') {
      a.busySince = now
      // La campana con salida simultánea gana: el agente pide atención explícitamente
      if (!hasBel) this.setState(id, a, 'working')
    }
    if (hasBel) this.fireAttention(id, a)
  }

  /** El usuario tecleó en la terminal: cuenta como "visto" */
  onInput(id: string): void {
    const a = this.map.get(id)
    if (a && a.state === 'attention') this.setState(id, a, 'working')
  }

  /** El usuario enfocó/click en la terminal */
  seen(id: string): void {
    const a = this.map.get(id)
    if (!a || a.state !== 'attention') return
    const settings = this.deps.settings()
    const active = Date.now() - a.lastOutputAt < settings.idleAfterMs
    this.setState(id, a, active ? 'working' : 'idle')
  }

  updateCpu(id: string, cpuPct: number): void {
    this.cpu.set(id, cpuPct)
  }

  remove(id: string): void {
    this.map.delete(id)
    this.cpu.delete(id)
  }

  attentionCount(): number {
    let n = 0
    for (const a of this.map.values()) if (a.state === 'attention') n++
    return n
  }

  states(): ActivityInfo[] {
    return [...this.map.entries()].map(([id, a]) => ({ id, state: a.state, since: a.stateSince }))
  }

  private fireAttention(id: string, a: TermActivity): void {
    if (a.state === 'attention') return
    if (this.deps.beforeAttention(id)) {
      // La cola de prompts consumió esta oportunidad: seguimos "trabajando"
      a.busySince = Date.now()
      this.setState(id, a, 'working')
      return
    }
    this.setState(id, a, 'attention')
    const info = this.deps.getInfo(id)
    if (info) {
      this.deps.emitDone({
        id,
        title: info.title,
        workspace: info.workspace,
        agent: this.deps.getAgent(id),
        at: Date.now(),
        type: 'done',
        snippet: this.deps.getTail(id)
      })
    }
  }

  private tick(): void {
    const now = Date.now()
    const { idleAfterMs } = this.deps.settings()
    for (const [id, a] of this.map) {
      if (a.state !== 'working') continue
      const silent = now - a.lastOutputAt > idleAfterMs
      const cpuIdle = (this.cpu.get(id) ?? 0) < CPU_IDLE_THRESHOLD
      if (!silent || !cpuIdle) continue
      const workDuration = a.lastOutputAt - a.busySince
      if (workDuration >= MIN_WORK_MS) {
        this.fireAttention(id, a)
      } else if (this.deps.beforeAttention(id)) {
        // Racha demasiado corta para "attention", pero la cola tenía algo pendiente:
        // seguimos avanzando la cola aunque el comando anterior haya sido instantáneo.
        a.busySince = now
      } else {
        this.setState(id, a, 'idle')
      }
    }
  }
}
