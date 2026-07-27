import { useState } from 'react'
import type { ActivityEvent } from '../../../shared/types'
import { AGENT_META, relTime } from '../agents'
import { useClickOutside, useNow } from '../hooks'

interface Props {
  events: ActivityEvent[]
  unseen: number
  onOpen: () => void
  onJump: (id: string, workspace: string) => void
  onClear: () => void
}

export function ActivityCenter({ events, unseen, onOpen, onJump, onClear }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(open, () => setOpen(false))
  const now = useNow()

  return (
    <div className="act-menu" ref={ref}>
      <button
        className={`act-bell ${unseen > 0 ? 'has-unseen' : ''}`}
        title="Centro de actividad"
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) onOpen()
        }}
      >
        🔔
        {unseen > 0 && <span className="act-badge">{unseen}</span>}
      </button>
      {open && (
        <div className="menu act-panel">
          <div className="act-panel-head">
            <span>Actividad de agentes</span>
            {events.length > 0 && (
              <button className="act-clear" onClick={onClear}>
                Limpiar
              </button>
            )}
          </div>
          {events.length === 0 && (
            <div className="act-empty">
              Sin eventos todavía. Cuando un agente termine de trabajar en una terminal, aparecerá
              aquí.
            </div>
          )}
          {events.map((ev, i) => {
            const meta = ev.agent ? AGENT_META[ev.agent] : null
            const icon = ev.type === 'queue' ? '▶' : ev.type === 'cpu' ? '⚠' : (meta?.icon ?? '❯')
            const color = ev.type === 'queue' ? '#7aa2f7' : ev.type === 'cpu' ? '#f7768e' : (meta?.color ?? '#7d8aa0')
            const title =
              ev.type === 'queue'
                ? `Prompt enviado${ev.remaining ? ` — quedan ${ev.remaining}` : ''}`
                : ev.type === 'cpu'
                  ? 'CPU alta sostenida'
                  : meta
                    ? `${meta.label} terminó`
                    : 'Terminal en espera'
            return (
              <button
                key={`${ev.id}-${ev.at}-${i}`}
                className="act-event"
                onClick={() => {
                  setOpen(false)
                  onJump(ev.id, ev.workspace)
                }}
              >
                <span className="act-event-icon" style={{ color }}>
                  {icon}
                </span>
                <span className="act-event-body">
                  <span className="act-event-title">{title}</span>
                  <span className="act-event-detail">
                    {ev.title} · {ev.workspace}
                  </span>
                  {ev.snippet && <span className="act-event-snippet">{ev.snippet}</span>}
                </span>
                <span className="act-event-time">{relTime(ev.at, now)}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
