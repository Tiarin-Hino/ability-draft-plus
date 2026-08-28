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

  it('vocabulary matches the build script contract (20 tags)', () => {
    expect(TAG_VOCABULARY).toHaveLength(20)
    expect(new Set(TAG_VOCABULARY).size).toBe(20)
  })
})

describe('parseHeroMeta', () => {
  it('parses attack types and skips junk entries', () => {
    const meta = parseHeroMeta({
      lina: { attackType: 'Ranged', primaryAttr: 'int' },
      sven: { attackType: 'Melee' },
      broken: { attackType: 42 },
    })!

    expect(meta.get('lina')).toBe('Ranged')
    expect(meta.get('sven')).toBe('Melee')
    expect(meta.has('broken')).toBe(false)
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
