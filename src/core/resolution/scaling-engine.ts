// @DEV-GUIDE: Mathematical resolution scaling for auto-generated layouts.
// Formula: scaleFactor = targetHeight / baseHeight, horizontalOffset = (targetWidth - baseWidth * scaleFactor) / 2
// Each aspect ratio family has a different base resolution:
// 4:3 -> 1920x1440, 16:10 -> 1920x1200, 16:9 -> 1920x1080, 21:9 -> 3440x1440.
// Scales all coordinate types: ultimate slots, standard slots, models, heroes, selected abilities.
// Accurate within 5px for ability slots (most critical), up to 35-48px for hero positions at extreme resolutions.
//
// This is the "auto" source in the layout service cascade: custom -> preset -> auto-scale.
// If the base resolution for the detected aspect family exists in layout_coordinates.json,
// scaleCoordinates() maps it to the target resolution. Otherwise falls back to 'none'.

/**
 * Mathematical scaling engine for resolution mapping.
 *
 * Dota 2's Panorama UI scales linearly:
 * - scaleFactor = targetHeight / baseHeight
 * - horizontalOffset = (targetWidth - baseWidth * scaleFactor) / 2
 *
 * Supported aspect ratio families (each scales from its own base):
 * - 4:3   (ratio 1.2-1.55): scales from 1920x1440 base
 * - 16:10 (ratio 1.55-1.7): scales from 1920x1200 base
 * - 16:9  (ratio 1.7-2.1):  scales from 1920x1080 base
 * - 21:9  (ratio >= 2.1):   scales from 3440x1440 base
 */

import type { SlotCoordinate, ResolutionLayout } from '@shared/types'

/** Known base resolutions for scaling, keyed by aspect ratio family */
export const SCALING_BASES = {
  '4:3': { width: 1920, height: 1440 },
  '16:10': { width: 1920, height: 1200 },
  '16:9': { width: 1920, height: 1080 },
  '21:9': { width: 3440, height: 1440 },
} as const

export type AspectFamily = keyof typeof SCALING_BASES

/**
 * Determine the aspect ratio family for a resolution.
 * Returns null if the resolution is too narrow (< 4:3).
 */
export function getAspectFamily(width: number, height: number): AspectFamily | null {
  const ratio = width / height
  if (ratio >= 2.1) return '21:9' // 21:9 (2.389) and super-ultrawide (3.556)
  if (ratio >= 1.7) return '16:9' // 16:9 (1.778)
  if (ratio >= 1.55) return '16:10' // 16:10 (1.6)
  if (ratio >= 1.2) return '4:3' // 4:3 (1.333) and 5:4 (1.25)
  return null
}

/**
 * Scale all coordinates from a base layout to a target resolution.
 * The baseWidth/baseHeight must match the resolution the baseLayout was designed for.
 */
export function scaleCoordinates(
  baseLayout: ResolutionLayout,
  targetWidth: number,
  targetHeight: number,
  baseWidth = 1920,
  baseHeight = 1080,
): ResolutionLayout {
  const scaleFactor = targetHeight / baseHeight
  const horizontalOffset = (targetWidth - baseWidth * scaleFactor) / 2

  return {
    heroes_params: scaleParams(baseLayout.heroes_params, scaleFactor),
    selected_abilities_params: scaleParams(baseLayout.selected_abilities_params, scaleFactor),
    ultimate_slots_coords: baseLayout.ultimate_slots_coords.map((c) =>
      scaleSlot(c, scaleFactor, horizontalOffset, true),
    ),
    standard_slots_coords: baseLayout.standard_slots_coords.map((c) =>
      scaleSlot(c, scaleFactor, horizontalOffset, true),
    ),
    models_coords: (baseLayout.models_coords ?? []).map((c) =>
      scaleSlot(c, scaleFactor, horizontalOffset, true),
    ),
    heroes_coords: (baseLayout.heroes_coords ?? []).map((c) =>
      scaleSlot(c, scaleFactor, horizontalOffset, false),
    ),
    selected_abilities_coords: (baseLayout.selected_abilities_coords ?? []).map((c) =>
      scaleSlot(c, scaleFactor, horizontalOffset, false),
    ),
  }
}

function scaleSlot(
  coord: SlotCoordinate,
  scale: number,
  xOffset: number,
  hasDimensions: boolean,
): SlotCoordinate {
  const result: SlotCoordinate = {
    x: Math.round(coord.x * scale + xOffset),
    y: Math.round(coord.y * scale),
    width: hasDimensions ? Math.round(coord.width * scale) : coord.width,
    height: hasDimensions ? Math.round(coord.height * scale) : coord.height,
    hero_order: coord.hero_order,
  }
  if (coord.ability_order !== undefined) result.ability_order = coord.ability_order
  if (coord.is_ultimate !== undefined) result.is_ultimate = coord.is_ultimate
  return result
}

function scaleParams(
  params: { width: number; height: number },
  scale: number,
): { width: number; height: number } {
  return {
    width: Math.round(params.width * scale),
    height: Math.round(params.height * scale),
  }
}

/**
 * Check if a resolution is eligible for auto-scaling.
 * Supports 4:3, 16:10, 16:9, and 21:9 aspect ratios.
 * Note: returns true even if the base resolution isn't in the JSON yet
 * (e.g., 4:3 before a 1024x768 preset is added). The layout service
 * handles the fallback to 'none' when the base doesn't exist.
 */
export function isAutoScalable(width: number, height: number): boolean {
  return getAspectFamily(width, height) !== null
}

/**
 * Parse a resolution string like "2560x1440" into width and height.
 */
export function parseResolution(resolution: string): { width: number; height: number } | null {
  const match = resolution.match(/^(\d+)x(\d+)$/)
  if (!match) return null
  return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) }
}
