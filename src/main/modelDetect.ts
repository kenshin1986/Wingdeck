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

// Confirmación de cambio de modelo de Claude Code ("Set model to Fable 5 and saved…")
const SET_MODEL_RE = /set model to/gi

interface Candidate {
  index: number
  label: string
}

/** Último match (el más a la derecha) de `re` en `text`, con su label */
function lastMatch(
  re: RegExp,
  text: string,
  toLabel: (m: RegExpExecArray) => string
): Candidate | null {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let last: Candidate | null = null
  let m: RegExpExecArray | null
  while ((m = g.exec(text)) !== null) {
    last = { index: m.index, label: toLabel(m) }
    if (m.index === g.lastIndex) g.lastIndex++
  }
  return last
}

const claudeLabel = (m: RegExpExecArray): string => `${capitalize(m[1])} ${m[2]}`
const opencodeLabel = (m: RegExpExecArray): string => `${m[1]} (${m[2].trim()})`

/**
 * Detección best-effort del modelo activo a partir de salida cruda del pty. Los
 * formatos de banner de estas CLIs no son un contrato estable — ver plan/investigación
 * en la sesión que introdujo esto — así que esto puede dejar de matchear entre
 * versiones de las CLIs sin que sea un bug de Wingdeck en sí.
 *
 * La ventana de escaneo es rodante y puede contener texto viejo (p. ej. el menú
 * de /model lista TODOS los modelos): por eso NUNCA se toma el primer match
 * posicional — gana la confirmación explícita "Set model to X" si está, y si no
 * el match más a la derecha (lo más reciente que emitió la CLI).
 */
export function detectModel(text: string): DetectedModel | null {
  const clean = text.replace(CSI_OSC_RE, '')

  // Prioridad 1: la última confirmación explícita de cambio de modelo
  let confirmEnd = -1
  SET_MODEL_RE.lastIndex = 0
  let cm: RegExpExecArray | null
  while ((cm = SET_MODEL_RE.exec(clean)) !== null) confirmEnd = cm.index + cm[0].length
  if (confirmEnd >= 0) {
    const after = clean.slice(confirmEnd, confirmEnd + 120)
    const friendly = CLAUDE_FRIENDLY_RE.exec(after)
    if (friendly) return { label: claudeLabel(friendly) }
    const rawId = CLAUDE_RAW_ID_RE.exec(after)
    if (rawId) return { label: claudeLabel(rawId) }
  }

  // Prioridad 2: el match más reciente del stream entre todos los formatos
  const candidates = [
    lastMatch(OPENCODE_STATUS_RE, clean, opencodeLabel),
    lastMatch(CLAUDE_FRIENDLY_RE, clean, claudeLabel),
    lastMatch(CLAUDE_RAW_ID_RE, clean, claudeLabel)
  ].filter((c): c is Candidate => c !== null)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.index - a.index)
  return { label: candidates[0].label }
}
