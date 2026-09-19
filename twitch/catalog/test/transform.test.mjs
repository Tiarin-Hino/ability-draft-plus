import { describe, it, expect } from 'vitest'
import {
  attachAghs,
  buildAbilityEntry,
  buildCatalog,
  buildHeroes,
  buildWindrunAliases,
  cleanTalentName,
  normalizeDisplayName,
  resolveAbilityKey,
  sliceCatalog,
  stripHtml,
} from '../transform.mjs'

const abilities = {
  antimage_mana_break: {
    dname: 'Mana Break',
    behavior: 'Passive',
    dmg_type: 'Physical',
    bkbpierce: 'No',
    desc: 'Burns mana.<br>Second line.',
    cd: ['10', '8'],
    mc: '50',
    attrib: [
      { key: 'x', header: 'MANA BURNED:', value: ['25', '30'] },
      { key: 'y', header: 'JUNK:', value: '0', generated: true },
    ],
    lore: 'Some <b>lore</b>',
  },
  antimage_blink: { dname: 'Blink', behavior: ['Point Target'], desc: 'Blinks.' },
  antimage_counterspell: { dname: 'Counterspell', desc: 'Reflects.' },
  antimage_mana_void: { dname: 'Mana Void', desc: 'Boom.' },
  antimage_persectur: { dname: 'Persecutor', is_innate: true, desc: 'Slows.' },
  invoker_sun_strike: { dname: 'Sun Strike', desc: 'Strike.' },
  special_bonus_hp_regen_3: { dname: '+3 Health Regen' },
  special_bonus_unique_antimage: { dname: '+25% Blink Cast Range' },
  generic_hidden: {},
}

const heroAbilities = {
  npc_dota_hero_antimage: {
    abilities: [
      'antimage_mana_break',
      'antimage_blink',
      'antimage_counterspell',
      'generic_hidden',
      'antimage_persectur',
      'antimage_mana_void',
    ],
    talents: [
      { name: 'special_bonus_hp_regen_3', level: 1 },
      { name: 'special_bonus_unique_antimage', level: 1 },
      { name: 'special_bonus_missing_name', level: 4 },
    ],
  },
  npc_dota_hero_zuus: { abilities: [], talents: [] },
}

const heroes = {
  1: {
    id: 1,
    name: 'npc_dota_hero_antimage',
    localized_name: 'Anti-Mage',
    primary_attr: 'agi',
    attack_type: 'Melee',
    roles: ['Carry'],
    base_str: 21,
    base_agi: 24,
    base_int: 12,
    str_gain: 1.6,
    agi_gain: 2.8,
    int_gain: 1.8,
    base_health: 120,
    base_mana: 75,
    attack_range: 150,
    move_speed: 310,
  },
  22: { id: 22, name: 'npc_dota_hero_zuus', localized_name: 'Zeus', primary_attr: 'int', attack_type: 'Ranged', roles: [] },
}

const aghs = [
  {
    hero_name: 'npc_dota_hero_antimage',
    hero_id: 1,
    has_scepter: true,
    scepter_desc: 'Scepter text',
    scepter_skill_name: 'Blink',
    scepter_new_skill: false,
    has_shard: true,
    shard_desc: 'Shard text',
    shard_skill_name: 'Counterspell!',
    shard_new_skill: false,
  },
  {
    hero_name: 'npc_dota_hero_zuus',
    hero_id: 22,
    has_scepter: true,
    scepter_desc: 'Nimbus',
    scepter_skill_name: 'Nimbus',
    scepter_new_skill: true,
    has_shard: false,
    shard_desc: '',
    shard_skill_name: '',
    shard_new_skill: false,
  },
]

describe('helpers', () => {
  it('strips html, template tokens and normalizes names', () => {
    expect(stripHtml('a<br>b <b>c</b>&amp;')).toBe('a\nb c&')
    expect(cleanTalentName('+{s:bonus_damage} Meat Hook Damage')).toBe('+Meat Hook Damage')
    expect(cleanTalentName('+5 Armor')).toBe('+5 Armor')
    expect(normalizeDisplayName("Ice Blast!")).toBe('iceblast')
    expect(normalizeDisplayName('Counterspell!')).toBe('counterspell')
  })

  it('resolves ability keys: exact, _ad suffix, override, missing', () => {
    expect(resolveAbilityKey('antimage_blink', abilities)).toBe('antimage_blink')
    expect(resolveAbilityKey('invoker_sun_strike_ad', abilities)).toBe('invoker_sun_strike')
    expect(resolveAbilityKey('mystery', abilities, { mystery: 'antimage_blink' })).toBe('antimage_blink')
    expect(resolveAbilityKey('mystery', abilities)).toBeNull()
  })

  it('compresses ability entries and drops generated attributes', () => {
    const entry = buildAbilityEntry(abilities.antimage_mana_break)
    expect(entry).toEqual({
      n: 'Mana Break',
      d: 'Burns mana.\nSecond line.',
      b: ['Passive'],
      dt: 'Physical',
      bkb: false,
      cd: '10 / 8',
      mc: '50',
      at: [['MANA BURNED', '25 / 30']],
    })
    expect(buildAbilityEntry(abilities.antimage_mana_break, { includeLore: true }).lore).toBe('Some lore')
    expect(buildAbilityEntry(abilities.antimage_persectur).innate).toBe(true)
  })
})

