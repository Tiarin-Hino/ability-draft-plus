import { useCallback, useEffect, useRef } from 'react'

// @DEV-GUIDE: Ref-counted mouse passthrough controller for the transparent click-through overlay.
// Tracks active hover/modal interaction locks in a module-level Set<symbol> so overlapping hovers
// (button -> tooltip, panel -> modal) never prematurely re-enable click-through when an inner
// child fires onMouseLeave or unmounts. ConfirmModal uses acquireMousePassthroughLock directly.

const activeLocks = new Set<symbol>()

export function acquireMousePassthroughLock(): () => void {
  const token = Symbol('overlay-interaction')
  const wasEmpty = activeLocks.size === 0
  activeLocks.add(token)
  if (wasEmpty) {
    window.electronApi.send('overlay:setMouseIgnore', { ignore: false })
  }

  let released = false
  return () => {
    if (released) return
    released = true
    activeLocks.delete(token)
    if (activeLocks.size === 0) {
      window.electronApi.send('overlay:setMouseIgnore', {
        ignore: true,
        forward: true,
      })
    }
  }
}

export function resetMousePassthroughForTests(): void {
  activeLocks.clear()
}

export function useMousePassthrough() {
  const releaseRef = useRef<(() => void) | null>(null)

  const onMouseEnter = useCallback((): void => {
    if (releaseRef.current === null) {
      releaseRef.current = acquireMousePassthroughLock()
    }
  }, [])

  const onMouseLeave = useCallback((): void => {
    if (releaseRef.current !== null) {
      releaseRef.current()
      releaseRef.current = null
    } else if (activeLocks.size === 0) {
      window.electronApi.send('overlay:setMouseIgnore', {
        ignore: true,
        forward: true,
      })
    }
  }, [])

  useEffect(() => {
    return () => {
      if (releaseRef.current !== null) {
        releaseRef.current()
        releaseRef.current = null
      }
    }
  }, [])

  return { onMouseEnter, onMouseLeave }
}
