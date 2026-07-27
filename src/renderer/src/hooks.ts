import { useEffect, useRef, useState } from 'react'

/** Cierra un popover/menú al hacer clic fuera de él */
export function useClickOutside(
  open: boolean,
  onClose: () => void
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open, onClose])
  return ref
}

/** Re-renderiza periódicamente (para tiempos relativos "hace 3 min") */
export function useNow(intervalMs = 15000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
