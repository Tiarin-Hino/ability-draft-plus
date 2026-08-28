import { describe, it, expect } from 'vitest'
import { computeShiftAxes } from '@core/domain/shift-axes'
import type { AbilityShiftRow } from '@core/database/repositories/ability-repository'

function row(name: string, partial: Partial<Omit<AbilityShiftRow, 'name'>>): AbilityShiftRow {
  return {
    name,
    killsShift: null,
    deathsShift: null,
    kaShift: null,
    gpmShift: null,
    xpmShift: null,
    dmgShift: null,
    healingShift: null,
    ...partial,
  }
}

describe('computeShiftAxes', () => {
  it('ranks greed by gpm + 0.5*xpm and rescales to [-1, +1]', () => {
    // Combined greed inputs: cleave 0.76, stun -0.475, shrapnel 0.055
    const axes = computeShiftAxes([
      row('great_cleave', { gpmShift: 0.56, xpmShift: 0.4 }),
      row('chaos_bolt', { gpmShift: -0.37, xpmShift: -0.21 }),
      row('shrapnel', { gpmShift: 0.07, xpmShift: -0.03 }),
    ])

    expect(axes.get('great_cleave')!.greed).toBe(1)
    expect(axes.get('shrapnel')!.greed).toBe(0)
    expect(axes.get('chaos_bolt')!.greed).toBe(-1)
  })

  it('greed ordering can differ from raw gpm ordering via the xpm weight', () => {
    // a has higher gpm, but b's xpm advantage flips the combined ordering
    const axes = computeShiftAxes([
      row('a', { gpmShift: 0.30, xpmShift: 0.0 }),
      row('b', { gpmShift: 0.25, xpmShift: 0.2 }),
      row('c', { gpmShift: -0.5, xpmShift: -0.5 }),
    ])

    expect(axes.get('b')!.greed).toBeGreaterThan(axes.get('a')!.greed)
  })

  it('gives tied values their average rank (zero-inflated healing clusters mid-axis)', () => {
    const axes = computeShiftAxes([
      row('tether', { healingShift: 4.2 }),
      row('nuke_a', { healingShift: 0 }),
      row('nuke_b', { healingShift: 0 }),
      row('nuke_c', { healingShift: 0 }),
      row('lifedrain_negative', { healingShift: -0.1 }),
    ])

    expect(axes.get('tether')!.enabling).toBe(1)
    expect(axes.get('lifedrain_negative')!.enabling).toBe(-1)
    // The three zeros share positions 1..3 of 0..4 -> avg 2/4 = 0.5 -> axis 0
    expect(axes.get('nuke_a')!.enabling).toBe(0)
    expect(axes.get('nuke_b')!.enabling).toBe(0)
    expect(axes.get('nuke_c')!.enabling).toBe(0)
  })

  it('null inputs get neutral 0 on that axis without disturbing the others ranks', () => {
    const axes = computeShiftAxes([
      row('with_data', { gpmShift: 0.5, xpmShift: 0.2, killsShift: 0.3 }),
      row('no_greed', { killsShift: -0.3 }),
      row('with_data_2', { gpmShift: -0.4, xpmShift: -0.1 }),
    ])

    expect(axes.get('no_greed')!.greed).toBe(0)
    expect(axes.get('with_data')!.greed).toBe(1)
    expect(axes.get('with_data_2')!.greed).toBe(-1)
    // kills axis ranked over the two non-null entries only
    expect(axes.get('with_data')!.killtaking).toBe(1)
    expect(axes.get('no_greed')!.killtaking).toBe(-1)
  })

  it('greed needs BOTH gpm and xpm; a lone gpm value is treated as missing', () => {
    const axes = computeShiftAxes([
      row('gpm_only', { gpmShift: 0.9 }),
      row('full', { gpmShift: 0.1, xpmShift: 0.1 }),
      row('full_2', { gpmShift: -0.2, xpmShift: 0.0 }),
    ])

    expect(axes.get('gpm_only')!.greed).toBe(0)
    expect(axes.get('full')!.greed).toBe(1)
  })

  it('all-null rows get fully neutral axes', () => {
    const axes = computeShiftAxes([
      row('unknown', {}),
      row('known', { gpmShift: 0.2, xpmShift: 0.1, kaShift: 0.4, healingShift: 0.5, killsShift: 0.1 }),
    ])

    expect(axes.get('unknown')).toEqual({ greed: 0, killtaking: 0, playmaking: 0, enabling: 0 })
  })

  it('a single non-null entry ranks neutral (no ordering information)', () => {
    const axes = computeShiftAxes([row('only', { gpmShift: 0.9, xpmShift: 0.9 })])

    expect(axes.get('only')!.greed).toBe(0)
  })

  it('returns an empty map for empty input', () => {
    expect(computeShiftAxes([]).size).toBe(0)
  })

  it('playmaking ranks ka_shift independently of kills', () => {
    const axes = computeShiftAxes([
      row('playmaker', { killsShift: -0.3, kaShift: 0.6 }),
      row('killtaker', { killsShift: 0.5, kaShift: 0.1 }),
      row('afk', { killsShift: -0.5, kaShift: -0.5 }),
    ])

    expect(axes.get('playmaker')!.playmaking).toBe(1)
    expect(axes.get('playmaker')!.killtaking).toBe(0)
    expect(axes.get('killtaker')!.killtaking).toBe(1)
  })
})
