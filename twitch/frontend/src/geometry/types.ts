import type { TwitchRect } from '@shared/types/twitch'

/** Pixel rectangle inside the extension iframe. */
export interface PxRect {
  x: number
  y: number
  w: number
  h: number
}

/** Where the game frame sits inside the streamer's canvas (fractions of the canvas). */
export interface GameRectCalibration {
  x: number
  y: number
  w: number
  h: number
}

export interface TopBarGeometry {
  /** Reference frame the fractions were measured on. */
  frame: { w: number; h: number }
  /** Player order 0-4 radiant (left of the clock), 5-9 dire. */
  portraits: TwitchRect[]
  clock: TwitchRect
}
