import { app, clipboard } from 'electron'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { PasteContent } from '../shared/types'

function pastesDir(): string {
  const dir = join(app.getPath('userData'), 'pastes')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Elimina PNGs pegados con más de 7 días de antigüedad */
export function cleanupPastes(): void {
  try {
    const dir = pastesDir()
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).mtimeMs < cutoff) unlinkSync(full)
    }
  } catch {
    /* limpieza best-effort */
  }
}

/**
 * Analiza el portapapeles con prioridad: archivos copiados (Explorer) →
 * imagen (captura/copiar imagen) → texto.
 */
export function analyzeClipboard(): PasteContent {
  // Archivos copiados en el Explorador (CF_HDROP → formato FileNameW)
  try {
    const raw = clipboard.readBuffer('FileNameW')
    if (raw && raw.length > 0) {
      const path = raw.toString('ucs2').replace(/\0+$/g, '')
      if (path) return { kind: 'files', paths: [path] }
    }
  } catch {
    /* formato no disponible */
  }

  const img = clipboard.readImage()
  if (!img.isEmpty()) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = join(pastesDir(), `paste-${stamp}.png`)
    writeFileSync(path, img.toPNG())
    return { kind: 'image', path }
  }

  const text = clipboard.readText()
  if (text) return { kind: 'text', text }
  return { kind: 'empty' }
}

export function copyText(text: string): void {
  clipboard.writeText(text)
}
