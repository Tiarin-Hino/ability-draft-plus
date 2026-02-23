import { describe, it, expect } from 'vitest'
import {
  filterRelevantOPCombinations,
  filterRelevantTrapCombinations,
  filterRelevantHeroSynergies,
  filterRelevantHeroTraps,
} from '@core/domain/op-trap-filter'
import type { AbilitySynergyPair, HeroAbilitySynergyRow } from '@core/database/repositories/synergy-repository'

const opCombos: AbilitySynergyPair[] = [
  { ability1InternalName: 'fireball', ability1DisplayName: 'Fireball', ability2InternalName: 'ice_blast', ability2DisplayName: 'Ice Blast', synergyWinrate: 0.68 },
  { ability1InternalName: 'fireball', ability1DisplayName: 'Fireball', ability2InternalName: 'thunder', ability2DisplayName: 'Thunder', synergyWinrate: 0.65 },
  { ability1InternalName: 'blink', ability1DisplayName: 'Blink', ability2InternalName: 'stun', ability2DisplayName: 'Stun', synergyWinrate: 0.70 },
  { ability1InternalName: 'unrelated_a', ability1DisplayName: 'Unrelated A', ability2InternalName: 'unrelated_b', ability2DisplayName: 'Unrelated B', synergyWinrate: 0.72 },
]

const trapCombos: AbilitySynergyPair[] = [
  { ability1InternalName: 'fireball', ability1DisplayName: 'Fireball', ability2InternalName: 'drain', ability2DisplayName: 'Drain', synergyWinrate: 0.35 },
  { ability1InternalName: 'blink', ability1DisplayName: 'Blink', ability2InternalName: 'curse', ability2DisplayName: 'Curse', synergyWinrate: 0.30 },
]

const heroSynergies: HeroAbilitySynergyRow[] = [
  { heroInternalName: 'lina', heroDisplayName: 'Lina', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.68 },
  { heroInternalName: 'lina', heroDisplayName: 'Lina', abilityInternalName: 'ice_blast', abilityDisplayName: 'Ice Blast', synergyWinrate: 0.64 },
  { heroInternalName: 'axe', heroDisplayName: 'Axe', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.60 },
  { heroInternalName: 'invoker', heroDisplayName: 'Invoker', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.75 },
]

const heroTraps: HeroAbilitySynergyRow[] = [
  { heroInternalName: 'lina', heroDisplayName: 'Lina', abilityInternalName: 'drain', abilityDisplayName: 'Drain', synergyWinrate: 0.35 },
  { heroInternalName: 'axe', heroDisplayName: 'Axe', abilityInternalName: 'blink', abilityDisplayName: 'Blink', synergyWinrate: 0.40 },
]

describe('filterRelevantOPCombinations', () => {
  it('includes combo when both abilities in pool', () => {
    const pool = new Set(['fireball', 'ice_blast', 'thunder'])
    const picked = new Set<string>()
    const result = filterRelevantOPCombinations(opCombos, pool, picked)
    expect(result).toHaveLength(2)
  })

  it('includes combo when one in pool and one picked', () => {
    const pool = new Set(['fireball'])
    const picked = new Set(['ice_blast'])
    const result = filterRelevantOPCombinations(opCombos, pool, picked)
    expect(result).toHaveLength(1)
    expect(result[0].ability1DisplayName).toBe('Fireball')
  })

  it('excludes combo when neither in pool nor picked', () => {
    const pool = new Set(['fireball'])
    const picked = new Set<string>()
    const result = filterRelevantOPCombinations(opCombos, pool, picked)
    expect(result).toHaveLength(0)
  })

  it('excludes combo when one in pool and other unrelated', () => {
    const pool = new Set(['blink'])
    const picked = new Set<string>()
    const result = filterRelevantOPCombinations(opCombos, pool, picked)
    expect(result).toHaveLength(0)
  })

  it('maps to SynergyPairDisplay format', () => {
    const pool = new Set(['blink', 'stun'])
    const result = filterRelevantOPCombinations(opCombos, pool, new Set())
    expect(result[0]).toEqual({
      ability1DisplayName: 'Blink',
      ability2DisplayName: 'Stun',
      synergyWinrate: 0.70,
    })
  })
})

