import { useEffect, useState } from 'react'
import type { FleetTemplate, WorkspaceResult } from '../../../shared/types'
import { useClickOutside } from '../hooks'

interface Props {
  onLaunch: (result: WorkspaceResult) => void
}

export function FleetMenu({ onLaunch }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<FleetTemplate[]>([])
  const [saveName, setSaveName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const ref = useClickOutside(open, () => {
    setOpen(false)
    setConfirmDelete(null)
  })

  useEffect(() => {
    if (open) window.orq.listTemplates().then(setTemplates)
  }, [open])

  const launch = async (name: string): Promise<void> => {
    setOpen(false)
    onLaunch(await window.orq.launchTemplate(name))
  }

  const saveCurrent = async (): Promise<void> => {
    const name = saveName.trim()
    if (!name) return
    setTemplates(await window.orq.saveTemplate(name))
    setSaveName('')
  }

  const remove = async (name: string): Promise<void> => {
    setTemplates(await window.orq.deleteTemplate(name))
    setConfirmDelete(null)
  }

  return (
    <div className="fleet-menu" ref={ref}>
      <button className="btn-secondary" title="Plantillas de flota" onClick={() => setOpen((v) => !v)}>
        🚀 Flotas
      </button>
      {open && (
        <div className="menu fleet-panel">
          <div className="act-panel-head">Plantillas de flota</div>
          {templates.length === 0 && (
            <div className="act-empty">
              Sin plantillas todavía. Arma un workspace con tus terminales (shell, carpeta y comando
              de arranque) y guárdalo abajo para volver a lanzarlo con un clic.
            </div>
          )}
          {templates.map((tpl) => (
            <div key={tpl.name} className="menu-row">
              <button className="menu-item" onClick={() => launch(tpl.name)}>
                <span className="menu-icon">🚀</span>
                {tpl.name}
                <span className="fleet-count">{tpl.terminals.length}</span>
              </button>
              <button
                className={`menu-folder ${confirmDelete === tpl.name ? 'is-danger' : ''}`}
                title={confirmDelete === tpl.name ? 'Confirmar eliminación' : 'Eliminar plantilla'}
                onClick={() =>
                  confirmDelete === tpl.name ? remove(tpl.name) : setConfirmDelete(tpl.name)
                }
              >
                {confirmDelete === tpl.name ? '¿✓?' : '🗑'}
              </button>
            </div>
          ))}
          <div className="menu-divider" />
          <div className="menu-row">
            <input
              className="ws-input"
              placeholder="Guardar workspace actual como…"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveCurrent()}
            />
            <button className="menu-folder" title="Guardar" onClick={saveCurrent}>
              ＋
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
