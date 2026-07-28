import {
  closeSync,
  existsSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  type Dirent
} from 'fs'
import { copyFileSync, rmSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import type { AgentKind, AgentSessionRef, SessionScanResult } from '../shared/types'

const TAIL_BYTES = 64 * 1024
const HEAD_BYTES = 16 * 1024
const MAX_PER_AGENT = 10
const CACHE_TTL_MS = 30_000

/** id que aceptan --resume/--session; también sirve para validar antes de interpolar en un comando */
export const CLAUDE_QWEN_ID_RE = /^[0-9a-fA-F-]{32,36}$/
export const OPENCODE_ID_RE = /^ses_[A-Za-z0-9_]+$/

function slugClaude(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

function slugQwen(cwd: string): string {
  return cwd.toLowerCase().replace(/[^a-zA-Z0-9]/g, '-')
}

function normalizeCwd(cwd: string): string {
  return cwd.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
}

function readTail(path: string, maxBytes: number): string {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const start = Math.max(0, size - maxBytes)
    const len = size - start
    if (len <= 0) return ''
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, start)
    const nl = buf.indexOf(0x0a)
    return buf.toString('utf8', nl >= 0 ? nl + 1 : 0)
  } finally {
    closeSync(fd)
  }
}

function readHead(path: string, maxBytes: number): string {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const len = Math.min(maxBytes, size)
    if (len <= 0) return ''
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, 0)
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseLines(text: string): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      /* línea partida por el corte del tail/head, ignorar */
    }
  }
  return out
}

function truncate(text: string, max = 80): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

/** Texto plano de un mensaje "user" de Claude Code (content: string | array de bloques) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function claudeUserText(record: any): string | null {
  const content = record?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const block = content.find((b: any) => b?.type === 'text' && typeof b.text === 'string')
    if (block) return block.text
  }
  return null
}

function listJsonlFiles(dir: string, nameRe?: RegExp): { path: string; mtimeMs: number }[] {
  if (!existsSync(dir)) return []
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: { path: string; mtimeMs: number }[] = []
  for (const e of entries) {
    if (!e.isFile()) continue
    if (!e.name.endsWith('.jsonl')) continue
    if (nameRe && !nameRe.test(e.name)) continue
    const path = join(dir, e.name)
    try {
      out.push({ path, mtimeMs: statSync(path).mtimeMs })
    } catch {
      /* el archivo pudo borrarse entre el readdir y el stat */
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out.slice(0, MAX_PER_AGENT)
}

function idFromFile(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  return base.replace(/\.jsonl$/, '')
}

function scanClaude(cwd: string): AgentSessionRef[] {
  const dir = join(homedir(), '.claude', 'projects', slugClaude(cwd))
  const files = listJsonlFiles(dir)
  const wantedCwd = normalizeCwd(cwd)
  const out: AgentSessionRef[] = []
  for (const f of files) {
    let title: string | null = null
    let recordCwd: string | null = null
    try {
      const tailLines = parseLines(readTail(f.path, TAIL_BYTES))
      for (let i = tailLines.length - 1; i >= 0; i--) {
        if (tailLines[i]?.type === 'ai-title' && typeof tailLines[i].aiTitle === 'string') {
          title = tailLines[i].aiTitle
          break
        }
      }
      const headLines = parseLines(readHead(f.path, HEAD_BYTES))
      for (const rec of headLines) {
        if (typeof rec?.cwd === 'string') {
          recordCwd = rec.cwd
          break
        }
      }
      if (!title) {
        for (const rec of headLines) {
          if (rec?.type === 'user') {
            const text = claudeUserText(rec)
            if (text) {
              title = truncate(text)
              break
            }
          }
        }
      }
    } catch {
      continue
    }
    // Descarta colisiones de slug: si el record trae un cwd distinto, no es esta carpeta
    if (recordCwd && normalizeCwd(recordCwd) !== wantedCwd) continue
    out.push({
      agent: 'claude',
      id: idFromFile(f.path),
      title: title ?? '(sin título)',
      cwd: recordCwd ?? cwd,
      updatedAt: f.mtimeMs
    })
  }
  return out
}

function scanQwen(cwd: string): AgentSessionRef[] {
  const dir = join(homedir(), '.qwen', 'projects', slugQwen(cwd), 'chats')
  const files = listJsonlFiles(dir, /^[0-9a-fA-F-]{32,36}\.jsonl$/)
  const wantedCwd = normalizeCwd(cwd)
  const out: AgentSessionRef[] = []
  for (const f of files) {
    let title: string | null = null
    let recordCwd: string | null = null
    try {
      const tailLines = parseLines(readTail(f.path, TAIL_BYTES))
      for (let i = tailLines.length - 1; i >= 0; i--) {
        const rec = tailLines[i]
        if (rec?.type === 'system' && rec?.subtype === 'custom_title' && typeof rec.customTitle === 'string') {
          title = rec.customTitle
          break
        }
      }
      const headLines = parseLines(readHead(f.path, HEAD_BYTES))
      for (const rec of headLines) {
        if (typeof rec?.cwd === 'string') {
          recordCwd = rec.cwd
          break
        }
      }
      if (!title) {
        for (const rec of headLines) {
          if (rec?.type === 'user') {
            const parts = rec?.message?.parts
            const text = Array.isArray(parts)
              ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                parts.find((p: any) => typeof p?.text === 'string')?.text
              : null
            if (text) {
              title = truncate(text)
              break
            }
          }
        }
      }
    } catch {
      continue
    }
    if (recordCwd && normalizeCwd(recordCwd) !== wantedCwd) continue
    out.push({
      agent: 'qwen',
      id: idFromFile(f.path),
      title: title ?? '(sin título)',
      cwd: recordCwd ?? cwd,
      updatedAt: f.mtimeMs
    })
  }
  return out
}

