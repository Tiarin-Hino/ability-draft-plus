// @DEV-GUIDE: Pure screen-space perspective geometry for aligning overlay hotspot frames
// onto Dota 2's 3D Ability Draft board without hardcoding resolution-specific matrices.
//
// Zero Electron imports — safe in both renderer components and Vitest unit tests.
// Dota 2 scales the centered AD board proportionally to viewportHeight / 1080 around
// viewportWidth / 2 across 16:9, 16:10, and ultrawide (21:9 / 32:9) aspect ratios:
// - Standard grid & model portraits sit on a central tilted plinth (vanishing point above center).
// - Upper 2x6 ultimate rack tiles follow a subtle arched horizontal perspective slope per column.
// - Selected player pick slots and hero cards sit on flat screen-aligned side panels.

export type VisualSlotCategory = 'ultimate' | 'standard' | 'model' | 'selected' | 'heroCard'

export interface SlotBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BoardPerspectiveStyle {
  skewXDeg: number
  skewYDeg: number
  rotateXDeg: number
  cssTransform: string
}

const REFERENCE_WIDTH = 1920
const REFERENCE_HEIGHT = 1080
const VANISH_X = 960
const VANISH_Y = -2040
const MAX_SKEW_X_DEG = 7.5
const STANDARD_ROTATE_X_DEG = 7
const ULT_COLUMN_SLOPES = [0.0567, 0.0309, 0.0103, -0.0103, -0.0412, -0.0567] as const

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) || Math.abs(value) < 0.005 ? 0 : value
}

const IDENTITY_STYLE: BoardPerspectiveStyle = {
  skewXDeg: 0,
  skewYDeg: 0,
  rotateXDeg: 0,
  cssTransform: 'none',
}

/**
 * Computes screen-space CSS perspective transforms for a board slot or UI card.
 * Expects `slot` and `viewportWidth`/`viewportHeight` to use matching pixel units
 * (both CSS logical pixels in the overlay renderer, or both physical pixels).
 */
export function computeBoardPerspectiveStyle(
  slot: SlotBounds,
  category: VisualSlotCategory,
  viewportWidth: number,
  viewportHeight: number,
): BoardPerspectiveStyle {
  if (
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight)
  ) {
    return IDENTITY_STYLE
  }

  if (category === 'selected' || category === 'heroCard') {
    return IDENTITY_STYLE
  }

  const cx = slot.x + slot.width / 2
  const cy = slot.y + slot.height / 2
  const scale = viewportHeight / REFERENCE_HEIGHT
  const dx1080 = (cx - viewportWidth / 2) / scale
  const x1080 = REFERENCE_WIDTH / 2 + dx1080
  const y1080 = cy / scale

  if (category === 'ultimate') {
    const col = clamp(Math.floor((dx1080 + 360) / 120), 0, ULT_COLUMN_SLOPES.length - 1)
    const slope = ULT_COLUMN_SLOPES[col]
    const skewYDeg = normalizeZero(Number(((Math.atan(slope) * 180) / Math.PI).toFixed(2)))
    return {
      skewXDeg: 0,
      skewYDeg,
      rotateXDeg: 0,
      cssTransform: skewYDeg === 0 ? 'none' : `skewY(${skewYDeg.toFixed(2)}deg)`,
    }
  }

  // 'standard' and 'model' slots sit on the tilted central 3D plinth.
  const dy = Math.max(400, y1080 - VANISH_Y)
  const tanTheta = (x1080 - VANISH_X) / dy
  const rawSkewX = ((-Math.atan(tanTheta) * 180) / Math.PI) * 0.55
  const skewXDeg = normalizeZero(
    Number(clamp(rawSkewX, -MAX_SKEW_X_DEG, MAX_SKEW_X_DEG).toFixed(2)),
  )
  const rotateXDeg = STANDARD_ROTATE_X_DEG

  return {
    skewXDeg,
    skewYDeg: 0,
    rotateXDeg,
    cssTransform: `perspective(900px) rotateX(${rotateXDeg}deg) skewX(${skewXDeg.toFixed(2)}deg)`,
  }
}
