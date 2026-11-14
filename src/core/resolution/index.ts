export type {
  ClickPoint,
  Rect,
  CalibrationAnchors,
  AffineParams,
  CalibrationResult,
  ValidationResult,
  MirrorElementType,
  MirrorOptions,
} from './types'

export {
  calculateFromBottomLeftTopRight,
  calculateFromTopLeftBottomRight,
  mirrorCoordinate,
  calculateHeroSpacing,
  calculateAbilitySpacing,
  generateHeroes,
  generateSelectedAbilities,
  mirrorElementsToRight,
  applyUltimateHeroOrders,
  applyStandardHeroOrders,
} from './coordinate-utils'

export { scaleCoordinates, isAutoScalable, parseResolution } from './scaling-engine'

export { deriveAffineParams, applyAffineTransform } from './anchor-calibration'

export { validateCoordinates } from './validation'

export {
  computeBoardPerspectiveStyle,
  type VisualSlotCategory,
  type SlotBounds,
  type BoardPerspectiveStyle,
} from './visual-geometry'
