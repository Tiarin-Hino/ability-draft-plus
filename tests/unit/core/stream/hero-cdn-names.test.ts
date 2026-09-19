import { describe, it, expect } from 'vitest'
import {
  deriveHeroCdnName,
  heroCdnNameFromDisplayName,
} from '@core/stream/hero-cdn-names'

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

  // Ability Draft leaves a hero short when some of its abilities are excluded from
  // the pool, and fills the gap with randomised abilities from other heroes. All
  // four rows below are REAL, captured from live drafts on 2026-09-04.
  it('survives a foreign filler ability in the row', () => {
    // Outworld Destroyer: Batrider's Firefly filled the missing fourth slot
    expect(
      deriveHeroCdnName([
        'obsidian_destroyer_sanity_eclipse',
        'obsidian_destroyer_arcane_orb',
        'obsidian_destroyer_astral_imprisonment',
        'batrider_firefly',
      ]),
    ).toBe('obsidian_destroyer')
  })

  it('survives a foreign ULTIMATE (Rubick’s is never in the pool)', () => {
    expect(
      deriveHeroCdnName([
        'grimstroke_soul_chain',
        'rubick_telekinesis',
        'rubick_fade_bolt',
        'rubick_arcane_supremacy',
      ]),
    ).toBe('rubick')
  })

  it('is not fooled by a sub-group larger than the hero prefix', () => {
    // Three of Void's four abilities share "faceless_void_time"
    expect(
      deriveHeroCdnName([
        'faceless_void_chronosphere',
        'faceless_void_time_walk',
        'faceless_void_time_dilation',
        'faceless_void_time_lock',
      ]),
    ).toBe('faceless_void')
  })

  it('refuses when two unrelated prefixes tie', () => {
    // A hero down to two pool abilities whose fillers both came from one hero:
    // nothing here identifies the row, so the caller falls back to the display name.
    expect(
      deriveHeroCdnName([
        'lion_impale',
        'lion_finger_of_death',
        'axe_berserkers_call',
        'axe_culling_blade',
      ]),
    ).toBeNull()
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

  it('collapses the beastmaster_summon over-extended prefix', () => {
    expect(
      deriveHeroCdnName([
        'beastmaster_summon_raptor',
        'beastmaster_summon_razorback',
      ]),
    ).toBe('beastmaster')
  })
})

describe('heroCdnNameFromDisplayName', () => {
  it('slugs simple display names', () => {
    expect(heroCdnNameFromDisplayName('Crystal Maiden')).toBe('crystal_maiden')
    expect(heroCdnNameFromDisplayName('Invoker')).toBe('invoker')
    expect(heroCdnNameFromDisplayName('Rubick')).toBe('rubick')
  })

  it('maps npc-divergent display names to the CDN name', () => {
    expect(heroCdnNameFromDisplayName('Outworld Destroyer')).toBe('obsidian_destroyer')
    // Our hero data still uses the pre-rename name — this is the slug that
    // actually reaches the fallback, and missing it produced a 404 portrait
    // and "Dota data not available" in the extension (2026-09-04).
    expect(heroCdnNameFromDisplayName('Outworld Devourer')).toBe('obsidian_destroyer')
    expect(heroCdnNameFromDisplayName("Nature's Prophet")).toBe('furion')
    expect(heroCdnNameFromDisplayName('Shadow Fiend')).toBe('nevermore')
    expect(heroCdnNameFromDisplayName('Windranger')).toBe('windrunner')
    expect(heroCdnNameFromDisplayName('Zeus')).toBe('zuus')
    expect(heroCdnNameFromDisplayName('Io')).toBe('wisp')
    expect(heroCdnNameFromDisplayName('Wraith King')).toBe('skeleton_king')
  })
})
