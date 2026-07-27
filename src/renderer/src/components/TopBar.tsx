import { useState } from 'react'
import type {
  ActivityEvent,
  AppSettings,
  ResourceSnapshot,
  ShellInfo,
  ShellKind,
  TerminalSession,
  WorkspaceResult,
  WorkspacesInfo
} from '../../../shared/types'
import { ActivityCenter } from './ActivityCenter'
import { FleetMenu } from './FleetMenu'
import { BroadcastPanel } from './BroadcastPanel'
import { BrainPanel } from './BrainPanel'
import { useClickOutside } from '../hooks'

const SHELL_ICONS: Record<string, string> = {
  pwsh: '❯',
  powershell: '❯',
  cmd: 'C:\\',
  gitbash: '$',
  wsl: '🐧'
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`
}

interface Props {
  shells: ShellInfo[]
  resources: ResourceSnapshot | null
  terminalCount: number
  sessions: TerminalSession[]
  workspaces: WorkspacesInfo
  events: ActivityEvent[]
  unseen: number
  settings: AppSettings | null
  onAdd: (shell: ShellKind, cwd?: string) => void
  onSwitchWorkspace: (name: string) => void
  onCreateWorkspace: (name: string) => void
  onRenameWorkspace: (oldName: string, newName: string) => void
  onDeleteWorkspace: (name: string) => void
  onLaunchTemplate: (result: WorkspaceResult) => void
  onDistribute: () => void
  onOpenEvents: () => void
  onJump: (id: string, workspace: string) => void
  onClearEvents: () => void
  onUpdateSettings: (patch: Partial<AppSettings>) => void
  onReopenOnboarding: () => void
}

export function TopBar({
  shells,
  resources,
  terminalCount,
  sessions,
  workspaces,
  events,
  unseen,
  settings,
  onAdd,
  onSwitchWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onLaunchTemplate,
  onDistribute,
  onOpenEvents,
  onJump,
  onClearEvents,
  onUpdateSettings,
  onReopenOnboarding
}: Props): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [wsOpen, setWsOpen] = useState(false)
  const [cfgOpen, setCfgOpen] = useState(false)
  const cfgRef = useClickOutside(cfgOpen, () => setCfgOpen(false))
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [newWsName, setNewWsName] = useState('')
  const menuRef = useClickOutside(menuOpen, () => setMenuOpen(false))
  const wsRef = useClickOutside(wsOpen, () => {
    setWsOpen(false)
    setRenaming(null)
    setConfirmDelete(null)
  })

  const cpu = resources?.global.cpu ?? 0
  const memUsed = resources?.global.memUsed ?? 0
  const memTotal = resources?.global.memTotal ?? 1
  const memPct = (memUsed / memTotal) * 100

  const pickFolderAnd = async (shell: ShellKind): Promise<void> => {
    setMenuOpen(false)
    const folder = await window.orq.pickFolder()
    if (folder) onAdd(shell, folder)
  }

  const submitNewWs = (): void => {
    const name = newWsName.trim()
    if (name) {
      onCreateWorkspace(name)
      setNewWsName('')
      setWsOpen(false)
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">🪽</span>
        <span className="brand-name">Wingdeck</span>

        <div className="ws-menu" ref={wsRef}>
          <button
            className="ws-button"
            title="Workspaces"
            onClick={() => setWsOpen((v) => !v)}
          >
            ▣ {workspaces.active} <span className="ws-caret">▾</span>
          </button>
          {wsOpen && (
            <div className="menu">
              {workspaces.names.map((name) =>
                renaming === name ? (
                  <input
                    key={name}
                    className="ws-input"
                    defaultValue={name}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onRenameWorkspace(name, (e.target as HTMLInputElement).value)
                        setRenaming(null)
                      }
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={() => setRenaming(null)}
                  />
                ) : (
                  <div key={name} className="menu-row">
                    <button
                      className={`menu-item ${name === workspaces.active ? 'is-active' : ''}`}
                      onClick={() => {
                        setWsOpen(false)
                        if (name !== workspaces.active) onSwitchWorkspace(name)
                      }}
                    >
                      <span className="menu-icon">{name === workspaces.active ? '●' : '○'}</span>
                      {name}
                    </button>
                    <button
                      className="menu-folder"
                      title="Renombrar"
                      onClick={() => setRenaming(name)}
                    >
                      ✎
                    </button>
                    <button
                      className={`menu-folder ${confirmDelete === name ? 'is-danger' : ''}`}
                      title={confirmDelete === name ? 'Confirmar eliminación' : 'Eliminar workspace'}
                      onClick={() => {
                        if (confirmDelete === name) {
                          setConfirmDelete(null)
                          setWsOpen(false)
                          onDeleteWorkspace(name)
                        } else {
                          setConfirmDelete(name)
                        }
                      }}
                    >
                      {confirmDelete === name ? '¿✓?' : '🗑'}
                    </button>
                  </div>
                )
              )}
              <div className="menu-divider" />
              <div className="menu-row">
                <input
                  className="ws-input"
                  placeholder="Nuevo workspace…"
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitNewWs()}
                />
                <button className="menu-folder" title="Crear" onClick={submitNewWs}>
                  ＋
                </button>
              </div>
            </div>
          )}
        </div>

        {terminalCount > 0 && <span className="count-chip">{terminalCount} activas</span>}

        <FleetMenu onLaunch={onLaunchTemplate} />
        <BroadcastPanel sessions={sessions} />
        <BrainPanel workspace={workspaces.active} sessions={sessions} />
        {sessions.length > 1 && (
          <button
            className="btn-secondary"
            title="Repartir todas las terminales del workspace por igual en el espacio disponible"
            onClick={onDistribute}
          >
            ▦ Distribuir
          </button>
        )}
      </div>

      <div className="topbar-right">
        <div className="meter" title={`CPU del sistema: ${cpu.toFixed(0)}%`}>
          <span className="meter-label">CPU</span>
          <div className="meter-track">
            <div
              className={`meter-fill ${cpu > 85 ? 'hot' : ''}`}
              style={{ width: `${Math.min(100, cpu)}%` }}
            />
          </div>
          <span className="meter-value">{cpu.toFixed(0)}%</span>
        </div>
        <div className="meter" title={`RAM: ${formatBytes(memUsed)} de ${formatBytes(memTotal)}`}>
          <span className="meter-label">RAM</span>
          <div className="meter-track">
            <div
              className={`meter-fill ${memPct > 85 ? 'hot' : ''}`}
              style={{ width: `${Math.min(100, memPct)}%` }}
            />
          </div>
          <span className="meter-value">{formatBytes(memUsed)}</span>
        </div>

        <ActivityCenter
          events={events}
          unseen={unseen}
          onOpen={onOpenEvents}
          onJump={onJump}
          onClear={onClearEvents}
        />

        <div className="cfg-menu" ref={cfgRef}>
          <button className="act-bell" title="Ajustes" onClick={() => setCfgOpen((v) => !v)}>
            ⚙
          </button>
          {cfgOpen && settings && (
            <div className="menu cfg-panel">
              <div className="act-panel-head">Ajustes</div>
              {(
                [
                  ['copyOnSelect', 'Copiar al seleccionar texto'],
                  ['flash', 'Parpadeo en barra de tareas'],
                  ['systemNotif', 'Notificación de Windows'],
                  ['sound', 'Sonido al terminar un agente'],
                  ['persistScrollback', 'Recordar el historial entre reinicios'],
                  ['askOnQuit', 'Preguntar antes de cerrar del todo']
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="cfg-row">
                  <input
                    type="checkbox"
                    checked={settings[key]}
                    onChange={(e) => onUpdateSettings({ [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
              <div className="menu-divider" />
              <label className="cfg-row cfg-row-select">
                Detectar inactividad tras
                <select
                  value={settings.idleAfterMs}
                  onChange={(e) => onUpdateSettings({ idleAfterMs: Number(e.target.value) })}
                >
                  <option value={4000}>4 s</option>
                  <option value={6000}>6 s</option>
                  <option value={10000}>10 s</option>
                  <option value={15000}>15 s</option>
                </select>
              </label>
              <div className="menu-divider" />
              <button className="menu-item" onClick={() => { setCfgOpen(false); onReopenOnboarding() }}>
                Repetir configuración inicial
              </button>
            </div>
          )}
        </div>

        <div className="add-menu" ref={menuRef}>
          <button className="btn-primary" onClick={() => setMenuOpen((v) => !v)}>
            + Terminal
          </button>
          {menuOpen && (
            <div className="menu">
              {shells.map((s) => (
                <div key={s.kind} className="menu-row">
                  <button
                    className="menu-item"
                    onClick={() => {
                      setMenuOpen(false)
                      onAdd(s.kind)
                    }}
                  >
                    <span className="menu-icon">{SHELL_ICONS[s.kind] ?? '❯'}</span>
                    {s.label}
                  </button>
                  <button
                    className="menu-folder"
                    title={`${s.label} en una carpeta específica…`}
                    onClick={() => pickFolderAnd(s.kind)}
                  >
                    📁
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
