// @DEV-GUIDE: Coordinate transformations for the draft grid layout.
// applyUltimateHeroOrders(): Maps ultimate slot positions to hero_order values.
// The grid is 2 rows x 6 cols. Left side heroes: [0,1,2,3,4,10], right side: [7,6,5,11,9,8].
// Uses tolerance-based row grouping (10px) because y-values can differ by 1-2px within a row.
// Without tolerance, strict (y,x) sorting puts right-side entries before left-side ones.
//
// Also provides: rectangle calculation from corner clicks, coordinate mirroring (left->right side),
// hero position generation from first two heroes + spacing, selected ability slot generation,
// and the mirrorElementsToRight function for the 68-click manual mapper.

/**
 * Coordinate geometry utilities for resolution mapping.
 * Ported from ../ability-draft-plus/scripts/mapper_utils.py
 */

import type { SlotCoordinate } from '@shared/types'
import type { ClickPoint, Rect, MirrorElementType, MirrorOptions } from './types'

/**
 * Calculate rectangle from bottom-left and top-right corners.
 * Used for ultimate ability slots.
 */
export function calculateFromBottomLeftTopRight(bl: ClickPoint, tr: ClickPoint): Rect {
  return {
    x: bl.x,
    y: tr.y,
    width: tr.x - bl.x,
    height: bl.y - tr.y,
  }
}

/**
 * Calculate rectangle from top-left and bottom-right corners.
 * Used for standards, models, heroes, selected abilities.
 */
export function calculateFromTopLeftBottomRight(tl: ClickPoint, br: ClickPoint): Rect {
  return {
    x: tl.x,
    y: tl.y,
    width: br.x - tl.x,
    height: br.y - tl.y,
  }
}

/**
 * Mirror a coordinate from left side to right side of screen.
 * Y stays the same, X is mirrored around screen center.
 */
export function mirrorCoordinate(
  x: number,
  y: number,
  width: number,
  screenWidth: number,
): { mirroredX: number; y: number } {
  const screenCenter = screenWidth / 2
  const mirroredX = Math.round(2 * screenCenter - x - width)
  return { mirroredX, y }
}

/** Calculate vertical spacing between hero boxes */
export function calculateHeroSpacing(hero0Y: number, hero1Y: number): number {
  return hero1Y - hero0Y
}

/** Calculate horizontal spacing between selected ability slots */
export function calculateAbilitySpacing(ability1X: number, ability2X: number): number {
  return ability2X - ability1X
}

/**
 * Generate all 5 left-side hero coordinates (hero_order 0-4)
 * from the first two hero boxes.
 */
export function generateHeroes(
  hero0: Rect,
  hero1: Rect,
): SlotCoordinate[] {
  const spacing = calculateHeroSpacing(hero0.y, hero1.y)

  const heroes: SlotCoordinate[] = [
    { x: hero0.x, y: hero0.y, width: 0, height: 0, hero_order: 0 },
    { x: hero1.x, y: hero1.y, width: 0, height: 0, hero_order: 1 },
  ]

  for (let i = 2; i < 5; i++) {
    heroes.push({
      x: hero0.x,
      y: hero1.y + (i - 1) * spacing,
      width: 0,
      height: 0,
      hero_order: i,
    })
  }

  return heroes
}

/**
 * Generate all 20 left-side selected ability slots
 * from hero 0's first two slots and the hero positions.
 */
export function generateSelectedAbilities(
  ability1: Rect,
  ability2: Rect,
  heroes: SlotCoordinate[],
): SlotCoordinate[] {
  const spacing = calculateAbilitySpacing(ability1.x, ability2.x)
  const hero0Y = heroes[0].y

  // Generate 4 base slot X positions for hero 0
  const baseSlots = Array.from({ length: 4 }, (_, slotIdx) => ({
    x: ability1.x + slotIdx * spacing,
    y: ability1.y,
  }))

  const allAbilities: SlotCoordinate[] = []

  for (const hero of heroes) {
    const yOffset = hero.y - hero0Y

    for (let slotIdx = 0; slotIdx < 4; slotIdx++) {
      allAbilities.push({
        x: baseSlots[slotIdx].x,
        y: baseSlots[slotIdx].y + yOffset,
        width: 0,
        height: 0,
        hero_order: hero.hero_order,
        is_ultimate: slotIdx === 3,
      })
    }
  }

  return allAbilities
}

