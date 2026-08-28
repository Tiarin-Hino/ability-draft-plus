import { describe, it, expect } from 'vitest'
import {
  resolveRoleContext,
  computeRoleScore,
  toRoleContextDisplay,
  POSITION_TEMPLATES,
  type RoleContext,
  type DraftPosition,
} from '@core/domain/role-scoring'
import type { ShiftAxes } from '@core/domain/shift-axes'
import type { ScanResult } from '@shared/types'
import {
  ROLE_ADJUSTMENT_CAP,
  ROLE_GREED_WEIGHT,
} from '@shared/constants/thresholds'

function pick(name: string, heroOrder: number, abilityOrder = 0): ScanResult {
  return {
    name,
    confidence: 0.95,
    hero_order: heroOrder,
    ability_order: abilityOrder,
    is_ultimate: false,
    coord: {
      x: heroOrder * 100 + abilityOrder * 10,
      y: 0,
      width: 64,
      height: 64,
      hero_order: heroOrder,
      ability_order: abilityOrder,
    },
  }
}

function axes(greed: number, partial: Partial<ShiftAxes> = {}): ShiftAxes {
  return { greed, killtaking: 0, playmaking: 0, enabling: 0, ...partial }
}

/** Two named picks for a player, both with the given greed. */
function twoPicks(
  heroOrder: number,
  greed: number,
  axesByName: Map<string, ShiftAxes>,
): ScanResult[] {
  const a = `p${heroOrder}_a`
  const b = `p${heroOrder}_b`
  axesByName.set(a, axes(greed))
  axesByName.set(b, axes(greed))
  return [pick(a, heroOrder, 0), pick(b, heroOrder, 1)]
}

const FIXED_5 = { roleMode: 'fixed' as const, roleFixedPositions: [5] }
const DYNAMIC = { roleMode: 'dynamic' as const, roleFixedPositions: [] }

