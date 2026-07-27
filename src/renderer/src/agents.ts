import type { AgentKind } from '../../shared/types'

export const AGENT_META: Record<AgentKind, { label: string; icon: string; color: string }> = {
  claude: { label: 'Claude', icon: '✳', color: '#d97757' },
  qwen: { label: 'Qwen', icon: '◆', color: '#a855f7' },
  opencode: { label: 'OpenCode', icon: '⬡', color: '#34d399' }
}

export function relTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 10) return 'ahora'
  if (s < 60) return `hace ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  return `hace ${h} h ${m % 60} min`
}
