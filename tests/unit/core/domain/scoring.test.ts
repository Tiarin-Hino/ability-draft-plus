import { describe, it, expect } from 'vitest'
import {
  normalizeWinrate,
  normalizePickOrder,
  calculateConsolidatedScore,
} from '@core/domain/scoring'

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
