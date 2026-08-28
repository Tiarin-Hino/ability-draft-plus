import { describe, it, expect } from 'vitest'
import {
  normalizeWinrate,
  normalizePickOrder,
  calculateConsolidatedScore,
  blendPersonal,
  calculatePersonalizedScore,
  NEUTRAL_PICK_POSITION,
} from '@core/domain/scoring'
import { PERSONAL_PRIOR_STRENGTH } from '@shared/constants/thresholds'

describe('normalizeWinrate', () => {
  it('returns winrate as-is when present', () => {
    expect(normalizeWinrate(0.55)).toBe(0.55)
  })

  it('returns 0.5 for null winrate', () => {
    expect(normalizeWinrate(null)).toBe(0.5)
  })

  it('handles 0 winrate', () => {
    expect(normalizeWinrate(0)).toBe(0)
  })

  it('handles 1.0 winrate', () => {
    expect(normalizeWinrate(1.0)).toBe(1.0)
  })
})

describe('normalizePickOrder', () => {
  it('returns 1.0 for pick order 1.0 (best)', () => {
    expect(normalizePickOrder(1.0)).toBe(1.0)
  })

  it('returns 0.0 for pick order 50.0 (worst)', () => {
    expect(normalizePickOrder(50.0)).toBe(0.0)
  })

  it('returns 0.5 for null pick rate', () => {
    expect(normalizePickOrder(null)).toBe(0.5)
  })

  it('returns ~0.5 for mid-range pick order', () => {
    // (50 - 25.5) / 49 = 24.5 / 49 = 0.5
    expect(normalizePickOrder(25.5)).toBe(0.5)
  })

  it('clamps below-minimum to 1.0', () => {
    expect(normalizePickOrder(0.5)).toBe(1.0)
  })

  it('clamps above-maximum to 50.0', () => {
    expect(normalizePickOrder(100)).toBe(0.0)
  })

  it('handles pick order 10', () => {
    // (50 - 10) / 49 ≈ 0.8163
    expect(normalizePickOrder(10)).toBeCloseTo(40 / 49)
  })

  it('handles pick order 40', () => {
    // (50 - 40) / 49 ≈ 0.2041
    expect(normalizePickOrder(40)).toBeCloseTo(10 / 49)
  })
})

describe('calculateConsolidatedScore', () => {
  it('produces 0.5 for null winrate and null pick rate', () => {
    // 0.4 * 0.5 + 0.6 * 0.5 = 0.2 + 0.3 = 0.5
    expect(calculateConsolidatedScore(null, null)).toBe(0.5)
  })

  it('produces correct score for known values', () => {
    // winrate=0.55, pickRate=10
    // wNorm = 0.55
    // pNorm = (50 - 10) / 49 = 40/49 ≈ 0.8163
    // score = 0.4 * 0.55 + 0.6 * (40/49)
    const expected = 0.4 * 0.55 + 0.6 * (40 / 49)
    expect(calculateConsolidatedScore(0.55, 10)).toBeCloseTo(expected)
  })

  it('produces correct score with best possible values', () => {
    // winrate=1.0, pickRate=1.0
    // wNorm = 1.0, pNorm = 1.0
    // score = 0.4 * 1.0 + 0.6 * 1.0 = 1.0
    expect(calculateConsolidatedScore(1.0, 1.0)).toBe(1.0)
  })

  it('produces correct score with worst possible values', () => {
    // winrate=0.0, pickRate=50.0
    // wNorm = 0.0, pNorm = 0.0
    // score = 0.0
    expect(calculateConsolidatedScore(0.0, 50.0)).toBe(0.0)
  })

  it('handles null winrate with real pick rate', () => {
    // wNorm = 0.5, pNorm = (50-25)/49 ≈ 0.5102
    const expected = 0.4 * 0.5 + 0.6 * (25 / 49)
    expect(calculateConsolidatedScore(null, 25)).toBeCloseTo(expected)
  })

  it('handles real winrate with null pick rate', () => {
    // wNorm = 0.6, pNorm = 0.5
    const expected = 0.4 * 0.6 + 0.6 * 0.5
    expect(calculateConsolidatedScore(0.6, null)).toBeCloseTo(expected)
  })
})

