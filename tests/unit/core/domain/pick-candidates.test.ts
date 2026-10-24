import { describe, it, expect } from 'vitest'
import { addPoolHeroAbilities } from '@core/domain/pick-candidates'
import type { HeroAbility } from '@core/domain/pick-candidates'
import { dedupeSelectedNames } from '@core/domain/scan-processor'
import type { ScanResult } from '@shared/types'

const HERO_ABILITIES: Record<string, HeroAbility[]> = {
  legioncommander: [
    { name: 'legion_commander_overwhelming_odds', isUltimate: false },
    { name: 'legion_commander_press_the_attack', isUltimate: false },
    { name: 'legion_commander_moment_of_courage', isUltimate: false },
    { name: 'legion_commander_duel', isUltimate: true },
  ],
  venomancer: [
    { name: 'venomancer_venomous_gale', isUltimate: false },
    { name: 'venomancer_plague_ward', isUltimate: false },
    { name: 'venomancer_noxious_plague', isUltimate: true },
  ],
}

const lookup = (hero: string): HeroAbility[] => HERO_ABILITIES[hero] ?? []

describe('addPoolHeroAbilities', () => {
  it('adds abilities the mid-draft pool scan no longer shows, typed by box', () => {
    // Joined mid-draft: Press the Attack and Duel were already drafted, so the
    // pool scan only produced the still-visible names
    const sets = {
      standard: new Set([
        'legion_commander_overwhelming_odds',
        'legion_commander_moment_of_courage',
      ]),
      ultimates: new Set<string>(),
    }
    const added = addPoolHeroAbilities(sets, ['legioncommander'], lookup)
    expect(added.sort()).toEqual(['legion_commander_duel', 'legion_commander_press_the_attack'])
    expect(sets.standard.has('legion_commander_press_the_attack')).toBe(true)
    expect(sets.ultimates.has('legion_commander_duel')).toBe(true)
    expect(sets.standard.has('legion_commander_duel')).toBe(false)
  })

  it('reports nothing new for a hero already covered, and skips unknown heroes', () => {
    const sets = { standard: new Set<string>(), ultimates: new Set<string>() }
    addPoolHeroAbilities(sets, ['venomancer'], lookup)
    expect(addPoolHeroAbilities(sets, ['venomancer', 'nonexistent'], lookup)).toEqual([])
    expect(sets.standard.size).toBe(2)
    expect(sets.ultimates.size).toBe(1)
  })
})

function pick(x: number, row: number, name: string | null, confidence: number): ScanResult {
  return {
    name,
    confidence,
    hero_order: row,
    ability_order: 1,
    is_ultimate: false,
    coord: { x, y: row * 100, width: 87, height: 87, hero_order: row },
  }
}

describe('dedupeSelectedNames', () => {
  it('keeps one box per ability across players: the higher-confidence read', () => {
    // 2026-10-24: Overwhelming Odds read on both row 1 and row 2
    const out = dedupeSelectedNames([
      pick(0, 1, 'legion_commander_overwhelming_odds', 0.62),
      pick(0, 2, 'legion_commander_overwhelming_odds', 0.91),
      pick(1, 2, 'riki_blink_strike', 0.95),
    ])
    expect(out.map((s) => s.name)).toEqual([
      null,
      'legion_commander_overwhelming_odds',
      'riki_blink_strike',
    ])
    expect(out[0].confidence).toBe(0)
  })

  it('keeps one box per ability on the same card, earlier slot on a tie', () => {
    const out = dedupeSelectedNames([
      pick(0, 4, 'venomancer_venomous_gale', 0.8),
      pick(1, 4, 'venomancer_venomous_gale', 0.8),
    ])
    expect(out.map((s) => s.name)).toEqual(['venomancer_venomous_gale', null])
  })

  it('leaves distinct names and empty boxes untouched', () => {
    const slots = [
      pick(0, 0, 'weaver_shukuchi', 0.9),
      pick(1, 0, null, 0),
      pick(2, 0, 'pudge_flesh_heap', 0.7),
    ]
    expect(dedupeSelectedNames(slots)).toEqual(slots)
  })
})
