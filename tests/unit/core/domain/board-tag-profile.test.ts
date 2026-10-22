import { describe, it, expect } from 'vitest'
import { computeBoardTagProfile, effectiveTags } from '@core/domain/board-tag-profile'
import type { AbilityTag } from '@core/domain/ability-tags'
import type { ScanResult } from '@shared/types'

const TAGS: Record<string, AbilityTag[]> = {
  stun: ['hard_cc'],
  slow: ['soft_cc'],
  swipes: ['steroid'],
  nuke: ['nuke'],
  shield: ['save_ally', 'dispel_ally'],
  nether_strike: ['hard_cc', 'mobility'],
  greater_bash: ['hard_cc', 'steroid'],
}
const WITH: Record<string, Array<[AbilityTag, string[]]>> = {
  nether_strike: [['hard_cc', ['greater_bash']]],
}
const tags = {
  getTags: (n: string) => (TAGS[n] ? new Set(TAGS[n]) : undefined),
  getWith: (n: string) => (WITH[n] ? new Map(WITH[n]) : undefined),
}

function pick(name: string, hero_order: number): ScanResult {
  return {
    name,
    confidence: 1,
    hero_order,
    ability_order: 1,
    is_ultimate: false,
    coord: { x: 0, y: 0, width: 1, height: 1 },
  } as ScanResult
}

describe('computeBoardTagProfile', () => {
  it('splits counts into mine / team / enemy / drafted / pool by draft row', () => {
    const profile = computeBoardTagProfile({
      selectedAbilities: [
        pick('stun', 2), // me
        pick('swipes', 0), // teammate
        pick('slow', 4), // teammate
        pick('nuke', 7), // enemy
        pick('stun', 9), // enemy
        pick('unknown_ability', 9), // untagged: ignored
      ],
      poolNames: ['shield', 'nuke', 'nuke', 'stun'],
      myHeroOrder: 2,
      tags,
    })

    expect(profile.mine.get('hard_cc')).toBe(1)
    expect(profile.team.get('steroid')).toBe(1)
    expect(profile.team.get('soft_cc')).toBe(1)
    expect(profile.team.has('hard_cc')).toBe(false)
    expect(profile.enemy.get('nuke')).toBe(1)
    expect(profile.enemy.get('hard_cc')).toBe(1)
    expect(profile.drafted.get('hard_cc')).toBe(2)
    // pool counts unique names: the duplicate nuke slot counts once
    expect(profile.pool.get('nuke')).toBe(1)
    expect(profile.pool.get('dispel_ally')).toBe(1)
    expect(profile.pool.get('hard_cc')).toBe(1)
  })

  it('leaves the team halves empty without My Spot but still counts drafted and pool', () => {
    const profile = computeBoardTagProfile({
      selectedAbilities: [pick('stun', 1), pick('nuke', 6)],
      poolNames: ['slow'],
      myHeroOrder: null,
      tags,
    })
    expect(profile.mine.size).toBe(0)
    expect(profile.team.size).toBe(0)
    expect(profile.enemy.size).toBe(0)
    expect(profile.drafted.get('hard_cc')).toBe(1)
    expect(profile.drafted.get('nuke')).toBe(1)
    expect(profile.pool.get('soft_cc')).toBe(1)
  })

  it('resolves conditional (with:) tags per owner, and pool conditionals from my picks', () => {
    // Row 6 holds Nether Strike WITHOUT Greater Bash: no hard_cc credit.
    // Row 1 holds both: the knockback counts.
    const base = {
      selectedAbilities: [
        pick('nether_strike', 6),
        pick('nether_strike', 1),
        pick('greater_bash', 1),
      ],
      poolNames: ['nether_strike'],
      tags,
    }
    const asRow0 = computeBoardTagProfile({ ...base, myHeroOrder: 0 })
    expect(asRow0.enemy.get('hard_cc')).toBeUndefined()
    expect(asRow0.enemy.get('mobility')).toBe(1)
    expect(asRow0.team.get('hard_cc')).toBe(2) // Nether Strike (enabled) + Greater Bash
    // I hold nothing: the pool Nether Strike is just mobility to me.
    expect(asRow0.pool.get('hard_cc')).toBeUndefined()
    expect(asRow0.pool.get('mobility')).toBe(1)

    const asRow1 = computeBoardTagProfile({ ...base, myHeroOrder: 1 })
    // As the Greater Bash holder, a pool Nether Strike IS a knockback.
    expect(asRow1.pool.get('hard_cc')).toBe(1)
    expect(asRow1.mine.get('hard_cc')).toBe(2)
  })
})

describe('effectiveTags', () => {
  it('returns the base set itself when there is no conditional entry (no copy)', () => {
    const base = new Set<AbilityTag>(['hard_cc'])
    const stable = { getTags: () => base, getWith: () => undefined }
    expect(effectiveTags('stun', new Set(), stable)).toBe(base)
  })

  it('returns undefined for untagged abilities', () => {
    expect(effectiveTags('nope', new Set(), tags)).toBeUndefined()
  })

  it('works with lookups that lack getWith (older stubs)', () => {
    const legacy = { getTags: tags.getTags }
    expect([...effectiveTags('nether_strike', new Set(), legacy)!]).toEqual(['hard_cc', 'mobility'])
  })
})
