import { describe, it, expect } from 'vitest'
import {
  getAbilitySynergySplit,
  getHeroSynergiesForAbility,
  getAbilitySynergiesForHero,
} from '@core/domain/synergy-enrichment'
import type { SynergyLookup } from '@core/domain/types'
import type { HeroAbilitySynergyRow } from '@core/database/repositories/synergy-repository'

const mockSynergyLookup: SynergyLookup = {
  getHighWinrateCombinations(baseAbilityName: string) {
    if (baseAbilityName === 'fireball') {
      return [
        { partnerDisplayName: 'Ice Blast', partnerInternalName: 'ice_blast', synergyWinrate: 0.62 },
        { partnerDisplayName: 'Thunder', partnerInternalName: 'thunder', synergyWinrate: 0.55 },
        { partnerDisplayName: 'Drain', partnerInternalName: 'drain', synergyWinrate: 0.45 },
        { partnerDisplayName: 'Curse', partnerInternalName: 'curse', synergyWinrate: 0.38 },
      ]
    }
    return []
  },
  getAllOPCombinations() { return [] },
  getAllTrapCombinations() { return [] },
  getAllHeroSynergies() { return [] },
  getAllHeroTrapSynergies() { return [] },
  getAllHeroAbilitySynergiesUnfiltered() { return [] },
}

const mockHeroSynergies: HeroAbilitySynergyRow[] = [
  { heroInternalName: 'lina', heroDisplayName: 'Lina', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.65 },
  { heroInternalName: 'cm', heroDisplayName: 'Crystal Maiden', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.58 },
  { heroInternalName: 'axe', heroDisplayName: 'Axe', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.52 },
  { heroInternalName: 'drow', heroDisplayName: 'Drow Ranger', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.51 },
  { heroInternalName: 'sniper', heroDisplayName: 'Sniper', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.50 },
  { heroInternalName: 'pa', heroDisplayName: 'Phantom Assassin', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.49 },
  { heroInternalName: 'pudge', heroDisplayName: 'Pudge', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.42 },
  { heroInternalName: 'techies', heroDisplayName: 'Techies', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.38 },
  { heroInternalName: 'brood', heroDisplayName: 'Broodmother', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.35 },
  { heroInternalName: 'chen', heroDisplayName: 'Chen', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.30 },
  { heroInternalName: 'io', heroDisplayName: 'Io', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.28 },
  // Different ability
  { heroInternalName: 'lina', heroDisplayName: 'Lina', abilityInternalName: 'ice_blast', abilityDisplayName: 'Ice Blast', synergyWinrate: 0.60 },
  // Hero not in pool
  { heroInternalName: 'invoker', heroDisplayName: 'Invoker', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.70 },
]

describe('getAbilitySynergySplit', () => {
  it('splits synergy partners by winrate 0.5 threshold', () => {
    const result = getAbilitySynergySplit('fireball', ['ice_blast', 'thunder', 'drain', 'curse'], mockSynergyLookup)
    expect(result.high).toHaveLength(2)
    expect(result.low).toHaveLength(2)
  })

  it('maps to SynergyPairDisplay format', () => {
    const result = getAbilitySynergySplit('fireball', ['ice_blast'], mockSynergyLookup)
    expect(result.high[0]).toEqual({
      ability1DisplayName: 'fireball',
      ability2DisplayName: 'Ice Blast',
      synergyWinrate: 0.62,
    })
  })

  it('returns empty for unknown ability', () => {
    const result = getAbilitySynergySplit('unknown', ['anything'], mockSynergyLookup)
    expect(result.high).toHaveLength(0)
    expect(result.low).toHaveLength(0)
  })

  it('places exactly 0.5 winrate in high group', () => {
    const lookup: SynergyLookup = {
      ...mockSynergyLookup,
      getHighWinrateCombinations: () => [
        { partnerDisplayName: 'Edge', partnerInternalName: 'edge', synergyWinrate: 0.5 },
      ],
    }
    const result = getAbilitySynergySplit('test', ['edge'], lookup)
    expect(result.high).toHaveLength(1)
    expect(result.low).toHaveLength(0)
  })
})

