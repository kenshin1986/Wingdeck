import { useEffect, useRef, useState } from 'react'
import type { TerminalSession } from '../../../shared/types'
import { useClickOutside } from '../hooks'
import { relTime } from '../agents'

interface Props {
  workspace: string
  sessions: TerminalSession[]
}

export function BrainPanel({ workspace, sessions }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [staleExternally, setStaleExternally] = useState(false)
  const [unseen, setUnseen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hasBackup, setHasBackup] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [reviewMsg, setReviewMsg] = useState<string | null>(null)
  const ref = useClickOutside(open, () => setOpen(false))
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const workspaceRef = useRef(workspace)
  workspaceRef.current = workspace
  const openRef = useRef(open)
  openRef.current = open

  const load = async (): Promise<void> => {
    setLoading(true)
    const [brain, backup] = await Promise.all([
      window.orq.getBrain(workspace),
      window.orq.getBrainBackup(workspace)
    ])
    setContent(brain.content)
    setUpdatedAt(brain.updatedAt)
    setHasBackup(backup !== null)
    setStaleExternally(false)
    setConfirmRestore(false)
    setLoading(false)
  }

  useEffect(() => {
    if (open) {
      setUnseen(false)
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspace])

  useEffect(() => {
    return window.orq.onBrainUpdated((changedWorkspace) => {
      if (changedWorkspace !== workspaceRef.current) return
      if (openRef.current) setStaleExternally(true)
      else setUnseen(true)
    })
  }, [])

  const onChange = (value: string): void => {
    setContent(value)
    setStaleExternally(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      window.orq.saveBrain(workspace, value)
    }, 600)
  }

  const restore = async (): Promise<void> => {
    if (!confirmRestore) {
      setConfirmRestore(true)
      return
    }
    const brain = await window.orq.restoreBrainBackup(workspace)
    setContent(brain.content)
    setUpdatedAt(brain.updatedAt)
    setConfirmRestore(false)
    // Después de restaurar, la versión reemplazada queda disponible como backup (swap reversible)
    setHasBackup(true)
  }

  const requestReview = async (): Promise<void> => {
    const count = await window.orq.broadcastBrainReview(workspace)
    setReviewMsg(count > 0 ? `Se pidió repasar a ${count} terminal(es).` : 'No hay terminales con agente en este workspace.')
    setTimeout(() => setReviewMsg(null), 4000)
  }

  const agentSessions = sessions.filter((s) => s.startupCmd?.trim())

  return (
    <div className="brain-menu" ref={ref}>
      <button
        className="btn-secondary brain-button"
        title="Memoria compartida de este workspace entre sus agentes"
        onClick={() => setOpen((v) => !v)}
      >
        🧠 Memoria
        {unseen && <span className="brain-badge" />}
      </button>
      {open && (
        <div className="menu brain-panel">
          <div className="act-panel-head">
            <span>Memoria del workspace</span>
            <span className="brain-updated">
              {updatedAt ? `actualizado ${relTime(updatedAt)}` : 'sin guardar aún'}
            </span>
          </div>
          {staleExternally && (
            <div className="brain-stale">
              <span>Un agente actualizó este archivo por fuera de ORQ.</span>
              <button className="menu-folder" onClick={load}>
                ↺ Recargar
              </button>
            </div>
          )}
          <textarea
            className="brain-textarea"
            value={content}
            onChange={(e) => onChange(e.target.value)}
            placeholder={loading ? 'Cargando…' : ''}
            spellCheck={false}
          />
          <div className="brain-actions">
            {hasBackup && (
              <button className="brain-link" onClick={restore}>
                {confirmRestore ? '¿Confirmar? (se puede deshacer)' : '↺ Restaurar versión anterior'}
              </button>
            )}
            {agentSessions.length > 0 && (
              <button className="brain-link" onClick={requestReview} title="Pedirles a los agentes que relean y actualicen el cerebro ahora, sin reiniciarlos">
                🔄 Repasar con los agentes
              </button>
            )}
          </div>
          {reviewMsg && <span className="brain-review-msg">{reviewMsg}</span>}
          <span className="cmd-hint">
            Se le indica esta ruta a cada terminal con comando de arranque (⚡) — el agente
            puede leerla y editarla con sus propias herramientas de archivo.
          </span>
        </div>
      )}
    </div>
  )
}
