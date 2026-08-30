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

  it('vocabulary matches the build script contract (20 tags)', () => {
    expect(TAG_VOCABULARY).toHaveLength(20)
    expect(new Set(TAG_VOCABULARY).size).toBe(20)
  })
})

describe('parseHeroMeta', () => {
  it('parses attributes; junk fields become undefined, never fatal', () => {
    const meta = parseHeroMeta({
      lina: {
        attackType: 'Ranged', primaryAttr: 'int',
        baseStr: 18, baseAgi: 23, baseInt: 25,
        strGain: 2.2, agiGain: 2.3, intGain: 3.7,
      },
      sven: { attackType: 'Melee' },
      broken: { attackType: 42, strGain: 'lots' },
    })!

    expect(meta.get('lina')!.attackType).toBe('Ranged')
    expect(meta.get('lina')!.intGain).toBe(3.7)
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
})
