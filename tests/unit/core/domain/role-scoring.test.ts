import { describe, it, expect } from 'vitest'
import {
  resolveRoleContext,
  computeRoleScore,
  computeModelRoleScore,
  computeAbilityPairing,
  computeModelPairing,
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
  PAIRING_ADJUSTMENT_CAP,
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
    myPickCount: 0,
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
      myPickCount: 0,
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
    myPickCount: 0,
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

    expect(stunNuke.reasons).toEqual(['covers:waveclear:nuke'])
    expect(stunNuke.delta).toBeGreaterThan(0)
  })

  it('half-credit coverage (soft CC toward hard disable) emits a partial chip', () => {
    // Shadow Strike ruling: a soft_cc must not claim to cover hard disable
    const softCc = computeRoleScore(axes(-0.5), ctxPos5, {
      candidateTags: tags('soft_cc'),
      myPickTags: [],
    })!
    expect(softCc.reasons).toContain('partial:hard_cc')
    expect(softCc.reasons.some((r) => r.startsWith('covers:hard_cc'))).toBe(false)
  })

  it('the covers chip names the matched alternative when it differs from the key', () => {
    // Shadow Realm case: a pure nuke covering the wave need must not claim
    // the waveclear tag — the chip carries the via suffix instead.
    const nukeOnly = computeRoleScore(axes(-0.3), ctxPos5, {
      candidateTags: tags('nuke'),
      myPickTags: [],
    })!
    expect(nukeOnly.reasons).toContain('covers:waveclear:nuke')

    // A real waveclear matches the key itself — no via suffix
    const realWave = computeRoleScore(axes(-0.3), ctxPos5, {
      candidateTags: tags('waveclear'),
      myPickTags: [],
    })!
    expect(realWave.reasons).toContain('covers:waveclear')
    expect(realWave.reasons.some((r) => r.startsWith('covers:waveclear:'))).toBe(false)
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
    // save_ally is the matched alternative; the renderer collapses the via
    // suffix when its label equals the need's ("ally save")
    expect(save.reasons).toContain('covers:save:save_ally')
  })

  it('curated roleMust boosts the matching position and flags the score', () => {
    const must = new Set<DraftPosition>([5])
    const plain = computeRoleScore(axes(-0.3), ctxPos5, {
      candidateTags: tags(),
      myPickTags: [],
    })!
    const curated = computeRoleScore(axes(-0.3), ctxPos5, {
      candidateTags: tags(),
      candidateRoleMust: must,
      myPickTags: [],
    })!

    expect(curated.delta).toBeGreaterThan(plain.delta)
    expect(curated.curated).toBe(true)
    expect(curated.reasons).toContain('curated')
    expect(plain.curated).toBeUndefined()
  })

  it('curated roleMust is inert when it does not intersect the effective set', () => {
    const mustPos1 = new Set<DraftPosition>([1])
    const plain = computeRoleScore(axes(-0.3), ctxPos5, {
      candidateTags: tags(),
      myPickTags: [],
    })!
    const offRole = computeRoleScore(axes(-0.3), ctxPos5, {
      candidateTags: tags(),
      candidateRoleMust: mustPos1,
      myPickTags: [],
    })!

    expect(offRole.delta).toBe(plain.delta)
    expect(offRole.curated).toBeUndefined()
    expect(offRole.reasons).not.toContain('curated')
  })
})

describe('need priorities and pool scarcity', () => {
  const tags = (...t: string[]) => new Set(t) as ReadonlySet<import('@core/domain/ability-tags').AbilityTag>
  const ctxPos1: RoleContext = {
    mode: 'fixed',
    effectivePositions: [1],
    myPickCount: 0,
    teamGreed: null,
    teammates: [],
    estimatedPositions: new Map(),
  }

  it('covering a defining need beats covering an itemizable one (pos-1 steroid > survival)', () => {
    const steroid = computeRoleScore(axes(0.5), ctxPos1, {
      candidateTags: tags('steroid'),
      myPickTags: [],
    })!
    const mobility = computeRoleScore(axes(0.5), ctxPos1, {
      candidateTags: tags('mobility'),
      myPickTags: [],
    })!

    expect(steroid.delta).toBeGreaterThan(mobility.delta)
  })

  it('pos-5 priorities are hard_cc > save > waveclear (user-tuned order)', () => {
    const ctxPos5: RoleContext = { ...ctxPos1, effectivePositions: [5] }
    const stun = computeRoleScore(axes(-0.6), ctxPos5, {
      candidateTags: tags('hard_cc'),
      myPickTags: [],
    })!
    const save = computeRoleScore(axes(-0.6), ctxPos5, {
      candidateTags: tags('save_ally'),
      myPickTags: [],
    })!

    expect(stun.delta).toBeGreaterThan(save.delta)
  })

  it('scarcity multiplies the need boost', () => {
    const scarce = computeRoleScore(axes(0.5), ctxPos1, {
      candidateTags: tags('farm_tool'),
      myPickTags: [],
      needScarcity: new Map([['farm', 1.8]]),
    })!
    const abundant = computeRoleScore(axes(0.5), ctxPos1, {
      candidateTags: tags('farm_tool'),
      myPickTags: [],
      needScarcity: new Map([['farm', 0.6]]),
    })!

    expect(scarce.delta).toBeGreaterThan(abundant.delta)
  })
})

