import { describe, it, expect } from 'vitest'
import { determineTopTierEntities } from '@core/domain/top-tier'
import type { ScoredEntity } from '@core/domain/types'

function makeAbility(
  name: string,
  score: number,
  opts: { isUltCoord?: boolean; isUltDb?: boolean } = {},
): ScoredEntity {
  return {
    entityType: 'ability',
    internalName: name,
    displayName: name,
    winrate: null,
    pickRate: null,
    consolidatedScore: score,
    isUltimateFromCoordSource: opts.isUltCoord ?? false,
    isUltimateFromDb: opts.isUltDb ?? false,
  }
}

function makeHero(name: string, score: number, dbHeroId: number): ScoredEntity {
  return {
    entityType: 'hero',
    internalName: name,
    displayName: name,
    winrate: null,
    pickRate: null,
    consolidatedScore: score,
    dbHeroId,
    heroOrder: 0,
  }
}

describe('determineTopTierEntities', () => {
  it('returns max 10 entities', () => {
    const entities = Array.from({ length: 20 }, (_, i) =>
      makeAbility(`ability_${i}`, 0.9 - i * 0.01),
    )
    const result = determineTopTierEntities(entities, null, false, new Set())
    expect(result).toHaveLength(10)
  })

  it('synergy suggestions come first, sorted by score', () => {
    const entities = [
      makeAbility('a', 0.9),
      makeAbility('b', 0.8),
      makeAbility('synergy1', 0.7),
      makeAbility('synergy2', 0.85),
    ]
    const synergyPartners = new Set(['synergy1', 'synergy2'])
    const result = determineTopTierEntities(entities, null, false, synergyPartners)

    // synergy2 (0.85) before synergy1 (0.7), then a (0.9) before b (0.8)
    expect(result[0].internalName).toBe('synergy2')
    expect(result[0].isSynergySuggestionForMySpot).toBe(true)
    expect(result[1].internalName).toBe('synergy1')
    expect(result[1].isSynergySuggestionForMySpot).toBe(true)
    expect(result[2].internalName).toBe('a')
    expect(result[2].isGeneralTopTier).toBe(true)
    expect(result[3].internalName).toBe('b')
  })

  it('general top picks fill remaining slots after synergy', () => {
    const entities = [
      makeAbility('a', 0.9),
      makeAbility('b', 0.8),
      makeAbility('c', 0.7),
      makeAbility('synergy1', 0.6),
    ]
    const result = determineTopTierEntities(
      entities,
      null,
      false,
      new Set(['synergy1']),
    )
    expect(result).toHaveLength(4)
    // 1 synergy + 3 general
    expect(result.filter((e) => e.isSynergySuggestionForMySpot)).toHaveLength(1)
    expect(result.filter((e) => e.isGeneralTopTier)).toHaveLength(3)
  })

  it('when mySpotHasUlt: excludes ultimates from candidates', () => {
    const entities = [
      makeAbility('ult1', 0.95, { isUltCoord: true }),
      makeAbility('ult2', 0.93, { isUltDb: true }),
      makeAbility('normal1', 0.9),
      makeAbility('normal2', 0.8),
    ]
    const result = determineTopTierEntities(entities, null, true, new Set())
    expect(result.map((e) => e.internalName)).toEqual(['normal1', 'normal2'])
  })

  it('when mySpotHasUlt: excludes ultimate synergy partners', () => {
    const entities = [
      makeAbility('ult_synergy', 0.95, { isUltCoord: true }),
      makeAbility('normal_synergy', 0.85),
      makeAbility('general', 0.7),
    ]
    const result = determineTopTierEntities(
      entities,
      null,
      true,
      new Set(['ult_synergy', 'normal_synergy']),
    )
    // ult_synergy excluded, normal_synergy included as synergy
    expect(result[0].internalName).toBe('normal_synergy')
    expect(result[0].isSynergySuggestionForMySpot).toBe(true)
    expect(result[1].internalName).toBe('general')
    expect(result[1].isGeneralTopTier).toBe(true)
  })

  it('when selectedModelId set: general candidates are abilities-only', () => {
    const entities = [
      makeHero('hero1', 0.95, 1),
      makeAbility('ability1', 0.9),
      makeAbility('ability2', 0.85),
    ]
    const result = determineTopTierEntities(entities, 1, false, new Set())
    expect(result.map((e) => e.internalName)).toEqual(['ability1', 'ability2'])
  })

  it('when selectedModelId is null: hero entities included in general picks', () => {
    const entities = [
      makeHero('hero1', 0.95, 1),
      makeAbility('ability1', 0.9),
    ]
    const result = determineTopTierEntities(entities, null, false, new Set())
    expect(result).toHaveLength(2)
    expect(result[0].internalName).toBe('hero1')
  })

  it('no synergy partners: all 10 are general picks', () => {
    const entities = Array.from({ length: 12 }, (_, i) =>
      makeAbility(`ability_${i}`, 0.9 - i * 0.01),
    )
    const result = determineTopTierEntities(entities, null, false, new Set())
    expect(result).toHaveLength(10)
    expect(result.every((e) => e.isGeneralTopTier)).toBe(true)
  })

  it('handles more than 10 synergy partners (takes top 10 by score)', () => {
    const entities = Array.from({ length: 15 }, (_, i) =>
      makeAbility(`syn_${i}`, 0.9 - i * 0.01),
    )
    const synergyPartners = new Set(entities.map((e) => e.internalName))
    const result = determineTopTierEntities(entities, null, false, synergyPartners)
    expect(result).toHaveLength(10)
    expect(result.every((e) => e.isSynergySuggestionForMySpot)).toBe(true)
    // Verify they're the top 10 by score
    expect(result[0].consolidatedScore).toBe(0.9)
  })

  it('returns empty for empty entities', () => {
    const result = determineTopTierEntities([], null, false, new Set())
    expect(result).toHaveLength(0)
  })

  it('synergy suggestions are not duplicated in general picks', () => {
    const entities = [
      makeAbility('synergy_ability', 0.95),
      makeAbility('general_ability', 0.8),
    ]
    const result = determineTopTierEntities(
      entities,
      null,
      false,
      new Set(['synergy_ability']),
    )
    const names = result.map((e) => e.internalName)
    expect(names).toEqual(['synergy_ability', 'general_ability'])
    // synergy_ability should NOT appear as general
    const synAbility = result.find((e) => e.internalName === 'synergy_ability')
    expect(synAbility?.isSynergySuggestionForMySpot).toBe(true)
    expect(synAbility?.isGeneralTopTier).toBe(false)
  })
})
