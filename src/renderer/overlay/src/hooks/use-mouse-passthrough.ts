import { useCallback, useEffect, useRef } from 'react'

// @DEV-GUIDE: Split-lock mouse passthrough controller for the transparent click-through overlay.
// Tracks modal locks (acquireMousePassthroughLock) separately from hover locks (useMousePassthrough)
// so overlapping hovers never prematurely re-enable click-through while an outer surface or modal
// is active, AND hidden/unmounted/missed-mouseleave hover locks can be reconciled safely via
// releaseAllHoverPassthroughLocks() or the lazy pointermove/blur reconciler without releasing
// open modal locks.

const modalLocks = new Set<symbol>()
const hoverLocks = new Map<symbol, () => void>()
let reconcilerAttached = false

function hasAnyLock(): boolean {
  return modalLocks.size > 0 || hoverLocks.size > 0
}

function sendMouseIgnore(ignore: boolean): void {
  if (ignore) {
    window.electronApi.send('overlay:setMouseIgnore', {
      ignore: true,
      forward: true,
    })
  } else {
    window.electronApi.send('overlay:setMouseIgnore', {
      ignore: false,
    })
  }
}

function handlePointerMove(e: Event): void {
  if (modalLocks.size > 0 || hoverLocks.size === 0) return
  if (((e as Partial<PointerEvent>).buttons ?? 0) !== 0) return
  const isInteractive =
    e.target instanceof Element && e.target.closest('.overlay-interactive') !== null
  if (!isInteractive) {
    releaseAllHoverPassthroughLocks()
  }
}

function handleGlobalLeave(): void {
  if (modalLocks.size === 0 && hoverLocks.size > 0) {
    releaseAllHoverPassthroughLocks()
  }
}

function attachReconciler(): void {
  if (reconcilerAttached || typeof document === 'undefined' || typeof window === 'undefined') {
    return
  }
  reconcilerAttached = true
  document.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true })
  document.addEventListener('mouseleave', handleGlobalLeave)
  window.addEventListener('blur', handleGlobalLeave)
}

function detachReconciler(): void {
  if (!reconcilerAttached || typeof document === 'undefined' || typeof window === 'undefined') {
    return
  }
  reconcilerAttached = false
  document.removeEventListener('pointermove', handlePointerMove, { capture: true })
  document.removeEventListener('mouseleave', handleGlobalLeave)
  window.removeEventListener('blur', handleGlobalLeave)
}

export function releaseAllHoverPassthroughLocks(): void {
  for (const release of [...hoverLocks.values()]) {
    release()
  }
}

export function acquireMousePassthroughLock(): () => void {
  const token = Symbol('overlay-interaction')
  const wasEmpty = !hasAnyLock()
  modalLocks.add(token)
  if (wasEmpty) {
    sendMouseIgnore(false)
  }

  let released = false
  return () => {
    if (released) return
    released = true
    modalLocks.delete(token)
    if (!hasAnyLock()) {
      sendMouseIgnore(true)
    }
  }
}

export function resetMousePassthroughForTests(): void {
  modalLocks.clear()
  hoverLocks.clear()
  detachReconciler()
}

export function useMousePassthrough(enabled = true) {
  const releaseRef = useRef<(() => void) | null>(null)
  const enabledRef = useRef(enabled)

  const onMouseEnter = useCallback((): void => {
    if (!enabledRef.current || releaseRef.current !== null) return

    const token = Symbol('overlay-hover')
    const wasEmpty = !hasAnyLock()
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      hoverLocks.delete(token)
      if (releaseRef.current === release) {
        releaseRef.current = null
      }
      if (hoverLocks.size === 0) {
        detachReconciler()
      }
      if (!hasAnyLock()) {
        sendMouseIgnore(true)
      }
    }

    releaseRef.current = release
    hoverLocks.set(token, release)
    attachReconciler()
    if (wasEmpty) {
      sendMouseIgnore(false)
    }
  }, [])

  const onMouseLeave = useCallback((): void => {
    if (releaseRef.current !== null) {
      releaseRef.current()
    } else if (!hasAnyLock()) {
      sendMouseIgnore(true)
    }
  }, [])

  useEffect(() => {
    enabledRef.current = enabled
    if (!enabled && releaseRef.current !== null) {
      releaseRef.current()
    }
  }, [enabled])

  useEffect(() => {
    return () => {
      if (releaseRef.current !== null) {
        releaseRef.current()
      }
    }
  }, [])

  return { onMouseEnter, onMouseLeave }
}