describe('computeModelRoleScore', () => {
  const ctx = (positions: DraftPosition[]): RoleContext => ({
    mode: 'fixed',
    effectivePositions: positions,
    myPickCount: 0,
    teamGreed: null,
    teammates: [],
    estimatedPositions: new Map(),
  })
  const pct = (partial: Partial<import('@core/domain/role-scoring').ModelStatPercentiles>) => ({
    strGain: 0.5, agiGain: 0.5, intGain: 0.5, totalGain: 0.5, intPool: 0.5,
    ...partial,
  })

  it('returns null when inactive', () => {
    expect(computeModelRoleScore(null, undefined, undefined, undefined, 0)).toBeNull()
    expect(
      computeModelRoleScore(ctx([]), undefined, pct({}), 'str', 0),
    ).toBeNull()
  })

  it('pos 1 prefers agi-gain scaling; pos 4 prefers int/mana models', () => {
    const carryStats = pct({ agiGain: 0.9, totalGain: 0.8 })
    const casterStats = pct({ intPool: 0.9, totalGain: 0.7 })

    const carryFor1 = computeModelRoleScore(ctx([1]), undefined, carryStats, 'agi', 0)!
    const casterFor1 = computeModelRoleScore(ctx([1]), undefined, casterStats, 'int', 0)!
    expect(carryFor1.delta).toBeGreaterThan(casterFor1.delta)

    const carryFor4 = computeModelRoleScore(ctx([4]), undefined, carryStats, 'agi', 0)!
    const casterFor4 = computeModelRoleScore(ctx([4]), undefined, casterStats, 'int', 0)!
    expect(casterFor4.delta).toBeGreaterThan(carryFor4.delta)
  })

  it('pos 3 credits STR primary attribute and str gain', () => {
    const strTank = pct({ strGain: 0.9 })
    const agiCarry = pct({ agiGain: 0.9 })
    const tankFor3 = computeModelRoleScore(ctx([3]), undefined, strTank, 'str', 0)!
    const carryFor3 = computeModelRoleScore(ctx([3]), undefined, agiCarry, 'agi', 0)!

    expect(tankFor3.delta).toBeGreaterThan(carryFor3.delta)
  })

  it('urgency adds a flat boost within the cap', () => {
    const base = computeModelRoleScore(ctx([1]), undefined, pct({}), 'agi', 0)!
    const urgent = computeModelRoleScore(ctx([1]), undefined, pct({}), 'agi', 0.09)!

    expect(urgent.delta).toBeCloseTo(base.delta + 0.09)
  })

  it('missing stat data scores as neutral fit, not an error', () => {
    const score = computeModelRoleScore(ctx([1, 4]), undefined, undefined, undefined, 0)!
    expect(Number.isFinite(score.delta)).toBe(true)
  })

  it('chassis percentiles matter: BAT for pos 1, bulk for pos 3, speed for pos 5', () => {
    const fastAttacker = computeModelRoleScore(
      ctx([1]), undefined, pct({ attackQuality: 0.95 }), 'agi', 0)!
    const slowAttacker = computeModelRoleScore(
      ctx([1]), undefined, pct({ attackQuality: 0.05 }), 'agi', 0)!
    expect(fastAttacker.delta).toBeGreaterThan(slowAttacker.delta)

    const bulky = computeModelRoleScore(ctx([3]), undefined, pct({ bulk: 0.95 }), 'str', 0)!
    const squishy = computeModelRoleScore(ctx([3]), undefined, pct({ bulk: 0.05 }), 'str', 0)!
    expect(bulky.delta).toBeGreaterThan(squishy.delta)

    const runner = computeModelRoleScore(ctx([5]), undefined, pct({ speed: 0.95 }), 'int', 0)!
    const slowpoke = computeModelRoleScore(ctx([5]), undefined, pct({ speed: 0.05 }), 'int', 0)!
    expect(runner.delta).toBeGreaterThan(slowpoke.delta)
  })

  it('absent chassis percentiles score as neutral (old hero_meta compatibility)', () => {
    const withNeutral = computeModelRoleScore(
      ctx([1]), undefined, pct({ attackQuality: 0.5, bulk: 0.5, speed: 0.5 }), 'agi', 0)!
    const withoutChassis = computeModelRoleScore(ctx([1]), undefined, pct({}), 'agi', 0)!
    expect(withoutChassis.delta).toBe(withNeutral.delta)
  })

  it('hero-tag accents: matching model tags lift the fitting position', () => {
    const heroTags = new Set<import('@core/domain/ability-tags').HeroTag>([
      'rc_talents',
      'innate_offense',
    ])
    const plain = computeModelRoleScore(ctx([1]), undefined, pct({}), 'agi', 0)!
    const tagged = computeModelRoleScore(ctx([1]), undefined, pct({}), 'agi', 0, heroTags)!
    expect(tagged.delta).toBeGreaterThan(plain.delta)

    // Pos-3 does not value rc tags — no accent there
    const plain3 = computeModelRoleScore(ctx([3]), undefined, pct({}), 'str', 0)!
    const tagged3 = computeModelRoleScore(ctx([3]), undefined, pct({}), 'str', 0, heroTags)!
    expect(tagged3.delta).toBe(plain3.delta)
  })

  it('model roleMust: boost + curated flag when an effective position matches', () => {
    const must = new Set<DraftPosition>([5])
    const plain = computeModelRoleScore(ctx([5]), undefined, pct({}), 'int', 0)!
    const curated = computeModelRoleScore(
      ctx([5]), undefined, pct({}), 'int', 0, undefined, must)!
    expect(curated.delta).toBeGreaterThan(plain.delta)
    expect(curated.curated).toBe(true)
    expect(curated.reasons).toContain('curated')

    const offRole = computeModelRoleScore(
      ctx([1]), undefined, pct({}), 'int', 0, undefined, must)!
    expect(offRole.curated).toBeUndefined()
  })
})

