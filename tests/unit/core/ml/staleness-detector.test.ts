import { describe, it, expect } from 'vitest'
import { detectModelGaps, isPickableAbility } from '@core/ml/staleness-detector'

describe('isPickableAbility', () => {
  it('returns true for regular hero abilities', () => {
    expect(isPickableAbility('antimage_mana_break')).toBe(true)
    expect(isPickableAbility('invoker_cold_snap_ad')).toBe(true)
  })

  it('rejects ad_special_bonus_ prefix', () => {
    expect(isPickableAbility('ad_special_bonus_unique_luna_1')).toBe(false)
  })

  it('rejects special_bonus_ prefix', () => {
    expect(isPickableAbility('special_bonus_strength_8')).toBe(false)
    expect(isPickableAbility('special_bonus_unique_puck_3')).toBe(false)
  })

  it('rejects greevil_ prefix', () => {
    expect(isPickableAbility('greevil_miniboss_green_living_armor')).toBe(false)
    expect(isPickableAbility('greevil_miniboss_blue_cold_snap')).toBe(false)
  })

  it('rejects frostbitten_ prefix', () => {
    expect(isPickableAbility('frostbitten_golem_time_warp_aura')).toBe(false)
  })

  it('rejects known unpickable innate/shard abilities', () => {
    expect(isPickableAbility('jakiro_double_trouble')).toBe(false)
    expect(isPickableAbility('rubick_hidden1')).toBe(false)
    expect(isPickableAbility('slark_depth_shroud')).toBe(false)
    expect(isPickableAbility('tiny_insurmountable')).toBe(false)
    expect(isPickableAbility('razor_dynamo')).toBe(false)
  })
})

describe('detectModelGaps', () => {
  it('returns null when sets match exactly', () => {
    const result = detectModelGaps(
      ['antimage_blink', 'axe_culling_blade'],
      ['antimage_blink', 'axe_culling_blade'],
    )
    expect(result).toBeNull()
  })

  it('detects abilities missing from model', () => {
    const result = detectModelGaps(
      ['antimage_blink'],
      ['antimage_blink', 'new_hero_ability'],
    )
    expect(result).not.toBeNull()
    expect(result!.missingFromModel).toEqual(['new_hero_ability'])
    expect(result!.staleInModel).toEqual([])
  })

  it('detects stale abilities in model', () => {
    const result = detectModelGaps(
      ['antimage_blink', 'old_removed_ability'],
      ['antimage_blink'],
    )
    expect(result).not.toBeNull()
    expect(result!.missingFromModel).toEqual([])
    expect(result!.staleInModel).toEqual(['old_removed_ability'])
  })

  it('detects both gaps simultaneously', () => {
    const result = detectModelGaps(
      ['antimage_blink', 'old_ability'],
      ['antimage_blink', 'new_ability'],
    )
    expect(result).not.toBeNull()
    expect(result!.missingFromModel).toEqual(['new_ability'])
    expect(result!.staleInModel).toEqual(['old_ability'])
  })

  it('sorts output arrays alphabetically', () => {
    const result = detectModelGaps(
      ['z_ability', 'a_ability'],
      ['c_new', 'a_new'],
    )
    expect(result).not.toBeNull()
    expect(result!.missingFromModel).toEqual(['a_new', 'c_new'])
    expect(result!.staleInModel).toEqual(['a_ability', 'z_ability'])
  })

  it('handles empty classNames array', () => {
    const result = detectModelGaps([], ['antimage_blink'])
    expect(result).not.toBeNull()
    expect(result!.missingFromModel).toEqual(['antimage_blink'])
    expect(result!.staleInModel).toEqual([])
  })

  it('handles empty dbAbilityNames array', () => {
    const result = detectModelGaps(['antimage_blink'], [])
    expect(result).not.toBeNull()
    expect(result!.missingFromModel).toEqual([])
    expect(result!.staleInModel).toEqual(['antimage_blink'])
  })

  it('handles both empty arrays', () => {
    const result = detectModelGaps([], [])
    expect(result).toBeNull()
  })

  it('sets detectedAt to a valid ISO date string', () => {
    const result = detectModelGaps(['a_ability'], ['b_ability'])
    expect(result).not.toBeNull()
    expect(new Date(result!.detectedAt).toISOString()).toBe(result!.detectedAt)
  })

  // ── Prefix filtering ──────────────────────────────────────────────────

  it('filters ad_special_bonus_ from both sides', () => {
    const result = detectModelGaps(
      ['antimage_blink', 'ad_special_bonus_unique_luna_1'],
      ['antimage_blink', 'ad_special_bonus_unique_puck_2'],
    )
    expect(result).toBeNull()
  })

  it('filters special_bonus_ from both sides', () => {
    const result = detectModelGaps(
      ['antimage_blink', 'special_bonus_strength_8'],
      ['antimage_blink', 'special_bonus_unique_doom_1'],
    )
    expect(result).toBeNull()
  })

  it('filters greevil_ non-hero abilities', () => {
    const result = detectModelGaps(
      ['antimage_blink'],
      ['antimage_blink', 'greevil_miniboss_green_living_armor'],
    )
    expect(result).toBeNull()
  })

  it('filters multiple noise categories at once', () => {
    const result = detectModelGaps(
      ['antimage_blink'],
      [
        'antimage_blink',
        'ad_special_bonus_unique_luna_1',
        'special_bonus_strength_8',
        'greevil_miniboss_blue_cold_snap',
      ],
    )
    expect(result).toBeNull()
  })

  // ── unpickableAbilities parameter ──────────────────────────────────────

  it('filters abilities in the unpickableAbilities set', () => {
    const unpickable = new Set(['jakiro_double_trouble', 'antimage_perseverance'])
    const result = detectModelGaps(
      ['antimage_blink'],
      ['antimage_blink', 'jakiro_double_trouble', 'antimage_perseverance'],
      unpickable,
    )
    expect(result).toBeNull()
  })

  it('unpickableAbilities filters from both model and DB sides', () => {
    const unpickable = new Set(['jakiro_double_trouble'])
    const result = detectModelGaps(
      ['antimage_blink', 'jakiro_double_trouble'],
      ['antimage_blink'],
      unpickable,
    )
    expect(result).toBeNull()
  })

  it('combines prefix filters with unpickableAbilities', () => {
    const unpickable = new Set(['jakiro_double_trouble'])
    const result = detectModelGaps(
      ['antimage_blink'],
      [
        'antimage_blink',
        'jakiro_double_trouble',
        'special_bonus_strength_8',
        'greevil_miniboss_green_living_armor',
      ],
      unpickable,
    )
    expect(result).toBeNull()
  })

  it('still detects real gaps after filtering', () => {
    const unpickable = new Set(['jakiro_double_trouble'])
    const result = detectModelGaps(
      ['antimage_blink'],
      ['antimage_blink', 'jakiro_double_trouble', 'new_hero_real_ability'],
      unpickable,
    )
    expect(result).not.toBeNull()
    expect(result!.missingFromModel).toEqual(['new_hero_real_ability'])
    expect(result!.staleInModel).toEqual([])
  })
})