async function scanOpenCode(cwd: string): Promise<AgentSessionRef[]> {
  const dbPath = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')
  if (!existsSync(dbPath)) return []
  const directory = cwd.replace(/\\/g, '/')
  const query =
    'SELECT id, title, directory, time_updated FROM session ' +
    'WHERE directory = ? AND parent_id IS NULL AND time_archived IS NULL ' +
    'ORDER BY time_updated DESC LIMIT ?'

  // node:sqlite es relativamente nuevo (podría faltar o cambiar en un Electron futuro):
  // import perezoso envuelto en try/catch, así OpenCode se apaga solo sin romper la UI.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let DatabaseSync: any
  try {
    ;({ DatabaseSync } = await import('node:sqlite'))
  } catch (err) {
    console.error('[agentSessions] node:sqlite no disponible, se omite OpenCode:', err)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runQuery = (path: string): any[] => {
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      return db.prepare(query).all(directory, MAX_PER_AGENT)
    } finally {
      db.close()
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: any[]
    try {
      rows = runQuery(dbPath)
    } catch {
      // Fallback: copiar la DB (+ WAL/SHM si existen) a un temp y consultar la copia,
      // por si el open directo está bloqueado por otro proceso.
      const tmp = mkdtempSync(join(tmpdir(), 'wingdeck-oc-'))
      const tmpDb = join(tmp, 'opencode.db')
      try {
        copyFileSync(dbPath, tmpDb)
        for (const suffix of ['-wal', '-shm']) {
          if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, tmpDb + suffix)
        }
        rows = runQuery(tmpDb)
      } finally {
        try {
          rmSync(tmp, { recursive: true, force: true })
        } catch {
          /* limpieza best-effort */
        }
      }
    }
    return rows.map((r) => ({
      agent: 'opencode' as const,
      id: String(r.id),
      title: String(r.title ?? '(sin título)'),
      cwd: String(r.directory ?? cwd),
      updatedAt: Number(r.time_updated ?? 0)
    }))
  } catch (err) {
    console.error('[agentSessions] escaneo de OpenCode falló, se omite:', err)
    return []
  }
}

// ── Caché por cwd ─────────────────────────────────

const scanCache = new Map<string, { at: number; result: SessionScanResult }>()
let installedCache: Record<AgentKind, boolean> | null = null
let installedPromise: Promise<Record<AgentKind, boolean>> | null = null

function checkOne(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('where', [bin], { windowsHide: true, timeout: 5000 }, (err) => resolve(!err))
  })
}

/** Cacheado por corrida — también lo usa el asistente de configuración inicial */
export async function getInstalled(): Promise<Record<AgentKind, boolean>> {
  if (installedCache) return installedCache
  if (!installedPromise) {
    installedPromise = (async () => {
      const [claude, qwen, opencode] = await Promise.all([
        checkOne('claude'),
        checkOne('qwen'),
        checkOne('opencode')
      ])
      installedCache = { claude, qwen, opencode }
      return installedCache
    })()
  }
  return installedPromise
}

// Graphify no es un AgentKind (no corre como shell/agente dentro de una terminal, es
// una herramienta externa que los agentes invocan) — se cachea por separado.
let graphifyCache: boolean | null = null
let graphifyPromise: Promise<boolean> | null = null

/** Cacheado por corrida — usado por el asistente de configuración inicial */
export async function checkGraphifyInstalled(): Promise<boolean> {
  if (graphifyCache !== null) return graphifyCache
  if (!graphifyPromise) {
    graphifyPromise = checkOne('graphify').then((v) => {
      graphifyCache = v
      return v
    })
  }
  return graphifyPromise
}

/**
 * Chequeo sincrónico y barato ("¿vale la pena escanear esta carpeta?"), pensado para
 * llamarse dentro de spawnFor() antes de decidir si retener el startupCmd.
 */
export function hasAnyHistoryHint(cwd: string): boolean {
  return existsSync(join(homedir(), '.claude', 'projects', slugClaude(cwd)))
    || existsSync(join(homedir(), '.qwen', 'projects', slugQwen(cwd), 'chats'))
}

export async function scanSessions(cwd: string): Promise<SessionScanResult> {
  const key = normalizeCwd(cwd)
  const cached = scanCache.get(key)
  const now = Date.now()
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.result

  const [claude, qwen, opencode, installed] = await Promise.all([
    Promise.resolve().then(() => scanClaude(cwd)),
    Promise.resolve().then(() => scanQwen(cwd)),
    scanOpenCode(cwd),
    getInstalled()
  ])

  const sessions = [...claude, ...qwen, ...opencode].sort((a, b) => b.updatedAt - a.updatedAt)
  const result: SessionScanResult = { cwd, sessions, installed, scannedAt: now }
  scanCache.set(key, { at: now, result })
  return result
}
