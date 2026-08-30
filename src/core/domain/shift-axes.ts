import { SHIFT_GREED_XPM_WEIGHT } from '@shared/constants/thresholds'
import type { AbilityShiftRow } from '@core/database/repositories/ability-repository'

// @DEV-GUIDE: Derives the role-fingerprint axes from raw /ability-shifts columns.
// Raw shift units are UNDOCUMENTED (z-score-like) — everything here is
// deliberately ordering-only: each axis is a percentile rank across the
// abilities currently in the pool, rescaled to [-1, +1].
//
// Axes (see the Position Templates spec):
//   greed      = pct(gpm_shift + 0.5 * xpm_shift)  -> farm priority, the primary axis
//   killtaking = pct(kills_shift)                  -> tempo / kill conversion (pos-2 accent)
//   playmaking = pct(ka_shift)                     -> fight participation (pos-4 accent)
//   enabling   = pct(healing_shift)                -> healing output (pos-5 accent; the raw
//                column is zero-inflated, so ties MUST get average ranks — a mid-rank
//                cluster for the "heals nothing" majority — and consumers only read the
//                top band, never the smooth middle)
//
// Abilities with a NULL input for an axis get the neutral 0 (the 0.5-percentile
// equivalent), mirroring how scoring treats missing winrates.

export interface ShiftAxes {
  /** [-1 support-shifted .. +1 core-shifted] */
  greed: number
  /** [-1 .. +1], high = drafters take kills */
  killtaking: number
  /** [-1 .. +1], high = drafters participate in fights (kills + assists) */
  playmaking: number
  /** [-1 .. +1], high = drafters heal; only the top band is meaningful */
  enabling: number
}

const NEUTRAL_AXES: Readonly<ShiftAxes> = Object.freeze({
  greed: 0,
  killtaking: 0,
  playmaking: 0,
  enabling: 0,
})

/**
 * Percentile ranks in [0, 1] for the non-null entries of `values`, with ties
 * receiving their average rank. Single-entry inputs rank 0.5 (no ordering
 * information). Returns a sparse map: null inputs are simply absent.
 */
function percentileRanks(values: Array<number | null>): Map<number, number> {
  const indexed: Array<{ index: number; value: number }> = []
  values.forEach((value, index) => {
    if (value !== null) indexed.push({ index, value })
  })
  const ranks = new Map<number, number>()
  const n = indexed.length
  if (n === 0) return ranks
  if (n === 1) {
    ranks.set(indexed[0].index, 0.5)
    return ranks
  }

  indexed.sort((a, b) => a.value - b.value)
  let i = 0
  while (i < indexed.length) {
    // Tie group [i, j): identical values share the average of their positions
    let j = i + 1
    while (j < indexed.length && indexed[j].value === indexed[i].value) j++
    const avgPosition = (i + j - 1) / 2
    const pct = avgPosition / (n - 1)
    for (let k = i; k < j; k++) ranks.set(indexed[k].index, pct)
    i = j
  }
  return ranks
}

/** Rescale a [0, 1] percentile to the [-1, +1] axis convention. */
function toAxis(pct: number | undefined): number {
  return pct === undefined ? 0 : 2 * pct - 1
}

/**
 * Compute the four role axes for every ability in `rows` (the full pool —
 * percentiles are relative, so always pass all abilities, not a subset).
 * Every input row gets an entry; rows with null shifts get neutral axes.
 */
export function computeShiftAxes(rows: AbilityShiftRow[]): Map<string, ShiftAxes> {
  const greedInput = rows.map((r) =>
    r.gpmShift !== null && r.xpmShift !== null
      ? r.gpmShift + SHIFT_GREED_XPM_WEIGHT * r.xpmShift
      : null,
  )
  const greedPct = percentileRanks(greedInput)
  const killsPct = percentileRanks(rows.map((r) => r.killsShift))
  const kaPct = percentileRanks(rows.map((r) => r.kaShift))
  const healingPct = percentileRanks(rows.map((r) => r.healingShift))

  const axes = new Map<string, ShiftAxes>()
  rows.forEach((row, index) => {
    const greed = greedPct.get(index)
    const killtaking = killsPct.get(index)
    const playmaking = kaPct.get(index)
    const enabling = healingPct.get(index)
    if (
      greed === undefined &&
      killtaking === undefined &&
      playmaking === undefined &&
      enabling === undefined
    ) {
      axes.set(row.name, NEUTRAL_AXES)
      return
    }
    axes.set(row.name, {
      greed: toAxis(greed),
      killtaking: toAxis(killtaking),
      playmaking: toAxis(playmaking),
      enabling: toAxis(enabling),
    })
  })
  return axes
}
