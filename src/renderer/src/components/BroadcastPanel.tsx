import { useState } from 'react'
import type { TerminalSession } from '../../../shared/types'
import { useClickOutside } from '../hooks'

interface Props {
  sessions: TerminalSession[]
}

export function BroadcastPanel({ sessions }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [queueMode, setQueueMode] = useState(false)
  const ref = useClickOutside(open, () => setOpen(false))

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = sessions.length > 0 && selected.size === sessions.length

  const send = async (): Promise<void> => {
    const message = text.trim()
    if (!message || selected.size === 0) return
    for (const id of selected) {
      if (queueMode) await window.orq.queueAdd(id, message)
      else window.orq.write(id, message + '\r')
    }
    setText('')
    setOpen(false)
  }

  return (
    <div className="broadcast-menu" ref={ref}>
      <button
        className="btn-secondary"
        title="Enviar el mismo mensaje a varias terminales"
        onClick={() => setOpen((v) => !v)}
      >
        📢 Broadcast
      </button>
      {open && (
        <div className="menu broadcast-panel">
          <div className="act-panel-head">Enviar a varias terminales</div>
          {sessions.length === 0 ? (
            <div className="act-empty">No hay terminales en este workspace.</div>
          ) : (
            <>
              <div className="broadcast-list">
                <label className="cfg-row">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(sessions.map((s) => s.id)) : new Set())
                    }
                  />
                  <strong>Todas</strong>
                </label>
                {sessions.map((s) => (
                  <label key={s.id} className="cfg-row">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                    {s.title}
                  </label>
                ))}
              </div>
              <div className="menu-divider" />
              <textarea
                className="broadcast-textarea"
                placeholder="Mensaje a enviar…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send()
                }}
                rows={3}
                autoFocus
              />
              <label className="cfg-row">
                <input
                  type="checkbox"
                  checked={queueMode}
                  onChange={(e) => setQueueMode(e.target.checked)}
                />
                Encolar (esperar a que cada agente quede libre)
              </label>
              <button className="btn-primary broadcast-send" onClick={send}>
                Enviar a {selected.size || 0} terminal(es)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
