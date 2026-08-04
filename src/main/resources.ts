import { spawn, execFile, type ChildProcess } from 'child_process'
import { cpus, totalmem, freemem } from 'os'
import { createInterface } from 'readline'
import type { AgentKind, ResourceSnapshot, TermStats } from '../shared/types'

interface ProcSample {
  ppid: number
  ws: number
  cpuTime: number // unidades de 100ns (user + kernel)
  name: string
}

const MONITOR_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  'while($true){',
  "  $s=(Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId),$($_.ParentProcessId),$($_.WorkingSetSize),$($_.UserModeTime+$_.KernelModeTime),$($_.Name)\" }) -join ';'",
  '  [Console]::Out.WriteLine("SNAP|$s")',
  '  Start-Sleep -Milliseconds 2500',
  '}'
].join('\n')

const psExe = (): string =>
  `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`

/** Procesos que pueden hospedar un agente vía script (hay que mirar su CommandLine) */
const HOST_PROCS = new Set(['node.exe', 'bun.exe', 'deno.exe'])

function agentFromString(s: string): AgentKind | null {
  const l = s.toLowerCase()
  if (l.includes('claude')) return 'claude'
  if (l.includes('qwen')) return 'qwen'
  if (l.includes('opencode')) return 'opencode'
  return null
}

export class ResourceMonitor {
  private proc: ChildProcess | null = null
  private prevProcs = new Map<number, ProcSample>()
  private prevTime = 0
  private prevCpuTimes = cpus()
  private stopped = false
  /** pid → agente detectado por CommandLine (null = consultado, sin agente) */
  private cmdlineCache = new Map<number, AgentKind | null>()
  private cmdlineQueryRunning = false
  /** Último árbol de pids visto por terminal (para reaplicar prioridad de CPU al togglear) */
  private lastTrees = new Map<string, number[]>()

