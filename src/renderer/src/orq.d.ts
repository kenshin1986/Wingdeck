import type { OrqApi } from '../../preload'

declare global {
  interface Window {
    orq: OrqApi
  }
}

export {}
