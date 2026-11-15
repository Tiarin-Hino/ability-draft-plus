// @DEV-GUIDE: Pure screen-space Panorama projection and perspective geometry for
// aligning overlay hotspot frames, pick sockets, hero cards, and action pills
// cleanly over Dota 2's 3D Ability Draft board at any desktop resolution.
// Zero Electron imports — runs in both renderer React UI and Vitest unit tests.

import type { LayoutSource } from '@shared/types'

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

export interface ResolvedVisualSlot {
  bounds: SlotBounds
  perspective: BoardPerspectiveStyle
  horizontalOverhangPx: number
}

export interface VisualSlotInput {
  fallback: SlotBounds
  category: VisualSlotCategory
  heroOrder?: number
  abilityOrder?: number
  isUltimate?: boolean
  boxIndex?: number
  viewportWidth: number
  viewportHeight: number
  layoutSource?: LayoutSource | null
}

const REFERENCE_WIDTH = 1920
const REFERENCE_HEIGHT = 1080
const BOARD_CENTER_X_1080 = 960.375
const MIN_WIDTH_HEIGHT_RATIO = 1.6
const PLINTH_VANISH_X = 960
const PLINTH_VANISH_Y = -1960
const MAX_PLINTH_SKEW_X_DEG = 7.8
const ULT_COL_PITCH_RATIO = 95.25
const ULT_SKEW_STEP_DEG = 1.18
const MAX_ULT_SKEW_X_DEG = 3.5

const IDENTITY_STYLE: BoardPerspectiveStyle = {
  skewXDeg: 0,
  skewYDeg: 0,
  rotateXDeg: 0,
  cssTransform: 'none',
}

interface UltimateCanonicalRow {
  heroOrders: readonly number[]
  y1080: number
  height1080: number
  width1080: number
  pitch1080: number
}

const ULTIMATE_ROWS: readonly UltimateCanonicalRow[] = [
  {
    heroOrders: [0, 1, 2, 7, 6, 5],
    y1080: 164.25,
    height1080: 61.5,
    width1080: 60.0,
    pitch1080: 96.3,
  },
  {
    heroOrders: [3, 4, 10, 11, 9, 8],
    y1080: 262.5,
    height1080: 59.25,
    width1080: 58.5,
    pitch1080: 94.2,
  },
]

const ULTIMATE_CANONICAL_BY_HERO = buildUltimateCanonicalMap()

interface PlinthCanonicalRow {
  leftHeroOrder: number
  rightHeroOrder: number
  stdY1080: number
  stdHeight1080: number
  stdWidth1080: number
  stdInnerCenterOffset1080: number
  stdPitch1080: number
  modelY1080: number
  modelHeight1080: number
  modelWidth1080: number
  modelCenterOffset1080: number
}

const PLINTH_ROWS: readonly PlinthCanonicalRow[] = [
  {
    leftHeroOrder: 0,
    rightHeroOrder: 5,
    stdY1080: 342.375,
    stdHeight1080: 45.75,
    stdWidth1080: 53.25,
    stdInnerCenterOffset1080: 51.6,
    stdPitch1080: 77.475,
    modelY1080: 342.75,
    modelHeight1080: 46.5,
    modelWidth1080: 55.5,
    modelCenterOffset1080: 309.375,
  },
  {
    leftHeroOrder: 1,
    rightHeroOrder: 6,
    stdY1080: 408.0,
    stdHeight1080: 47.625,
    stdWidth1080: 54.75,
    stdInnerCenterOffset1080: 53.0625,
    stdPitch1080: 79.5,
    modelY1080: 408.0,
    modelHeight1080: 48.75,
    modelWidth1080: 57.0,
    modelCenterOffset1080: 317.8125,
  },
  {
    leftHeroOrder: 2,
    rightHeroOrder: 7,
    stdY1080: 477.0,
    stdHeight1080: 50.25,
    stdWidth1080: 56.25,
    stdInnerCenterOffset1080: 54.375,
    stdPitch1080: 81.9375,
    modelY1080: 476.25,
    modelHeight1080: 51.75,
    modelWidth1080: 58.5,
    modelCenterOffset1080: 326.4375,
  },
  {
    leftHeroOrder: 3,
    rightHeroOrder: 8,
    stdY1080: 591.75,
    stdHeight1080: 54.75,
    stdWidth1080: 58.5,
    stdInnerCenterOffset1080: 57.1875,
    stdPitch1080: 85.5,
    modelY1080: 591.0,
    modelHeight1080: 56.25,
    modelWidth1080: 60.75,
    modelCenterOffset1080: 341.8125,
  },
  {
    leftHeroOrder: 4,
    rightHeroOrder: 9,
    stdY1080: 671.25,
    stdHeight1080: 58.125,
    stdWidth1080: 60.75,
    stdInnerCenterOffset1080: 58.875,
    stdPitch1080: 88.125,
    modelY1080: 670.5,
    modelHeight1080: 60.0,
    modelWidth1080: 63.0,
    modelCenterOffset1080: 352.125,
  },
  {
    leftHeroOrder: 10,
    rightHeroOrder: 11,
    stdY1080: 756.0,
    stdHeight1080: 61.5,
    stdWidth1080: 62.25,
    stdInnerCenterOffset1080: 60.5625,
    stdPitch1080: 90.9375,
    modelY1080: 755.25,
    modelHeight1080: 63.0,
    modelWidth1080: 65.25,
    modelCenterOffset1080: 363.1875,
  },
]

