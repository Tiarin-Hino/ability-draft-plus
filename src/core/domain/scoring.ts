import {
  WEIGHT_WINRATE,
  WEIGHT_PICK_ORDER,
  MIN_PICK_ORDER_FOR_NORMALIZATION,
  MAX_PICK_ORDER_FOR_NORMALIZATION,
  PERSONAL_PRIOR_STRENGTH,
} from '@shared/constants/thresholds'

// @DEV-GUIDE: Ability/hero scoring formula used throughout the app.
// consolidatedScore = 0.4 * normalizedWinrate + 0.6 * normalizedPickOrder
//
// winrate: float [0, 1] from DB (0.55 = 55%). Normalized within observed range.
// pickRate: average pick position (lower = picked earlier = better).
//   Inverted and normalized to [0, 1] so earlier picks score higher.
// Missing values default to 0.5 (neutral score).
// Min/max pick order range: 1.0 to 50.0.
//
// PERSONALIZATION: blendPersonal() shrinks a small personal sample toward the
// global value in INPUT space (winrate / avg pick position) BEFORE the formula:
// blended = (n * personal + K * global) / (n + K), K = PERSONAL_PRIOR_STRENGTH.
// The formula and weights are untouched; with no personal data every score is
// bit-identical to the global-only path.

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

/**
 * Shrink a small personal sample toward the global value:
 * (games * personal + K * globalValue) / (games + K).
 * A null global falls back to `neutral` as the prior mean (mirroring how the
 * normalizers treat missing values). games <= 0 returns the global unchanged.
 */
export function blendPersonal(
  globalValue: number | null,
  personalValue: number,
  games: number,
  neutral: number,
): number {
  const prior = globalValue ?? neutral
  if (games <= 0) return prior
  return (
    (games * personalValue + PERSONAL_PRIOR_STRENGTH * prior) /
    (games + PERSONAL_PRIOR_STRENGTH)
  )
}

/** Neutral prior mean for pick position: the value normalizePickOrder maps to 0.5. */
export const NEUTRAL_PICK_POSITION =
  (MIN_PICK_ORDER_FOR_NORMALIZATION + MAX_PICK_ORDER_FOR_NORMALIZATION) / 2

export interface PersonalizedScore {
  consolidatedScore: number
  /** Present only when personal data actually contributed. */
  personalGames?: number
  personalWinrate?: number
  personalScoreDelta?: number
}

/**
 * Consolidated score with optional personalization. Without personal data (or
 * with 0 games) this returns exactly calculateConsolidatedScore(global inputs)
 * and no personal fields. With it, winrate — and pick position when the sample
 * has one (abilities do, heroes don't) — are shrunk toward the global values
 * via blendPersonal() before scoring, and the delta vs the global-only score
 * is reported for the overlay's up/down marker.
 */
export function calculatePersonalizedScore(
  globalWinrate: number | null,
  globalPickRate: number | null,
  personal?: { games: number; winrate: number; avgPickPosition?: number | null },
): PersonalizedScore {
  const baseScore = calculateConsolidatedScore(globalWinrate, globalPickRate)
  if (!personal || personal.games <= 0) {
    return { consolidatedScore: baseScore }
  }

  const blendedWinrate = blendPersonal(
    globalWinrate,
    personal.winrate,
    personal.games,
    0.5,
  )
  const blendedPickRate =
    personal.avgPickPosition != null
      ? blendPersonal(
          globalPickRate,
          personal.avgPickPosition,
          personal.games,
          NEUTRAL_PICK_POSITION,
        )
      : globalPickRate

  const consolidatedScore = calculateConsolidatedScore(blendedWinrate, blendedPickRate)
  return {
    consolidatedScore,
    personalGames: personal.games,
    personalWinrate: personal.winrate,
    personalScoreDelta: consolidatedScore - baseScore,
  }
}
