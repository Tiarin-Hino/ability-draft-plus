// @DEV-GUIDE: Ability Draft turn clock — pure schedule math for GSI-driven auto-rescan.
// Empirical model (validated against a played lobby, 2026-08-13):
// - map.clock_time runs -59 -> 0 during hero selection = the PREVIEW period; the first
//   pick turn starts when clock_time reaches 0, so ALL schedule offsets here are relative
//   to that moment (clock zero / pick-phase anchor), NOT to hero-selection entry.
// - Each pick turn lasts 7 seconds; players pick one after another.
// - Turn order interleaves the teams: radiant 1st, dire 1st, radiant 2nd, ... which in
//   the scan's player-index convention (0-4 radiant, 5-9 dire) is [0,5,1,6,2,7,3,8,4,9].
// - 5 rounds (4 ability picks + hero model pick), serpentine: odd rounds run the order
//   forward, even rounds run it backward, with a 5-second break between rounds.
// All timing/order assumptions are isolated in DEFAULT_AD_DRAFT_CLOCK and
// buildTurnSchedule() — if a real lobby disagrees, fix them HERE only.

export interface DraftClockConfig {
  /** Seconds per pick turn. */
  turnDurationS: number
  /** Seconds of break between rounds. */
  roundBreakS: number
  playerCount: number
  /** Turns per player (4 ability picks; the model pick consumes a turn too). */
  rounds: number
}

export const DEFAULT_AD_DRAFT_CLOCK: DraftClockConfig = {
  turnDurationS: 7,
  roundBreakS: 5,
  playerCount: 10,
  rounds: 5,
}

/**
 * Round-1 pick order as scan player indices (0-4 radiant, 5-9 dire):
 * radiant 1st, dire 1st, radiant 2nd, dire 2nd, ...
 */
function interleavedOrder(playerCount: number): number[] {
  const half = playerCount / 2
  const order: number[] = []
  for (let i = 0; i < half; i++) {
    order.push(i, half + i)
  }
  return order
}

export interface TurnWindow {
  /** 0-based pick sequence across the whole draft. */
  seq: number
  /** 0-based round this turn belongs to. */
  round: number
  /** Player slot 0–9 whose turn this is. */
  playerIndex: number
  /** Seconds from the pick-phase anchor (clock_time 0). */
  startS: number
  endS: number
}

/** Full serpentine schedule; offsets in seconds from the pick-phase anchor (clock 0). */
export function buildTurnSchedule(
  config: DraftClockConfig = DEFAULT_AD_DRAFT_CLOCK,
): TurnWindow[] {
  const forward = interleavedOrder(config.playerCount)
  const backward = [...forward].reverse()

  const windows: TurnWindow[] = []
  let cursor = 0
  let seq = 0

  for (let round = 0; round < config.rounds; round++) {
    if (round > 0) cursor += config.roundBreakS
    const order = round % 2 === 0 ? forward : backward
    for (const playerIndex of order) {
      windows.push({
        seq,
        round,
        playerIndex,
        startS: cursor,
        endS: cursor + config.turnDurationS,
      })
      seq++
      cursor += config.turnDurationS
    }
  }
  return windows
}

/** The turn active at `elapsedS` (seconds since clock zero), or null (break / over / preview). */
export function turnAt(
  elapsedS: number,
  schedule: TurnWindow[],
): TurnWindow | null {
  return (
    schedule.find((w) => elapsedS >= w.startS && elapsedS < w.endS) ?? null
  )
}

/** Turns that fully ENDED inside (fromS, toS] — players whose pick should now be visible. */
export function turnsEndedBetween(
  schedule: TurnWindow[],
  fromS: number,
  toS: number,
): TurnWindow[] {
  return schedule.filter((w) => w.endS > fromS && w.endS <= toS)
}

/**
 * Resolve the LOCAL player's row from the on-screen "YOU WILL DRAFT IN: N"
 * countdown (playing mode only — spectators never see it). N seconds after the
 * capture moment, the local player's next turn STARTS; matching that instant
 * against the schedule's turn starts identifies the turn — and its playerIndex
 * IS the visual row (user-validated timing model: radiant 1 picks at clock 0,
 * dire 1 at +7s, radiant 2 at +14s, ...). Works from the preview onward
 * (elapsedS is negative before clock zero) and across round breaks. Returns
 * null when no turn start falls within the tolerance (OCR misread, or the
 * anchor drifted) — turn starts are >= 7s apart, so the default 2.5s tolerance
 * can never match two windows.
 */
export function countdownTargetRow(input: {
  /** OCR'd countdown value in seconds. */
  countdownS: number
  /** Seconds since the pick-phase anchor at the CAPTURE moment (negative during preview). */
  elapsedS: number
  toleranceS?: number
  schedule?: TurnWindow[]
}): { row: number; deltaS: number } | null {
  const tolerance = input.toleranceS ?? 2.5
  const schedule = input.schedule ?? buildTurnSchedule()
  const turnStartS = input.elapsedS + input.countdownS

  let best: { row: number; deltaS: number } | null = null
  for (const window of schedule) {
    const deltaS = Math.abs(window.startS - turnStartS)
    if (deltaS <= tolerance && (best === null || deltaS < best.deltaS)) {
      best = { row: window.playerIndex, deltaS }
    }
  }
  return best
}

/**
 * True when `elapsedS` falls in a between-rounds break (or past the final turn) —
 * the moments a full-pool reconciliation rescan is safe and cheap to run.
 */
export function isRoundBreak(
  elapsedS: number,
  schedule: TurnWindow[],
): boolean {
  if (schedule.length === 0) return false
  const last = schedule[schedule.length - 1]
  if (elapsedS >= last.endS) return true
  return elapsedS >= 0 && turnAt(elapsedS, schedule) === null
}
