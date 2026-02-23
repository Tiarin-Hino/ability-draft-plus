import type { ResolutionLayout } from '@shared/types'

/** A point clicked by the user on the screenshot */
export interface ClickPoint {
  x: number
  y: number
}

/** Rectangle with position and dimensions */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The 4 anchor points for calibration */
export interface CalibrationAnchors {
  /** Top-left corner of first ultimate ability slot */
  ultimateTopLeft: ClickPoint
  /** Bottom-right corner of first ultimate ability slot */
  ultimateBottomRight: ClickPoint
  /** Top-left corner of hero 0 box */
  hero0TopLeft: ClickPoint
  /** Top-left corner of hero 1 box */
  hero1TopLeft: ClickPoint
}

/** Affine transform parameters derived from anchors */
export interface AffineParams {
  xScale: number
  yScale: number
  xOffset: number
  yOffset: number
}

/** Result of any calibration method */
export interface CalibrationResult {
  resolution: string
  layout: ResolutionLayout
  method: 'preset' | 'auto-scaled' | 'anchor-calibrated'
  accuracy?: number
}

/** Validation result from coordinate checking */
export interface ValidationResult {
  passed: boolean
  errors: string[]
  warnings: string[]
}

/** Element types for mirroring logic */
export type MirrorElementType =
  | 'ultimates'
  | 'standards'
  | 'models'
  | 'heroes'
  | 'selected_abilities'

/** Options for mirror operation */
export interface MirrorOptions {
  hasDimensions: boolean
  elementWidth?: number
  elementHeight?: number
}
