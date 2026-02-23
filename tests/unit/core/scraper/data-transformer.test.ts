import { describe, it, expect } from 'vitest'
import {
  transformAbilitiesAndHeroes,
  transformPairs,
  transformTriplets,
  buildWinrateMap,
  buildAbilityLookup,
} from '@core/scraper/data-transformer'
import type { AbilityLookup } from '@core/scraper/data-transformer'
import type {
  WindrunAbilityStat,
  WindrunPair,
  WindrunTriplet,
  WindrunStaticAbility,
  WindrunStaticHero,
} from '@core/scraper/types'

// ── Fixtures ────────────────────────────────────────────────────────────────

const staticAbilitiesArray: WindrunStaticAbility[] = [
  { valveId: 5359, englishName: 'Fury Swipes', shortName: 'ursa_fury_swipes', ownerHeroId: 70, hasScepter: false, hasShard: true },
  { valveId: 5032, englishName: 'Shrapnel', shortName: 'sniper_shrapnel', ownerHeroId: 35, hasScepter: false, hasShard: false },
  { valveId: 5033, englishName: 'Headshot', shortName: 'sniper_headshot', ownerHeroId: 35, hasScepter: false, hasShard: false },
  { valveId: 5100, englishName: 'Firestorm', shortName: 'doom_bringer_firestorm', ownerHeroId: 69, hasScepter: false, hasShard: false },
  { valveId: 5200, englishName: 'Ice Blast', shortName: 'ancient_apparition_ice_blast', ownerHeroId: 68, hasScepter: false, hasShard: false },
]

const abilityLookup: AbilityLookup = buildAbilityLookup(staticAbilitiesArray)

const staticHeroes: Record<string, WindrunStaticHero> = {
  '70': { id: 70, englishName: 'Ursa', shortName: 'ursa' },
  '35': { id: 35, englishName: 'Sniper', shortName: 'sniper' },
  '69': { id: 69, englishName: 'Doom', shortName: 'doom_bringer' },
  '68': { id: 68, englishName: 'Ancient Apparition', shortName: 'ancient_apparition' },
}

// ── buildAbilityLookup ──────────────────────────────────────────────────────

describe('buildAbilityLookup', () => {
  it('builds a map from valveId to ability data', () => {
    expect(abilityLookup.get(5359)?.shortName).toBe('ursa_fury_swipes')
    expect(abilityLookup.get(5032)?.shortName).toBe('sniper_shrapnel')
    expect(abilityLookup.size).toBe(5)
  })

  it('skips entries with non-positive valveId', () => {
    const withNegative: WindrunStaticAbility[] = [
      { valveId: -1, englishName: 'Hero', shortName: 'hero', ownerHeroId: 1, hasScepter: false, hasShard: false },
      { valveId: 0, englishName: 'Zero', shortName: 'zero', ownerHeroId: 1, hasScepter: false, hasShard: false },
      { valveId: 100, englishName: 'Valid', shortName: 'valid', ownerHeroId: 1, hasScepter: false, hasShard: false },
    ]
    const lookup = buildAbilityLookup(withNegative)
    expect(lookup.size).toBe(1)
    expect(lookup.get(100)?.shortName).toBe('valid')
  })
})

// ── buildWinrateMap ─────────────────────────────────────────────────────────

describe('buildWinrateMap', () => {
  it('builds a map from abilityId to winrate', () => {
    const stats: WindrunAbilityStat[] = [
      { abilityId: 5359, numPicks: 100, avgPickPosition: 3, wins: 55, ownerHero: 70, winrate: 0.55, pickRate: 0.9 },
      { abilityId: -35, numPicks: 200, avgPickPosition: 5, wins: 100, ownerHero: 35, winrate: 0.50, pickRate: 0.8 },
    ]
    const map = buildWinrateMap(stats)
    expect(map.get(5359)).toBe(0.55)
    expect(map.get(-35)).toBe(0.50)
    expect(map.size).toBe(2)
  })

  it('returns empty map for empty array', () => {
    expect(buildWinrateMap([]).size).toBe(0)
  })
})

// ── transformAbilitiesAndHeroes ─────────────────────────────────────────────