describe('filterRelevantTrapCombinations', () => {
  it('includes trap combo when both in pool', () => {
    const pool = new Set(['fireball', 'drain'])
    const result = filterRelevantTrapCombinations(trapCombos, pool, new Set())
    expect(result).toHaveLength(1)
    expect(result[0].synergyWinrate).toBe(0.35)
  })

  it('includes trap combo when one picked + one in pool', () => {
    const pool = new Set(['blink'])
    const picked = new Set(['curse'])
    const result = filterRelevantTrapCombinations(trapCombos, pool, picked)
    expect(result).toHaveLength(1)
  })

  it('excludes when neither relevant', () => {
    const result = filterRelevantTrapCombinations(trapCombos, new Set(['unrelated']), new Set())
    expect(result).toHaveLength(0)
  })
})

describe('filterRelevantHeroSynergies', () => {
  it('includes when ability in pool AND hero in pool AND WR - 0.5 >= threshold', () => {
    const pool = new Set(['fireball', 'ice_blast'])
    const heroesInPool = new Set(['lina', 'axe'])
    // threshold 0.13: lina/fireball WR 0.68 → increase 0.18 >= 0.13 ✓
    // lina/ice_blast WR 0.64 → increase 0.14 >= 0.13 ✓
    // axe/fireball WR 0.60 → increase 0.10 < 0.13 ✗
    const result = filterRelevantHeroSynergies(heroSynergies, pool, new Set(), heroesInPool, 0.13)
    expect(result).toHaveLength(2)
  })

  it('includes when ability is picked (not in pool)', () => {
    const pool = new Set<string>()
    const picked = new Set(['fireball'])
    const heroesInPool = new Set(['lina'])
    const result = filterRelevantHeroSynergies(heroSynergies, pool, picked, heroesInPool, 0.13)
    expect(result).toHaveLength(1)
    expect(result[0].heroDisplayName).toBe('Lina')
  })

  it('excludes when hero not in pool', () => {
    const pool = new Set(['fireball'])
    const heroesInPool = new Set<string>() // invoker not included
    const result = filterRelevantHeroSynergies(heroSynergies, pool, new Set(), heroesInPool, 0.13)
    expect(result).toHaveLength(0)
  })

  it('excludes when below threshold', () => {
    const pool = new Set(['fireball'])
    const heroesInPool = new Set(['axe'])
    // axe/fireball WR 0.60 → increase 0.10 < 0.13
    const result = filterRelevantHeroSynergies(heroSynergies, pool, new Set(), heroesInPool, 0.13)
    expect(result).toHaveLength(0)
  })
})

describe('filterRelevantHeroTraps', () => {
  it('includes when ability in pool and hero in pool', () => {
    const pool = new Set(['drain', 'blink'])
    const heroesInPool = new Set(['lina', 'axe'])
    const result = filterRelevantHeroTraps(heroTraps, pool, new Set(), heroesInPool)
    expect(result).toHaveLength(2)
  })

  it('includes when ability is picked', () => {
    const pool = new Set<string>()
    const picked = new Set(['drain'])
    const heroesInPool = new Set(['lina'])
    const result = filterRelevantHeroTraps(heroTraps, pool, picked, heroesInPool)
    expect(result).toHaveLength(1)
  })

  it('excludes when hero not in pool', () => {
    const pool = new Set(['drain'])
    const heroesInPool = new Set<string>()
    const result = filterRelevantHeroTraps(heroTraps, pool, new Set(), heroesInPool)
    expect(result).toHaveLength(0)
  })
})
