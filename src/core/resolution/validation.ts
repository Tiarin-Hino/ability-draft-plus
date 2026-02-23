// @DEV-GUIDE: Post-calibration validation for resolution layouts. Checks that all
// coordinates are within screen bounds (no negative x/y, no overflow past screen edges)
// and that each category has the correct number of entries (12 ultimates, 36 standards,
// 10 heroes, 40 selected abilities, 12 models). Used after both auto-scaling and
// manual/anchor calibration to catch misclicks or math errors before saving.

/**
 * Coordinate validation for resolution layouts.
 * Ported from mapper_utils.py::validate_coordinates()
 */

import type { ResolutionLayout } from '@shared/types'
import type { ValidationResult } from './types'

const EXPECTED_COUNTS: Record<string, number> = {
  ultimate_slots_coords: 12,
  standard_slots_coords: 36,
  heroes_coords: 10,
  selected_abilities_coords: 40,
  models_coords: 12,
}

/**
 * Validate a resolution layout against screen bounds and expected structure.
 */
export function validateCoordinates(
  layout: ResolutionLayout,
  screenWidth: number,
  screenHeight: number,
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check categories with direct width/height
  const categoriesWithDims: Array<{ key: keyof ResolutionLayout; label: string }> = [
    { key: 'ultimate_slots_coords', label: 'ultimate_slots_coords' },
    { key: 'standard_slots_coords', label: 'standard_slots_coords' },
    { key: 'models_coords', label: 'models_coords' },
  ]

  for (const { key, label } of categoriesWithDims) {
    const coords = layout[key]
    if (!Array.isArray(coords)) continue

    for (let i = 0; i < coords.length; i++) {
      const item = coords[i]
      if (item.x < 0 || item.y < 0) {
        errors.push(
          `${label}[${i}] hero_order=${item.hero_order}: Negative coordinates (x=${item.x}, y=${item.y})`,
        )
      }
      if (item.x + item.width > screenWidth) {
        errors.push(
          `${label}[${i}] hero_order=${item.hero_order}: Extends beyond screen width (x=${item.x}, w=${item.width})`,
        )
      }
      if (item.y + item.height > screenHeight) {
        errors.push(
          `${label}[${i}] hero_order=${item.hero_order}: Extends beyond screen height (y=${item.y}, h=${item.height})`,
        )
      }
    }
  }

  // Check categories with shared params
  const categoriesWithParams: Array<{
    key: keyof ResolutionLayout
    paramsKey: keyof ResolutionLayout
    label: string
  }> = [
    { key: 'heroes_coords', paramsKey: 'heroes_params', label: 'heroes_coords' },
    {
      key: 'selected_abilities_coords',
      paramsKey: 'selected_abilities_params',
      label: 'selected_abilities_coords',
    },
  ]

  for (const { key, paramsKey, label } of categoriesWithParams) {
    const coords = layout[key]
    const params = layout[paramsKey] as { width: number; height: number } | undefined
    if (!Array.isArray(coords) || !params) continue

    for (let i = 0; i < coords.length; i++) {
      const item = coords[i]
      if (item.x < 0 || item.y < 0) {
        errors.push(
          `${label}[${i}] hero_order=${item.hero_order}: Negative coordinates (x=${item.x}, y=${item.y})`,
        )
      }
      if (item.x + params.width > screenWidth) {
        errors.push(
          `${label}[${i}] hero_order=${item.hero_order}: Extends beyond screen width`,
        )
      }
      if (item.y + params.height > screenHeight) {
        errors.push(
          `${label}[${i}] hero_order=${item.hero_order}: Extends beyond screen height`,
        )
      }
    }
  }

  // Check counts
  for (const [category, expected] of Object.entries(EXPECTED_COUNTS)) {
    const coords = layout[category as keyof ResolutionLayout]
    if (!Array.isArray(coords)) {
      if (category === 'models_coords' || category === 'heroes_coords' || category === 'selected_abilities_coords') {
        // These are optional in the ResolutionLayout type but required for a complete mapping
        warnings.push(`Missing optional category: ${category}`)
      } else {
        errors.push(`Missing required category: ${category}`)
      }
      continue
    }

    if (coords.length !== expected) {
      errors.push(`${category}: Expected ${expected} entries, got ${coords.length}`)
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  }
}
