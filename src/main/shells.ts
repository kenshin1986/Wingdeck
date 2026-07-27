import { existsSync } from 'fs'
import { join } from 'path'
import type { ShellInfo, ShellKind } from '../shared/types'

const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'

const candidates: { kind: ShellKind; label: string; paths: string[] }[] = [
  {
    kind: 'pwsh',
    label: 'PowerShell 7',
    paths: [
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
      join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'PowerShell', '7', 'pwsh.exe')
    ]
  },
  {
    kind: 'powershell',
    label: 'Windows PowerShell',
    paths: [join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')]
  },
  {
    kind: 'cmd',
    label: 'CMD',
    paths: [process.env.ComSpec ?? join(systemRoot, 'System32', 'cmd.exe')]
  },
  {
    kind: 'gitbash',
    label: 'Git Bash',
    paths: [
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe')
    ]
  },
  {
    kind: 'wsl',
    label: 'WSL',
    paths: [join(systemRoot, 'System32', 'wsl.exe')]
  }
]

export function detectShells(): ShellInfo[] {
  const found: ShellInfo[] = []
  for (const c of candidates) {
    const path = c.paths.find((p) => p && existsSync(p))
    if (path) found.push({ kind: c.kind, label: c.label, path })
  }
  return found
}

export function shellPath(kind: ShellKind): string | null {
  const info = detectShells().find((s) => s.kind === kind)
  return info?.path ?? null
}