describe('transformAbilitiesAndHeroes', () => {
  const overallStats: WindrunAbilityStat[] = [
    { abilityId: -70, numPicks: 1000, avgPickPosition: 4.5, wins: 520, ownerHero: 70, winrate: 0.52, pickRate: 0.95 },
    { abilityId: 5359, numPicks: 800, avgPickPosition: 2.6, wins: 440, ownerHero: 70, winrate: 0.55, pickRate: 0.99 },
    { abilityId: 5032, numPicks: 600, avgPickPosition: 8.0, wins: 300, ownerHero: 35, winrate: 0.50, pickRate: 0.7 },
  ]

  const hsStats: WindrunAbilityStat[] = [
    { abilityId: -70, numPicks: 200, avgPickPosition: 4.0, wins: 110, ownerHero: 70, winrate: 0.55, pickRate: 0.9 },
    { abilityId: 5359, numPicks: 150, avgPickPosition: 2.2, wins: 90, ownerHero: 70, winrate: 0.60, pickRate: 0.98 },
  ]

  it('separates heroes (negative IDs) from abilities (positive IDs)', () => {
    const { heroData, abilityData } = transformAbilitiesAndHeroes(
      overallStats, hsStats, abilityLookup, staticHeroes,
    )
    expect(heroData).toHaveLength(1)
    expect(abilityData).toHaveLength(2)
  })

  it('maps hero correctly with windrunId and names from static data', () => {
    const { heroData } = transformAbilitiesAndHeroes(
      overallStats, hsStats, abilityLookup, staticHeroes,
    )
    const ursa = heroData[0]
    expect(ursa.name).toBe('ursa')
    expect(ursa.displayName).toBe('Ursa')
    expect(ursa.windrunId).toBe(70)
    expect(ursa.winrate).toBe(0.52)
    expect(ursa.highSkillWinrate).toBe(0.55)
    expect(ursa.pickRate).toBe(4.5)
    expect(ursa.hsPickRate).toBe(4.0)
  })

  it('maps ability correctly with names and heroName from static data', () => {
    const { abilityData } = transformAbilitiesAndHeroes(
      overallStats, hsStats, abilityLookup, staticHeroes,
    )
    const fury = abilityData.find((a) => a.name === 'ursa_fury_swipes')!
    expect(fury.displayName).toBe('Fury Swipes')
    expect(fury.heroId).toBe(70)
    expect(fury.heroName).toBe('ursa')
    expect(fury.winrate).toBe(0.55)
    expect(fury.highSkillWinrate).toBe(0.60)
    expect(fury.pickRate).toBe(2.6)
    expect(fury.hsPickRate).toBe(2.2)
  })

  it('sets null for high-skill stats when missing', () => {
    const { abilityData } = transformAbilitiesAndHeroes(
      overallStats, hsStats, abilityLookup, staticHeroes,
    )
    const shrapnel = abilityData.find((a) => a.name === 'sniper_shrapnel')!
    expect(shrapnel.highSkillWinrate).toBeNull()
    expect(shrapnel.hsPickRate).toBeNull()
  })

  it('skips entries not found in static data', () => {
    const statsWithUnknown: WindrunAbilityStat[] = [
      { abilityId: 9999, numPicks: 10, avgPickPosition: 1, wins: 5, ownerHero: 0, winrate: 0.5, pickRate: 0.1 },
      { abilityId: -999, numPicks: 10, avgPickPosition: 1, wins: 5, ownerHero: 999, winrate: 0.5, pickRate: 0.1 },
    ]
    const { heroData, abilityData } = transformAbilitiesAndHeroes(
      statsWithUnknown, [], abilityLookup, staticHeroes,
    )
    expect(heroData).toHaveLength(0)
    expect(abilityData).toHaveLength(0)
  })
})

// ── transformPairs ──────────────────────────────────────────────────────────

