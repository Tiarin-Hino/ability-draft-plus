import {
  WEIGHT_WINRATE,
  WEIGHT_PICK_ORDER,
  MIN_PICK_ORDER_FOR_NORMALIZATION,
  MAX_PICK_ORDER_FOR_NORMALIZATION,
} from '@shared/constants/thresholds'

// @DEV-GUIDE: Ability/hero scoring formula used throughout the app.
// consolidatedScore = 0.4 * normalizedWinrate + 0.6 * normalizedPickOrder
//
// winrate: float [0, 1] from DB (0.55 = 55%). Normalized within observed range.
// pickRate: average pick position (lower = picked earlier = better).
//   Inverted and normalized to [0, 1] so earlier picks score higher.
// Missing values default to 0.5 (neutral score).
// Min/max pick order range: 1.0 to 50.0.

/**
 * Normalize winrate for scoring. Missing winrate defaults to 0.5 (neutral).
 * Winrate is already a float in [0, 1] from the DB.
 */
export function normalizeWinrate(winrate: number | null): number {
  return winrate !== null ? winrate : 0.5
}

/**
 * Normalize pick order for scoring. Lower pick order (picked early = better) yields
 * a higher normalized score. Clamped to [1, 50], inverted: (50 - clamped) / 49.
 * Missing pick rate defaults to 0.5 (neutral).
 */
export function normalizePickOrder(pickRate: number | null): number {
  if (pickRate === null) return 0.5
  const clamped = Math.max(
    MIN_PICK_ORDER_FOR_NORMALIZATION,
    Math.min(MAX_PICK_ORDER_FOR_NORMALIZATION, pickRate),
  )
  const range =
    MAX_PICK_ORDER_FOR_NORMALIZATION - MIN_PICK_ORDER_FOR_NORMALIZATION
  return (MAX_PICK_ORDER_FOR_NORMALIZATION - clamped) / range
}

/**
 * Compute the consolidated score: 0.4 * normalizedWinrate + 0.6 * normalizedPickOrder.
 */
export function calculateConsolidatedScore(
  winrate: number | null,
  pickRate: number | null,
): number {
  return (
    WEIGHT_WINRATE * normalizeWinrate(winrate) +
    WEIGHT_PICK_ORDER * normalizePickOrder(pickRate)
  )
}
