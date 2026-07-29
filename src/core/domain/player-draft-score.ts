import type { PlayerDraftScore, PlayerScoreConfidence } from '@shared/types/stream'
import {
  PLAYER_SCORE_SYNERGY_WEIGHT,
  PLAYER_SCORE_MAX_PAIR_DELTA,
} from '@shared/constants/thresholds'
import { normalizeWinrate } from './scoring'

// @DEV-GUIDE: Per-player draft strength for the streamer view.
//   base       = mean(normalizeWinrate(pick.winrate))            // null winrate -> 0.5 neutral
//   synergyAdj = Σ over unordered pick-pairs with a synergy row:
//                  clamp(synergyIncrease, ±PLAYER_SCORE_MAX_PAIR_DELTA)
//   score      = clamp01(base + PLAYER_SCORE_SYNERGY_WEIGHT * synergyAdj)
// synergyIncrease is already "lift over expected winrate" from the AbilitySynergies table,
// so no expected-value math is needed here. Triplet lift (AbilityTriplets) is a documented
// v1.1 extension point — intentionally NOT part of v1.
// Confidence scales with pick count only (0 none / 1 low / 2–3 medium / 4 high): a
// one-pick score is mostly the ability's raw winrate, not a draft evaluation.

export interface PlayerPickInput {
  name: string
  winrate: number | null
}

/** Structurally matches SynergyRepository.getSynergiesAmong rows. */
export interface PairSynergyInput {
  ability1Name: string
  ability2Name: string
  synergyWinrate: number
  synergyIncrease: number | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function confidenceForPickCount(count: number): PlayerScoreConfidence {
  if (count <= 0) return 'none'
  if (count === 1) return 'low'
  if (count <= 3) return 'medium'
  return 'high'
}

/**
 * Compute a player's draft strength from their recognized picks and the synergy rows
 * among those picks. Pairs not covered by `pairSynergies` contribute nothing.
 */
export function calculatePlayerDraftScore(
  picks: PlayerPickInput[],
  pairSynergies: PairSynergyInput[],
): PlayerDraftScore {
  if (picks.length === 0) {
    return { score: null, base: null, synergyAdjustment: 0, confidence: 'none' }
  }

  const base =
    picks.reduce((sum, pick) => sum + normalizeWinrate(pick.winrate), 0) /
    picks.length

  const pickNames = new Set(picks.map((p) => p.name))
  const countedPairs = new Set<string>()
  let synergyAdjustment = 0

  for (const pair of pairSynergies) {
    if (pair.ability1Name === pair.ability2Name) continue
    if (!pickNames.has(pair.ability1Name) || !pickNames.has(pair.ability2Name)) continue
    const key =
      pair.ability1Name < pair.ability2Name
        ? `${pair.ability1Name}|${pair.ability2Name}`
        : `${pair.ability2Name}|${pair.ability1Name}`
    if (countedPairs.has(key)) continue
    countedPairs.add(key)
    if (pair.synergyIncrease === null) continue
    synergyAdjustment += clamp(
      pair.synergyIncrease,
      -PLAYER_SCORE_MAX_PAIR_DELTA,
      PLAYER_SCORE_MAX_PAIR_DELTA,
    )
  }

  const score = clamp(
    base + PLAYER_SCORE_SYNERGY_WEIGHT * synergyAdjustment,
    0,
    1,
  )

  return {
    score,
    base,
    synergyAdjustment,
    confidence: confidenceForPickCount(picks.length),
  }
}
