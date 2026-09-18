import type { ScanResult } from '@shared/types'
import type { PickEvent } from '@shared/types/stream'
import type { TurnWindow } from '@core/gsi/draft-clock'
import {
  LATE_PICK_GRACE_S,
  PICK_SEEN_EARLY_TOLERANCE_S,
} from '@shared/constants/thresholds'

// @DEV-GUIDE: Ability picks are read off each player's card (hero_order = player
// index 0-9) and tracked per BOX GROUP — the card's single ultimate box, and its
// three standard boxes taken as a SET. A name in row X IS player X's pick; no
// turn-clock guessing.
//
// Why a set and not box positions: Dota REORDERS the standard abilities on a card
// as picks land (127 of 127 high-confidence box changes across 69 live drafts were
// an ability moving to another box, not a new reading). The ultimate box never
// moves (0 shifts), so for it the group is just that one box.
//
// Per group, after an accepted scan (rules observed live, 2026-09-16):
// - A name that APPEARS is a new pick.
// - While any box in the group is unreadable (a tooltip, a rejected match), a
//   recorded name that is not visible may just be hidden: it is flagged
//   `vacated`, never removed; it clears if the name shows again.
// - With every box readable, a name that is GONE is resolved:
//   - a vacated one was a phantom — an empty ultimate box scored 0.457 against
//     Focus Fire while the player drafted a model — and is removed;
//   - a live one that vanished together with a newly appeared name was a misread
//     of that pick: renamed in place, keeping its turn (Overcharge -> Paralyzing
//     Cask);
//   - a live one with nothing to replace it was a phantom too, removed.
//
// ORDER is not discovery order: `orderByDraftTurns` places every pick at one of
// its player's turns in the serpentine schedule, using WHEN the pick was first
// seen (`seenAtS`, seconds since the pick-phase anchor). Discovery lags (a
// player's double turn at a round break collapses into one scan; picks found
// together in one scan come out in card order), and a pick can be missing
// altogether (2026-09-17: a player's Io card never OCR'd, so counting picks —
// "k-th pick = k-th turn" — slid all their later abilities one round early).

export interface AbilityPickInput {
  /** The draft timeline so far (ability events + model markers). */
  timeline: readonly PickEvent[]
  /** Merged selected-abilities state AFTER an accepted scan (every row's boxes). */
  nextSelected: readonly ScanResult[]
  clockTime: number | null
  /** Seconds since the pick-phase anchor at capture start; stamped on new picks. */
  seenAtS?: number
}

export interface AbilityPickUpdate {
  /** The timeline with renamed / vacated / removed events applied in place. */
  timeline: PickEvent[]
  /** Genuinely new picks, in card order (seq assigned by the caller/store). */
  added: Omit<PickEvent, 'seq'>[]
  corrected: { playerIndex: number; from: string; to: string }[]
  /** Removed picks: read, but never really on the card. */
  phantoms: { playerIndex: number; name: string }[]
  /** True when an event's vacated flag was set or cleared. */
  vacatedChanged: boolean
}

/** A box read that is neither a name nor a detected-empty box. */
function isUnreadable(slot: ScanResult): boolean {
  return slot.name === null && (slot.rejectedMatch !== undefined || slot.confidence > 0)
}

const BOXES_PER_GROUP = { std: 3, ult: 1 } as const