/**
 * Mirror left-side elements to right side with hero_order remapping.
 *
 * Hero order mapping:
 * - heroes/models/selected_abilities: 0-4 → 5-9, 10 → 11
 * - ultimates/standards: keep as-is (they get their own hero_order assignment)
 */
export function mirrorElementsToRight(
  leftElements: SlotCoordinate[],
  screenWidth: number,
  elementType: MirrorElementType,
  options: MirrorOptions,
): SlotCoordinate[] {
  const heroOrderOffset: Record<MirrorElementType, number> = {
    heroes: 5,
    models: 5,
    selected_abilities: 5,
    ultimates: 0,
    standards: 0,
  }

  const offset = heroOrderOffset[elementType]

  return leftElements.map((elem) => {
    const width = options.hasDimensions ? elem.width : (options.elementWidth ?? 0)
    const height = options.hasDimensions ? elem.height : (options.elementHeight ?? 0)

    const { mirroredX, y } = mirrorCoordinate(elem.x, elem.y, width, screenWidth)

    let newHeroOrder = elem.hero_order
    if (elem.hero_order === 10) {
      newHeroOrder = 11
    } else if (elementType === 'heroes' || elementType === 'models' || elementType === 'selected_abilities') {
      newHeroOrder = elem.hero_order + offset
    }

    const result: SlotCoordinate = {
      x: mirroredX,
      y,
      width: options.hasDimensions ? width : 0,
      height: options.hasDimensions ? height : 0,
      hero_order: newHeroOrder,
    }

    if (elem.ability_order !== undefined) result.ability_order = elem.ability_order
    if (elem.is_ultimate !== undefined) result.is_ultimate = elem.is_ultimate

    return result
  })
}

/**
 * Apply correct hero_order to ultimate slots based on layout pattern.
 *
 * Grid layout (3 cols x 2 rows per side):
 * Left side:  Row 1: [0, 1, 2],  Row 2: [3, 4, 10]
 * Right side: Row 1: [7, 6, 5],  Row 2: [11, 9, 8]
 */
export function applyUltimateHeroOrders(
  ultimates: SlotCoordinate[],
  isLeftSide: boolean,
): SlotCoordinate[] {
  const orders = isLeftSide
    ? [0, 1, 2, 3, 4, 10]
    : [7, 6, 5, 11, 9, 8]

  for (let i = 0; i < ultimates.length; i++) {
    ultimates[i].hero_order = orders[i]
  }

  return ultimates
}

/**
 * Apply correct hero_order and ability_order to standard slots.
 *
 * Layout: 6 rows (one per hero) x 3 abilities per row.
 * Left side heroes:  [0, 1, 2, 3, 4, 10]
 * Right side heroes: [5, 6, 7, 8, 9, 11]
 */
export function applyStandardHeroOrders(
  standards: SlotCoordinate[],
  isLeftSide: boolean,
): SlotCoordinate[] {
  const heroOrders = isLeftSide
    ? [0, 1, 2, 3, 4, 10]
    : [5, 6, 7, 8, 9, 11]

  for (let rowIdx = 0; rowIdx < 6; rowIdx++) {
    for (let colIdx = 0; colIdx < 3; colIdx++) {
      const idx = rowIdx * 3 + colIdx
      standards[idx].hero_order = heroOrders[rowIdx]
      standards[idx].ability_order = colIdx + 1
    }
  }

  return standards
}
