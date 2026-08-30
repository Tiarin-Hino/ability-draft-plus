import { describe, it, expect } from 'vitest'
import {
  parseAbilityTagsDataset,
  parseHeroMeta,
  isInertOnModel,
  TAG_VOCABULARY,
  type AbilityTag,
} from '@core/domain/ability-tags'

describe('parseAbilityTagsDataset', () => {
  it('parses a valid dataset into tag sets', () => {
    const parsed = parseAbilityTagsDataset({
      version: 1,
      abilities: {
        sven_great_cleave: { tags: ['farm_tool', 'steroid', 'melee_only', 'aoe'] },
        chaos_knight_chaos_bolt: { tags: ['hard_cc'] },
        empty_one: { tags: [] },
      },
    })!

    expect(parsed.tagsByAbility.size).toBe(3)
    expect(parsed.tagsByAbility.get('sven_great_cleave')!.has('melee_only')).toBe(true)
    expect(parsed.tagsByAbility.get('empty_one')!.size).toBe(0)
    expect(parsed.droppedTags).toEqual([])
  })

  it('drops unknown tags instead of failing (newer dataset, older app)', () => {
    const parsed = parseAbilityTagsDataset({
      abilities: { x: { tags: ['hard_cc', 'brand_new_tag'] } },
    })!

    expect([...parsed.tagsByAbility.get('x')!]).toEqual(['hard_cc'])
    expect(parsed.droppedTags).toEqual(['brand_new_tag'])
  })

  it('returns null for structurally invalid input', () => {
    expect(parseAbilityTagsDataset(null)).toBeNull()
    expect(parseAbilityTagsDataset('nope')).toBeNull()
    expect(parseAbilityTagsDataset({})).toBeNull()
  })

  it('parses requires dependency gates; junk dropped, empty omitted', () => {
    const parsed = parseAbilityTagsDataset({
      abilities: {
        luna_eclipse: { tags: [], requires: ['luna_lucent_beam'] },
        nevermore_requiem: { tags: [], requires: ['model:nevermore'] },
        junk: { tags: [], requires: [42, '', 'ok_one', 'ok_one'] },
        none: { tags: [] },
        empty: { tags: [], requires: [] },
      },
    })!

    expect(parsed.requiresByAbility.get('luna_eclipse')).toEqual(['luna_lucent_beam'])
    expect(parsed.requiresByAbility.get('nevermore_requiem')).toEqual(['model:nevermore'])
    expect(parsed.requiresByAbility.get('junk')).toEqual(['ok_one'])
    expect(parsed.requiresByAbility.has('none')).toBe(false)
    expect(parsed.requiresByAbility.has('empty')).toBe(false)
  })

  it('parses curated roleMust positions; invalid values dropped, empty omitted', () => {
    const parsed = parseAbilityTagsDataset({
      abilities: {
        disruptor_glimpse: { tags: ['initiation', 'setup_cc'], roleMust: [4, 5] },
        junk_positions: { tags: [], roleMust: [0, 6, 2.5, 'five', 3] },
        all_junk: { tags: [], roleMust: [99] },
        no_role_must: { tags: ['nuke'] },
      },
    })!

    expect([...parsed.roleMustByAbility.get('disruptor_glimpse')!]).toEqual([4, 5])
    expect([...parsed.roleMustByAbility.get('junk_positions')!]).toEqual([3])
    expect(parsed.roleMustByAbility.has('all_junk')).toBe(false)
    expect(parsed.roleMustByAbility.has('no_role_must')).toBe(false)
  })

  it('vocabulary matches the build script contract (21 tags)', () => {
    expect(TAG_VOCABULARY).toHaveLength(21)
    expect(new Set(TAG_VOCABULARY).size).toBe(21)
  })
})

describe('parseHeroMeta', () => {
  it('parses attributes; junk fields become undefined, never fatal', () => {
    const meta = parseHeroMeta({
      lina: {
        attackType: 'Ranged', primaryAttr: 'int',
        baseStr: 18, baseAgi: 23, baseInt: 25,
        strGain: 2.2, agiGain: 2.3, intGain: 3.7,
        attackRange: 670, attackRate: 1.6, moveSpeed: 300,
        baseArmor: 1, baseHealth: 120, baseMana: 75,
      },
      sven: { attackType: 'Melee' },
      broken: { attackType: 42, strGain: 'lots' },
    })!

    expect(meta.get('lina')!.attackType).toBe('Ranged')
    expect(meta.get('lina')!.intGain).toBe(3.7)
    expect(meta.get('lina')!.attackRange).toBe(670)
    expect(meta.get('lina')!.attackRate).toBe(1.6)
    expect(meta.get('lina')!.moveSpeed).toBe(300)
    expect(meta.get('sven')!.attackRange).toBeUndefined()
    expect(meta.get('sven')!.attackType).toBe('Melee')
    expect(meta.get('sven')!.strGain).toBeUndefined()
    expect(meta.get('broken')!.attackType).toBeUndefined()
    expect(meta.get('broken')!.strGain).toBeUndefined()
  })

  it('returns null for invalid input', () => {
    expect(parseHeroMeta(null)).toBeNull()
  })
})

describe('isInertOnModel', () => {
  const tags = (...t: AbilityTag[]) => new Set<AbilityTag>(t)

  it('flags melee-only abilities on ranged models and vice versa', () => {
    expect(isInertOnModel(tags('melee_only', 'steroid'), 'Ranged')).toBe(true)
    expect(isInertOnModel(tags('melee_only'), 'Melee')).toBe(false)
    expect(isInertOnModel(tags('ranged_only'), 'Melee')).toBe(true)
    expect(isInertOnModel(tags('ranged_only'), 'Ranged')).toBe(false)
  })

  it('never flags without tags or without a known attack type', () => {
    expect(isInertOnModel(undefined, 'Ranged')).toBe(false)
    expect(isInertOnModel(tags('melee_only'), undefined)).toBe(false)
    expect(isInertOnModel(tags('nuke'), 'Ranged')).toBe(false)
  })

  it('the candidate is never inert on its own native model (Wukong on MK)', () => {
    expect(isInertOnModel(tags('ranged_only'), 'Melee', { nativeToModel: true })).toBe(false)
    expect(isInertOnModel(tags('melee_only'), 'Ranged', { nativeToModel: true })).toBe(false)
    expect(isInertOnModel(tags('ranged_only'), 'Melee', { nativeToModel: false })).toBe(true)
  })

  it('a drafted grants_ranged pick waives ranged_only on melee, not melee_only on ranged', () => {
    expect(isInertOnModel(tags('ranged_only'), 'Melee', { picksGrantRanged: true })).toBe(false)
    expect(isInertOnModel(tags('ranged_only'), 'Melee', { picksGrantRanged: false })).toBe(true)
    // nothing grants melee — the melee_only filter has no symmetric waiver
    expect(isInertOnModel(tags('melee_only'), 'Ranged', { picksGrantRanged: true })).toBe(true)
  })
})