describe('blendPersonal', () => {
  it('computes the shrinkage formula', () => {
    // (15 * 0.9 + 20 * 0.5) / 35
    const expected = (15 * 0.9 + PERSONAL_PRIOR_STRENGTH * 0.5) / (15 + PERSONAL_PRIOR_STRENGTH)
    expect(blendPersonal(0.5, 0.9, 15, 0.5)).toBeCloseTo(expected)
  })

  it('returns the global value unchanged at 0 games', () => {
    expect(blendPersonal(0.55, 0.9, 0, 0.5)).toBe(0.55)
  })

  it('approaches the personal value as games grow', () => {
    expect(blendPersonal(0.5, 0.9, 100_000, 0.5)).toBeCloseTo(0.9, 3)
  })

  it('falls back to the neutral prior when the global value is null', () => {
    const expected = (10 * 0.8 + PERSONAL_PRIOR_STRENGTH * 0.5) / (10 + PERSONAL_PRIOR_STRENGTH)
    expect(blendPersonal(null, 0.8, 10, 0.5)).toBeCloseTo(expected)
  })
})

describe('calculatePersonalizedScore', () => {
  it('matches the global score exactly without personal data', () => {
    const result = calculatePersonalizedScore(0.55, 10)
    expect(result.consolidatedScore).toBe(calculateConsolidatedScore(0.55, 10))
    expect(result.personalGames).toBeUndefined()
    expect(result.personalWinrate).toBeUndefined()
    expect(result.personalScoreDelta).toBeUndefined()
  })

  it('matches the global score exactly with a 0-game sample', () => {
    const result = calculatePersonalizedScore(0.55, 10, {
      games: 0,
      winrate: 1,
      avgPickPosition: 1,
    })
    expect(result.consolidatedScore).toBe(calculateConsolidatedScore(0.55, 10))
    expect(result.personalGames).toBeUndefined()
  })

  it('blends winrate and pick position and reports the delta', () => {
    const personal = { games: 15, winrate: 0.9, avgPickPosition: 5 }
    const result = calculatePersonalizedScore(0.5, 20, personal)

    const blendedWr = blendPersonal(0.5, 0.9, 15, 0.5)
    const blendedPick = blendPersonal(20, 5, 15, NEUTRAL_PICK_POSITION)
    const expected = calculateConsolidatedScore(blendedWr, blendedPick)

    expect(result.consolidatedScore).toBeCloseTo(expected)
    expect(result.personalGames).toBe(15)
    expect(result.personalWinrate).toBe(0.9)
    expect(result.personalScoreDelta).toBeCloseTo(
      expected - calculateConsolidatedScore(0.5, 20),
    )
  })

  it('a strong personal record raises the score; a weak one lowers it', () => {
    const base = calculateConsolidatedScore(0.5, 20)
    const up = calculatePersonalizedScore(0.5, 20, {
      games: 30,
      winrate: 0.8,
      avgPickPosition: 8,
    })
    const down = calculatePersonalizedScore(0.5, 20, {
      games: 30,
      winrate: 0.2,
      avgPickPosition: 40,
    })
    expect(up.consolidatedScore).toBeGreaterThan(base)
    expect(down.consolidatedScore).toBeLessThan(base)
  })

  it('blends winrate only when the sample has no pick position (heroes)', () => {
    const result = calculatePersonalizedScore(0.5, 20, {
      games: 25,
      winrate: 0.7,
    })
    const blendedWr = blendPersonal(0.5, 0.7, 25, 0.5)
    expect(result.consolidatedScore).toBeCloseTo(
      calculateConsolidatedScore(blendedWr, 20),
    )
  })
})