describe('heroes + aghs', () => {
  it('builds heroes with innate, draftable abilities and talents', () => {
    const { heroes: out, report } = buildHeroes(heroAbilities, heroes, abilities)
    const am = out.antimage
    expect(am.n).toBe('Anti-Mage')
    expect(am.innate).toBe('antimage_persectur')
    expect(am.abilities).toEqual(['antimage_mana_break', 'antimage_blink', 'antimage_counterspell', 'antimage_mana_void'])
    expect(am.talents).toEqual([
      { l: 1, n: '+3 Health Regen', name: 'special_bonus_hp_regen_3' },
      { l: 1, n: '+25% Blink Cast Range', name: 'special_bonus_unique_antimage' },
      { l: 4, n: 'missing name', name: 'special_bonus_missing_name' },
    ])
    expect(am.stats.str).toBe(21)
    expect(report.talentsWithoutName).toEqual(['special_bonus_missing_name'])
  })

  it('attaches scepter/shard to the matching ability, hero-level for new skills', () => {
    const { heroes: out } = buildHeroes(heroAbilities, heroes, abilities)
    const abilitiesOut = {
      antimage_blink: buildAbilityEntry(abilities.antimage_blink),
      antimage_counterspell: buildAbilityEntry(abilities.antimage_counterspell),
    }
    const report = attachAghs(aghs, out, abilitiesOut, abilities)
    expect(abilitiesOut.antimage_blink.sc).toEqual({ d: 'Scepter text' })
    expect(abilitiesOut.antimage_counterspell.sh).toEqual({ d: 'Shard text' })
    expect(out.antimage.scepter).toEqual({ d: 'Scepter text', skill: 'antimage_blink', newSkill: false })
    expect(out.zuus.scepter).toEqual({ d: 'Nimbus', skill: null, newSkill: true })
    expect(out.zuus.shard).toBeNull()
    expect(report.attached).toBe(2)
    expect(report.unmatched).toEqual([])
  })

  it('maps Windrun hero names to CDN names with overrides', () => {
    const { aliases, unresolved } = buildWindrunAliases(
      ['antimage', 'zeus', 'drow_ranger', 'nobody'],
      ['antimage', 'zuus', 'drow_ranger'],
    )
    expect(aliases).toEqual({ antimage: 'antimage', zeus: 'zuus', drow_ranger: 'drow_ranger' })
    expect(unresolved).toEqual(['nobody'])
  })
})

describe('buildCatalog', () => {
  it('assembles the catalog and reports gaps', () => {
    const { catalog, report } = buildCatalog({
      classNames: ['antimage_blink', 'invoker_sun_strike_ad', 'unknown_ability'],
      windrunHeroNames: ['antimage', 'zeus'],
      abilities,
      heroAbilities,
      heroes,
      aghs,
      commit: 'abc',
      builtAt: '2026-09-02T00:00:00.000Z',
    })
    expect(catalog.schema).toBe(1)
    expect(catalog.abilities.invoker_sun_strike_ad.src).toBe('invoker_sun_strike')
    expect(catalog.abilities.antimage_persectur.innate).toBe(true)
    expect(catalog.abilities.antimage_blink.sc).toEqual({ d: 'Scepter text' })
    expect(catalog.aliases.windrunToCdn).toEqual({ antimage: 'antimage', zeus: 'zuus' })
    expect(report.missingAbilities).toEqual(['unknown_ability'])

    const demo = sliceCatalog(catalog, ['antimage'])
    expect(Object.keys(demo.heroes)).toEqual(['antimage'])
    expect(demo.abilities.antimage_persectur).toBeDefined()
    expect(demo.abilities.invoker_sun_strike_ad).toBeUndefined()
  })
})