const STANDARD_CANONICAL_BY_KEY = buildStandardCanonicalMap()
const MODEL_CANONICAL_BY_HERO = buildModelCanonicalMap()

const HERO_CARD_Y0_1080 = 146.25
const HERO_CARD_ROW_STRIDE_1080 = 168.0
const HERO_CARD_RADIANT_X_1080 = 139.5
const HERO_CARD_DIRE_X_1080 = 1460.25
const HERO_CARD_WIDTH_1080 = 320.25
const HERO_CARD_HEIGHT_1080 = 151.5

const SELECTED_BOX_Y0_1080 = 236.25
const SELECTED_BOX_BASE_DP = 56
const SELECTED_BOX_HALF_MARGIN_DP = 2
const SELECTED_BOX_SIZE_1080 = 56.25
const SELECTED_BOX_RADIANT_INNER_1080 = 506.25
const SELECTED_BOX_DIRE_INNER_1080 = 505.5

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value
}

function computePanoramaProjection(
  viewportWidth: number,
  viewportHeight: number,
): { scale: number; letterboxY: number } {
  // Dota 2's Panorama UI scales by height down to a 16:10 horizontal width clamp,
  // then vertically letterboxes narrower aspect ratios (e.g. 4:3 / 5:4).
  const effectiveH = Math.min(viewportHeight, viewportWidth / MIN_WIDTH_HEIGHT_RATIO)
  const letterboxY = (viewportHeight - effectiveH) / 2
  return { scale: effectiveH / REFERENCE_HEIGHT, letterboxY }
}

function projectRectFrom1080p(
  rect1080: SlotBounds,
  viewportWidth: number,
  viewportHeight: number,
): SlotBounds {
  const { scale, letterboxY } = computePanoramaProjection(viewportWidth, viewportHeight)
  const centerX = viewportWidth / 2
  return {
    x: centerX + (rect1080.x - REFERENCE_WIDTH / 2) * scale,
    y: letterboxY + rect1080.y * scale,
    width: rect1080.width * scale,
    height: rect1080.height * scale,
  }
}

function buildUltimateCanonicalMap(): Map<number, SlotBounds> {
  const map = new Map<number, SlotBounds>()
  for (const row of ULTIMATE_ROWS) {
    row.heroOrders.forEach((heroOrder, col) => {
      const offsetUnits = col - 2.5
      const cx = BOARD_CENTER_X_1080 + offsetUnits * row.pitch1080
      map.set(heroOrder, {
        x: cx - row.width1080 / 2,
        y: row.y1080,
        width: row.width1080,
        height: row.height1080,
      })
    })
  }
  return map
}

function buildStandardCanonicalMap(): Map<string, SlotBounds> {
  const map = new Map<string, SlotBounds>()
  for (const row of PLINTH_ROWS) {
    for (let abilityOrder = 1; abilityOrder <= 3; abilityOrder++) {
      // Left side displays ability_order 1..3 outer-to-inner; right side displays 1..3 inner-to-outer.
      const leftColFromCenter = 3 - abilityOrder
      const leftCx =
        BOARD_CENTER_X_1080 - (row.stdInnerCenterOffset1080 + leftColFromCenter * row.stdPitch1080)
      map.set(`${row.leftHeroOrder}:${abilityOrder}`, {
        x: leftCx - row.stdWidth1080 / 2,
        y: row.stdY1080,
        width: row.stdWidth1080,
        height: row.stdHeight1080,
      })

      const rightColFromCenter = abilityOrder - 1
      const rightCx =
        BOARD_CENTER_X_1080 + (row.stdInnerCenterOffset1080 + rightColFromCenter * row.stdPitch1080)
      map.set(`${row.rightHeroOrder}:${abilityOrder}`, {
        x: rightCx - row.stdWidth1080 / 2,
        y: row.stdY1080,
        width: row.stdWidth1080,
        height: row.stdHeight1080,
      })
    }
  }
  return map
}