describe('transformPairs', () => {
  const winrateMap = new Map<number, number>([
    [5359, 0.55],  // Fury Swipes
    [5032, 0.50],  // Shrapnel
    [5033, 0.48],  // Headshot (same hero as Shrapnel)
    [5100, 0.52],  // Firestorm
    [-35, 0.50],   // Sniper hero
  ])

  it('computes synergy_increase correctly for ability-ability pair', () => {
    const pairs: WindrunPair[] = [
      { abilityIdOne: 5359, abilityIdTwo: 5100, numPicks: 500, winrate: 0.65 },
    ]
    const { abilityPairs } = transformPairs(pairs, winrateMap, abilityLookup, staticHeroes)
    expect(abilityPairs).toHaveLength(1)
    // synergy_increase = 0.65 - (0.55 + 0.52) / 2 = 0.65 - 0.535 = 0.115
    expect(abilityPairs[0].synergyIncrease).toBeCloseTo(0.115)
    expect(abilityPairs[0].isOp).toBe(false) // 0.115 < 0.13
  })

  it('marks pair as OP when synergy_increase >= 0.13', () => {
    const pairs: WindrunPair[] = [
      { abilityIdOne: 5359, abilityIdTwo: 5100, numPicks: 500, winrate: 0.70 },
    ]
    const { abilityPairs } = transformPairs(pairs, winrateMap, abilityLookup, staticHeroes)
    // synergy_increase = 0.70 - (0.55 + 0.52) / 2 = 0.70 - 0.535 = 0.165
    expect(abilityPairs[0].synergyIncrease).toBeCloseTo(0.165)
    expect(abilityPairs[0].isOp).toBe(true)
  })

  it('filters out same-hero ability pairs', () => {
    const pairs: WindrunPair[] = [
      { abilityIdOne: 5032, abilityIdTwo: 5033, numPicks: 300, winrate: 0.55 },
    ]
    const { abilityPairs } = transformPairs(pairs, winrateMap, abilityLookup, staticHeroes)
    expect(abilityPairs).toHaveLength(0)
  })

  it('orders ability names alphabetically for consistent storage', () => {
    const pairs: WindrunPair[] = [
      // Fury Swipes (ursa_fury_swipes) + Firestorm (doom_bringer_firestorm)
      // Alphabetically: doom_bringer_firestorm < ursa_fury_swipes
      { abilityIdOne: 5359, abilityIdTwo: 5100, numPicks: 500, winrate: 0.60 },
    ]
    const { abilityPairs } = transformPairs(pairs, winrateMap, abilityLookup, staticHeroes)
    expect(abilityPairs[0].ability1Name).toBe('doom_bringer_firestorm')
    expect(abilityPairs[0].ability2Name).toBe('ursa_fury_swipes')
  })

  it('routes hero-ability pairs (negative first ID) correctly', () => {
    const pairs: WindrunPair[] = [
      { abilityIdOne: -35, abilityIdTwo: 5359, numPicks: 1000, winrate: 0.60 },
    ]
    const { abilityPairs, heroPairs } = transformPairs(pairs, winrateMap, abilityLookup, staticHeroes)
    expect(abilityPairs).toHaveLength(0)
    expect(heroPairs).toHaveLength(1)
    expect(heroPairs[0].heroName).toBe('sniper')
    expect(heroPairs[0].abilityName).toBe('ursa_fury_swipes')
    // synergy_increase = 0.60 - (0.50 + 0.55) / 2 = 0.60 - 0.525 = 0.075
    expect(heroPairs[0].synergyIncrease).toBeCloseTo(0.075)
  })

  it('defaults to 0.5 winrate for unknown ability IDs', () => {
    const emptyWrMap = new Map<number, number>()
    const pairs: WindrunPair[] = [
      { abilityIdOne: 5359, abilityIdTwo: 5100, numPicks: 500, winrate: 0.65 },
    ]
    const { abilityPairs } = transformPairs(pairs, emptyWrMap, abilityLookup, staticHeroes)
    // synergy_increase = 0.65 - (0.5 + 0.5) / 2 = 0.65 - 0.5 = 0.15
    expect(abilityPairs[0].synergyIncrease).toBeCloseTo(0.15)
  })

  it('skips pairs with unknown ability IDs', () => {
    const pairs: WindrunPair[] = [
      { abilityIdOne: 9999, abilityIdTwo: 5359, numPicks: 100, winrate: 0.55 },
    ]
    const { abilityPairs } = transformPairs(pairs, winrateMap, abilityLookup, staticHeroes)
    expect(abilityPairs).toHaveLength(0)
  })
})

// ── transformTriplets ───────────────────────────────────────────────────────

