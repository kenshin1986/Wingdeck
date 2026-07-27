import { useEffect, useState } from 'react'
import type { AgentKind } from '../../../shared/types'
import { AGENT_META } from '../agents'

const INSTALL_CMD: Record<AgentKind, string> = {
  claude: 'npm install -g @anthropic-ai/claude-code',
  qwen: 'npm install -g @qwen-code/qwen-code',
  opencode: 'npm install -g opencode-ai'
}

const AGENTS: AgentKind[] = ['claude', 'qwen', 'opencode']

interface Props {
  onOpenLogin: (agent: AgentKind) => void
  onFinish: () => void
}

export function OnboardingWizard({ onOpenLogin, onFinish }: Props): React.JSX.Element {
  const [installed, setInstalled] = useState<Record<AgentKind, boolean> | null>(null)
  const [copied, setCopied] = useState<AgentKind | null>(null)

  useEffect(() => {
    window.orq.checkClisInstalled().then(setInstalled)
  }, [])

  const copyInstall = (agent: AgentKind): void => {
    window.orq.copyText(INSTALL_CMD[agent])
    setCopied(agent)
    setTimeout(() => setCopied((cur) => (cur === agent ? null : cur)), 1500)
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