describe('resolveRoleContext', () => {
  it('returns null for mode off, unknown modes, fixed-without-selection, and unknown spot', () => {
    const empty = new Map<string, ShiftAxes>()
    expect(
      resolveRoleContext({ roleMode: 'off', roleFixedPositions: [5] }, [], 0, empty),
    ).toBeNull()
    expect(
      resolveRoleContext(
        { roleMode: 'nonsense' as unknown as 'off', roleFixedPositions: [] },
        [],
        0,
        empty,
      ),
    ).toBeNull()
    expect(
      resolveRoleContext({ roleMode: 'fixed', roleFixedPositions: [] }, [], 0, empty),
    ).toBeNull()
    // Dynamic needs the spot (its job is reading MY team); fixed does not
    expect(resolveRoleContext(DYNAMIC, [], null, empty)).toBeNull()
  })

  it('fixed mode works without a spot: positions active, auxiliaries empty', () => {
    const ctx = resolveRoleContext(FIXED_5, [], null, new Map())!

    expect(ctx.mode).toBe('fixed')
    expect(ctx.effectivePositions).toEqual([5])
    expect(ctx.teammates).toEqual([])
    expect(ctx.teamGreed).toBeNull()
    expect(ctx.estimatedPositions.size).toBe(0)
  })

  it('teammates are the same screen half, excluding me', () => {
    const empty = new Map<string, ShiftAxes>()
    const left = resolveRoleContext(FIXED_5, [], 2, empty)!
    expect(left.teammates.map((t) => t.heroOrder)).toEqual([0, 1, 3, 4])
    const right = resolveRoleContext(FIXED_5, [], 7, empty)!
    expect(right.teammates.map((t) => t.heroOrder)).toEqual([5, 6, 8, 9])
  })

  it('summarizes pick counts, build greed, and team greed', () => {
    const axesByName = new Map<string, ShiftAxes>([
      ['a', axes(0.8)],
      ['b', axes(0.4)],
      ['c', axes(-0.6)],
    ])
    const selected = [pick('a', 1, 0), pick('b', 1, 1), pick('c', 2, 0)]
    const ctx = resolveRoleContext(FIXED_5, selected, 0, axesByName)!

    const t1 = ctx.teammates.find((t) => t.heroOrder === 1)!
    expect(t1.pickCount).toBe(2)
    expect(t1.buildGreed).toBeCloseTo(0.6)
    const t2 = ctx.teammates.find((t) => t.heroOrder === 2)!
    expect(t2.buildGreed).toBeCloseTo(-0.6)
    const t3 = ctx.teammates.find((t) => t.heroOrder === 3)!
    expect(t3.pickCount).toBe(0)
    expect(t3.buildGreed).toBeNull()
    // teamGreed = mean over teammates WITH greed: (0.6 + -0.6) / 2
    expect(ctx.teamGreed).toBeCloseTo(0)
  })

  it('fixed mode: effective positions are the selection; teammates rank-match onto the rest', () => {
    const axesByName = new Map<string, ShiftAxes>()
    const selected = [
      ...twoPicks(1, 0.8, axesByName),
      ...twoPicks(2, 0.3, axesByName),
      ...twoPicks(3, -0.2, axesByName),
      ...twoPicks(4, -0.7, axesByName),
    ]
    const ctx = resolveRoleContext(FIXED_5, selected, 0, axesByName)!

    expect(ctx.mode).toBe('fixed')
    expect(ctx.effectivePositions).toEqual([5])
    // My reserved position is 5 → teammates spread over 1-4 by greed rank
    expect(ctx.estimatedPositions.get(1)).toBe(1)
    expect(ctx.estimatedPositions.get(2)).toBe(2)
    expect(ctx.estimatedPositions.get(3)).toBe(3)
    expect(ctx.estimatedPositions.get(4)).toBe(4)
  })

  it('fixed multi-select reserves the position closest to my own build greed', () => {
    const axesByName = new Map<string, ShiftAxes>()
    const myPicks = twoPicks(0, -0.7, axesByName) // I trend hard support
    const mate = twoPicks(1, -0.5, axesByName)
    const ctx = resolveRoleContext(
      { roleMode: 'fixed', roleFixedPositions: [4, 5] },
      [...myPicks, ...mate],
      0,
      axesByName,
    )!

    expect(ctx.effectivePositions).toEqual([4, 5])
    // Reserved = 5 (closest to my greed −0.7), so the −0.5 teammate lands on 4
    expect(ctx.estimatedPositions.get(1)).toBe(4)
  })

  it('dynamic mode: gate closed below the evidence floor', () => {
    const axesByName = new Map<string, ShiftAxes>()
    // Only ONE teammate has >= 2 picks
    const selected = [
      ...twoPicks(1, 0.6, axesByName),
      pick('solo', 2, 0),
    ]
    axesByName.set('solo', axes(0.2))
    const ctx = resolveRoleContext(DYNAMIC, selected, 0, axesByName)!

    expect(ctx.mode).toBe('dynamic')
    expect(ctx.dynamicGateOpen).toBe(false)
    expect(ctx.effectivePositions).toEqual([])
  })

  it('dynamic mode: open gate recommends the vacant positions and narrows with evidence', () => {
    const axesByName = new Map<string, ShiftAxes>()
    const twoConfident = [
      ...twoPicks(1, 0.75, axesByName),
      ...twoPicks(2, 0.35, axesByName),
    ]
    const ctx2 = resolveRoleContext(DYNAMIC, twoConfident, 0, axesByName)!
    expect(ctx2.dynamicGateOpen).toBe(true)
    expect(ctx2.estimatedPositions.get(1)).toBe(1)
    expect(ctx2.estimatedPositions.get(2)).toBe(2)
    expect(ctx2.effectivePositions).toEqual([3, 4, 5])

    const fourConfident = [
      ...twoConfident,
      ...twoPicks(3, -0.3, axesByName),
      ...twoPicks(4, -0.65, axesByName),
    ]
    const ctx4 = resolveRoleContext(DYNAMIC, fourConfident, 0, axesByName)!
    // Minimal-cost rank-match puts the two support builds on 4 and 5 → only 3 vacant
    expect(ctx4.estimatedPositions.get(3)).toBe(4)
    expect(ctx4.estimatedPositions.get(4)).toBe(5)
    expect(ctx4.effectivePositions).toEqual([3])
  })
})

