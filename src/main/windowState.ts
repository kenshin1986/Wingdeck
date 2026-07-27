import { app, screen } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

interface WindowState {
  bounds: Bounds
  isMaximized: boolean
}

/** Recuerda tamaño, posición y si estaba maximizada la ventana principal entre reinicios */
export class WindowStateStore {
  private file: string
  private data: WindowState | null = null

  constructor() {
    this.file = join(app.getPath('userData'), 'window-state.json')
    try {
      if (existsSync(this.file)) this.data = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (err) {
      console.error('[window-state] no se pudo leer window-state.json:', err)
    }
  }

  /**
   * Bounds a usar al crear la ventana. Si el monitor donde estaba guardada ya
   * no está conectado (p. ej. se desconectó el monitor externo), se ignoran
   * para que Electron centre la ventana en la pantalla actual.
   */
  initialBounds(): Partial<Bounds> {
    const bounds = this.data?.bounds
    if (!bounds) return {}
    const fitsInSomeDisplay = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return (
        bounds.x < a.x + a.width &&
        bounds.x + bounds.width > a.x &&
        bounds.y < a.y + a.height &&
        bounds.y + bounds.height > a.y
      )
    })
    return fitsInSomeDisplay ? bounds : {}
  }

  wasMaximized(): boolean {
    return this.data?.isMaximized ?? false
  }

  save(bounds: Bounds, isMaximized: boolean): void {
    this.data = { bounds, isMaximized }
    try {
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
    } catch (err) {
      console.error('[window-state] no se pudo guardar window-state.json:', err)
    }
  }
}
