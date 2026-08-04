import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GridLayout, useContainerWidth, noCompactor, type Layout, type LayoutItem } from 'react-grid-layout'
import { GRID_COLS, ROW_HEIGHT, MARGIN, MIN_W, MIN_H, availableRows, arrangeLayout } from './layout'
import type {
  ActivityEvent,
  ActivityInfo,
  AgentKind,
  AppSettings,
  InitPayload,
  ResourceSnapshot,
  ShellInfo,
  ShellKind,
  TermLayout,
  TerminalSession,
  WorkspacesInfo
} from '../../shared/types'
import { TopBar } from './components/TopBar'
import { TerminalCard } from './components/TerminalCard'
import { OnboardingWizard } from './components/OnboardingWizard'
import { AGENT_META } from './agents'

let audioCtx: AudioContext | null = null
/** Chime corto de dos tonos, sin assets */
function playChime(): void {
  try {
    audioCtx ??= new AudioContext()
    const t0 = audioCtx.currentTime
    for (const [freq, start] of [
      [660, 0],
      [990, 0.12]
    ] as const) {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t0 + start)
      gain.gain.linearRampToValueAtTime(0.12, t0 + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + start + 0.35)
      osc.connect(gain).connect(audioCtx.destination)
      osc.start(t0 + start)
      osc.stop(t0 + start + 0.4)
    }
  } catch {
    /* audio no disponible */
  }
}

function toLayoutItem(s: TerminalSession): LayoutItem {
  return {
    i: s.id,
    x: s.layout.x,
    y: s.layout.y,
    w: s.layout.w,
    h: s.layout.h,
    minW: MIN_W,
    minH: MIN_H,
    ...(s.pinned ? { isDraggable: false, isResizable: false } : {})
  }
}

/** Tamaño de la primera terminal de un workspace vacío: aprovecha toda la pantalla visible. */
function firstTerminalLayout(containerH: number): TermLayout {
  return { x: 0, y: 0, w: GRID_COLS, h: availableRows(containerH) }
}

