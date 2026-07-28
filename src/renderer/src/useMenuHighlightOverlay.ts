import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import {
  buildOptionRanks,
  computeArrowDelta,
  resolveKeyBytes,
  scanHighlightedRows,
  DORMANT_AFTER_EMPTY_SCANS,
  type RankedRow
} from './menuHighlight'

const DORMANT_POLL_MS = 500
/** Micro-delay entre pulsaciones sintéticas: algunos lectores de input en modo raw
 * (readline de Node en TUIs) procesan por chunk y podrían perder pulsaciones si
 * llegan pegadas en un solo paquete sin flush entre medio. */
const KEY_SEND_DELAY_MS = 10

export interface MenuOverlayRow {
  bufferY: number
  top: number
  height: number
}

interface FreshScan {
  highlighted: number[]
  ranks: RankedRow[]
}

function freshScan(term: Terminal): FreshScan {
  return { highlighted: scanHighlightedRows(term), ranks: buildOptionRanks(term) }
}

/** Detecta genéricamente "qué línea visible de un menú de consola está resaltada
 * ahora" (alternate buffer + exactamente 1 fila con inverse/bg no-default) y permite
 * hacer click en otra línea para sintetizar las flechas necesarias hacia el pty —
 * ver el plan en C:\Users\Manuel\.claude\plans\cached-gliding-hellman.md. */
export function useMenuHighlightOverlay(
  term: Terminal | null,
  containerRef: React.RefObject<HTMLDivElement | null>
): { rows: MenuOverlayRow[]; onRowClick: (bufferY: number) => void } {
  const [rows, setRows] = useState<MenuOverlayRow[]>([])
  const dormantRef = useRef(false)
  const emptyStreakRef = useRef(0)
  const genRef = useRef(0)

  const clearRows = useCallback((): void => {
    setRows((prev) => (prev.length ? [] : prev))
  }, [])

  const gateOpen = useCallback((t: Terminal): boolean => {
    return (
      t.buffer.active.type === 'alternate' &&
      t.modes.mouseTrackingMode === 'none' &&
      !t.hasSelection()
    )
  }, [])

  const rescan = useCallback(
    (t: Terminal): void => {
      if (dormantRef.current) return
      if (!gateOpen(t)) {
        clearRows()
        // El circuit-breaker solo cuenta "estamos en alt-buffer sin un resaltado
        // claro" (vim/htop) — salir de alt-buffer o tener selección activa no debe
        // sumar al contador de modo dormido.
        if (t.buffer.active.type !== 'alternate') emptyStreakRef.current = 0
        return
      }
      const { highlighted, ranks } = freshScan(t)
      if (highlighted.length !== 1) {
        clearRows()
        emptyStreakRef.current++
        if (emptyStreakRef.current >= DORMANT_AFTER_EMPTY_SCANS) dormantRef.current = true
        return
      }
      emptyStreakRef.current = 0
      const container = containerRef.current
      if (!container || container.clientHeight === 0) return
      // .term-body tiene padding propio (el área donde xterm realmente dibuja filas
      // es su content-box, no el clientHeight completo) — hay que descontarlo para
      // que las filas del overlay no vayan corriéndose respecto al texto real.
      const style = getComputedStyle(container)
      const padTop = parseFloat(style.paddingTop) || 0
      const padBottom = parseFloat(style.paddingBottom) || 0
      const contentHeight = container.clientHeight - padTop - padBottom
      if (contentHeight <= 0) return
      const focusBufferY = highlighted[0]
      const rowHeightPx = contentHeight / t.rows
      const next = ranks
        .filter((r) => r.bufferY !== focusBufferY)
        .map((r) => ({
          bufferY: r.bufferY,
          top: padTop + r.viewportRow * rowHeightPx,
          height: rowHeightPx
        }))
      setRows(next)
    },
    [clearRows, containerRef, gateOpen]
  )

  useEffect(() => {
    if (!term) return
    genRef.current++
    dormantRef.current = false
    emptyStreakRef.current = 0
    setRows([])

    let rafId = 0
    let dirty = false
    const scheduleRescan = (): void => {
      dirty = true
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        if (dirty) {
          dirty = false
          rescan(term)
        }
      })
    }

    let lastBufferType = term.buffer.active.type
    const dormantPoll = setInterval(() => {
      if (!dormantRef.current) return
      const type = term.buffer.active.type
      if (type !== lastBufferType) {
        lastBufferType = type
        dormantRef.current = false
        emptyStreakRef.current = 0
        scheduleRescan()
      }
    }, DORMANT_POLL_MS)

    const renderSub = term.onRender(() => scheduleRescan())
    const cursorSub = term.onCursorMove(() => scheduleRescan())
    const resizeSub = term.onResize(() => scheduleRescan())
    const selSub = term.onSelectionChange(() => scheduleRescan())
    const bufferSub = term.buffer.onBufferChange((buf) => {
      lastBufferType = buf.type
      dormantRef.current = false
      emptyStreakRef.current = 0
      scheduleRescan()
    })

    return () => {
      cancelAnimationFrame(rafId)
      clearInterval(dormantPoll)
      renderSub.dispose()
      cursorSub.dispose()
      resizeSub.dispose()
      selSub.dispose()
      bufferSub.dispose()
    }
  }, [term, rescan])

  const onRowClick = useCallback(
    (bufferY: number): void => {
      if (!term) return
      if (!gateOpen(term)) return
      const { highlighted, ranks } = freshScan(term)
      if (highlighted.length !== 1) return
      const delta = computeArrowDelta(ranks, highlighted[0], bufferY)
      if (!delta) return
      const bytes = resolveKeyBytes(delta.keys, term.modes.applicationCursorKeysMode)
      const gen = genRef.current
      let sent = 0
      const sendNext = (): void => {
        if (gen !== genRef.current) return
        term.input(bytes, false)
        sent++
        if (sent < delta.count) setTimeout(sendNext, KEY_SEND_DELAY_MS)
      }
      sendNext()
    },
    [term, gateOpen]
  )

  return { rows, onRowClick }
}
