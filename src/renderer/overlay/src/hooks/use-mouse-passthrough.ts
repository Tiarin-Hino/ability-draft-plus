import { useCallback } from 'react'

// @DEV-GUIDE: Provides onMouseEnter/onMouseLeave handlers for overlay interactive elements.
// Enter: sends overlay:setMouseIgnore { ignore: false } -> disables click-through (user can interact)
// Leave: sends overlay:setMouseIgnore { ignore: true, forward: true } -> re-enables click-through
// This toggles Electron's setIgnoreMouseEvents() at the OS level. Every interactive overlay
// component (buttons, panels, tooltips) spreads these handlers onto its root element.

export function useMousePassthrough() {
  const onMouseEnter = useCallback((): void => {
    window.electronApi.send('overlay:setMouseIgnore', {
      ignore: false,
    })
  }, [])

  const onMouseLeave = useCallback((): void => {
    window.electronApi.send('overlay:setMouseIgnore', {
      ignore: true,
      forward: true,
    })
  }, [])

  return { onMouseEnter, onMouseLeave }
}
