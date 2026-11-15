import { useEffect, useState } from 'react'
import { resolveLogicalOverlayViewport } from '@core/resolution/visual-geometry'

/**
 * Track the overlay's logical DIP viewport dimensions across window resizes and
 * resolution updates, immune to Windows' 1px click-through width adjustment.
 */
export function useLogicalOverlayViewport(
  targetResolution: string | null | undefined,
  scaleFactor: number,
): { width: number; height: number } {
  const [windowViewport, setWindowViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1920,
    height: typeof window !== 'undefined' ? window.innerHeight : 1080,
  }))

  useEffect(() => {
    const onResize = (): void => {
      setWindowViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return resolveLogicalOverlayViewport(
    targetResolution,
    scaleFactor,
    windowViewport.width,
    windowViewport.height,
  )
}