function buildModelCanonicalMap(): Map<number, SlotBounds> {
  const map = new Map<number, SlotBounds>()
  for (const row of PLINTH_ROWS) {
    map.set(row.leftHeroOrder, {
      x: BOARD_CENTER_X_1080 - row.modelCenterOffset1080 - row.modelWidth1080 / 2,
      y: row.modelY1080,
      width: row.modelWidth1080,
      height: row.modelHeight1080,
    })
    map.set(row.rightHeroOrder, {
      x: BOARD_CENTER_X_1080 + row.modelCenterOffset1080 - row.modelWidth1080 / 2,
      y: row.modelY1080,
      width: row.modelWidth1080,
      height: row.modelHeight1080,
    })
  }
  return map
}

function resolveSelectedScreenRect(input: VisualSlotInput): SlotBounds | null {
  const { heroOrder, isUltimate, boxIndex, fallback, viewportWidth, viewportHeight } = input
  if (heroOrder === undefined || heroOrder < 0 || heroOrder > 9) {
    return null
  }
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return null
  }

  const isDire = heroOrder >= 5
  const row = isDire ? heroOrder - 5 : heroOrder
  const { scale, letterboxY } = computePanoramaProjection(viewportWidth, viewportHeight)
  const centerX = viewportWidth / 2

  // Dota 2 Panorama rounds each socket box and its horizontal margin independently per scale step,
  // anchoring the 4-box strip from the hero card's inner edge outward.
  const boxSize = Math.round(SELECTED_BOX_BASE_DP * scale)
  const boxGap = 2 * Math.round(SELECTED_BOX_HALF_MARGIN_DP * scale)
  const pitch = boxSize + boxGap
  const radiantInnerRight = Math.round(centerX - SELECTED_BOX_RADIANT_INNER_1080 * scale)
  const direInnerLeft = Math.round(centerX + SELECTED_BOX_DIRE_INNER_1080 * scale)
  const x0 = isDire ? direInnerLeft : radiantInnerRight - boxSize - 3 * pitch
  const y = letterboxY + (SELECTED_BOX_Y0_1080 + row * HERO_CARD_ROW_STRIDE_1080) * scale

  let col: number
  if (boxIndex !== undefined && boxIndex >= 0 && boxIndex <= 3) {
    col = boxIndex
  } else if (isUltimate) {
    col = 3
  } else {
    const fallbackWidth = fallback.width > 0 ? fallback.width : SELECTED_BOX_SIZE_1080 * scale
    const fallbackCenterX = fallback.x + fallbackWidth / 2
    const maxCol = isUltimate === false ? 3 : 4
    let bestCol = 0
    let bestDist = Infinity
    for (let b = 0; b < maxCol; b++) {
      const dist = Math.abs(fallbackCenterX - (x0 + b * pitch + boxSize / 2))
      if (dist < bestDist) {
        bestDist = dist
        bestCol = b
      }
    }
    col = bestCol
  }

  return {
    x: x0 + col * pitch,
    y,
    width: boxSize,
    height: boxSize,
  }
}

function resolveCanonical1080pRect(input: VisualSlotInput): SlotBounds | null {
  const { category, heroOrder, abilityOrder } = input
  if (category === 'ultimate' && heroOrder !== undefined) {
    return ULTIMATE_CANONICAL_BY_HERO.get(heroOrder) ?? null
  }
  if (category === 'standard' && heroOrder !== undefined && abilityOrder !== undefined) {
    return STANDARD_CANONICAL_BY_KEY.get(`${heroOrder}:${abilityOrder}`) ?? null
  }
  if (category === 'model' && heroOrder !== undefined) {
    return MODEL_CANONICAL_BY_HERO.get(heroOrder) ?? null
  }
  if (category === 'heroCard' && heroOrder !== undefined && heroOrder >= 0 && heroOrder <= 9) {
    const isDire = heroOrder >= 5
    const row = isDire ? heroOrder - 5 : heroOrder
    return {
      x: isDire ? HERO_CARD_DIRE_X_1080 : HERO_CARD_RADIANT_X_1080,
      y: HERO_CARD_Y0_1080 + row * HERO_CARD_ROW_STRIDE_1080,
      width: HERO_CARD_WIDTH_1080,
      height: HERO_CARD_HEIGHT_1080,
    }
  }
  return null
}