export function reconcileAbilityPicks(input: AbilityPickInput): AbilityPickUpdate {
  const timeline: (PickEvent | null)[] = input.timeline.map((event) => ({ ...event }))
  const added: AbilityPickUpdate['added'] = []
  const corrected: AbilityPickUpdate['corrected'] = []
  const phantoms: AbilityPickUpdate['phantoms'] = []
  let vacatedChanged = false

  const groups = new Map<string, { row: number; box: 'std' | 'ult'; boxes: ScanResult[] }>()
  for (const slot of input.nextSelected) {
    const box = slot.is_ultimate ? 'ult' : 'std'
    const key = `${slot.hero_order}:${box}`
    const group = groups.get(key) ?? { row: slot.hero_order, box, boxes: [] }
    group.boxes.push(slot)
    groups.set(key, group)
  }

  for (const { row, box, boxes } of groups.values()) {
    const visible: string[] = []
    for (const slot of boxes) {
      if (slot.name !== null && !visible.includes(slot.name)) visible.push(slot.name)
    }
    const readable =
      boxes.length >= BOXES_PER_GROUP[box] && !boxes.some((slot) => isUnreadable(slot))

    const indices = timeline
      .map((event, index) => ({ event, index }))
      .filter(
        (x): x is { event: PickEvent; index: number } =>
          x.event !== null &&
          x.event.kind === 'ability' &&
          x.event.playerIndex === row &&
          x.event.box === box,
      )

    // A flagged name that shows again was only hidden
    for (const { event, index } of indices) {
      if (event.vacated === true && event.abilityName !== null && visible.includes(event.abilityName)) {
        const cleared = { ...event }
        delete cleared.vacated
        timeline[index] = cleared
        vacatedChanged = true
      }
    }

    const recordedNames = new Set(indices.map(({ event }) => event.abilityName))
    const appeared = visible.filter((name) => !recordedNames.has(name))
    const gone = indices.filter(
      ({ index }) =>
        timeline[index]?.abilityName !== null &&
        !visible.includes(timeline[index]?.abilityName as string),
    )

    const newPick = (name: string): void => {
      added.push({
        playerIndex: row,
        abilityName: name,
        kind: 'ability',
        clockTime: input.clockTime,
        box,
        ...(input.seenAtS !== undefined ? { seenAtS: input.seenAtS } : {}),
      })
    }

    if (!readable) {
      for (const { index } of gone) {
        const event = timeline[index] as PickEvent
        if (event.vacated !== true) {
          timeline[index] = { ...event, vacated: true }
          vacatedChanged = true
        }
      }
      appeared.forEach(newPick)
      continue
    }

    const goneLive: number[] = []
    for (const { index } of gone) {
      const event = timeline[index] as PickEvent
      if (event.vacated === true) {
        phantoms.push({ playerIndex: row, name: event.abilityName ?? '' })
        timeline[index] = null
      } else {
        goneLive.push(index)
      }
    }
    const replacements = [...appeared]
    for (const index of goneLive) {
      const event = timeline[index] as PickEvent
      const replacement = replacements.shift()
      if (replacement === undefined) {
        phantoms.push({ playerIndex: row, name: event.abilityName ?? '' })
        timeline[index] = null
      } else {
        corrected.push({ playerIndex: row, from: event.abilityName ?? '', to: replacement })
        timeline[index] = { ...event, abilityName: replacement }
      }
    }
    replacements.forEach(newPick)
  }

  return {
    timeline: timeline.filter((e): e is PickEvent => e !== null),
    added,
    corrected,
    phantoms,
    vacatedChanged,
  }
}

export interface DraftTurnOptions {
  /** How long after a turn ends its pick may still be first seen. */
  graceS: number
  /** How far before a turn starts a capture may already show its pick (clock slack). */
  earlyS: number
}

/**
 * The draft turn (index into `schedule`, the serpentine turn windows) of every
 * timeline event, or null past the end of its player's turns. Per player:
 *
 * 1. Timed picks, in the order they were seen, take the player's EARLIEST free
 *    turn that had started and ended no more than `graceS` before the pick was
 *    seen. That is the normal case — a pick shows up a few seconds after its
 *    turn — and keeps a double turn (two turns 12 s apart at a round break)
 *    in order when its first pick is read late.
 * 2. A timed pick seen later than that was read late, or an earlier turn of
 *    this player went unread: the least-late pairing goes first, i.e. the
 *    LATEST free turn that had started, leaving the gap for the missing pick.
 * 3. Untimed picks (spectate GSI markers, replays, drafts joined mid-way) and
 *    timed picks that fit no started turn fill the player's earliest free
 *    turns in timeline order — a late card read lands in the gap it left.
 *
 * Picks seen in the same capture carry no order of their own: their turns go
 * to them in timeline order, which makes re-ordering an ordered timeline a no-op.
 */