describe('ability x model pairing (Layer C)', () => {
  const tags = (...t: string[]) =>
    new Set(t) as ReadonlySet<import('@core/domain/ability-tags').AbilityTag>
  const heroTags = (...t: string[]) =>
    new Set(t) as ReadonlySet<import('@core/domain/ability-tags').HeroTag>
  const profile = (
    partial: Partial<import('@core/domain/role-scoring').PairingModelProfile>,
  ): import('@core/domain/role-scoring').PairingModelProfile => ({
    attackQuality: 0.5,
    bulk: 0.5,
    intPool: 0.5,
    tags: heroTags(),
    ...partial,
  })
  const pctFull = (partial: object) => ({
    strGain: 0.5, agiGain: 0.5, intGain: 0.5, totalGain: 0.5, intPool: 0.5,
    attackQuality: 0.5, bulk: 0.5, speed: 0.5,
    ...partial,
  })

  it('forward: steroids follow the model attack cadence, mana-hungry the pool', () => {
    expect(
      computeAbilityPairing(tags('steroid'), profile({ attackQuality: 0.95 })),
    ).toBeGreaterThan(0)
    expect(
      computeAbilityPairing(tags('steroid'), profile({ attackQuality: 0.05 })),
    ).toBeLessThan(0)
    expect(
      computeAbilityPairing(tags('mana_hungry'), profile({ intPool: 0.1 })),
    ).toBeLessThan(0)
    // rc-tagged model adds the flat bump on top of neutral cadence
    expect(
      computeAbilityPairing(tags('steroid'), profile({ tags: heroTags('rc_talents') })),
    ).toBeGreaterThan(computeAbilityPairing(tags('steroid'), profile({})))
  })

  it('forward: no-ops without a model or without candidate tags; capped', () => {
    expect(computeAbilityPairing(tags('steroid'), undefined)).toBe(0)
    expect(computeAbilityPairing(undefined, profile({}))).toBe(0)
    const extreme = computeAbilityPairing(
      tags('steroid', 'farm_tool', 'initiation', 'channeled', 'mana_hungry'),
      profile({ attackQuality: 1, bulk: 1, intPool: 1, tags: heroTags('rc_talents', 'innate_tank') }),
    )
    expect(extreme).toBeLessThanOrEqual(PAIRING_ADJUSTMENT_CAP)
  })

  it('reverse: two drafted right-click pieces make attack cadence matter', () => {
    const rcDraft = [tags('steroid'), tags('farm_tool')]
    const fast = computeModelPairing(rcDraft, pctFull({ attackQuality: 0.95 }), undefined)
    const slow = computeModelPairing(rcDraft, pctFull({ attackQuality: 0.05 }), undefined)
    expect(fast).toBeGreaterThan(0)
    expect(slow).toBeLessThan(0)
    // One steroid is not a commitment yet
    expect(
      computeModelPairing([tags('steroid')], pctFull({ attackQuality: 0.95 }), undefined),
    ).toBe(0)
  })

  it('reverse: no-ops with no picks or no percentiles', () => {
    expect(computeModelPairing([], pctFull({}), undefined)).toBe(0)
    expect(computeModelPairing([tags('steroid')], undefined, undefined)).toBe(0)
  })
})