describe('computeRoleScore', () => {
  const ctxFixed5: RoleContext = {
    mode: 'fixed',
    effectivePositions: [5],
    teamGreed: null,
    teammates: [],
    estimatedPositions: new Map(),
  }

  it('returns null without a context or with an empty effective set (gate closed)', () => {
    expect(computeRoleScore(axes(0.5), null)).toBeNull()
    expect(
      computeRoleScore(axes(0.5), { ...ctxFixed5, effectivePositions: [] }),
    ).toBeNull()
  })

  it('for pos 5, a support-shifted ability outranks a greedy one', () => {
    const support = computeRoleScore(axes(-0.7), ctxFixed5)!
    const greedy = computeRoleScore(axes(0.9), ctxFixed5)!
    expect(support.delta).toBeGreaterThan(greedy.delta)
    expect(greedy.delta).toBeLessThan(0)
    expect(support.bestPosition).toBe(5)
  })

  it('missing axes score as neutral greed (identical delta for all such abilities)', () => {
    const a = computeRoleScore(undefined, ctxFixed5)!
    const b = computeRoleScore(undefined, ctxFixed5)!
    expect(a.delta).toBe(b.delta)
    expect(a.delta).toBeCloseTo(
      ROLE_GREED_WEIGHT * (1 - Math.abs(0 - POSITION_TEMPLATES[5].greedTarget)),
    )
  })

  it('multi-position sets score against the best-fitting position', () => {
    const ctx45: RoleContext = { ...ctxFixed5, effectivePositions: [4, 5] }
    const midGreed = computeRoleScore(axes(0), ctx45)!
    expect(midGreed.bestPosition).toBe(4) // |0-(-0.35)| < |0-(-0.6)|
  })

  it('team balance devalues greedy picks on a greedy team and boosts support picks', () => {
    const greedyTeam: RoleContext = { ...ctxFixed5, teamGreed: 0.8 }
    const neutralTeam = ctxFixed5

    const greedyOnGreedyTeam = computeRoleScore(axes(0.9), greedyTeam)!
    const greedyOnNeutral = computeRoleScore(axes(0.9), neutralTeam)!
    expect(greedyOnGreedyTeam.delta).toBeLessThan(greedyOnNeutral.delta)

    const supportOnGreedyTeam = computeRoleScore(axes(-0.7), greedyTeam)!
    const supportOnNeutral = computeRoleScore(axes(-0.7), neutralTeam)!
    expect(supportOnGreedyTeam.delta).toBeGreaterThan(supportOnNeutral.delta)
  })

  it('the enabling accent only counts in the top band of the healing axis', () => {
    const noAccent = computeRoleScore(axes(-0.6, { enabling: 0.6 }), ctxFixed5)!
    const withAccent = computeRoleScore(axes(-0.6, { enabling: 0.8 }), ctxFixed5)!
    expect(withAccent.delta).toBeGreaterThan(noAccent.delta)
    const baseline = computeRoleScore(axes(-0.6, { enabling: 0 }), ctxFixed5)!
    expect(noAccent.delta).toBe(baseline.delta)
  })

  it('delta never exceeds the cap at axis extremes', () => {
    for (const greed of [-1, 1]) {
      for (const teamGreed of [-1, 0, 1]) {
        for (const positions of [[1], [5], [1, 2, 3, 4, 5]] as DraftPosition[][]) {
          const ctx: RoleContext = {
            ...ctxFixed5,
            effectivePositions: positions,
            teamGreed,
          }
          const score = computeRoleScore(
            axes(greed, { killtaking: 1, playmaking: 1, enabling: 1 }),
            ctx,
          )!
          expect(Math.abs(score.delta)).toBeLessThanOrEqual(ROLE_ADJUSTMENT_CAP)
        }
      }
    }
  })
})

describe('toRoleContextDisplay', () => {
  it('flattens estimates and reports pick-based confidence', () => {
    const ctx: RoleContext = {
      mode: 'dynamic',
      effectivePositions: [3],
      teamGreed: 0.1,
      teammates: [
        { heroOrder: 1, pickCount: 3, buildGreed: 0.5 },
        { heroOrder: 2, pickCount: 0, buildGreed: null },
      ],
      estimatedPositions: new Map([[1, 2 as DraftPosition]]),
      dynamicGateOpen: true,
    }
    const display = toRoleContextDisplay(ctx)

    expect(display.mode).toBe('dynamic')
    expect(display.effectivePositions).toEqual([3])
    expect(display.dynamicGateOpen).toBe(true)
    expect(display.teammates).toEqual([
      { heroOrder: 1, estimatedPosition: 2, confidence: 0.75 },
      { heroOrder: 2, estimatedPosition: null, confidence: 0 },
    ])
  })
})

