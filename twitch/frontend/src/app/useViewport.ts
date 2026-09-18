import { useEffect, useMemo, useState } from 'react'
import { fitVideoRect, gameRect } from '../geometry/project'
import type { PxRect } from '../geometry/types'
import { useOverlayStore } from './store'

/** Iframe size -> video rect (contain-fit) -> calibrated game rect, all in px. */
export function useViewport(): { iframe: { w: number; h: number }; video: PxRect; game: PxRect } {
  const [iframe, setIframe] = useState({ w: window.innerWidth, h: window.innerHeight })
  const videoRes = useOverlayStore((s) => s.context.videoRes)
  const calibration = useOverlayStore((s) => s.config.gameRect)

  useEffect(() => {
    const update = () => setIframe({ w: window.innerWidth, h: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(document.documentElement)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [])

  return useMemo(() => {
    const aspect = videoRes ? videoRes.w / videoRes.h : 16 / 9
    const video = fitVideoRect(iframe, aspect)
    return { iframe, video, game: gameRect(video, calibration) }
  }, [iframe, videoRes, calibration])
}
