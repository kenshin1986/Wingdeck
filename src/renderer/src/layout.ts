import { getAllCollisions, sortLayoutItemsByRowCol, type Layout, type LayoutItem } from 'react-grid-layout'

export const GRID_COLS = 24
export const ROW_HEIGHT = 24
export const MARGIN = 10
export const MIN_W = 5
export const MIN_H = 7

/** Filas de grilla que entran en containerH sin que aparezca scroll vertical. */
export function availableRows(containerH: number): number {
  return Math.max(MIN_H, Math.floor((containerH - MARGIN) / (ROW_HEIGHT + MARGIN)))
}

export interface ArrangeInput {
  /** Layout actual (de ahí se leen los rects de las pineadas) */
  current: Layout
  /** ids de terminales fijadas: no se mueven, el resto las esquiva */
  pinnedIds: Set<string>
  /** columnas objetivo, o 'auto' para la heurística por aspecto */
  cols: 'auto' | 1 | 2 | 3
  containerW: number
  containerH: number
}

/** Resta de intervalos 1-D: [0, total) menos los rangos ocupados, ordenados. */
function freeIntervals(total: number, occupied: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...occupied].sort((a, b) => a[0] - b[0])
  const free: Array<[number, number]> = []
  let cursor = 0
  for (const [start, end] of sorted) {
    if (start > cursor) free.push([cursor, start])
    cursor = Math.max(cursor, end)
  }
  if (cursor < total) free.push([cursor, total])
  return free
}

/**
 * Reacomoda las terminales no pineadas en `cols` columnas (o una heurística
 * por aspecto si `cols==='auto'`) dentro del alto visible, esquivando los
 * rects ocupados por las pineadas. Las pineadas vuelven intactas.
 *
 * Algoritmo: bandas horizontales de izquierda a derecha. Por cada banda se
 * calculan los huecos libres restando los rects de pins que la tocan
 * (rectángulo completo x∈[0,24)), y se reparten ahí los items pendientes.
 * Si una banda queda sin capacidad (un pin ocupa todo el ancho) se salta y
 * se sigue debajo — ese es el único caso, junto con "no entran ni al mínimo
 * de alto", donde el resultado puede exceder el viewport (aparece scroll).
 */
export function arrangeLayout(input: ArrangeInput): LayoutItem[] {
  const { current, pinnedIds, cols, containerW, containerH } = input
  const pinned = current.filter((l) => pinnedIds.has(l.i))
  const free = sortLayoutItemsByRowCol(current.filter((l) => !pinnedIds.has(l.i)))
  const n = free.length
  if (n === 0) return current.slice()

  const availRows = availableRows(containerH)

  let c: number
  if (cols === 'auto') {
    let guess = Math.max(1, Math.round(Math.sqrt(n * (containerW / Math.max(containerH, 1)))))
    // Sube columnas si con `guess` no entraría a lo alto — la heurística original
    // podía exceder el viewport porque no consideraba el alto disponible.
    const maxRowsFit = Math.max(1, Math.floor(availRows / MIN_H))
    guess = Math.max(guess, Math.ceil(n / maxRowsFit))
    c = Math.min(guess, n, Math.max(1, Math.floor(GRID_COLS / MIN_W)))
  } else {
    c = Math.min(cols, n)
  }

  const rows = Math.ceil(n / c)
  const totalRowUnits = rows * MIN_H > availRows ? rows * MIN_H : availRows

  const baseH = Math.floor(totalRowUnits / rows)
  let hRemainder = totalRowUnits - baseH * rows
  const rowHeights: number[] = []
  for (let i = 0; i < rows; i++) {
    rowHeights.push(baseH + (hRemainder > 0 ? 1 : 0))
    if (hRemainder > 0) hRemainder--
  }
  const overflowBandH = rowHeights[rowHeights.length - 1] ?? MIN_H

  const result: LayoutItem[] = [...pinned]
  const queue = [...free]
  let y = 0
  let bandIdx = 0
  // Cota de seguridad: nunca deberíamos iterar más bandas que ítems + filas,
  // pero evita cualquier loop infinito si un caso límite no se contempló.
  const guardMax = n + rows + 32

  for (let iter = 0; iter < guardMax && queue.length > 0; iter++) {
    const h = bandIdx < rowHeights.length ? rowHeights[bandIdx] : overflowBandH
    bandIdx++
    const band: LayoutItem = { i: '__arrange_band__', x: 0, y, w: GRID_COLS, h }
    const overlapping = getAllCollisions(pinned, band)
    const occupied: Array<[number, number]> = overlapping.map((p) => [p.x, p.x + p.w])
    const intervals = freeIntervals(GRID_COLS, occupied).filter(([s, e]) => e - s >= MIN_W)

    if (intervals.length === 0) {
      y += h
      continue
    }

    const totalFreeW = intervals.reduce((sum, [s, e]) => sum + (e - s), 0)
    const caps = intervals.map(([s, e]) => Math.floor((e - s) / MIN_W))
    const capacity = caps.reduce((a, b) => a + b, 0)
    const want = Math.min(c, queue.length, capacity)
    if (want === 0) {
      y += h
      continue
    }

    const counts = intervals.map(([s, e], i) =>
      Math.min(caps[i], Math.round((want * (e - s)) / totalFreeW))
    )
    let assigned = counts.reduce((a, b) => a + b, 0)
    // El redondeo puede dejar `assigned` distinto de `want`: ajustar respetando
    // la capacidad de cada intervalo.
    for (let i = 0; assigned < want && i < intervals.length * 2; i++) {
      const idx = i % intervals.length
      if (counts[idx] < caps[idx]) {
        counts[idx]++
        assigned++
      }
    }
    for (let i = 0; assigned > want && i < intervals.length * 2; i++) {
      const idx = i % intervals.length
      if (counts[idx] > 0) {
        counts[idx]--
        assigned--
      }
    }

    for (let i = 0; i < intervals.length; i++) {
      const k = counts[i]
      if (k <= 0) continue
      const [s, e] = intervals[i]
      const w = e - s
      const baseW = Math.floor(w / k)
      let wRemainder = w - baseW * k
      let x = s
      for (let j = 0; j < k; j++) {
        const item = queue.shift()
        if (!item) break
        const itemW = baseW + (wRemainder > 0 ? 1 : 0)
        if (wRemainder > 0) wRemainder--
        result.push({ i: item.i, x, y, w: itemW, h, minW: MIN_W, minH: MIN_H })
        x += itemW
      }
    }
    y += h
  }

  return result
}