export function assignDraftTurns(
  timeline: readonly PickEvent[],
  schedule: readonly TurnWindow[],
  options: DraftTurnOptions = { graceS: LATE_PICK_GRACE_S, earlyS: PICK_SEEN_EARLY_TOLERANCE_S },
): (number | null)[] {
  const turnsOf = new Map<number, number[]>()
  schedule.forEach((window, turn) => {
    const turns = turnsOf.get(window.playerIndex) ?? []
    turns.push(turn)
    turnsOf.set(window.playerIndex, turns)
  })

  const eventsOf = new Map<number, { event: PickEvent; position: number }[]>()
  timeline.forEach((event, position) => {
    const events = eventsOf.get(event.playerIndex) ?? []
    events.push({ event, position })
    eventsOf.set(event.playerIndex, events)
  })

  const turnOf: (number | null)[] = timeline.map(() => null)
  for (const [player, events] of eventsOf) {
    const turns = turnsOf.get(player) ?? []
    const taken = new Set<number>()
    const started = (seenAtS: number, turn: number): boolean =>
      schedule[turn].startS <= seenAtS + options.earlyS
    const lateness = (seenAtS: number, turn: number): number =>
      seenAtS - schedule[turn].endS - options.graceS
    const assign = (position: number, turn: number): void => {
      turnOf[position] = turn
      taken.add(turn)
    }

    const timed = events
      .filter((x) => x.event.seenAtS !== undefined)
      .sort((a, b) => (a.event.seenAtS as number) - (b.event.seenAtS as number) || a.position - b.position)

    // 1. Seen in time for a turn: the earliest such free turn
    for (const { event, position } of timed) {
      const seenAtS = event.seenAtS as number
      const turn = turns.find((t) => !taken.has(t) && started(seenAtS, t) && lateness(seenAtS, t) <= 0)
      if (turn !== undefined) assign(position, turn)
    }

    // 2. Seen late: the least-late pairing first
    for (;;) {
      let best: { position: number; turn: number; late: number } | null = null
      for (const { event, position } of timed) {
        if (turnOf[position] !== null) continue
        const seenAtS = event.seenAtS as number
        for (const turn of turns) {
          if (taken.has(turn) || !started(seenAtS, turn)) continue
          const late = lateness(seenAtS, turn)
          if (best === null || late < best.late) best = { position, turn, late }
        }
      }
      if (best === null) break
      assign(best.position, best.turn)
    }

    // 3. Everything else fills the earliest free turns in timeline order
    for (const { position } of events) {
      if (turnOf[position] !== null) continue
      const turn = turns.find((t) => !taken.has(t))
      if (turn !== undefined) assign(position, turn)
    }

    // Same capture: hand the group's turns out in timeline order
    const bySeen = new Map<number, number[]>()
    for (const { event, position } of timed) {
      const group = bySeen.get(event.seenAtS as number) ?? []
      group.push(position)
      bySeen.set(event.seenAtS as number, group)
    }
    for (const positions of bySeen.values()) {
      if (positions.length < 2) continue
      const slots = positions
        .map((position) => turnOf[position])
        .sort((a, b) => (a ?? Infinity) - (b ?? Infinity))
      ;[...positions].sort((a, b) => a - b).forEach((position, i) => {
        turnOf[position] = slots[i]
      })
    }
  }
  return turnOf
}

/**
 * Put every pick at its draft turn (`assignDraftTurns`) and renumber seq to the
 * new position. Anything beyond its player's turns keeps its place after the
 * schedule. Deterministic and idempotent.
 */
export function orderByDraftTurns(
  timeline: readonly PickEvent[],
  schedule: readonly TurnWindow[],
  options?: DraftTurnOptions,
): PickEvent[] {
  const turnOf = assignDraftTurns(timeline, schedule, options)
  return timeline
    .map((event, position) => ({
      event,
      position,
      turn: turnOf[position] ?? schedule.length + position,
    }))
    .sort((a, b) => a.turn - b.turn || a.position - b.position)
    .map(({ event }, seq) => ({ ...event, seq }))
}
