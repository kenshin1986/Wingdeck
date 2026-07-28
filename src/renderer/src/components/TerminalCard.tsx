import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import type {
  ActivityInfo,
  AgentKind,
  SessionScanResult,
  TerminalSession,
  TermStats
} from '../../../shared/types'
import { AGENT_META, relTime } from '../agents'
import { useNow } from '../hooks'
import { useMenuHighlightOverlay } from '../useMenuHighlightOverlay'

const MIN_FONT = 9
const MAX_FONT = 22
const DEFAULT_FONT = 13
const PERSIST_SNAPSHOT_MS = 10_000
const PERSIST_SCROLLBACK_ROWS = 3000
// Rutas Windows absolutas o relativas con extensión, con línea opcional (archivo.ts:42)
const PATH_RE =
  /((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|(?:[\w-]+[\\/])+)[\w.\\/-]*\.[A-Za-z0-9]{1,10})(?::(\d+))?/g

export const ACCENTS = ['#7aa2f7', '#9ece6a', '#f7768e', '#e0af68', '#bb9af7', '#7dcfff']

const SHELL_LABELS: Record<string, string> = {
  pwsh: 'pwsh',
  powershell: 'PS',
  cmd: 'cmd',
  gitbash: 'bash',
  wsl: 'wsl'
}

const THEME = {
  background: '#0d1117',
  foreground: '#dee7f0',
  cursor: '#7aa2f7',
  cursorAccent: '#0d1117',
  selectionBackground: 'rgba(122, 162, 247, 0.30)',
  black: '#1a1f29',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#c8d0dc',
  brightBlack: '#4b5568',
  brightRed: '#ff8fa3',
  brightGreen: '#b4e484',
  brightYellow: '#f2c882',
  brightBlue: '#96b7ff',
  brightMagenta: '#d3b6ff',
  brightCyan: '#9ce0ff',
  brightWhite: '#f0f4f8'
}

declare global {
  interface Window {
    /** Hook de pruebas: con WebGL el texto no vive en el DOM */
    __orqTerms?: Map<string, Terminal>
  }
}