describe('greed taper by pick index', () => {
  const ctxPos1AtPick = (myPickCount: number): RoleContext => ({
    mode: 'fixed',
    effectivePositions: [1],
    myPickCount,
    teamGreed: null,
    teammates: [],
    estimatedPositions: new Map(),
  })

  it('a greedy pick earns less greed credit on later picks', () => {
    const first = computeRoleScore(axes(0.7), ctxPos1AtPick(0))!
    const fourth = computeRoleScore(axes(0.7), ctxPos1AtPick(3))!

    expect(first.delta).toBeGreaterThan(fourth.delta)
  })

  it('resolveRoleContext counts my picks (and estimates the round without a spot)', () => {
    const axesByName = new Map<string, ShiftAxes>()
    const mine = twoPicks(0, 0.5, axesByName)
    const ctx = resolveRoleContext(FIXED_5, mine, 0, axesByName)!
    expect(ctx.myPickCount).toBe(2)

    // Without a spot: board-round estimate = floor(named picks / 10)
    const board = [
      ...twoPicks(1, 0.1, axesByName),
      ...twoPicks(2, 0.1, axesByName),
      ...twoPicks(3, 0.1, axesByName),
      ...twoPicks(4, 0.1, axesByName),
      ...twoPicks(5, 0.1, axesByName),
      pick('extra', 6, 0),
    ]
    const noSpot = resolveRoleContext(FIXED_5, board, null, axesByName)!
    expect(noSpot.myPickCount).toBe(1)
  })
})

describe('soft_cc half-credit and mana budget', () => {
  const tags = (...t: string[]) => new Set(t) as ReadonlySet<import('@core/domain/ability-tags').AbilityTag>
  const ctxPos5: RoleContext = {
    mode: 'fixed',
    effectivePositions: [5],
    myPickCount: 0,
    teamGreed: null,
    teammates: [],
    estimatedPositions: new Map(),
  }

  it('a soft_cc candidate half-covers an unmet hard_cc need', () => {
    const hard = computeRoleScore(axes(-0.6), ctxPos5, {
      candidateTags: tags('hard_cc'),
      myPickTags: [],
    })!
    const soft = computeRoleScore(axes(-0.6), ctxPos5, {
      candidateTags: tags('soft_cc'),
      myPickTags: [],
    })!
    const none = computeRoleScore(axes(-0.6), ctxPos5, {
      candidateTags: tags(),
      myPickTags: [],
    })!

    expect(soft.reasons).toContain('partial:hard_cc')
    expect(soft.delta).toBeGreaterThan(none.delta)
    expect(soft.delta).toBeLessThan(hard.delta)
  })

  it('an owned soft_cc leaves the disable need half-open (hard_cc still boosted)', () => {
    const withSlowOwned = computeRoleScore(axes(-0.6), ctxPos5, {
      candidateTags: tags('hard_cc'),
      myPickTags: [tags('soft_cc')],
    })!
    expect(withSlowOwned.reasons).toContain('covers:hard_cc')
  })

  it('fractional coverage saturates: four slows make a fifth disable a duplicate', () => {
    const fifthSlow = computeRoleScore(axes(-0.6), ctxPos5, {
      candidateTags: tags('soft_cc'),
      myPickTags: [tags('soft_cc'), tags('soft_cc'), tags('soft_cc'), tags('soft_cc')],
    })!
    expect(fifthSlow.reasons).toContain('duplicate:hard_cc')
  })

  it('third mana-hungry ability gets damped regardless of model', () => {
    const third = computeRoleScore(axes(-0.6), ctxPos5, {
      candidateTags: tags('mana_hungry', 'nuke'),
      myPickTags: [tags('mana_hungry'), tags('mana_hungry')],
    })!
    const second = computeRoleScore(axes(-0.6), ctxPos5, {
      candidateTags: tags('mana_hungry', 'nuke'),
      myPickTags: [tags('mana_hungry')],
    })!

    expect(third.reasons).toContain('duplicate:mana_budget')
    expect(second.reasons).not.toContain('duplicate:mana_budget')
    expect(third.delta).toBeLessThan(second.delta)
  })
})