describe('getHeroSynergiesForAbility', () => {
  const heroesInPool = new Set(['lina', 'cm', 'axe', 'drow', 'sniper', 'pa', 'pudge', 'techies', 'brood', 'chen', 'io'])

  it('returns top 5 strong synergies (WR >= 0.5) sorted desc', () => {
    const result = getHeroSynergiesForAbility('fireball', mockHeroSynergies, heroesInPool)
    expect(result.strong).toHaveLength(5)
    expect(result.strong[0].heroDisplayName).toBe('Lina')
    expect(result.strong[4].heroDisplayName).toBe('Sniper')
    // Verify sorted descending
    for (let i = 1; i < result.strong.length; i++) {
      expect(result.strong[i - 1].synergyWinrate).toBeGreaterThanOrEqual(result.strong[i].synergyWinrate)
    }
  })

  it('returns top 5 weak synergies (WR < 0.5) sorted asc', () => {
    const result = getHeroSynergiesForAbility('fireball', mockHeroSynergies, heroesInPool)
    expect(result.weak).toHaveLength(5)
    expect(result.weak[0].heroDisplayName).toBe('Io')
    expect(result.weak[4].heroDisplayName).toBe('Pudge')
    // Verify sorted ascending
    for (let i = 1; i < result.weak.length; i++) {
      expect(result.weak[i - 1].synergyWinrate).toBeLessThanOrEqual(result.weak[i].synergyWinrate)
    }
  })

  it('filters to heroes in pool only', () => {
    const smallPool = new Set(['lina'])
    const result = getHeroSynergiesForAbility('fireball', mockHeroSynergies, smallPool)
    expect(result.strong).toHaveLength(1)
    expect(result.strong[0].heroDisplayName).toBe('Lina')
  })

  it('excludes hero not in pool (invoker has WR 0.70 but not in pool)', () => {
    const result = getHeroSynergiesForAbility('fireball', mockHeroSynergies, heroesInPool)
    const invoker = result.strong.find((s) => s.heroDisplayName === 'Invoker')
    expect(invoker).toBeUndefined()
  })

  it('returns empty for non-matching ability', () => {
    const result = getHeroSynergiesForAbility('nonexistent', mockHeroSynergies, heroesInPool)
    expect(result.strong).toHaveLength(0)
    expect(result.weak).toHaveLength(0)
  })
})

describe('getAbilitySynergiesForHero', () => {
  const poolAndPicked = new Set(['fireball', 'ice_blast'])

  it('returns synergies filtered to abilities in pool or picked', () => {
    const result = getAbilitySynergiesForHero('lina', mockHeroSynergies, poolAndPicked)
    expect(result.strong).toHaveLength(2)
    expect(result.strong[0].synergyWinrate).toBe(0.65)
    expect(result.strong[1].synergyWinrate).toBe(0.60)
  })

  it('returns empty for hero with no matching synergies', () => {
    const result = getAbilitySynergiesForHero('nonexistent_hero', mockHeroSynergies, poolAndPicked)
    expect(result.strong).toHaveLength(0)
    expect(result.weak).toHaveLength(0)
  })

  it('limits to top 5 per category', () => {
    // Use a hero with many abilities (mock as lina with many abilities in pool)
    const manyAbilities = new Set(['fireball', 'ice_blast', 'a', 'b', 'c', 'd', 'e', 'f'])
    const manyRows: HeroAbilitySynergyRow[] = [
      ...Array.from({ length: 7 }, (_, i) => ({
        heroInternalName: 'megahero',
        heroDisplayName: 'Mega Hero',
        abilityInternalName: String.fromCharCode(97 + i), // a, b, c, d, e, f, g
        abilityDisplayName: `Ability ${String.fromCharCode(65 + i)}`,
        synergyWinrate: 0.6 + i * 0.01,
      })),
    ]
    const result = getAbilitySynergiesForHero('megahero', manyRows, manyAbilities)
    expect(result.strong).toHaveLength(5)
  })
})
