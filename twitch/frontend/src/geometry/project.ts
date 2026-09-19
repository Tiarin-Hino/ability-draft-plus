import type { TwitchRect } from '@shared/types/twitch'
import type { GameRectCalibration, PxRect, TopBarGeometry } from './types'

// Pure geometry: the extension iframe covers the whole player; the video is letter- or
// pillar-boxed inside it (Twitch keeps the broadcast aspect); the GAME occupies the
// broadcaster's calibrated sub-rectangle of the video (full frame by default). Slot
// fractions (from the app, relative to the game frame) map through all three.

export const FULL_FRAME: GameRectCalibration = { x: 0, y: 0, w: 1, h: 1 }

/** Contain-fit a video of the given aspect ratio into the iframe. */
export function fitVideoRect(iframe: { w: number; h: number }, videoAspect: number): PxRect {
  if (iframe.w <= 0 || iframe.h <= 0 || !Number.isFinite(videoAspect) || videoAspect <= 0) {
    return { x: 0, y: 0, w: Math.max(0, iframe.w), h: Math.max(0, iframe.h) }
  }
  const iframeAspect = iframe.w / iframe.h
  if (iframeAspect > videoAspect) {
    // Pillarbox: full height, centered horizontally
    const w = iframe.h * videoAspect
    return { x: (iframe.w - w) / 2, y: 0, w, h: iframe.h }
  }
  // Letterbox: full width, centered vertically
  const h = iframe.w / videoAspect
  return { x: 0, y: (iframe.h - h) / 2, w: iframe.w, h }
}

/** Game frame in iframe pixels: the calibrated sub-rectangle of the video. */
export function gameRect(video: PxRect, cal: GameRectCalibration): PxRect {
  return {
    x: video.x + video.w * cal.x,
    y: video.y + video.h * cal.y,
    w: video.w * cal.w,
    h: video.h * cal.h,
  }
}

export function toPx(rect: TwitchRect, game: PxRect): PxRect {
  return {
    x: game.x + rect[0] * game.w,
    y: game.y + rect[1] * game.h,
    w: rect[2] * game.w,
    h: rect[3] * game.h,
  }
}

export function projectRects(rects: (TwitchRect | null)[], game: PxRect): (PxRect | null)[] {
  return rects.map((rect) => (rect ? toPx(rect, game) : null))
}

/** In-game top bar portraits with the broadcaster's fine-tune (dx/dy in frame fractions). */
export function projectTopBar(
  topbar: TopBarGeometry,
  game: PxRect,
  tune: { dx: number; dy: number; scale: number },
): PxRect[] {
  const centerX = topbar.clock[0] + topbar.clock[2] / 2
  return topbar.portraits.map((rect) => {
    // Scale around the bar's center so the bar stays centered when zoomed
    const x = centerX + (rect[0] - centerX) * tune.scale + tune.dx
    const y = rect[1] * tune.scale + tune.dy
    return toPx([x, y, rect[2] * tune.scale, rect[3] * tune.scale], game)
  })
}

export function parseResolution(value: string | undefined | null): { w: number; h: number } | null {
  if (!value) return null
  const match = /^(\d+)x(\d+)$/.exec(value.trim())
  if (!match) return null
  const w = Number(match[1])
  const h = Number(match[2])
  return w > 0 && h > 0 ? { w, h } : null
}