describe('transformTriplets', () => {
  const winrateMap = new Map<number, number>([
    [5359, 0.55],  // Fury Swipes
    [5100, 0.52],  // Firestorm
    [5200, 0.48],  // Ice Blast
    [-70, 0.52],   // Ursa hero
  ])

  it('transforms 3-ability triplet correctly', () => {
    const triplets: WindrunTriplet[] = [
      { abilityIdOne: 5359, abilityIdTwo: 5100, abilityIdThree: 5200, numPicks: 200, winrate: 0.70 },
    ]
    const { abilityTriplets, heroTriplets } = transformTriplets(
      triplets, winrateMap, abilityLookup, staticHeroes,
    )
    expect(abilityTriplets).toHaveLength(1)
    expect(heroTriplets).toHaveLength(0)

    // synergy_increase = 0.70 - (0.55 + 0.52 + 0.48) / 3 = 0.70 - 0.5167 ≈ 0.1833
    expect(abilityTriplets[0].synergyIncrease).toBeCloseTo(0.70 - (0.55 + 0.52 + 0.48) / 3)
    expect(abilityTriplets[0].isOp).toBe(true) // > 0.13
  })

  it('sorts ability names alphabetically in 3-ability triplet', () => {
    const triplets: WindrunTriplet[] = [
      // Names: ursa_fury_swipes, doom_bringer_firestorm, ancient_apparition_ice_blast
      // Sorted: ancient_apparition_ice_blast, doom_bringer_firestorm, ursa_fury_swipes
      { abilityIdOne: 5359, abilityIdTwo: 5100, abilityIdThree: 5200, numPicks: 200, winrate: 0.60 },
    ]
    const { abilityTriplets } = transformTriplets(
      triplets, winrateMap, abilityLookup, staticHeroes,
    )
    expect(abilityTriplets[0].ability1Name).toBe('ancient_apparition_ice_blast')
    expect(abilityTriplets[0].ability2Name).toBe('doom_bringer_firestorm')
    expect(abilityTriplets[0].ability3Name).toBe('ursa_fury_swipes')
  })

  it('transforms hero + 2 abilities triplet correctly', () => {
    const triplets: WindrunTriplet[] = [
      { abilityIdOne: -70, abilityIdTwo: 5359, abilityIdThree: 5100, numPicks: 150, winrate: 0.65 },
    ]
    const { abilityTriplets, heroTriplets } = transformTriplets(
      triplets, winrateMap, abilityLookup, staticHeroes,
    )
    expect(abilityTriplets).toHaveLength(0)
    expect(heroTriplets).toHaveLength(1)

    expect(heroTriplets[0].heroName).toBe('ursa')
    // synergy_increase = 0.65 - (0.52 + 0.55 + 0.52) / 3 = 0.65 - 0.53 = 0.12
    expect(heroTriplets[0].synergyIncrease).toBeCloseTo(0.65 - (0.52 + 0.55 + 0.52) / 3)
  })

  it('sorts ability names in hero triplets', () => {
    const triplets: WindrunTriplet[] = [
      // ursa_fury_swipes > doom_bringer_firestorm alphabetically → swap
      { abilityIdOne: -70, abilityIdTwo: 5359, abilityIdThree: 5100, numPicks: 150, winrate: 0.65 },
    ]
    const { heroTriplets } = transformTriplets(
      triplets, winrateMap, abilityLookup, staticHeroes,
    )
    expect(heroTriplets[0].ability1Name).toBe('doom_bringer_firestorm')
    expect(heroTriplets[0].ability2Name).toBe('ursa_fury_swipes')
  })

  it('skips triplets with unknown static data', () => {
    const triplets: WindrunTriplet[] = [
      { abilityIdOne: 9999, abilityIdTwo: 5359, abilityIdThree: 5100, numPicks: 50, winrate: 0.55 },
    ]
    const { abilityTriplets } = transformTriplets(
      triplets, winrateMap, abilityLookup, staticHeroes,
    )
    expect(abilityTriplets).toHaveLength(0)
  })

  it('defaults to 0.5 winrate for unknown IDs', () => {
    const emptyWrMap = new Map<number, number>()
    const triplets: WindrunTriplet[] = [
      { abilityIdOne: 5359, abilityIdTwo: 5100, abilityIdThree: 5200, numPicks: 100, winrate: 0.70 },
    ]
    const { abilityTriplets } = transformTriplets(
      triplets, emptyWrMap, abilityLookup, staticHeroes,
    )
    // synergy_increase = 0.70 - (0.5 + 0.5 + 0.5) / 3 = 0.70 - 0.5 = 0.20
    expect(abilityTriplets[0].synergyIncrease).toBeCloseTo(0.20)
  })
})
