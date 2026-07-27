import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { FleetTemplate } from '../shared/types'

export class TemplateStore {
  private file: string
  private data: FleetTemplate[] = []

  constructor() {
    this.file = join(app.getPath('userData'), 'templates.json')
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
        if (Array.isArray(parsed)) this.data = parsed
      }
    } catch (err) {
      console.error('[templates] no se pudo leer templates.json:', err)
    }
  }

  list(): FleetTemplate[] {
    return this.data
  }

  save(template: FleetTemplate): void {
    this.data = [...this.data.filter((t) => t.name !== template.name), template]
    this.flush()
  }

  delete(name: string): void {
    this.data = this.data.filter((t) => t.name !== name)
    this.flush()
  }

  private flush(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
    } catch (err) {
      console.error('[templates] no se pudo guardar templates.json:', err)
    }
  }
}