/**
 * Parse a "WIDTHxHEIGHT" resolution string and return the overlay's logical
 * DIP viewport size (unaffected by the 1px Windows click-through shrink).
 */
export function resolveLogicalOverlayViewport(
  targetResolution: string | null | undefined,
  scaleFactor: number,
  fallbackWidth: number,
  fallbackHeight: number,
): { width: number; height: number } {
  if (targetResolution) {
    const match = /^(\d+)x(\d+)$/.exec(targetResolution.trim())
    if (match) {
      const w = Number(match[1])
      const h = Number(match[2])
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && scaleFactor > 0) {
        return { width: w / scaleFactor, height: h / scaleFactor }
      }
    }
  }
  return { width: fallbackWidth, height: fallbackHeight }
}

/**
 * Compute subtle screen-space CSS skew transforms matching the perspective of
 * Dota 2's Ability Draft board at arbitrary resolutions (16:9, 16:10, 21:9, 4:3).
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
    !Number.isFinite(slot.x) ||
    !Number.isFinite(slot.y) ||
    slot.width <= 0 ||
    slot.height <= 0
  ) {
    return IDENTITY_STYLE
  }

  if (category === 'selected' || category === 'heroCard') {
    return IDENTITY_STYLE
  }

  const { scale, letterboxY } = computePanoramaProjection(viewportWidth, viewportHeight)
  if (scale <= 0) {
    return IDENTITY_STYLE
  }

  const cx = slot.x + slot.width / 2
  const cy = slot.y + slot.height / 2
  const dx1080 = (cx - viewportWidth / 2) / scale
  const x1080 = REFERENCE_WIDTH / 2 + dx1080
  const y1080 = (cy - letterboxY) / scale

  if (category === 'ultimate') {
    const colOffsetUnits = dx1080 / ULT_COL_PITCH_RATIO
    const rawUltSkewX = -colOffsetUnits * ULT_SKEW_STEP_DEG
    const skewXDeg = normalizeZero(
      Number(clamp(rawUltSkewX, -MAX_ULT_SKEW_X_DEG, MAX_ULT_SKEW_X_DEG).toFixed(2)),
    )
    return {
      skewXDeg,
      skewYDeg: 0,
      rotateXDeg: 0,
      cssTransform: skewXDeg === 0 ? 'none' : `skewX(${skewXDeg.toFixed(2)}deg)`,
    }
  }

  // 'standard' and 'model' slots sit along radial columns converging above center on the 3D plinth.
  // Negative CSS skewX leans the top edge inward and bottom edge outward on left columns (and vice versa).
  const dy = Math.max(400, y1080 - PLINTH_VANISH_Y)
  const tanTheta = (x1080 - PLINTH_VANISH_X) / dy
  const rawSkewX = (Math.atan(tanTheta) * 180) / Math.PI
  const skewXDeg = normalizeZero(
    Number(clamp(rawSkewX, -MAX_PLINTH_SKEW_X_DEG, MAX_PLINTH_SKEW_X_DEG).toFixed(2)),
  )

  return {
    skewXDeg,
    skewYDeg: 0,
    rotateXDeg: 0,
    cssTransform: skewXDeg === 0 ? 'none' : `skewX(${skewXDeg.toFixed(2)}deg)`,
  }
}

/**
 * Resolve calibrated screen bounds and perspective transform for an overlay slot.
 * Preserves user-supplied fallback bounds verbatim when `layoutSource === 'custom'`.
 */
export function resolveVisualSlotLayout(input: VisualSlotInput): ResolvedVisualSlot {
  const useCanonical = input.layoutSource !== 'custom'
  let bounds: SlotBounds
  if (useCanonical && input.category === 'selected') {
    bounds = resolveSelectedScreenRect(input) ?? input.fallback
  } else {
    const canonical1080 = useCanonical ? resolveCanonical1080pRect(input) : null
    bounds =
      canonical1080 !== null && input.viewportWidth > 0 && input.viewportHeight > 0
        ? projectRectFrom1080p(canonical1080, input.viewportWidth, input.viewportHeight)
        : input.fallback
  }

  const perspective = computeBoardPerspectiveStyle(
    bounds,
    input.category,
    input.viewportWidth,
    input.viewportHeight,
  )
  const horizontalOverhangPx =
    perspective.skewXDeg === 0
      ? 0
      : (Math.abs(Math.tan((perspective.skewXDeg * Math.PI) / 180)) * bounds.height) / 2

  return { bounds, perspective, horizontalOverhangPx }
}
