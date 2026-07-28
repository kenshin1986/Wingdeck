// eslint-disable-next-line no-control-regex
const CSI_OSC_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\r/g

// "Sonnet 5 with high effort · Claude Max" (banner de arranque de Claude Code)
const CLAUDE_FRIENDLY_RE = /\b(Opus|Sonnet|Haiku|Fable)\s+(\d+(?:\.\d+)?)\b/i
// Fallback cuando Claude Code imprime el id crudo (Bedrock/Vertex) en vez del nombre amigable
const CLAUDE_RAW_ID_RE = /claude-(opus|sonnet|haiku)-(\d+(?:[-.]\d+)*)/i
// "Build · qwen3.5:397b Ollama Cloud" (barra de estado de opencode)
const OPENCODE_STATUS_RE = /(?:Build|Plan)\s*·\s*(\S+)\s+([A-Za-z][\w. ]*?)(?=[^\w. ]|$)/

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

export interface DetectedModel {
  /** Texto corto para mostrar en el badge, p. ej. "Sonnet 5" o "qwen3.5:397b (Ollama Cloud)" */
  label: string
}

/**
 * Detección best-effort del modelo activo a partir de salida cruda del pty. Los
 * formatos de banner de estas CLIs no son un contrato estable — ver plan/investigación
 * en la sesión que introdujo esto — así que esto puede dejar de matchear entre
 * versiones de las CLIs sin que sea un bug de Wingdeck en sí.
 */
export function detectModel(text: string): DetectedModel | null {
  const clean = text.replace(CSI_OSC_RE, '')

  const opencode = OPENCODE_STATUS_RE.exec(clean)
  if (opencode) {
    const [, model, provider] = opencode
    return { label: `${model} (${provider.trim()})` }
  }

  const friendly = CLAUDE_FRIENDLY_RE.exec(clean)
  if (friendly) {
    const [, family, version] = friendly
    return { label: `${capitalize(family)} ${version}` }
  }

  const rawId = CLAUDE_RAW_ID_RE.exec(clean)
  if (rawId) {
    const [, family, version] = rawId
    return { label: `${capitalize(family)} ${version}` }
  }

  return null
}
