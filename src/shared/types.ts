export type ShellKind = 'pwsh' | 'powershell' | 'cmd' | 'gitbash' | 'wsl'

export interface ShellInfo {
  kind: ShellKind
  label: string
  path: string
}

export interface TermLayout {
  x: number
  y: number
  w: number
  h: number
}

export interface TerminalSession {
  id: string
  title: string
  shell: ShellKind
  cwd: string
  layout: TermLayout
  color: number
  createdAt: number
  /** Comando que se ejecuta automáticamente al abrir/restaurar la terminal */
  startupCmd?: string
  /** Prompts pendientes de enviar cuando el agente quede libre */
  queue?: string[]
  queuePaused?: boolean
  fontSize?: number
  /** Nota corta de en qué se está trabajando en esta terminal */
  description?: string
  /** 'never' = no ofrecer más el overlay de "retomar sesión" en esta terminal */
  resumeOverlay?: 'auto' | 'never'
  /** Modelo activo detectado en la salida del pty (best-effort, ver modelDetect.ts) */
  model?: string
  /**
   * Sesiones de agente trabajadas EN esta terminal (más reciente primero). El
   * overlay de "retomar" y el menú de sesiones solo ofrecen las propias — si no
   * hay ninguna, caen a la lista completa del cwd y al retomar se la apropian.
   */
  agentSessions?: OwnedAgentSession[]
}

/** Una sesión de agente asociada a la terminal que la trabajó */
export interface OwnedAgentSession {
  agent: AgentKind
  id: string
  at: number
}

export interface WorkspacesInfo {
  active: string
  names: string[]
}

export type AgentKind = 'claude' | 'qwen' | 'opencode'

export type ActivityState = 'working' | 'idle' | 'attention'

export interface ActivityInfo {
  id: string
  state: ActivityState
  since: number
}

export type ActivityEventType = 'done' | 'queue' | 'cpu'

export interface ActivityEvent {
  id: string
  title: string
  agent: AgentKind | null
  workspace: string
  at: number
  type: ActivityEventType
  /** Últimas líneas de salida (para 'done') o info del prompt/CPU */
  snippet?: string
  remaining?: number
}

export interface AppSettings {
  copyOnSelect: boolean
  flash: boolean
  systemNotif: boolean
  sound: boolean
  idleAfterMs: number
  persistScrollback: boolean
  /** Preguntar (seguir en bandeja / cerrar todo) al hacer clic en "Salir" */
  askOnQuit: boolean
  /** Ya se completó (o descartó) el asistente de configuración inicial */
  onboardingDone: boolean
  /**
   * Claves de API opcionales, para agentes/herramientas que soportan autenticarse por
   * variable de entorno en vez de (o además de) su login por navegador propio. Se
   * inyectan como env var (ANTHROPIC_API_KEY/OPENAI_API_KEY/GEMINI_API_KEY) al lanzar
   * cada terminal — nunca se envían a ningún servidor de Wingdeck, quedan en disco
   * local (%APPDATA%) igual que el resto de la configuración.
   */
  apiKeys: {
    anthropic?: string
    openai?: string
    gemini?: string
  }
}

export type PasteContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; path: string }
  | { kind: 'files'; paths: string[] }
  | { kind: 'empty' }

export interface TermStats {
  cpu: number
  mem: number
  procs: number
  agent: AgentKind | null
}

export interface ResourceSnapshot {
  global: {
    cpu: number
    memUsed: number
    memTotal: number
    cores: number
  }
  terminals: Record<string, TermStats>
}

export interface InitPayload {
  shells: ShellInfo[]
  terminals: TerminalSession[]
  home: string
  workspaces: WorkspacesInfo
}

export interface FleetTemplateTerminal {
  shell: ShellKind
  cwd: string
  title: string
  startupCmd?: string
  layout: TermLayout
  color: number
  description?: string
}

export interface FleetTemplate {
  name: string
  terminals: FleetTemplateTerminal[]
}

export interface WorkspaceResult {
  terminals: TerminalSession[]
  workspaces: WorkspacesInfo
}

export interface WorkspaceBrain {
  content: string
  updatedAt: number | null
}

/** Una sesión previa de un CLI de agente, encontrada en su carpeta de datos */
export interface AgentSessionRef {
  agent: AgentKind
  /** uuid (claude/qwen) o ses_… (opencode) — es lo que acepta el flag de resume */
  id: string
  title: string
  /** cwd real registrado en la sesión (desambigua colisiones de carpeta/slug) */
  cwd: string
  updatedAt: number
  /**
   * Cuándo se CREÓ la sesión (birthtime del archivo / time_created). Clave para
   * el claim-watch: una sesión externa viva tiene mtime reciente pero creación
   * vieja — solo un archivo nacido después del arranque del agente es "nuevo".
   */
  createdAt?: number
}

export interface SessionScanResult {
  cwd: string
  sessions: AgentSessionRef[]
  installed: Record<AgentKind, boolean>
  scannedAt: number
}