  start(getPids: () => Record<string, number>, emit: (snap: ResourceSnapshot) => void): void {
    this.proc = spawn(psExe(), ['-NoProfile', '-NonInteractive', '-Command', MONITOR_SCRIPT], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const rl = createInterface({ input: this.proc.stdout! })
    rl.on('line', (line) => {
      if (!line.startsWith('SNAP|')) return
      try {
        emit(this.buildSnapshot(line.slice(5), getPids()))
      } catch (err) {
        console.error('[resources] error procesando snapshot:', err)
      }
    })

    this.proc.on('exit', () => {
      this.proc = null
      if (!this.stopped) {
        setTimeout(() => !this.stopped && this.start(getPids, emit), 5000)
      }
    })
  }

  private buildSnapshot(payload: string, termPids: Record<string, number>): ResourceSnapshot {
    const now = Date.now()
    const procs = new Map<number, ProcSample>()
    const children = new Map<number, number[]>()

    for (const part of payload.split(';')) {
      const fields = part.split(',')
      const pid = Number(fields[0])
      if (!Number.isFinite(pid)) continue
      const ppid = Number(fields[1]) || 0
      procs.set(pid, {
        ppid,
        ws: Number(fields[2]) || 0,
        cpuTime: Number(fields[3]) || 0,
        name: fields.slice(4).join(',').toLowerCase()
      })
      const arr = children.get(ppid)
      if (arr) arr.push(pid)
      else children.set(ppid, [pid])
    }

    const elapsedMs = this.prevTime ? now - this.prevTime : 0
    const cores = cpus().length

    const terminals: Record<string, TermStats> = {}
    const unknownHostPids: number[] = []

    for (const [termId, rootPid] of Object.entries(termPids)) {
      if (!procs.has(rootPid)) continue
      let mem = 0
      let cpuDelta = 0
      let count = 0
      let agent: AgentKind | null = null
      const stack = [rootPid]
      const seen = new Set<number>()
      while (stack.length) {
        const pid = stack.pop()!
        if (seen.has(pid)) continue
        seen.add(pid)
        const p = procs.get(pid)
        if (!p) continue
        count++
        mem += p.ws
        const prev = this.prevProcs.get(pid)
        if (prev && elapsedMs > 0) {
          cpuDelta += Math.max(0, p.cpuTime - prev.cpuTime)
        }
        if (!agent) {
          agent = agentFromString(p.name)
          if (!agent && HOST_PROCS.has(p.name)) {
            const cached = this.cmdlineCache.get(pid)
            if (cached !== undefined) agent = cached
            else unknownHostPids.push(pid)
          }
        }
        for (const child of children.get(pid) ?? []) stack.push(child)
      }
      // cpuTime en 100ns => delta / (ms * 10000) es fracción de un núcleo
      const cpu = elapsedMs > 0 ? (cpuDelta / (elapsedMs * 10_000) / cores) * 100 : 0
      terminals[termId] = { cpu: Math.min(100, cpu), mem, procs: count, agent }
      // Nunca exponer procesos Wingdeck en el árbol (p. ej. una segunda instancia
      // transitoria lanzada desde una terminal): applyAgentPriority usa esta
      // lista para cambiar prioridades y degradar la propia app la congelaría.
      this.lastTrees.set(
        termId,
        [...seen].filter((p) => procs.get(p)?.name !== 'wingdeck.exe')
      )
      if (process.env.ORQ_DEBUG) {
        const names = [...seen].map((p) => procs.get(p)?.name).filter(Boolean)
        console.error(`[res-debug] ${termId} root=${rootPid} tree=${names.join('|')} agent=${agent}`)
      }
    }

    // Purgar del caché los pids que ya no existen (evita confundir pids reciclados)
    for (const pid of this.cmdlineCache.keys()) {
      if (!procs.has(pid)) this.cmdlineCache.delete(pid)
    }

    if (unknownHostPids.length > 0) this.queryCmdlines(unknownHostPids)

    this.prevProcs = procs
    this.prevTime = now

    return {
      global: {
        cpu: this.globalCpu(),
        memUsed: totalmem() - freemem(),
        memTotal: totalmem(),
        cores
      },
      terminals
    }
  }

  /** Consulta puntual de CommandLine solo para pids desconocidos (con caché) */
  private queryCmdlines(pids: number[]): void {
    if (this.cmdlineQueryRunning) return
    this.cmdlineQueryRunning = true
    const filter = pids.map((p) => `ProcessId=${p}`).join(' OR ')
    const script = `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`
    execFile(
      psExe(),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 10000 },
      (err, stdout) => {
        this.cmdlineQueryRunning = false
        if (process.env.ORQ_DEBUG) {
          console.error(`[res-debug] cmdline query pids=${pids} err=${err?.message ?? 'no'} out=${stdout?.slice(0, 200)}`)
        }
        if (err) return
        const answered = new Set<number>()
        for (const line of stdout.split(/\r?\n/)) {
          const sep = line.indexOf('|')
          if (sep < 0) continue
          const pid = Number(line.slice(0, sep))
          if (!Number.isFinite(pid)) continue
          answered.add(pid)
          this.cmdlineCache.set(pid, agentFromString(line.slice(sep + 1)))
        }
        // pids que no respondieron (proceso terminó): marcarlos sin agente
        for (const pid of pids) {
          if (!answered.has(pid)) this.cmdlineCache.set(pid, null)
        }
      }
    )
  }

  /** Snapshot del último árbol de pids conocido por terminal (best-effort, hasta 2.5s viejo) */
  trees(): Record<string, number[]> {
    return Object.fromEntries(this.lastTrees)
  }

  private globalCpu(): number {
    const current = cpus()
    let busy = 0
    let total = 0
    for (let i = 0; i < current.length; i++) {
      const c = current[i].times
      const p = this.prevCpuTimes[i]?.times ?? c
      const dIdle = c.idle - p.idle
      const dTotal = c.user - p.user + (c.nice - p.nice) + (c.sys - p.sys) + (c.irq - p.irq) + dIdle
      busy += dTotal - dIdle
      total += dTotal
    }
    this.prevCpuTimes = current
    return total > 0 ? (busy / total) * 100 : 0
  }

  stop(): void {
    this.stopped = true
    this.proc?.kill()
    this.proc = null
  }
}
