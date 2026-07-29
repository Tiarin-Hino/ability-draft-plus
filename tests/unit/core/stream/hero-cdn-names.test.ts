import { describe, it, expect } from 'vitest'
import { deriveHeroCdnName } from '@core/stream/hero-cdn-names'

describe('deriveHeroCdnName', () => {
  it('derives a single-word hero name', () => {
    expect(
      deriveHeroCdnName([
        'abaddon_death_coil',
        'abaddon_aphotic_shield',
        'abaddon_frostmourne',
        'abaddon_borrowed_time',
      ]),
    ).toBe('abaddon')
  })

  it('derives a multi-word hero name', () => {
    expect(
      deriveHeroCdnName([
        'drow_ranger_frost_arrows',
        'drow_ranger_wave_of_silence',
        'drow_ranger_multishot',
        'drow_ranger_marksmanship',
      ]),
    ).toBe('drow_ranger')
  })

  it('derives a long multi-word hero name', () => {
    expect(
      deriveHeroCdnName([
        'keeper_of_the_light_illuminate',
        'keeper_of_the_light_spirit_form',
      ]),
    ).toBe('keeper_of_the_light')
  })

  it('trims mid-word common prefixes back to the hero name', () => {
    // Both abilities start with "l" after the hero prefix
    expect(
      deriveHeroCdnName(['lina_laguna_blade', 'lina_light_strike_array']),
    ).toBe('lina')
  })

  it('handles legacy valve names that differ from display names', () => {
    expect(deriveHeroCdnName(['wisp_tether', 'wisp_spirits'])).toBe('wisp')
    expect(deriveHeroCdnName(['zuus_arc_lightning', 'zuus_thundergods_wrath'])).toBe('zuus')
    expect(
      deriveHeroCdnName(['skeleton_king_hellfire_blast', 'skeleton_king_reincarnation']),
    ).toBe('skeleton_king')
  })

  it('applies overrides where ability prefix differs from the npc name', () => {
    expect(
      deriveHeroCdnName(['sandking_burrowstrike', 'sandking_epicenter']),
    ).toBe('sand_king')
  })

  it('ignores null entries from unrecognized slots', () => {
    expect(
      deriveHeroCdnName([null, 'pudge_meat_hook', 'pudge_rot', null]),
    ).toBe('pudge')
  })

  it('returns null with fewer than two recognized names', () => {
    expect(deriveHeroCdnName([])).toBeNull()
    expect(deriveHeroCdnName([null, null])).toBeNull()
    expect(deriveHeroCdnName(['pudge_meat_hook', null])).toBeNull()
  })

  it('returns null when names share no common prefix', () => {
    expect(
      deriveHeroCdnName(['pudge_meat_hook', 'lina_laguna_blade']),
    ).toBeNull()
  })
})
