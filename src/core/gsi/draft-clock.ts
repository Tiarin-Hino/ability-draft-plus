// @DEV-GUIDE: Ability Draft turn clock — pure schedule math for the experimental
// auto-rescan feature. Given the moment GSI reported the draft starting (transition
// into DOTA_GAMERULES_STATE_HERO_SELECTION), computes whose turn it is at any elapsed
// time and which turns fully elapsed inside a window (feeds pick-attribution).
//
// !!! TIMING CONSTANTS ARE EMPIRICALLY UNVALIDATED (plan phase 4 capture spike) !!!
// Assumed AD flow: a preview period to inspect the pool, then 40 picks in serpentine
// order (0->9, 9->0, 0->9, 9->0) with a fixed per-pick timer. All assumptions are
// isolated in DEFAULT_AD_DRAFT_CLOCK and buildTurnSchedule() — validate against real
// lobby captures and fix HERE only.

export interface DraftClockConfig {
  /** Seconds from draft start until the first pick timer begins. */
  previewDurationS: number
  /** Seconds per pick turn. */
  turnDurationS: number
  playerCount: number
  /** Picks per player (4 abilities; model selection consumes a turn too). */
  rounds: number
}

export const DEFAULT_AD_DRAFT_CLOCK: DraftClockConfig = {
  previewDurationS: 15,
  turnDurationS: 10,
  playerCount: 10,
  rounds: 4,
}

export interface TurnWindow {
  /** 0-based pick sequence across the whole draft. */
  seq: number
  /** Player slot 0–9 whose turn this is. */
  playerIndex: number
  startS: number
  endS: number
}

/** Full serpentine schedule, offsets in seconds from draft start. */
export function buildTurnSchedule(
  config: DraftClockConfig = DEFAULT_AD_DRAFT_CLOCK,
): TurnWindow[] {
  const windows: TurnWindow[] = []
  let cursor = config.previewDurationS
  let seq = 0

  for (let round = 0; round < config.rounds; round++) {
    for (let i = 0; i < config.playerCount; i++) {
      const playerIndex =
        round % 2 === 0 ? i : config.playerCount - 1 - i
      windows.push({
        seq,
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

/** The turn active at `elapsedS`, or null (preview period / draft over). */
export function turnAt(
  elapsedS: number,
  schedule: TurnWindow[],
): TurnWindow | null {
  return (
    schedule.find((w) => elapsedS >= w.startS && elapsedS < w.endS) ?? null
  )
}

/** Turns that fully ENDED inside (fromS, toS] — the attribution window. */
export function elapsedTurnsBetween(
  schedule: TurnWindow[],
  fromS: number,
  toS: number,
): TurnWindow[] {
  return schedule.filter((w) => w.endS > fromS && w.endS <= toS)
}