describe('computeRoleScore with tags (needs engine)', () => {
  const tags = (...t: string[]) => new Set(t) as ReadonlySet<import('@core/domain/ability-tags').AbilityTag>
  const ctxPos5: RoleContext = {
    mode: 'fixed',
    effectivePositions: [5],
    teamGreed: null,
    teammates: [],
    estimatedPositions: new Map(),
  }

  it('boosts a candidate covering an unmet need, with a covers chip', () => {
    const without = computeRoleScore(axes(-0.3), ctxPos5)!
    const covering = computeRoleScore(axes(-0.3), ctxPos5, {
      candidateTags: tags('waveclear'),
      myPickTags: [tags('hard_cc'), tags('save_ally')],
    })!

    expect(covering.delta).toBeGreaterThan(without.delta)
    expect(covering.reasons).toContain('covers:waveclear')
  })

  it('damps a candidate that only duplicates a twice-covered need (third stun)', () => {
    const thirdStun = computeRoleScore(axes(-0.3), ctxPos5, {
      candidateTags: tags('hard_cc'),
      myPickTags: [tags('hard_cc'), tags('hard_cc')],
    })!
    const neutral = computeRoleScore(axes(-0.3), ctxPos5, {
      candidateTags: tags(),
      myPickTags: [tags('hard_cc'), tags('hard_cc')],
    })!

    expect(thirdStun.delta).toBeLessThan(neutral.delta)
    expect(thirdStun.reasons).toEqual(['duplicate:hard_cc'])
  })

  it('a duplicate that ALSO covers an unmet need is not damped', () => {
    // Third stun, but it is a nuke too and waveclear|nuke is unmet
    const stunNuke = computeRoleScore(axes(-0.3), ctxPos5, {
      candidateTags: tags('hard_cc', 'nuke'),
      myPickTags: [tags('hard_cc'), tags('hard_cc')],
    })!

    expect(stunNuke.reasons).toEqual(['covers:waveclear'])
    expect(stunNuke.delta).toBeGreaterThan(0)
  })

  it('AND requirements: pos-3 aoe_cc needs hard_cc AND aoe on one ability', () => {
    const ctxPos3: RoleContext = { ...ctxPos5, effectivePositions: [3] }
    const stStun = computeRoleScore(axes(0.1), ctxPos3, {
      candidateTags: tags('hard_cc'),
      myPickTags: [],
    })!
    const aoeStun = computeRoleScore(axes(0.1), ctxPos3, {
      candidateTags: tags('hard_cc', 'aoe'),
      myPickTags: [],
    })!

    expect(aoeStun.reasons).toContain('covers:aoe_cc')
    expect(stStun.reasons).not.toContain('covers:aoe_cc')
  })

  it('untagged candidates skip needs and accents entirely', () => {
    const bare = computeRoleScore(axes(-0.3), ctxPos5)!
    const untagged = computeRoleScore(axes(-0.3), ctxPos5, {
      candidateTags: undefined,
      myPickTags: [tags('hard_cc')],
    })!

    expect(untagged.delta).toBe(bare.delta)
    expect(untagged.reasons).toEqual([])
  })

  it('static accents: a steroid is damped for pos 5 beyond its greed', () => {
    const plain = computeRoleScore(axes(0.2), ctxPos5, {
      candidateTags: tags(),
      myPickTags: [],
    })!
    const steroid = computeRoleScore(axes(0.2), ctxPos5, {
      candidateTags: tags('steroid'),
      myPickTags: [tags('save_ally'), tags('hard_cc'), tags('waveclear')],
    })!

    expect(steroid.delta).toBeLessThan(plain.delta)
  })

  it('reasons follow the best-fitting position in a multi-set', () => {
    const ctx45: RoleContext = { ...ctxPos5, effectivePositions: [4, 5] }
    // Candidate is a save: only pos 5 has the save need; its coverage boost
    // should pull the best position to 5 and carry the pos-5 chip.
    const save = computeRoleScore(axes(-0.5), ctx45, {
      candidateTags: tags('save_ally'),
      myPickTags: [],
    })!

    expect(save.bestPosition).toBe(5)
    expect(save.reasons).toContain('covers:save')
  })
})
