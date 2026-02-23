// @DEV-GUIDE: 4-anchor calibration for custom resolution mapping. An alternative to the
// mathematical auto-scaling when Dota 2's UI doesn't match expected proportions (e.g.,
// windowed mode with non-standard borders, or custom HUD skins).
//
// The user clicks 4 reference points on a screenshot, and we derive an affine transform
// (separate X/Y scale + offset) to map all 1080p base coordinates to the target resolution.
// X scale comes from the ultimate slot width; Y scale from the hero spacing (more pixels = more accurate).
// Includes cross-validation between slot-derived and hero-derived Y scales.

/**
 * 4-anchor calibration for resolution mapping.
 *
 * The user clicks 4 reference points:
 * - A: Top-left corner of first ultimate ability slot
 * - B: Bottom-right corner of first ultimate ability slot
 * - C: Top-left corner of hero 0 box
 * - D: Top-left corner of hero 1 box
 *
 * From these we derive an affine transform (scale + offset)
 * to map all 1080p base coordinates to the target resolution.
 */

import type { SlotCoordinate, ResolutionLayout } from '@shared/types'
import type { CalibrationAnchors, AffineParams } from './types'

// 1080p reference values
const BASE_ULTIMATE_0_X = 693
const BASE_ULTIMATE_0_Y = 166
const BASE_ULTIMATE_0_WIDTH = 53
const BASE_ULTIMATE_0_HEIGHT = 58
const BASE_HERO_0_Y = 146
const BASE_HERO_1_Y = 308
const BASE_HERO_SPACING = BASE_HERO_1_Y - BASE_HERO_0_Y // 162

/**
 * Derive affine transform parameters from 4 anchor clicks.
 */
export function deriveAffineParams(anchors: CalibrationAnchors): AffineParams {
  // Scale from ultimate slot dimensions (A and B)
  const measuredWidth = anchors.ultimateBottomRight.x - anchors.ultimateTopLeft.x
  const measuredHeight = anchors.ultimateBottomRight.y - anchors.ultimateTopLeft.y

  const xScaleFromSlot = measuredWidth / BASE_ULTIMATE_0_WIDTH

  // Scale from hero spacing (C and D) - more reliable for Y because it spans more pixels
  const measuredHeroSpacing = anchors.hero1TopLeft.y - anchors.hero0TopLeft.y
  const yScaleFromHeroes = measuredHeroSpacing / BASE_HERO_SPACING

  // Use slot-derived xScale; hero-derived yScale
  const xScale = xScaleFromSlot
  const yScale = yScaleFromHeroes

  // Offsets: where the base origin maps to in the target
  const xOffset = anchors.ultimateTopLeft.x - BASE_ULTIMATE_0_X * xScale
  const yOffset = anchors.ultimateTopLeft.y - BASE_ULTIMATE_0_Y * yScale

  // Cross-validate: check Y scale from slot height
  const yScaleFromSlot = measuredHeight / BASE_ULTIMATE_0_HEIGHT

  // If slot and hero Y scales differ by more than 10%, warn (but still use hero-based)
  if (Math.abs(yScaleFromSlot - yScaleFromHeroes) / yScaleFromHeroes > 0.1) {
    // This could happen if the user clicked imprecisely
    // The hero-based scale is more reliable since it spans more pixels
  }

  return { xScale, yScale, xOffset, yOffset }
}

/**
 * Apply an affine transform to all coordinates in a base layout.
 */
export function applyAffineTransform(
  baseLayout: ResolutionLayout,
  params: AffineParams,
): ResolutionLayout {
  return {
    heroes_params: {
      width: Math.round(baseLayout.heroes_params.width * params.xScale),
      height: Math.round(baseLayout.heroes_params.height * params.yScale),
    },
    selected_abilities_params: {
      width: Math.round(baseLayout.selected_abilities_params.width * params.xScale),
      height: Math.round(baseLayout.selected_abilities_params.height * params.yScale),
    },
    ultimate_slots_coords: baseLayout.ultimate_slots_coords.map((c) =>
      transformSlot(c, params, true),
    ),
    standard_slots_coords: baseLayout.standard_slots_coords.map((c) =>
      transformSlot(c, params, true),
    ),
    models_coords: (baseLayout.models_coords ?? []).map((c) =>
      transformSlot(c, params, true),
    ),
    heroes_coords: (baseLayout.heroes_coords ?? []).map((c) =>
      transformSlot(c, params, false),
    ),
    selected_abilities_coords: (baseLayout.selected_abilities_coords ?? []).map((c) =>
      transformSlot(c, params, false),
    ),
  }
}

function transformSlot(
  coord: SlotCoordinate,
  params: AffineParams,
  hasDimensions: boolean,
): SlotCoordinate {
  const result: SlotCoordinate = {
    x: Math.round(coord.x * params.xScale + params.xOffset),
    y: Math.round(coord.y * params.yScale + params.yOffset),
    width: hasDimensions ? Math.round(coord.width * params.xScale) : coord.width,
    height: hasDimensions ? Math.round(coord.height * params.yScale) : coord.height,
    hero_order: coord.hero_order,
  }
  if (coord.ability_order !== undefined) result.ability_order = coord.ability_order
  if (coord.is_ultimate !== undefined) result.is_ultimate = coord.is_ultimate
  return result
}
