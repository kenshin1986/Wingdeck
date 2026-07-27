import { existsSync, readFileSync, statSync } from 'fs'
import { dirname, join } from 'path'

interface CacheEntry {
  branch: string | null
  at: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_MS = 5000
const MAX_LEVELS = 6

/** Sube directorios buscando un `.git` (carpeta normal o archivo de worktree) */
function findGitEntry(cwd: string): string | null {
  let dir = cwd
  for (let i = 0; i < MAX_LEVELS; i++) {
    const candidate = join(dir, '.git')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function readHead(gitEntry: string): string | null {
  let headFile = join(gitEntry, 'HEAD')
  if (statSync(gitEntry).isFile()) {
    // Worktree: el archivo .git contiene "gitdir: <ruta>"
    const content = readFileSync(gitEntry, 'utf8').trim()
    const m = /^gitdir:\s*(.+)$/.exec(content)
    if (!m) return null
    headFile = join(m[1], 'HEAD')
  }
  if (!existsSync(headFile)) return null
  const head = readFileSync(headFile, 'utf8').trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
  return ref ? ref[1] : head.slice(0, 7)
}

/** Rama actual del repo que contiene `cwd`, o null si no es un repo git. Cacheado 5s. */
export function branchFor(cwd: string): string | null {
  const now = Date.now()
  const cached = cache.get(cwd)
  if (cached && now - cached.at < CACHE_MS) return cached.branch

  let branch: string | null = null
  try {
    const gitEntry = findGitEntry(cwd)
    if (gitEntry) branch = readHead(gitEntry)
  } catch {
    branch = null
  }

  cache.set(cwd, { branch, at: now })
  return branch
}
