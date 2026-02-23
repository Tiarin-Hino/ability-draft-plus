import { describe, it, expect } from 'vitest'
import { identifyHeroModels } from '@core/domain/hero-identification'
import type { HeroLookup } from '@core/domain/types'
import type { SlotCoordinate } from '@shared/types'

function makeCoord(heroOrder: number): SlotCoordinate {
  return { x: 0, y: 0, width: 64, height: 64, hero_order: heroOrder }
}

const mockHeroLookup: HeroLookup = {
  getByAbilityName(abilityName: string) {
    const map: Record<
      string,
      { heroId: number; heroName: string; heroDisplayName: string | null }
    > = {
      firestorm: { heroId: 1, heroName: 'lina', heroDisplayName: 'Lina' },
      blink: { heroId: 2, heroName: 'antimage', heroDisplayName: 'Anti-Mage' },
    }
    return map[abilityName] ?? null
  },
  getById(heroId: number) {
    const map: Record<
      number,
      {
        heroId: number
        name: string
        displayName: string
        winrate: number | null
        highSkillWinrate: number | null
        pickRate: number | null
        hsPickRate: number | null
      }
    > = {
      1: {
        heroId: 1,
        name: 'lina',
        displayName: 'Lina',
        winrate: 0.52,
        highSkillWinrate: 0.54,
        pickRate: 15,
        hsPickRate: 12,
      },
      2: {
        heroId: 2,
        name: 'antimage',
        displayName: 'Anti-Mage',
        winrate: 0.48,
        highSkillWinrate: 0.50,
        pickRate: 20,
        hsPickRate: 18,
      },
    }
    return map[heroId] ?? null
  },
}

describe('identifyHeroModels', () => {
  it('identifies a hero from its defining ability', () => {
    const result = identifyHeroModels(
      [{ name: 'firestorm', confidence: 0.95, hero_order: 0 }],
      [makeCoord(0)],
      mockHeroLookup,
    )
    expect(result).toHaveLength(1)
    expect(result[0].heroName).toBe('lina')
    expect(result[0].heroDisplayName).toBe('Lina')
    expect(result[0].dbHeroId).toBe(1)
    expect(result[0].winrate).toBe(0.52)
    expect(result[0].identificationConfidence).toBe(0.95)
  })

  it('returns Unknown Hero when ability name is null', () => {
    const result = identifyHeroModels(
      [{ name: null, confidence: 0.3, hero_order: 0 }],
      [makeCoord(0)],
      mockHeroLookup,
    )
    expect(result[0].heroDisplayName).toBe('Unknown Hero')
    expect(result[0].dbHeroId).toBeNull()
    expect(result[0].identificationConfidence).toBe(0)
  })

  it('returns Unknown Hero when ability not found in DB', () => {
    const result = identifyHeroModels(
      [{ name: 'nonexistent_ability', confidence: 0.92, hero_order: 0 }],
      [makeCoord(0)],
      mockHeroLookup,
    )
    expect(result[0].heroDisplayName).toBe('Unknown Hero')
    expect(result[0].dbHeroId).toBeNull()
  })

  it('returns Unknown Hero for model coords without matching defining ability', () => {
    const result = identifyHeroModels(
      [{ name: 'firestorm', confidence: 0.95, hero_order: 0 }],
      [makeCoord(0), makeCoord(1)],
      mockHeroLookup,
    )
    expect(result).toHaveLength(2)
    expect(result[0].heroDisplayName).toBe('Lina')
    expect(result[1].heroDisplayName).toBe('Unknown Hero')
  })

  it('handles multiple heroes preserving order from modelCoords', () => {
    const result = identifyHeroModels(
      [
        { name: 'blink', confidence: 0.91, hero_order: 1 },
        { name: 'firestorm', confidence: 0.95, hero_order: 0 },
      ],
      [makeCoord(0), makeCoord(1)],
      mockHeroLookup,
    )
    expect(result[0].heroName).toBe('lina')
    expect(result[1].heroName).toBe('antimage')
  })

  it('handles empty hero defining abilities', () => {
    const result = identifyHeroModels(
      [],
      [makeCoord(0), makeCoord(1)],
      mockHeroLookup,
    )
    expect(result).toHaveLength(2)
    expect(result[0].heroDisplayName).toBe('Unknown Hero')
    expect(result[1].heroDisplayName).toBe('Unknown Hero')
  })

  it('handles empty model coords', () => {
    const result = identifyHeroModels(
      [{ name: 'firestorm', confidence: 0.95, hero_order: 0 }],
      [],
      mockHeroLookup,
    )
    expect(result).toHaveLength(0)
  })

  it('returns Unknown Hero when hero lookup returns null for getById', () => {
    const partialLookup: HeroLookup = {
      getByAbilityName() {
        return { heroId: 999, heroName: 'missing', heroDisplayName: null }
      },
      getById() {
        return null
      },
    }
    const result = identifyHeroModels(
      [{ name: 'some_ability', confidence: 0.95, hero_order: 0 }],
      [makeCoord(0)],
      partialLookup,
    )
    expect(result[0].heroDisplayName).toBe('Unknown Hero')
    expect(result[0].dbHeroId).toBeNull()
  })
})
