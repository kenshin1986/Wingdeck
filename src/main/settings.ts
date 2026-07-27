import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { AppSettings } from '../shared/types'

const DEFAULTS: AppSettings = {
  copyOnSelect: true,
  flash: true,
  systemNotif: true,
  sound: true,
  idleAfterMs: 6000,
  persistScrollback: true,
  askOnQuit: true,
  onboardingDone: false
}

export class SettingsStore {
  private file: string
  private data: AppSettings = { ...DEFAULTS }

  constructor() {
    this.file = join(app.getPath('userData'), 'settings.json')
    try {
      if (existsSync(this.file)) {
        this.data = { ...DEFAULTS, ...JSON.parse(readFileSync(this.file, 'utf8')) }
      }
    } catch (err) {
      console.error('[settings] no se pudo leer settings.json:', err)
    }
  }

  get(): AppSettings {
    return { ...this.data }
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.data = { ...this.data, ...patch }
    try {
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
    } catch (err) {
      console.error('[settings] no se pudo guardar settings.json:', err)
    }
    return this.get()
  }
}