function formatMem(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

function shortenCwd(cwd: string, home: string): string {
  if (home && cwd.toLowerCase().startsWith(home.toLowerCase())) {
    return `~${cwd.slice(home.length)}`
  }
  return cwd
}

function quotePath(p: string): string {
  return `"${p}"`
}

interface Props {
  session: TerminalSession
  home: string
  stats?: TermStats
  activity?: ActivityInfo
  highlighted: boolean
  copyOnSelect: boolean
  focused: boolean
  onClose: () => void
  onRename: (title: string) => void
  onDescriptionChange: (text: string) => void
  onStartupCmdChange: (cmd: string) => void
  onToggleFocus: () => void
}

export function TerminalCard({
  session,
  home,
  stats,
  activity,
  highlighted,
  copyOnSelect,
  focused,
  onClose,
  onRename,
  onDescriptionChange,
  onStartupCmdChange,
  onToggleFocus
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const copyOnSelectRef = useRef(copyOnSelect)
  copyOnSelectRef.current = copyOnSelect
  const onToggleFocusRef = useRef(onToggleFocus)
  onToggleFocusRef.current = onToggleFocus
  const [exited, setExited] = useState<number | null>(null)
  const [cwd, setCwd] = useState(session.cwd)
  const [branch, setBranch] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(session.title)
  const [descEditing, setDescEditing] = useState(false)
  const [description, setDescription] = useState(session.description ?? '')
  const [cmdOpen, setCmdOpen] = useState(false)
  const [startupCmd, setStartupCmd] = useState(session.startupCmd ?? '')
  const [queueOpen, setQueueOpen] = useState(false)
  const [queue, setQueue] = useState<string[]>(session.queue ?? [])
  const [queuePaused, setQueuePaused] = useState(session.queuePaused ?? false)
  const [newPrompt, setNewPrompt] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [fontSize, setFontSize] = useState(session.fontSize ?? DEFAULT_FONT)
  const [hasGraph, setHasGraph] = useState(false)
  const [resumeOffer, setResumeOffer] = useState<SessionScanResult | null>(null)
  const [otherToolOpen, setOtherToolOpen] = useState(false)
  const [neverAskAgain, setNeverAskAgain] = useState(false)
  const [activeTerm, setActiveTerm] = useState<Terminal | null>(null)
  const typedSinceMountRef = useRef(false)
  const dragDepth = useRef(0)
  const accent = ACCENTS[session.color % ACCENTS.length]
  const now = useNow()
  const { rows: menuRows, onRowClick: onMenuRowClick } = useMenuHighlightOverlay(
    activeTerm,
    containerRef
  )

  const insertText = (text: string): void => {
    window.orq.write(session.id, text)
  }

  const smartPaste = async (): Promise<void> => {
    const content = await window.orq.readClipboard()
    const term = termRef.current
    if (!term) return
    switch (content.kind) {
      case 'text':
        term.paste(content.text)
        break
      case 'image':
        insertText(quotePath(content.path) + ' ')
        break
      case 'files':
        insertText(content.paths.map(quotePath).join(' ') + ' ')
        break
    }
    term.focus()
  }

  const pasteAsText = async (): Promise<void> => {
    const content = await window.orq.readClipboard()
    if (content.kind === 'text') termRef.current?.paste(content.text)
    termRef.current?.focus()
  }

  const copySelection = (): void => {
    const sel = termRef.current?.getSelection()
    if (sel) window.orq.copyText(sel)
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
      fontSize: session.fontSize ?? DEFAULT_FONT,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 8000,
      allowProposedApi: true,
      theme: THEME
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    const search = new SearchAddon()
    term.loadAddon(search)
    searchRef.current = search
    const serializeAddon = new SerializeAddon()
    term.loadAddon(serializeAddon)

    term.registerLinkProvider({
      provideLinks(lineNumber, callback) {
        const line = term.buffer.active.getLine(lineNumber - 1)
        if (!line) return callback(undefined)
        const text = line.translateToString(true)
        const links: import('@xterm/xterm').ILink[] = []
        PATH_RE.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = PATH_RE.exec(text)) !== null) {
          const path = match[1]
          const lineNo = match[2] ? Number(match[2]) : undefined
          links.push({
            range: {
              start: { x: match.index + 1, y: lineNumber },
              end: { x: match.index + match[0].length + 1, y: lineNumber }
            },
            text: match[0],
            activate: () => {
              void window.orq.openInEditor(session.id, path, lineNo)
            }
          })
        }
        callback(links.length > 0 ? links : undefined)
      }
    })

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true
      const key = ev.key.toLowerCase()
      if (ev.ctrlKey && ev.shiftKey && key === 'c') {
        ev.preventDefault()
        copySelection()
        return false
      }
      if (ev.ctrlKey && ev.shiftKey && key === 'v') {
        ev.preventDefault()
        void pasteAsText()
        return false
      }
      if (ev.ctrlKey && ev.altKey && key === 'v') {
        // Reenviar Ctrl+V crudo: el agente (p. ej. Claude Code) lee el portapapeles
        ev.preventDefault()
        insertText('\x16')
        return false
      }
      if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && key === 'v') {
        ev.preventDefault()
        void smartPaste()
        return false
      }
      if (ev.ctrlKey && ev.shiftKey && key === 'f') {
        ev.preventDefault()
        onToggleFocusRef.current()
        return false
      }
      if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && key === 'f') {
        ev.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
        return false
      }
      return true
    })

    term.open(el)

    // Renderizado WebGL para mejor rendimiento; si falla, xterm usa el renderer DOM.
    import('@xterm/addon-webgl')
      .then(({ WebglAddon }) => {
        try {
          term.loadAddon(new WebglAddon())
        } catch {
          /* GPU no disponible */
        }
      })
      .catch(() => undefined)

    try {
      fit.fit()
    } catch {
      /* contenedor aún sin tamaño */
    }

    termRef.current = term
    fitRef.current = fit
    ;(window.__orqTerms ??= new Map()).set(session.id, term)
    setActiveTerm(term)

    const offData = window.orq.onTermData(session.id, (d) => term.write(d))
    const offExit = window.orq.onTermExit(session.id, (code) => setExited(code))
    const offCwd = window.orq.onCwd(session.id, setCwd)
    const offBranch = window.orq.onGitBranch(session.id, setBranch)
    // OJO: term.onData dispara tanto por tecleo real como por respuestas AUTOMÁTICAS
    // de xterm.js a secuencias de protocolo del propio shell (consultas de
    // capacidades, focus-reporting) — no sirve para detectar "el usuario ya
    // escribió algo". Para eso se usa un keydown real sobre el DOM, más abajo.
    const dataSub = term.onData((d) => {
      window.orq.write(session.id, d)
    })

    let copyTimer: NodeJS.Timeout | null = null
    const selSub = term.onSelectionChange(() => {
      if (!copyOnSelectRef.current) return
      if (copyTimer) clearTimeout(copyTimer)
      copyTimer = setTimeout(() => {
        const sel = term.getSelection()
        if (sel) window.orq.copyText(sel)
      }, 250)
    })

    window.orq.attach(session.id, term.cols, term.rows).then((buffer) => {
      if (buffer) {
        // Empuja el contenido reproducido al scrollback antes de que llegue el
        // primer output en vivo del shell: PowerShell/PSReadLine suelen emitir
        // un clear-screen al iniciar, que borraría lo reproducido si todavía
        // estuviera en el viewport (un clear no toca el scrollback).
        term.write(buffer + '\r\n'.repeat(term.rows))
      }
      window.orq.resize(session.id, term.cols, term.rows)
    })

    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        try {
          fit.fit()
          window.orq.resize(session.id, term.cols, term.rows)
        } catch {
          /* ignorar durante drag */
        }
      })
    })
    ro.observe(el)

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const next = Math.min(MAX_FONT, Math.max(MIN_FONT, term.options.fontSize! - Math.sign(e.deltaY)))
      if (next === term.options.fontSize) return
      term.options.fontSize = next
      setFontSize(next)
      window.orq.setFontSize(session.id, next)
      try {
        fit.fit()
        window.orq.resize(session.id, term.cols, term.rows)
      } catch {
        /* ignorar */
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })

    // Señal real de "el usuario ya está tecleando" (a diferencia de term.onData,
    // que también dispara por respuestas automáticas del protocolo de xterm.js).
    const onKeydown = (): void => {
      typedSinceMountRef.current = true
    }
    el.addEventListener('keydown', onKeydown, { capture: true })

    const persistSnapshot = (): void => {
      try {
        window.orq.persistBuffer(
          session.id,
          serializeAddon.serialize({ scrollback: PERSIST_SCROLLBACK_ROWS })
        )
      } catch {
        /* el terminal puede estar a medio disponer */
      }
    }
    const persistTimer = setInterval(persistSnapshot, PERSIST_SNAPSHOT_MS)

    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
      if (copyTimer) clearTimeout(copyTimer)
      clearInterval(persistTimer)
      persistSnapshot()
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('keydown', onKeydown, { capture: true })
      offData()
      offExit()
      offCwd()
      offBranch()
      dataSub.dispose()
      selSub.dispose()
      window.__orqTerms?.delete(session.id)
      term.dispose()
      termRef.current = null
      setActiveTerm(null)
      // El pty sigue vivo en segundo plano (p. ej. al cambiar de workspace)
      window.orq.detach(session.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // xterm hace stopPropagation del mousedown, así que el "visto" se captura
  // en fase de captura con un listener nativo sobre toda la tarjeta.
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const markSeen = (): void => window.orq.seen(session.id)
    el.addEventListener('mousedown', markSeen, { capture: true })
    return () => el.removeEventListener('mousedown', markSeen, { capture: true })
  }, [session.id])

  // Cuando el main despacha un prompt de la cola automáticamente, refleja el consumo aquí
  useEffect(() => {
    return window.orq.onActivityDone((ev) => {
      if (ev.id === session.id && ev.type === 'queue') setQueue((prev) => prev.slice(1))
    })
  }, [session.id])

  // Grafo Graphify: revisa si existe graphify-out/graph.html en el cwd vivo
  useEffect(() => {
    let alive = true
    const check = (): void => {
      void window.orq.graphCheck(cwd).then((v) => {
        if (alive) setHasGraph(v)
      })
    }
    check()
    const t = setInterval(check, 10_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [cwd])

  // Retomar sesión: el main ofrece sesiones previas solo en un cold spawn elegible
  // (retiene el ⚡ mientras tanto). Si el usuario ya empezó a escribir en la terminal
  // antes de que llegue la oferta, taparle la vista sería hostil — se descarta sola.
  useEffect(() => {
    return window.orq.onSessionsOffer(session.id, (result) => {
      if (typedSinceMountRef.current) {
        window.orq.dismissSessionOffer(session.id, false)
        return
      }
      setResumeOffer(result)
    })
  }, [session.id])

  const resumeSession = async (agent: AgentKind, sessionId: string): Promise<void> => {
    const res = await window.orq.resumeSession(session.id, agent, sessionId)
    if (res.ok) setResumeOffer(null)
  }

  const startNewFromOffer = async (agent: AgentKind | null): Promise<void> => {
    const res = await window.orq.startNewSession(session.id, agent)
    if (res.ok) {
      setResumeOffer(null)
      setOtherToolOpen(false)
    }
  }

  const dismissOffer = (): void => {
    window.orq.dismissSessionOffer(session.id, neverAskAgain)
    setResumeOffer(null)
  }

  useEffect(() => {
    if (!resumeOffer) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismissOffer()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeOffer])

  const openResumeMenu = async (): Promise<void> => {
    const result = await window.orq.listSessions(session.id)
    if (result.sessions.length > 0) setResumeOffer(result)
  }

  const restart = async (): Promise<void> => {
    const term = termRef.current
    // Un reinicio es un cold spawn nuevo: si el usuario había tecleado antes en la
    // vida de esta tarjeta, ese hecho ya no aplica a ESTE arranque — sin resetear,
    // la oferta de "retomar sesión" quedaría auto-descartada para siempre en esta
    // terminal (el ref nunca se limpiaba solo, ni siquiera en reinicios explícitos).
    typedSinceMountRef.current = false
    await window.orq.restart(session.id, term?.cols ?? 80, term?.rows ?? 24)
    term?.reset()
    setExited(null)
    term?.focus()
  }

  const commitTitle = (value: string): void => {
    const clean = value.trim()
    setEditing(false)
    if (clean && clean !== title) {
      setTitle(clean)
      onRename(clean)
    }
  }

  const commitDescription = (value: string): void => {
    const clean = value.trim()
    setDescEditing(false)
    if (clean !== description) {
      setDescription(clean)
      onDescriptionChange(clean)
    }
  }

  const commitStartupCmd = (value: string): void => {
    const clean = value.trim()
    setStartupCmd(clean)
    window.orq.setStartupCmd(session.id, clean)
    onStartupCmdChange(clean)
    setCmdOpen(false)
  }

  const addToQueue = async (): Promise<void> => {
    const prompt = newPrompt.trim()
    if (!prompt) return
    const updated = await window.orq.queueAdd(session.id, prompt)
    setQueue(updated?.queue ?? [])
    setNewPrompt('')
  }

  const removeFromQueue = async (index: number): Promise<void> => {
    const updated = await window.orq.queueRemove(session.id, index)
    setQueue(updated?.queue ?? [])
  }

  const toggleQueuePause = async (): Promise<void> => {
    const next = !queuePaused
    setQueuePaused(next)
    await window.orq.queuePause(session.id, next)
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const files = [...e.dataTransfer.files]
    if (files.length > 0) {
      const paths = files.map((f) => window.orq.pathForFile(f)).filter(Boolean)
      if (paths.length > 0) insertText(paths.map(quotePath).join(' ') + ' ')
    } else {
      const text = e.dataTransfer.getData('text')
      if (text) termRef.current?.paste(text)
    }
    termRef.current?.focus()
  }

  const state = activity?.state
  const agentMeta = stats?.agent ? AGENT_META[stats.agent] : null
  const dotClass =
    state === 'working' ? 'dot-working' : state === 'attention' ? 'dot-attention' : 'dot-idle'
  const dotTitle =
    state === 'working'
      ? 'Trabajando (salida activa)'
      : state === 'attention'
        ? `Terminó — esperando ${activity ? relTime(activity.since, now) : ''}`
        : `Inactiva ${activity ? relTime(activity.since, now) : ''}`

  return (
    <div
      id={`card-${session.id}`}
      ref={cardRef}
      className={`term-card ${exited !== null ? 'is-exited' : ''} ${state === 'working' ? 'is-working' : ''} ${state === 'attention' ? 'is-attention' : ''} ${highlighted ? 'is-highlight' : ''}`}
      style={{ '--term-color': accent } as React.CSSProperties}
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current++
        setDragging(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="term-header">
        <span className={`term-dot ${dotClass}`} title={dotTitle} />
        {editing ? (
          <input
            className="term-title-input"
            defaultValue={title}
            autoFocus
            onFocus={(e) => e.target.select()}
            onBlur={(e) => commitTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle((e.target as HTMLInputElement).value)
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <span
            className="term-title"
            title="Doble clic para renombrar"
            onDoubleClick={() => setEditing(true)}
          >
            {title}
          </span>
        )}
        {agentMeta && (
          <span
            className="term-agent"
            style={{ '--agent-color': agentMeta.color } as React.CSSProperties}
            title={`Agente detectado: ${agentMeta.label}`}
          >
            <span className="term-agent-glyph">{agentMeta.icon}</span>
            {agentMeta.label}
          </span>
        )}
        {descEditing ? (
          <input
            className="term-desc-input"
            defaultValue={description}
            autoFocus
            placeholder="¿En qué estás trabajando?"
            onFocus={(e) => e.target.select()}
            onBlur={(e) => commitDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDescription((e.target as HTMLInputElement).value)
              if (e.key === 'Escape') setDescEditing(false)
            }}
          />
        ) : (
          description && (
            <span
              className="term-desc"
              title={description}
              onDoubleClick={() => setDescEditing(true)}
            >
              「{description}」
            </span>
          )
        )}
        {state === 'attention' && (
          <span className="term-ready" title={dotTitle}>
            ● listo
          </span>
        )}
        <span className="term-shell">
          {SHELL_LABELS[session.shell] ?? session.shell}
        </span>
        <span className="term-cwd" title={cwd}>
          {shortenCwd(cwd, home)}
        </span>
        {branch && (
          <span className="term-branch" title={`Rama de git: ${branch}`}>
            git:{branch}
          </span>
        )}
        {stats && exited === null && (
          <span className="term-stats" title={`${stats.procs} proceso(s)`}>
            {stats.cpu.toFixed(0)}% · {formatMem(stats.mem)}
          </span>
        )}
        <button
          className={`term-btn ${queue.length > 0 ? 'has-cmd' : ''}`}
          title={queue.length > 0 ? `${queue.length} prompt(s) en cola` : 'Cola de prompts'}
          onClick={() => setQueueOpen((v) => !v)}
        >
          📋{queue.length > 0 && <span className="term-btn-badge">{queue.length}</span>}
        </button>
        <button
          className={`term-btn ${startupCmd ? 'has-cmd' : ''}`}
          title={
            startupCmd
              ? `Comando de arranque: ${startupCmd}`
              : 'Definir comando de arranque automático'
          }
          onClick={() => setCmdOpen((v) => !v)}
        >
          ⚡
        </button>
        {hasGraph && (
          <button
            className="term-btn"
            title="Abrir grafo Graphify (graphify-out/graph.html)"
            onClick={() => void window.orq.graphOpen(cwd)}
          >
            🕸
          </button>
        )}
        <button className="term-btn" title="Buscar en el historial (Ctrl+F)" onClick={() => {
          setSearchOpen(true)
          setTimeout(() => searchInputRef.current?.focus(), 0)
        }}>
          🔍
        </button>
        <button
          className={`term-btn ${focused ? 'has-cmd' : ''}`}
          title="Modo enfoque (Ctrl+Shift+F)"
          onClick={onToggleFocus}
        >
          ⛶
        </button>
        <button className="term-btn" title="Reiniciar shell" onClick={restart}>
          ↻
        </button>
        <button className="term-btn term-btn-close" title="Cerrar terminal" onClick={onClose}>
          ✕
        </button>
      </div>
      {searchOpen && (
        <div className="search-bar">
          <input
            ref={searchInputRef}
            className="search-input"
            placeholder="Buscar en el historial…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.shiftKey) {
                searchRef.current?.findPrevious((e.target as HTMLInputElement).value)
              } else if (e.key === 'Enter') {
                searchRef.current?.findNext((e.target as HTMLInputElement).value)
              } else if (e.key === 'Escape') {
                searchRef.current?.clearDecorations()
                setSearchOpen(false)
                termRef.current?.focus()
              }
            }}
          />
          <button
            className="term-btn"
            title="Anterior (Shift+Enter)"
            onClick={() => searchInputRef.current && searchRef.current?.findPrevious(searchInputRef.current.value)}
          >
            ↑
          </button>
          <button
            className="term-btn"
            title="Siguiente (Enter)"
            onClick={() => searchInputRef.current && searchRef.current?.findNext(searchInputRef.current.value)}
          >
            ↓
          </button>
          <button
            className="term-btn"
            title="Cerrar (Esc)"
            onClick={() => {
              searchRef.current?.clearDecorations()
              setSearchOpen(false)
              termRef.current?.focus()
            }}
          >
            ✕
          </button>
        </div>
      )}
      {cmdOpen && (
        <div className="cmd-popover">
          <label>Comando al abrir/restaurar esta terminal</label>
          <div className="cmd-row">
            <input
              defaultValue={startupCmd}
              placeholder="p. ej. claude"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitStartupCmd((e.target as HTMLInputElement).value)
                if (e.key === 'Escape') setCmdOpen(false)
              }}
            />
            <button
              className="btn-primary"
              onClick={(e) => {
                const input = e.currentTarget.parentElement?.querySelector(
                  'input'
                ) as HTMLInputElement
                commitStartupCmd(input?.value ?? '')
              }}
            >
              Guardar
            </button>
          </div>
          <span className="cmd-hint">Déjalo vacío para desactivarlo.</span>
        </div>
      )}
      {queueOpen && (
        <div className="cmd-popover queue-popover">
          <label>Prompts en cola (se envían cuando el agente quede libre)</label>
          {queue.length === 0 && <span className="cmd-hint">Sin prompts encolados.</span>}
          {queue.length > 0 && (
            <ul className="queue-list">
              {queue.map((p, i) => (
                <li key={i}>
                  <span className="queue-item-text">{p}</span>
                  <button className="queue-item-remove" onClick={() => removeFromQueue(i)}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="cmd-row">
            <input
              placeholder="Añadir prompt…"
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addToQueue()}
            />
            <button className="btn-primary" onClick={addToQueue}>
              Añadir
            </button>
          </div>
          <label className="cfg-row">
            <input type="checkbox" checked={queuePaused} onChange={toggleQueuePause} />
            Pausar cola (no enviar automáticamente)
          </label>
        </div>
      )}
      <div
        className="term-body"
        ref={containerRef}
        onMouseDown={() => termRef.current?.focus()}
        onContextMenu={(e) => {
          e.preventDefault()
          setCtxMenu({ x: e.clientX, y: e.clientY })
        }}
      />
      {menuRows.length > 0 && (
        <div className="menu-click-overlay">
          {menuRows.map((r) => (
            <div
              key={r.bufferY}
              className="menu-click-row"
              style={{ top: r.top, height: r.height }}
              onClick={() => onMenuRowClick(r.bufferY)}
            />
          ))}
        </div>
      )}
      {ctxMenu && (
        <>
          <div className="ctx-backdrop" onMouseDown={() => setCtxMenu(null)} />
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button
              className="menu-item"
              disabled={!termRef.current?.hasSelection()}
              onClick={() => {
                copySelection()
                setCtxMenu(null)
              }}
            >
              Copiar <kbd>Ctrl+Shift+C</kbd>
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setCtxMenu(null)
                void smartPaste()
              }}
            >
              Pegar <kbd>Ctrl+V</kbd>
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setCtxMenu(null)
                void pasteAsText()
              }}
            >
              Pegar como texto <kbd>Ctrl+Shift+V</kbd>
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setCtxMenu(null)
                insertText('\x16')
                termRef.current?.focus()
              }}
            >
              Reenviar Ctrl+V al agente <kbd>Ctrl+Alt+V</kbd>
            </button>
            <div className="menu-divider" />
            <button
              className="menu-item"
              onClick={() => {
                termRef.current?.clear()
                setCtxMenu(null)
              }}
            >
              Limpiar terminal
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setCtxMenu(null)
                setDescEditing(true)
              }}
            >
              {description ? 'Editar descripción' : 'Agregar descripción'}
            </button>
            <button
              className="menu-item"
              onClick={() => {
                setCtxMenu(null)
                void openResumeMenu()
              }}
            >
              Sesiones anteriores…
            </button>
          </div>
        </>
      )}
      {dragging && (
        <div className="drop-overlay">
          <span>Soltar para insertar la ruta 📄</span>
        </div>
      )}
      {exited !== null && (
        <div className="term-exit-overlay">
          <p>Proceso finalizado (código {exited})</p>
          <button className="btn-primary" onClick={restart}>
            ↻ Reiniciar
          </button>
        </div>
      )}
      {resumeOffer && exited === null && (
        <div className="term-exit-overlay term-resume-overlay">
          <p className="term-resume-title">Ya trabajaste acá antes</p>
          <ul className="queue-list term-resume-list">
            {resumeOffer.sessions.slice(0, 5).map((s) => {
              const meta = AGENT_META[s.agent]
              return (
                <li key={`${s.agent}-${s.id}`} className="term-resume-item">
                  <span className="term-resume-item-info">
                    <span className="term-agent" style={{ '--agent-color': meta.color } as React.CSSProperties}>
                      <span className="term-agent-glyph">{meta.icon}</span>
                      {meta.label}
                    </span>
                    <span className="term-resume-item-title" title={s.title}>
                      {s.title}
                    </span>
                    <span className="term-resume-item-time">{relTime(s.updatedAt, now)}</span>
                  </span>
                  <button className="btn-secondary" onClick={() => void resumeSession(s.agent, s.id)}>
                    Retomar
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="term-resume-actions">
            <button
              className="btn-primary"
              onClick={() => void startNewFromOffer(resumeOffer.sessions[0].agent)}
            >
              Nueva con {AGENT_META[resumeOffer.sessions[0].agent].label}
            </button>
            <div className="term-resume-other">
              <button className="btn-secondary" onClick={() => setOtherToolOpen((v) => !v)}>
                Otra herramienta ▾
              </button>
              {otherToolOpen && (
                <div className="cmd-popover term-resume-other-menu">
                  {(['claude', 'qwen', 'opencode'] as AgentKind[]).map((a) => (
                    <button
                      key={a}
                      className="menu-item"
                      disabled={!resumeOffer.installed[a]}
                      onClick={() => void startNewFromOffer(a)}
                    >
                      {AGENT_META[a].icon} {AGENT_META[a].label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="btn-secondary" onClick={dismissOffer}>
              Cerrar
            </button>
          </div>
          <label className="cfg-row term-resume-never">
            <input
              type="checkbox"
              checked={neverAskAgain}
              onChange={(e) => setNeverAskAgain(e.target.checked)}
            />
            No volver a preguntar en esta terminal
          </label>
        </div>
      )}
    </div>
  )
}
