import { describe, it, expect } from 'vitest'
import {
  calculatePlayerDraftScore,
  type PairSynergyInput,
  type PlayerPickInput,
} from '@core/domain/player-draft-score'
import {
  PLAYER_SCORE_SYNERGY_WEIGHT,
  PLAYER_SCORE_MAX_PAIR_DELTA,
} from '@shared/constants/thresholds'

function pick(name: string, winrate: number | null): PlayerPickInput {
  return { name, winrate }
}

function pair(
  a: string,
  b: string,
  synergyIncrease: number | null,
  synergyWinrate = 0.55,
): PairSynergyInput {
  return {
    ability1Name: a,
    ability2Name: b,
    synergyIncrease,
    synergyWinrate,
  }
}

describe('calculatePlayerDraftScore', () => {
  it('returns null score and none confidence for zero picks', () => {
    const result = calculatePlayerDraftScore([], [])
    expect(result.score).toBeNull()
    expect(result.base).toBeNull()
    expect(result.synergyAdjustment).toBe(0)
    expect(result.confidence).toBe('none')
  })

  it('one pick: score equals its winrate, confidence low', () => {
    const result = calculatePlayerDraftScore([pick('a', 0.57)], [])
    expect(result.score).toBeCloseTo(0.57)
    expect(result.base).toBeCloseTo(0.57)
    expect(result.confidence).toBe('low')
  })

  it('null winrate defaults to neutral 0.5', () => {
    const result = calculatePlayerDraftScore(
      [pick('a', null), pick('b', 0.6)],
      [],
    )
    expect(result.base).toBeCloseTo(0.55)
    expect(result.confidence).toBe('medium')
  })

  it('confidence scales with pick count', () => {
    const picks = [
      pick('a', 0.5),
      pick('b', 0.5),
      pick('c', 0.5),
      pick('d', 0.5),
    ]
    expect(calculatePlayerDraftScore(picks.slice(0, 1), []).confidence).toBe('low')
    expect(calculatePlayerDraftScore(picks.slice(0, 2), []).confidence).toBe('medium')
    expect(calculatePlayerDraftScore(picks.slice(0, 3), []).confidence).toBe('medium')
    expect(calculatePlayerDraftScore(picks, []).confidence).toBe('high')
  })

  it('adds weighted synergy lift between picked pairs', () => {
    const result = calculatePlayerDraftScore(
      [pick('a', 0.5), pick('b', 0.5)],
      [pair('a', 'b', 0.04)],
    )
    expect(result.synergyAdjustment).toBeCloseTo(0.04)
    expect(result.score).toBeCloseTo(0.5 + PLAYER_SCORE_SYNERGY_WEIGHT * 0.04)
  })

  it('negative lift lowers the score', () => {
    const result = calculatePlayerDraftScore(
      [pick('a', 0.5), pick('b', 0.5)],
      [pair('a', 'b', -0.06)],
    )
    expect(result.score).toBeCloseTo(0.5 - PLAYER_SCORE_SYNERGY_WEIGHT * 0.06)
  })

  it('clamps a single pair lift to PLAYER_SCORE_MAX_PAIR_DELTA', () => {
    const result = calculatePlayerDraftScore(
      [pick('a', 0.5), pick('b', 0.5)],
      [pair('a', 'b', 0.5)],
    )
    expect(result.synergyAdjustment).toBeCloseTo(PLAYER_SCORE_MAX_PAIR_DELTA)
  })

  it('ignores synergy rows for abilities the player has not picked', () => {
    const result = calculatePlayerDraftScore(
      [pick('a', 0.5), pick('b', 0.5)],
      [pair('a', 'x', 0.08), pair('x', 'y', 0.08)],
    )
    expect(result.synergyAdjustment).toBe(0)
  })

  it('counts each unordered pair once even with duplicate/reversed rows', () => {
    const result = calculatePlayerDraftScore(
      [pick('a', 0.5), pick('b', 0.5)],
      [pair('a', 'b', 0.04), pair('b', 'a', 0.04)],
    )
    expect(result.synergyAdjustment).toBeCloseTo(0.04)
  })

  it('skips rows with null synergyIncrease', () => {
    const result = calculatePlayerDraftScore(
      [pick('a', 0.5), pick('b', 0.5)],
      [pair('a', 'b', null)],
    )
    expect(result.synergyAdjustment).toBe(0)
  })

  it('clamps final score into [0, 1]', () => {
    const high = calculatePlayerDraftScore(
      [pick('a', 0.99), pick('b', 0.99), pick('c', 0.99), pick('d', 0.99)],
      [
        pair('a', 'b', 0.08),
        pair('a', 'c', 0.08),
        pair('a', 'd', 0.08),
        pair('b', 'c', 0.08),
        pair('b', 'd', 0.08),
        pair('c', 'd', 0.08),
      ],
    )
    expect(high.score).toBeLessThanOrEqual(1)

    const low = calculatePlayerDraftScore(
      [pick('a', 0.01), pick('b', 0.01)],
      [pair('a', 'b', -0.08)],
    )
    expect(low.score).toBeGreaterThanOrEqual(0)
  })

  it('sums lifts across all picked pairs (4 picks, 6 possible pairs)', () => {
    const result = calculatePlayerDraftScore(
      [pick('a', 0.5), pick('b', 0.5), pick('c', 0.5), pick('d', 0.5)],
      [pair('a', 'b', 0.02), pair('c', 'd', 0.03), pair('a', 'd', -0.01)],
    )
    expect(result.synergyAdjustment).toBeCloseTo(0.04)
    expect(result.score).toBeCloseTo(0.5 + PLAYER_SCORE_SYNERGY_WEIGHT * 0.04)
  })
})
