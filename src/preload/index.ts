import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ActivityEvent,
  ActivityInfo,
  AgentKind,
  AppSettings,
  FleetTemplate,
  InitPayload,
  PasteContent,
  ResourceSnapshot,
  SessionScanResult,
  ShellKind,
  TermLayout,
  TerminalSession,
  WorkspaceBrain,
  WorkspaceResult,
  WorkspacesInfo
} from '../shared/types'

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  init: (): Promise<InitPayload> => ipcRenderer.invoke('app:init'),

  createTerminal: (opts: {
    shell: ShellKind
    cwd?: string
    layout: TermLayout
    title?: string
  }): Promise<TerminalSession> => ipcRenderer.invoke('term:create', opts),

  attach: (id: string, cols: number, rows: number): Promise<string> =>
    ipcRenderer.invoke('term:attach', id, cols, rows),

  write: (id: string, data: string): void => {
    ipcRenderer.send('term:input', id, data)
  },

  resize: (id: string, cols: number, rows: number): void => {
    ipcRenderer.send('term:resize', id, cols, rows)
  },

  restart: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('term:restart', id, cols, rows),

  close: (id: string): Promise<void> => ipcRenderer.invoke('term:close', id),

  rename: (id: string, title: string): void => {
    ipcRenderer.send('term:title', id, title)
  },

  setDesc: (id: string, text: string): void => {
    ipcRenderer.send('term:desc', id, text)
  },

  detach: (id: string): void => {
    ipcRenderer.send('term:detach', id)
  },

  setStartupCmd: (id: string, cmd: string): void => {
    ipcRenderer.send('term:startupCmd', id, cmd)
  },

  setFontSize: (id: string, size: number): void => {
    ipcRenderer.send('term:fontSize', id, size)
  },

  persistBuffer: (id: string, text: string): void => {
    ipcRenderer.send('term:persistBuffer', id, text)
  },

  queueAdd: (id: string, prompt: string): Promise<TerminalSession | undefined> =>
    ipcRenderer.invoke('queue:add', id, prompt),
  queueRemove: (id: string, index: number): Promise<TerminalSession | undefined> =>
    ipcRenderer.invoke('queue:remove', id, index),
  queuePause: (id: string, paused: boolean): Promise<TerminalSession | undefined> =>
    ipcRenderer.invoke('queue:pause', id, paused),

  openInEditor: (id: string, path: string, line?: number): Promise<{ ok: boolean; resolved?: string }> =>
    ipcRenderer.invoke('open:inEditor', id, path, line),

  graphCheck: (cwd: string): Promise<boolean> => ipcRenderer.invoke('graph:check', cwd),
  graphOpen: (cwd: string): Promise<{ ok: boolean; resolved?: string }> =>
    ipcRenderer.invoke('graph:open', cwd),

  listTemplates: (): Promise<FleetTemplate[]> => ipcRenderer.invoke('tpl:list'),
  saveTemplate: (name: string): Promise<FleetTemplate[]> => ipcRenderer.invoke('tpl:save', name),
  deleteTemplate: (name: string): Promise<FleetTemplate[]> => ipcRenderer.invoke('tpl:delete', name),
  launchTemplate: (name: string): Promise<WorkspaceResult> => ipcRenderer.invoke('tpl:launch', name),

  switchWorkspace: (name: string): Promise<WorkspaceResult> => ipcRenderer.invoke('ws:switch', name),
  createWorkspace: (name: string): Promise<WorkspaceResult> => ipcRenderer.invoke('ws:create', name),
  renameWorkspace: (oldName: string, newName: string): Promise<WorkspacesInfo> =>
    ipcRenderer.invoke('ws:rename', oldName, newName),
  deleteWorkspace: (name: string): Promise<WorkspaceResult> => ipcRenderer.invoke('ws:delete', name),

  updateLayout: (items: ({ id: string } & TermLayout)[]): void => {
    ipcRenderer.send('layout:update', items)
  },

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),

  onTermData: (id: string, cb: (data: string) => void): (() => void) =>
    subscribe<{ id: string; data: string }>('term:data', (p) => {
      if (p.id === id) cb(p.data)
    }),

  onTermExit: (id: string, cb: (code: number) => void): (() => void) =>
    subscribe<{ id: string; code: number }>('term:exit', (p) => {
      if (p.id === id) cb(p.code)
    }),

  onCwd: (id: string, cb: (cwd: string) => void): (() => void) =>
    subscribe<{ id: string; cwd: string }>('session:cwd', (p) => {
      if (p.id === id) cb(p.cwd)
    }),

  onGitBranch: (id: string, cb: (branch: string | null) => void): (() => void) =>
    subscribe<{ id: string; branch: string | null }>('session:git', (p) => {
      if (p.id === id) cb(p.branch)
    }),

  onResources: (cb: (snap: ResourceSnapshot) => void): (() => void) =>
    subscribe<ResourceSnapshot>('res:update', cb),

  // ── Actividad de agentes ─────────────────────────
  seen: (id: string): void => {
    ipcRenderer.send('act:seen', id)
  },
  activityStates: (): Promise<ActivityInfo[]> => ipcRenderer.invoke('act:states'),
  onActivityState: (cb: (info: ActivityInfo) => void): (() => void) =>
    subscribe<ActivityInfo>('act:state', cb),
  onActivityDone: (cb: (ev: ActivityEvent) => void): (() => void) =>
    subscribe<ActivityEvent>('act:done', cb),
  onActivityFocus: (cb: (p: { id: string; workspace: string }) => void): (() => void) =>
    subscribe<{ id: string; workspace: string }>('act:focus', cb),

  // ── Portapapeles y archivos ──────────────────────
  readClipboard: (): Promise<PasteContent> => ipcRenderer.invoke('clipboard:read'),
  copyText: (text: string): void => {
    ipcRenderer.send('clipboard:copy', text)
  },
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  // ── Ajustes ──────────────────────────────────────
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', patch),

  // ── Configuración inicial ─────────────────────────
  checkClisInstalled: (): Promise<Record<AgentKind, boolean>> =>
    ipcRenderer.invoke('onboarding:checkClis'),
  checkGraphifyInstalled: (): Promise<boolean> => ipcRenderer.invoke('onboarding:checkGraphify'),

  // ── Cerebro del workspace ─────────────────────────
  getBrain: (workspace: string): Promise<WorkspaceBrain> => ipcRenderer.invoke('brain:get', workspace),
  saveBrain: (workspace: string, content: string): void => {
    ipcRenderer.send('brain:save', workspace, content)
  },
  onBrainUpdated: (cb: (workspace: string) => void): (() => void) =>
    subscribe<{ workspace: string }>('brain:updated', (p) => cb(p.workspace)),
  getBrainBackup: (workspace: string): Promise<string | null> =>
    ipcRenderer.invoke('brain:getBackup', workspace),
  restoreBrainBackup: (workspace: string): Promise<WorkspaceBrain> =>
    ipcRenderer.invoke('brain:restoreBackup', workspace),
  broadcastBrainReview: (workspace: string): Promise<number> =>
    ipcRenderer.invoke('brain:broadcastReview', workspace),

  // ── Sesiones previas de agentes (retomar) ─────────
  listSessions: (id: string): Promise<SessionScanResult> => ipcRenderer.invoke('sessions:list', id),
  resumeSession: (
    id: string,
    agent: AgentKind,
    sessionId: string
  ): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('sessions:resume', id, agent, sessionId),
  startNewSession: (id: string, agent: AgentKind | null): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('sessions:startNew', id, agent),
  dismissSessionOffer: (id: string, neverAgain: boolean): void => {
    ipcRenderer.send('sessions:dismiss', id, neverAgain)
  },
  onSessionsOffer: (id: string, cb: (result: SessionScanResult) => void): (() => void) =>
    subscribe<{ id: string; result: SessionScanResult }>('sessions:offer', (p) => {
      if (p.id === id) cb(p.result)
    })
}

export type OrqApi = typeof api

contextBridge.exposeInMainWorld('orq', api)
