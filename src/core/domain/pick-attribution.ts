import type { PickEvent } from '@shared/types/stream'
import type { TurnWindow } from '../gsi/draft-clock'

// @DEV-GUIDE: Attributes pool departures to the players whose turns elapsed —
// the heart of the experimental auto-rescan feature. Pure and recomputable.
//
// Rules (in elapsed-turn order):
// - one departed ability per elapsed turn -> 'ability' PickEvent for that turn's player
// - more elapsed turns than departures  -> remaining turns get 'modelSelectionMarker'
//   (the player picked a hero model; model RECOGNITION is future work — the marker
//   records exactly where it will slot in)
// - more departures than elapsed turns  -> the surplus is returned as `unattributed`
//   (attribution drift: a missed scan or manual rescan outside the auto flow); the
//   caller logs it and the board falls back to snapshot grouping for those.
//
// Known limitation (documented in the plan): when a window spans multiple turns and
// mixes ability picks with model picks, abilities are assigned to the EARLIEST turns.
// The truly ambiguous double-model case (user + previous player both picked models)
// yields two markers; disambiguation UI ships with model recognition, not now.

export interface AttributionInput {
  /** Pool ability names before the rescan (iteration order preserved for determinism). */
  prevPoolNames: string[]
  /** Pool ability names after the rescan. */
  newPoolNames: string[]
  /** Turns fully elapsed since the last attribution (see elapsedTurnsBetween). */
  elapsedTurns: TurnWindow[]
  /** Sequence number for the first emitted event. */
  nextSeq: number
  clockTime: number | null
}

export interface AttributionResult {
  events: PickEvent[]
  /** Departed abilities that had no elapsed turn to attach to. */
  unattributed: string[]
}

export function attributePicks(input: AttributionInput): AttributionResult {
  const newPool = new Set(input.newPoolNames)
  const departed = input.prevPoolNames.filter((name) => !newPool.has(name))

  const events: PickEvent[] = []
  let seq = input.nextSeq

  input.elapsedTurns.forEach((turn, i) => {
    const abilityName = i < departed.length ? departed[i] : null
    events.push({
      seq,
      playerIndex: turn.playerIndex,
      abilityName,
      kind: abilityName !== null ? 'ability' : 'modelSelectionMarker',
      clockTime: input.clockTime,
    })
    seq++
  })

  return {
    events,
    unattributed: departed.slice(input.elapsedTurns.length),
  }
}
