import { useEffect, useState } from 'react'
import type { AgentKind, AppSettings } from '../../../shared/types'
import { AGENT_META } from '../agents'

const INSTALL_CMD: Record<AgentKind, string> = {
  claude: 'npm install -g @anthropic-ai/claude-code',
  qwen: 'npm install -g @qwen-code/qwen-code',
  opencode: 'npm install -g opencode-ai'
}

const AGENTS: AgentKind[] = ['claude', 'qwen', 'opencode']

const GRAPHIFY_INSTALL_CMD = 'uv tool install graphifyy'
const GRAPHIFY_REGISTER_CMD = 'graphify install'

type ApiKeyField = keyof AppSettings['apiKeys']

const API_KEY_FIELDS: { key: ApiKeyField; label: string; placeholder: string; usedBy: string }[] = [
  {
    key: 'anthropic',
    label: 'Anthropic',
    placeholder: 'sk-ant-…',
    usedBy: 'Claude Code, Qwen Code, OpenCode, Graphify'
  },
  {
    key: 'openai',
    label: 'OpenAI',
    placeholder: 'sk-…',
    usedBy: 'Qwen Code, OpenCode, Graphify'
  },
  {
    key: 'gemini',
    label: 'Google Gemini',
    placeholder: 'AIza…',
    usedBy: 'Qwen Code, OpenCode, Graphify'
  }
]

interface Props {
  onOpenLogin: (agent: AgentKind) => void
  onFinish: () => void
}

export function OnboardingWizard({ onOpenLogin, onFinish }: Props): React.JSX.Element {
  const [installed, setInstalled] = useState<Record<AgentKind, boolean> | null>(null)
  const [copied, setCopied] = useState<AgentKind | null>(null)
  const [graphifyInstalled, setGraphifyInstalled] = useState<boolean | null>(null)
  const [graphifyCopied, setGraphifyCopied] = useState(false)
  const [apiKeys, setApiKeys] = useState<AppSettings['apiKeys']>({})
  const [keysSaved, setKeysSaved] = useState(false)

  useEffect(() => {
    window.orq.checkClisInstalled().then(setInstalled)
    window.orq.checkGraphifyInstalled().then(setGraphifyInstalled)
    window.orq.getSettings().then((s) => setApiKeys(s.apiKeys ?? {}))
  }, [])

  const copyInstall = (agent: AgentKind): void => {
    window.orq.copyText(INSTALL_CMD[agent])
    setCopied(agent)
    setTimeout(() => setCopied((cur) => (cur === agent ? null : cur)), 1500)
  }

  const copyGraphifyInstall = (): void => {
    window.orq.copyText(`${GRAPHIFY_INSTALL_CMD}\n${GRAPHIFY_REGISTER_CMD}`)
    setGraphifyCopied(true)
    setTimeout(() => setGraphifyCopied(false), 1500)
  }

  const saveApiKeys = async (): Promise<void> => {
    await window.orq.updateSettings({ apiKeys })
    setKeysSaved(true)
    setTimeout(() => setKeysSaved(false), 1500)
  }

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding-panel">
        <h1>Bienvenido a Wingdeck</h1>
        <p className="onboarding-intro">
          Wingdeck orquesta terminales y agentes de IA. Para sacarle provecho, conectá acá las
          herramientas que uses — nada de esto pasa por Wingdeck, cada CLI maneja su propio login.
        </p>
        <ul className="onboarding-list">
          {AGENTS.map((agent) => {
            const meta = AGENT_META[agent]
            const isInstalled = installed?.[agent]
            return (
              <li key={agent} className="onboarding-item">
                <span className="onboarding-item-head">
                  <span className="term-agent" style={{ color: meta.color, borderColor: meta.color }}>
                    {meta.icon} {meta.label}
                  </span>
                  {installed === null ? (
                    <span className="onboarding-status">buscando…</span>
                  ) : isInstalled ? (
                    <span className="onboarding-status onboarding-status-ok">✓ instalado</span>
                  ) : (
                    <span className="onboarding-status onboarding-status-missing">✗ no encontrado</span>
                  )}
                </span>
                {installed !== null && (
                  <div className="onboarding-item-action">
                    {isInstalled ? (
                      <button className="btn-primary" onClick={() => onOpenLogin(agent)}>
                        Abrir terminal y conectar cuenta
                      </button>
                    ) : (
                      <>
                        <code className="onboarding-cmd">{INSTALL_CMD[agent]}</code>
                        <button className="btn-secondary" onClick={() => copyInstall(agent)}>
                          {copied === agent ? 'Copiado' : 'Copiar'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <h2 className="onboarding-subhead">Graphify (grafo de código)</h2>
        <p className="onboarding-intro">
          Herramienta externa que mapea un proyecto en un grafo navegable para que los agentes
          consulten en vez de releer archivos sueltos. Opcional, pero recomendada.
        </p>
        <div className="onboarding-item onboarding-item-graphify">
          <span className="onboarding-item-head">
            <span className="term-agent" style={{ color: '#7dcfff', borderColor: '#7dcfff' }}>
              🕸 Graphify
            </span>
            {graphifyInstalled === null ? (
              <span className="onboarding-status">buscando…</span>
            ) : graphifyInstalled ? (
              <span className="onboarding-status onboarding-status-ok">✓ instalado</span>
            ) : (
              <span className="onboarding-status onboarding-status-missing">✗ no encontrado</span>
            )}
          </span>
          {graphifyInstalled === false && (
            <div className="onboarding-item-action onboarding-item-action-col">
              <code className="onboarding-cmd">{GRAPHIFY_INSTALL_CMD}</code>
              <code className="onboarding-cmd">{GRAPHIFY_REGISTER_CMD}</code>
              <button className="btn-secondary" onClick={copyGraphifyInstall}>
                {graphifyCopied ? 'Copiado' : 'Copiar ambos'}
              </button>
            </div>
          )}
        </div>

        <h2 className="onboarding-subhead">Claves de API (opcional)</h2>
        <p className="onboarding-intro">
          Cada CLI de arriba ya puede iniciar sesión por su cuenta con su propio navegador — esto
          es solo para quienes prefieren autenticarse por clave de API (o quieren correr Graphify
          en modo headless). Se guardan solo en este equipo y se pasan como variable de entorno a
          las terminales que abras; nunca salen de tu máquina a través de Wingdeck.
        </p>
        <div className="onboarding-apikeys">
          {API_KEY_FIELDS.map((f) => (
            <label key={f.key} className="onboarding-apikey-row">
              <span className="onboarding-apikey-label">
                {f.label}
                <span className="onboarding-apikey-usedby">{f.usedBy}</span>
              </span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={f.placeholder}
                value={apiKeys[f.key] ?? ''}
                onChange={(e) => setApiKeys((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          <button className="btn-secondary onboarding-apikeys-save" onClick={saveApiKeys}>
            {keysSaved ? 'Guardado' : 'Guardar claves'}
          </button>
        </div>

        <p className="onboarding-hint">
          Podés repetir esta pantalla cuando quieras desde ⚙ Ajustes → "Repetir configuración inicial".
        </p>
        <div className="onboarding-actions">
          <button className="btn-primary" onClick={onFinish}>
            Continuar
          </button>
        </div>
      </div>
    </div>
  )
}