export default function App(): React.JSX.Element {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [home, setHome] = useState('')
  const [layout, setLayout] = useState<LayoutItem[]>([])
  const [resources, setResources] = useState<ResourceSnapshot | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspacesInfo>({ active: '', names: [] })
  const [ready, setReady] = useState(false)
  const [activity, setActivity] = useState<Record<string, ActivityInfo>>({})
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [unseen, setUnseen] = useState(0)
  const [toast, setToast] = useState<ActivityEvent | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const { width, containerRef, mounted } = useContainerWidth()
  const layoutRef = useRef<LayoutItem[]>([])
  layoutRef.current = layout
  const sessionsRef = useRef<TerminalSession[]>([])
  sessionsRef.current = sessions
  const settingsRef = useRef<AppSettings | null>(null)
  settingsRef.current = settings
  const workspacesRef = useRef(workspaces)
  workspacesRef.current = workspaces

  useEffect(() => {
    window.orq.init().then((payload: InitPayload) => {
      setShells(payload.shells)
      setHome(payload.home)
      setSessions(payload.terminals)
      setLayout(payload.terminals.map(toLayoutItem))
      setWorkspaces(payload.workspaces)
      setReady(true)
    })
    window.orq.getSettings().then((s) => {
      setSettings(s)
      if (!s.onboardingDone) setShowOnboarding(true)
    })
    window.orq.activityStates().then((states) => {
      setActivity(Object.fromEntries(states.map((s) => [s.id, s])))
    })
    const offRes = window.orq.onResources(setResources)
    const offState = window.orq.onActivityState((info) => {
      setActivity((prev) => ({ ...prev, [info.id]: info }))
    })
    const offDone = window.orq.onActivityDone((ev) => {
      setEvents((prev) => [ev, ...prev].slice(0, 50))
      setUnseen((n) => n + 1)
      setToast(ev)
      if (ev.type === 'done' && (settingsRef.current?.sound ?? true)) playChime()
    })
    const offFocus = window.orq.onActivityFocus((p) => {
      void jumpToRef.current(p.id, p.workspace)
    })
    return () => {
      offRes()
      offState()
      offDone()
      offFocus()
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  // Ctrl+1..9 salta a la n-ésima terminal (ordenadas por posición en la grilla)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || !/^[1-9]$/.test(e.key)) return
      const order = [...layoutRef.current].sort((a, b) => a.y - b.y || a.x - b.x)
      const target = order[Number(e.key) - 1]
      if (!target) return
      e.preventDefault()
      const session = sessionsRef.current.find((s) => s.id === target.i)
      if (!session) return
      window.orq.seen(session.id)
      document.getElementById(`card-${session.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      window.__orqTerms?.get(session.id)?.focus()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  const applyWorkspace = useCallback(
    (result: { terminals: TerminalSession[]; workspaces: WorkspacesInfo }) => {
      setSessions(result.terminals)
      setLayout(result.terminals.map(toLayoutItem))
      setWorkspaces(result.workspaces)
    },
    []
  )

  const switchWorkspace = useCallback(
    async (name: string) => applyWorkspace(await window.orq.switchWorkspace(name)),
    [applyWorkspace]
  )

  const createWorkspace = useCallback(
    async (name: string) => applyWorkspace(await window.orq.createWorkspace(name)),
    [applyWorkspace]
  )

  const renameWorkspace = useCallback(async (oldName: string, newName: string) => {
    setWorkspaces(await window.orq.renameWorkspace(oldName, newName))
  }, [])

  const deleteWorkspace = useCallback(
    async (name: string) => applyWorkspace(await window.orq.deleteWorkspace(name)),
    [applyWorkspace]
  )

  const jumpTo = useCallback(
    async (id: string, workspace: string) => {
      if (workspace && workspace !== workspacesRef.current.active) {
        applyWorkspace(await window.orq.switchWorkspace(workspace))
      }
      window.orq.seen(id)
      setHighlightId(id)
      setTimeout(() => {
        document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 350)
      setTimeout(() => setHighlightId(null), 3000)
    },
    [applyWorkspace]
  )
  const jumpToRef = useRef(jumpTo)
  jumpToRef.current = jumpTo

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings(await window.orq.updateSettings(patch))
  }, [])

  const addTerminal = useCallback(
    async (shell: ShellKind, cwd?: string) => {
      const current = layoutRef.current
      let item: TermLayout
      if (current.length === 0) {
        // Workspace vacío: que la primera terminal aproveche toda la pantalla
        // disponible en vez de un tamaño fijo pensado para monitores chicos.
        const containerH = containerRef.current?.clientHeight || 700
        item = firstTerminalLayout(containerH)
      } else {
        const y = current.reduce((max, l) => Math.max(max, l.y + l.h), 0)
        item = { x: 0, y, w: 12, h: 14 }
      }
      const session = await window.orq.createTerminal({ shell, cwd, layout: item })
      setSessions((prev) => [...prev, session])
      setLayout((prev) => [...prev, toLayoutItem(session)])
    },
    []
  )

  /** Abre una terminal nueva con el CLI de un agente listo para loguearse (asistente inicial) */
  const openLoginTerminal = useCallback(
    async (agent: AgentKind) => {
      const current = layoutRef.current
      let item: TermLayout
      if (current.length === 0) {
        const containerH = containerRef.current?.clientHeight || 700
        item = firstTerminalLayout(containerH)
      } else {
        const y = current.reduce((max, l) => Math.max(max, l.y + l.h), 0)
        item = { x: 0, y, w: 12, h: 14 }
      }
      const shell = shells.find((s) => s.kind === 'pwsh')?.kind ?? shells[0]?.kind
      if (!shell) return
      const session = await window.orq.createTerminal({
        shell,
        cwd: home,
        layout: item,
        title: `${AGENT_META[agent].label} — login`
      })
      window.orq.setStartupCmd(session.id, agent)
      setSessions((prev) => [...prev, { ...session, startupCmd: agent }])
      setLayout((prev) => [...prev, toLayoutItem(session)])
    },
    [home, shells]
  )

  const finishOnboarding = useCallback(() => {
    setShowOnboarding(false)
    void updateSettings({ onboardingDone: true })
  }, [updateSettings])

  const openLoginFromOnboarding = useCallback(
    (agent: AgentKind) => {
      void openLoginTerminal(agent)
      finishOnboarding()
    },
    [openLoginTerminal, finishOnboarding]
  )

  /**
   * Reacomoda todas las terminales no fijadas para que quepan en el lienzo
   * visible sin scroll, esquivando las pineadas. Sin argumento usa la última
   * preferencia de columnas guardada en ajustes (o 'auto').
   */
  const arrangeTiles = useCallback((cols?: 'auto' | 1 | 2 | 3) => {
    if (sessionsRef.current.length === 0) return
    const chosen = cols ?? settingsRef.current?.layoutColumns ?? 'auto'
    const el = containerRef.current
    const pinnedIds = new Set(sessionsRef.current.filter((s) => s.pinned).map((s) => s.id))
    const items = arrangeLayout({
      current: layoutRef.current,
      pinnedIds,
      cols: chosen,
      containerW: el?.clientWidth || 1400,
      containerH: el?.clientHeight || 800
    })
    setLayout(items)
    window.orq.updateLayout(items.map((l) => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h })))
  }, [])

  const toggleTerminalPin = useCallback((id: string) => {
    const next = !sessionsRef.current.find((s) => s.id === id)?.pinned
    window.orq.setPinned(id, next)
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, pinned: next || undefined } : s)))
    setLayout((prev) =>
      prev.map((l) =>
        l.i === id
          ? {
              ...l,
              isDraggable: next ? false : undefined,
              isResizable: next ? false : undefined
            }
          : l
      )
    )
  }, [])

  const closeTerminal = useCallback((id: string) => {
    window.orq.close(id)
    setSessions((prev) => prev.filter((s) => s.id !== id))
    setLayout((prev) => prev.filter((l) => l.i !== id))
  }, [])

  const renameTerminal = useCallback((id: string, title: string) => {
    window.orq.rename(id, title)
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)))
  }, [])

  const updateTerminalDescription = useCallback((id: string, text: string) => {
    window.orq.setDesc(id, text)
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, description: text || undefined } : s))
    )
  }, [])

  const updateTerminalStartupCmd = useCallback((id: string, cmd: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, startupCmd: cmd || undefined } : s))
    )
  }, [])

  const updateTerminalModel = useCallback((id: string, model: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, model: model || undefined } : s))
    )
  }, [])

  const onLayoutChange = useCallback((next: Layout) => {
    // Los flags de pin se re-derivan de sessionsRef en vez de confiar en el eco
    // de RGL — así nunca se pierden en un ciclo de drag/resize de otra card.
    const pinnedIds = new Set(sessionsRef.current.filter((s) => s.pinned).map((s) => s.id))
    const items = next.map((l) => ({
      i: l.i,
      x: l.x,
      y: l.y,
      w: l.w,
      h: l.h,
      minW: MIN_W,
      minH: MIN_H,
      ...(pinnedIds.has(l.i) ? { isDraggable: false as const, isResizable: false as const } : {})
    }))
    setLayout(items)
    window.orq.updateLayout(items.map((l) => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h })))
  }, [])

  const statsById = useMemo(() => resources?.terminals ?? {}, [resources])

  return (
    <div className="app">
      <TopBar
        shells={shells}
        resources={resources}
        terminalCount={sessions.length}
        sessions={sessions}
        workspaces={workspaces}
        events={events}
        unseen={unseen}
        settings={settings}
        onAdd={addTerminal}
        onSwitchWorkspace={switchWorkspace}
        onCreateWorkspace={createWorkspace}
        onRenameWorkspace={renameWorkspace}
        onDeleteWorkspace={deleteWorkspace}
        onLaunchTemplate={applyWorkspace}
        onArrange={arrangeTiles}
        onOpenEvents={() => setUnseen(0)}
        onJump={jumpTo}
        onClearEvents={() => setEvents([])}
        onUpdateSettings={updateSettings}
        onReopenOnboarding={() => setShowOnboarding(true)}
      />
      {showOnboarding && (
        <OnboardingWizard onOpenLogin={openLoginFromOnboarding} onFinish={finishOnboarding} />
      )}
      <div className="workspace" ref={containerRef}>
        {ready && sessions.length === 0 && (
          <div className="empty-state">
            <div className="empty-logo">◧</div>
            <h1>Tu espacio de terminales</h1>
            <p>
              Crea terminales, acomódalas donde quieras arrastrando su barra superior y
              redimensiónalas desde la esquina. ORQ recordará la posición y la carpeta de trabajo
              de cada una para tu próxima sesión.
            </p>
            <div className="empty-actions">
              {shells.map((s) => (
                <button key={s.kind} className="btn-primary" onClick={() => addTerminal(s.kind)}>
                  + {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {mounted && ready && sessions.length > 0 && (
          <GridLayout
            width={width}
            layout={layout}
            gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT, margin: [MARGIN, MARGIN] }}
            dragConfig={{ enabled: true, handle: '.term-header' }}
            resizeConfig={{ enabled: true, handles: ['se', 'e', 's'] }}
            compactor={noCompactor}
            onLayoutChange={onLayoutChange}
          >
            {sessions.map((s) => (
              <div key={s.id} className={`grid-item ${focusId === s.id ? 'is-focused' : ''}`}>
                <TerminalCard
                  session={s}
                  home={home}
                  stats={statsById[s.id]}
                  activity={activity[s.id]}
                  highlighted={highlightId === s.id}
                  copyOnSelect={settings?.copyOnSelect ?? true}
                  focused={focusId === s.id}
                  onClose={() => closeTerminal(s.id)}
                  onRename={(title) => renameTerminal(s.id, title)}
                  onDescriptionChange={(text) => updateTerminalDescription(s.id, text)}
                  onStartupCmdChange={(cmd) => updateTerminalStartupCmd(s.id, cmd)}
                  onModelChange={(model) => updateTerminalModel(s.id, model)}
                  onToggleFocus={() => setFocusId((cur) => (cur === s.id ? null : s.id))}
                  pinned={!!s.pinned}
                  onTogglePin={() => toggleTerminalPin(s.id)}
                  obscured={focusId !== null && focusId !== s.id}
                />
              </div>
            ))}
          </GridLayout>
        )}
        {focusId && <div className="focus-backdrop" onClick={() => setFocusId(null)} />}
      </div>
      {toast && (
        <button
          className={`toast toast-${toast.type}`}
          onClick={() => {
            const ev = toast
            setToast(null)
            void jumpTo(ev.id, ev.workspace)
          }}
        >
          <span
            className="toast-icon"
            style={{
              color:
                toast.type === 'queue'
                  ? '#7aa2f7'
                  : toast.type === 'cpu'
                    ? '#f7768e'
                    : (toast.agent ? AGENT_META[toast.agent].color : '#e0af68')
            }}
          >
            {toast.type === 'queue' ? '▶' : toast.type === 'cpu' ? '⚠' : toast.agent ? AGENT_META[toast.agent].icon : '●'}
          </span>
          <span>
            <strong>
              {toast.type === 'queue'
                ? `Prompt enviado${toast.remaining ? ` — quedan ${toast.remaining}` : ''}`
                : toast.type === 'cpu'
                  ? 'CPU alta sostenida'
                  : toast.agent
                    ? `${AGENT_META[toast.agent].label} terminó`
                    : 'Terminal en espera'}
            </strong>
            <br />
            {toast.title} · {toast.workspace}
            {sessions.find((s) => s.id === toast.id)?.description && (
              <>
                <br />
                <span className="toast-desc">
                  「{sessions.find((s) => s.id === toast.id)?.description}」
                </span>
              </>
            )}
            {toast.snippet && (
              <>
                <br />
                <span className="toast-snippet">{toast.snippet}</span>
              </>
            )}
          </span>
        </button>
      )}
    </div>
  )
}
