import type { Terminal } from '@xterm/xterm'

/** Nunca se envían más pulsaciones que esto por click: si el heurístico calculó una
 * distancia mayor, casi seguro erró de menú — mejor no actuar que enviar decenas de
 * flechas a ciegas. */
export const MAX_SYNTH_KEYS = 40

/** Fracción mínima de celdas no-espacio de una fila que deben cumplir el criterio de
 * resaltado (inverse o bg no-default) para contar como "fila resaltada". Evita que un
 * solo carácter decorativo con bg cuente como selección de menú. */
const HIGHLIGHT_CELL_RATIO = 0.4

/** Tras esta cantidad de rescans consecutivos sin exactamente 1 fila resaltada, el
 * hook que consume este módulo debe pasar a modo "dormido" (ver useMenuHighlightOverlay). */
export const DORMANT_AFTER_EMPTY_SCANS = 20

export type SyntheticKey = 'up' | 'down'

export interface RankedRow {
  /** Índice de fila absoluto en el buffer (no relativo al viewport). */
  bufferY: number
  /** Fila dentro del viewport, 0..term.rows-1 — usada para geometría del overlay. */
  viewportRow: number
  /** Posición dentro de la lista de opciones reales (excluye blancos/separadores). */
  rank: number
  text: string
}

/** Caracteres de "box drawing" y adornos repetidos comunes en separadores visuales de
 * menús (líneas horizontales, marcos) — filas dominadas por estos no cuentan como
 * opciones navegables. */
const BOX_DRAWING_RE = /[─-╿▀-▟=_*~-]/

function isSeparatorLine(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  const nonSpace = [...trimmed].filter((c) => c !== ' ')
  if (nonSpace.length === 0) return true
  const boxLike = nonSpace.filter((c) => BOX_DRAWING_RE.test(c)).length
  if (boxLike / nonSpace.length > 0.6) return true
  // Fila dominada por un único carácter repetido (p. ej. "────────" con otro glifo)
  const distinct = new Set(nonSpace)
  if (distinct.size === 1 && nonSpace.length > 2) return true
  return false
}

function isRowHighlighted(term: Terminal, bufferY: number): boolean {
  const line = term.buffer.active.getLine(bufferY)
  if (!line) return false
  let nonSpace = 0
  let hit = 0
  for (let x = 0; x < term.cols; x++) {
    const cell = line.getCell(x)
    if (!cell) continue
    const ch = cell.getChars()
    if (ch === '' || ch === ' ') continue
    nonSpace++
    if (cell.isInverse() || !cell.isBgDefault()) hit++
  }
  if (nonSpace === 0) return false
  return hit / nonSpace >= HIGHLIGHT_CELL_RATIO
}

/** Recorre solo las filas visibles del viewport (nunca scrollback) y devuelve los
 * índices de buffer de las que cumplen el criterio de resaltado. */
export function scanHighlightedRows(term: Terminal): number[] {
  const buf = term.buffer.active
  const rows: number[] = []
  for (let r = 0; r < term.rows; r++) {
    const bufferY = buf.viewportY + r
    if (isRowHighlighted(term, bufferY)) rows.push(bufferY)
  }
  return rows
}

/** Construye el ranking de "opciones reales" visibles (excluye líneas en blanco,
 * separadores decorativos, y continuaciones de línea envuelta) para poder calcular
 * distancias en pulsaciones de flecha en vez de en filas de buffer crudas. */
export function buildOptionRanks(term: Terminal): RankedRow[] {
  const buf = term.buffer.active
  const ranked: RankedRow[] = []
  let rank = 0
  for (let r = 0; r < term.rows; r++) {
    const bufferY = buf.viewportY + r
    const line = buf.getLine(bufferY)
    if (!line || line.isWrapped) continue
    const text = line.translateToString(true)
    if (isSeparatorLine(text)) continue
    ranked.push({ bufferY, viewportRow: r, rank, text })
    rank++
  }
  return ranked
}

/** Distancia en pulsaciones de flecha entre la fila actualmente resaltada y una fila
 * objetivo, calculada en "ranks" de opción (no filas crudas) para que separadores y
 * líneas en blanco no desalineen el conteo. Devuelve null si alguna de las dos filas
 * no forma parte del ranking de opciones (p. ej. el usuario clickeó un separador). */
export function computeArrowDelta(
  ranks: RankedRow[],
  focusBufferY: number,
  targetBufferY: number
): { keys: SyntheticKey; count: number } | null {
  const focus = ranks.find((r) => r.bufferY === focusBufferY)
  const target = ranks.find((r) => r.bufferY === targetBufferY)
  if (!focus || !target) return null
  const delta = target.rank - focus.rank
  if (delta === 0) return null
  if (Math.abs(delta) > MAX_SYNTH_KEYS) return null
  return { keys: delta > 0 ? 'down' : 'up', count: Math.abs(delta) }
}

/** Resuelve una tecla sintética a los bytes exactos a enviar, respetando el modo de
 * cursor de aplicación (DECCKM) del programa activo — term.input() no pasa por el
 * traductor de teclado interno de xterm, así que hay que replicarlo a mano. */
export function resolveKeyBytes(key: SyntheticKey, applicationCursorKeys: boolean): string {
  const letter = key === 'up' ? 'A' : 'B'
  return applicationCursorKeys ? `\x1bO${letter}` : `\x1b[${letter}`
}
