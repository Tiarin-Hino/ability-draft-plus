import { describe, it, expect } from 'vitest'
import {
  calculateFromBottomLeftTopRight,
  calculateFromTopLeftBottomRight,
  mirrorCoordinate,
  generateHeroes,
  generateSelectedAbilities,
  mirrorElementsToRight,
  applyUltimateHeroOrders,
  applyStandardHeroOrders,
  calculateHeroSpacing,
  calculateAbilitySpacing,
} from '@core/resolution/coordinate-utils'

describe('calculateFromBottomLeftTopRight', () => {
  it('calculates rect from BL+TR corners', () => {
    const result = calculateFromBottomLeftTopRight({ x: 693, y: 224 }, { x: 746, y: 166 })
    expect(result).toEqual({ x: 693, y: 166, width: 53, height: 58 })
  })

  it('handles zero-size rect', () => {
    const result = calculateFromBottomLeftTopRight({ x: 100, y: 100 }, { x: 100, y: 100 })
    expect(result).toEqual({ x: 100, y: 100, width: 0, height: 0 })
  })
})

describe('calculateFromTopLeftBottomRight', () => {
  it('calculates rect from TL+BR corners', () => {
    const result = calculateFromTopLeftBottomRight({ x: 731, y: 344 }, { x: 778, y: 386 })
    expect(result).toEqual({ x: 731, y: 344, width: 47, height: 42 })
  })
})

describe('mirrorCoordinate', () => {
  it('mirrors coordinate across screen center', () => {
    const { mirroredX, y } = mirrorCoordinate(693, 166, 53, 1920)
    expect(y).toBe(166) // Y unchanged
    expect(mirroredX).toBe(1174) // 2 * 960 - 693 - 53 = 1174
  })

  it('mirror of mirror returns original X', () => {
    const { mirroredX: firstMirror } = mirrorCoordinate(693, 166, 53, 1920)
    const { mirroredX: secondMirror } = mirrorCoordinate(firstMirror, 166, 53, 1920)
    expect(secondMirror).toBe(693)
  })

  it('element at center mirrors to center', () => {
    // Element centered at screen center
    const { mirroredX } = mirrorCoordinate(935, 100, 50, 1920)
    expect(mirroredX).toBe(935) // Symmetric
  })
})

describe('calculateHeroSpacing', () => {
  it('returns vertical distance between heroes', () => {
    expect(calculateHeroSpacing(146, 308)).toBe(162)
  })
})

describe('calculateAbilitySpacing', () => {
  it('returns horizontal distance between abilities', () => {
    expect(calculateAbilitySpacing(216, 277)).toBe(61)
  })
})

describe('generateHeroes', () => {
  it('generates 5 heroes (0-4) from first two', () => {
    const hero0 = { x: 140, y: 146, width: 320, height: 146 }
    const hero1 = { x: 140, y: 308, width: 320, height: 146 }

    const heroes = generateHeroes(hero0, hero1)

    expect(heroes).toHaveLength(5)
    expect(heroes[0]).toMatchObject({ x: 140, y: 146, hero_order: 0 })
    expect(heroes[1]).toMatchObject({ x: 140, y: 308, hero_order: 1 })
    expect(heroes[2]).toMatchObject({ x: 140, y: 470, hero_order: 2 })
    expect(heroes[3]).toMatchObject({ x: 140, y: 632, hero_order: 3 })
    expect(heroes[4]).toMatchObject({ x: 140, y: 794, hero_order: 4 })
  })

  it('maintains uniform spacing', () => {
    const hero0 = { x: 140, y: 146, width: 320, height: 146 }
    const hero1 = { x: 140, y: 308, width: 320, height: 146 }

    const heroes = generateHeroes(hero0, hero1)
    const spacing = heroes[1].y - heroes[0].y

    for (let i = 1; i < heroes.length; i++) {
      expect(heroes[i].y - heroes[i - 1].y).toBe(spacing)
    }
  })
})

describe('generateSelectedAbilities', () => {
  it('generates 20 selected ability slots from 2 reference points', () => {
    const ability1 = { x: 216, y: 237, width: 55, height: 55 }
    const ability2 = { x: 277, y: 237, width: 55, height: 55 }
    const heroes = [
      { x: 140, y: 146, width: 0, height: 0, hero_order: 0 },
      { x: 140, y: 308, width: 0, height: 0, hero_order: 1 },
      { x: 140, y: 470, width: 0, height: 0, hero_order: 2 },
      { x: 140, y: 632, width: 0, height: 0, hero_order: 3 },
      { x: 140, y: 794, width: 0, height: 0, hero_order: 4 },
    ]

    const slots = generateSelectedAbilities(ability1, ability2, heroes)

    expect(slots).toHaveLength(20) // 5 heroes x 4 slots
    // First hero, first slot
    expect(slots[0]).toMatchObject({ x: 216, y: 237, hero_order: 0, is_ultimate: false })
    // First hero, last slot (ultimate)
    expect(slots[3]).toMatchObject({ hero_order: 0, is_ultimate: true })
    // Second hero, first slot
    expect(slots[4]).toMatchObject({ hero_order: 1, is_ultimate: false })
    // Check Y offset matches hero spacing
    expect(slots[4].y - slots[0].y).toBe(308 - 146) // 162
  })
})

describe('mirrorElementsToRight', () => {
  it('mirrors heroes with hero_order +5 offset', () => {
    const leftHeroes = [
      { x: 140, y: 146, width: 0, height: 0, hero_order: 0 },
      { x: 140, y: 308, width: 0, height: 0, hero_order: 1 },
    ]

    const rightHeroes = mirrorElementsToRight(leftHeroes, 1920, 'heroes', {
      hasDimensions: false,
      elementWidth: 320,
      elementHeight: 146,
    })

    expect(rightHeroes).toHaveLength(2)
    expect(rightHeroes[0].hero_order).toBe(5)
    expect(rightHeroes[1].hero_order).toBe(6)
    expect(rightHeroes[0].y).toBe(146) // Y unchanged
  })

  it('maps hero_order 10 to 11', () => {
    const leftModels = [
      { x: 570, y: 756, width: 56, height: 62, hero_order: 10 },
    ]

    const rightModels = mirrorElementsToRight(leftModels, 1920, 'models', {
      hasDimensions: true,
    })

    expect(rightModels[0].hero_order).toBe(11)
  })

  it('preserves ability_order and is_ultimate', () => {
    const leftSlots = [
      { x: 216, y: 237, width: 0, height: 0, hero_order: 0, is_ultimate: false },
      { x: 398, y: 237, width: 0, height: 0, hero_order: 0, is_ultimate: true },
    ]

    const rightSlots = mirrorElementsToRight(leftSlots, 1920, 'selected_abilities', {
      hasDimensions: false,
      elementWidth: 55,
      elementHeight: 55,
    })

    expect(rightSlots[0].is_ultimate).toBe(false)
    expect(rightSlots[1].is_ultimate).toBe(true)
  })
})

describe('applyUltimateHeroOrders', () => {
  it('applies left-side hero orders [0,1,2,3,4,10]', () => {
    const ultimates = Array.from({ length: 6 }, () => ({
      x: 0, y: 0, width: 50, height: 50, hero_order: 0,
    }))

    applyUltimateHeroOrders(ultimates, true)

    expect(ultimates.map((u) => u.hero_order)).toEqual([0, 1, 2, 3, 4, 10])
  })

  it('applies right-side hero orders [7,6,5,11,9,8]', () => {
    const ultimates = Array.from({ length: 6 }, () => ({
      x: 0, y: 0, width: 50, height: 50, hero_order: 0,
    }))

    applyUltimateHeroOrders(ultimates, false)

    expect(ultimates.map((u) => u.hero_order)).toEqual([7, 6, 5, 11, 9, 8])
  })
})

describe('applyStandardHeroOrders', () => {
  it('applies left-side hero orders and ability_orders', () => {
    const standards = Array.from({ length: 18 }, () => ({
      x: 0, y: 0, width: 50, height: 50, hero_order: 0,
    }))

    applyStandardHeroOrders(standards, true)

    // First row: hero 0, abilities 1-3
    expect(standards[0].hero_order).toBe(0)
    expect(standards[0].ability_order).toBe(1)
    expect(standards[2].ability_order).toBe(3)

    // Last row: hero 10
    expect(standards[15].hero_order).toBe(10)
    expect(standards[15].ability_order).toBe(1)
  })

  it('applies right-side hero orders [5,6,7,8,9,11]', () => {
    const standards = Array.from({ length: 18 }, () => ({
      x: 0, y: 0, width: 50, height: 50, hero_order: 0,
    }))

    applyStandardHeroOrders(standards, false)

    expect(standards[0].hero_order).toBe(5)
    expect(standards[15].hero_order).toBe(11)
  })
})
