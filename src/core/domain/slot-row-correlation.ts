import {
  PLAYER_CARD_DIFF_THRESHOLD,
  SLOT_MAP_EVENT_SLACK_BEFORE_MS,
  SLOT_MAP_EVENT_SLACK_AFTER_MS,
} from '@shared/constants/thresholds'
import { heroNameToken } from './own-row-detection'

/** Mean absolute per-byte difference; Infinity on length mismatch (treat as changed). */
export function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return Infinity
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i])
  }
  return sum / a.length
}

// @DEV-GUIDE: GSI slot <-> scan row correlation for SPECTATE/REPLAY sessions.
// Problem: in spectate, GSI reports players by team_slot but that order does NOT
// match the draft screen's visual row order, and no GSI field derives the mapping
// (verified empirically: not team_slot, not raw playerN key order, not player_slot;
// the abilities/draft GSI sections are empty during hero selection). Without the
// mapping, player names/models land on wrong board rows.
// Mechanism: correlate GSI hero-model pick events with player-card pixel changes.
// - Each of the 10 player cards (heroes_coords) shows pixel-static "NO HERO" art
//   until that row's player drafts a model, then permanently switches to ANIMATED
//   hero art. Diffing a card against its initial-scan baseline detects the switch
//   without any image recognition.
// - When GSI says slot S gained a hero in the same time window that card row R
//   first read changed, S<->R. Mappings accumulate per draft (sticky) and
//   ambiguous multi-pick windows resolve by elimination.
// Safeguards:
// - Two-scan persistence before a card counts as changed (hover tooltips fake a
//   change for one capture).
// - A row is only usable once it has read EQUAL to its baseline at least once
//   (baselineVerified): a card that already showed a hero at initial-scan time
//   has an animated baseline that never compares clean — such rows would read
//   "changed" forever and must not correlate with anything.
// - Replay rewinds revert cards to NO HERO (reads equal to baseline again) and
//   revert GSI heroes to null; both sides re-fire on the re-pick, giving repeat
//   chances. Committed mappings are identity facts and never revert.
// - Commits require the event's match window to be CLOSED (no future row can
//   join) and mutual uniqueness (the row isn't claimed by another event).
// - GSI teams are authoritative (team2 -> rows 0-4, team3 -> rows 5-9), so
//   candidates are restricted to the event's team half.

/** One normalized player-card crop: raw RGB bytes at PLAYER_CARD_COMPARE_SIZE². */
export interface PlayerCardCapture {
  /** Scan row 0-9 (heroes_coords hero_order: 0-4 radiant column, 5-9 dire). */
  row: number
  tile: Uint8Array
}

export interface CardRowState {
  row: number
  /**
   * The row has compared EQUAL to its baseline at least once, proving the
   * baseline is its static NO HERO art. Rows that never verify (a hero was
   * already drafted when the baseline was captured) are excluded from
   * correlation — their animated baseline reads "changed" on every scan.
   */
  baselineVerified: boolean
  status: 'static' | 'pending' | 'changed'
  /** Wall-clock ms when the current change was FIRST read (set on pending,
   * kept through changed, cleared when the card reads static again). */
  firstChangedAtMs: number | null
}

/** GSI reported this slot gained a hero model at atMs (wall clock). */
export interface GsiHeroEvent {
  /** GSI slot index 0-9 (team-correct, within-team order unknown). */
  slot: number
  npcName: string
  atMs: number
}

export interface SlotRowMapping {
  gsiSlot: number
  scanRow: number
}

export function initialCardRows(rows: number[]): CardRowState[] {
  return rows.map((row) => ({
    row,
    baselineVerified: false,
    status: 'static' as const,
    firstChangedAtMs: null,
  }))
}

// ---------------------------------------------------------------------------
// Identity join (preferred) — see correlateByHeroIdentity below.
// ---------------------------------------------------------------------------

export interface HeroIdentityInput {
  /** Spectate GSI: slot -> hero npc short name. Slots without a hero omitted. */
  gsiHeroes: ReadonlyArray<{ slot: number; npcName: string }>
  /** Card OCR per draft row (DraftStore.ocrHeroNamesByRow). */
  ocrHeroNamesByRow: Readonly<Record<number, { name: string }>>
  /** Already-committed mappings — identity facts, never revised. */
  mappings: readonly SlotRowMapping[]
}

/**
 * Correlate GSI slots to draft rows by HERO IDENTITY: GSI says slot 0 is Tusk,
 * the drafter's card OCRs as "Tusk" on row 4, therefore slot 0 <-> row 4.
 *
 * This is strictly better than the pixel/timing correlation below and runs
 * first. That one has to catch the *moment* a card switches art, which makes it
 * hostile to reality: it needs a clean baseline (a card already showing a hero
 * when the baseline was captured can never verify), a diff above a noise
 * threshold, and a GSI event inside a ±10/20 s window. Observed 2026-09-04:
 * cards flagged changed 14 s after baseline with diffs of 10-22 against a
 * threshold of 10, which burned every row, so all ten GSI events were dropped
 * unmatchable and no name, model or in-game column could be placed all game.
 * The identity join has no timing window, no threshold, and works from a single
 * observation of each side — a hero's name is on the card for the rest of the
 * draft, so a late scan resolves it just as well as an early one.
 *
 * Safeguards: a token must match exactly ONE unmapped slot and ONE unmapped row
 * (AD models are unique, so anything else is an OCR misread), and the two must
 * be in the same team half — GSI teams are authoritative (team2 -> rows 0-4,
 * team3 -> rows 5-9), so a cross-half match is proof of a bad read.
 */
export function correlateByHeroIdentity(input: HeroIdentityInput): {
  mappings: SlotRowMapping[]
  newMappings: SlotRowMapping[]
} {
  const mappedSlots = new Set(input.mappings.map((m) => m.gsiSlot))
  const mappedRows = new Set(input.mappings.map((m) => m.scanRow))

  const slotsByToken = new Map<string, number[]>()
  for (const { slot, npcName } of input.gsiHeroes) {
    if (mappedSlots.has(slot)) continue
    const token = heroNameToken(npcName)
    const list = slotsByToken.get(token)
    if (list) list.push(slot)
    else slotsByToken.set(token, [slot])
  }

  const rowsByToken = new Map<string, number[]>()
  for (const [rowKey, ocr] of Object.entries(input.ocrHeroNamesByRow)) {
    const row = Number(rowKey)
    if (!Number.isInteger(row) || mappedRows.has(row)) continue
    const token = heroNameToken(ocr.name)
    const list = rowsByToken.get(token)
    if (list) list.push(row)
    else rowsByToken.set(token, [row])
  }

  const newMappings: SlotRowMapping[] = []
  for (const [token, slots] of slotsByToken) {
    const rows = rowsByToken.get(token)
    if (!rows || slots.length !== 1 || rows.length !== 1) continue
    const gsiSlot = slots[0]
    const scanRow = rows[0]
    // Same team half, or the read is wrong
    if (gsiSlot < 5 !== scanRow < 5) continue
    newMappings.push({ gsiSlot, scanRow })
  }

  return {
    mappings: [...input.mappings, ...newMappings],
    newMappings,
  }
}

/**
 * Force the last unmapped slot/row in a team half. GSI teams are authoritative
 * (team2 -> rows 0-4, team3 -> rows 5-9), so with four of a half's five slots
 * mapped the fifth is determined by elimination — no card evidence needed. This
 * matters because the identity join can only resolve a row once its player has
 * drafted a model, so the last player to pick would otherwise stay anonymous
 * for the whole draft.
 *
 * `knownSlots` are the slots GSI actually reports for that half (normally all
 * five); passing fewer prevents inventing a mapping for a slot that isn't there.
 */
export function correlateByElimination(input: {
  knownSlots: readonly number[]
  mappings: readonly SlotRowMapping[]
}): { mappings: SlotRowMapping[]; newMappings: SlotRowMapping[] } {
  const mappedSlots = new Set(input.mappings.map((m) => m.gsiSlot))
  const mappedRows = new Set(input.mappings.map((m) => m.scanRow))
  const newMappings: SlotRowMapping[] = []

  for (const half of [0, 5]) {
    const slots = input.knownSlots.filter(
      (s) => s >= half && s < half + 5 && !mappedSlots.has(s),
    )
    const rows = [half, half + 1, half + 2, half + 3, half + 4].filter(
      (r) => !mappedRows.has(r),
    )
    // Exactly one candidate on each side, and GSI must know all five of the
    // half's slots — otherwise "the only one left" is not actually determined.
    const halfSlotsKnown = input.knownSlots.filter(
      (s) => s >= half && s < half + 5,
    ).length
    if (halfSlotsKnown === 5 && slots.length === 1 && rows.length === 1) {
      newMappings.push({ gsiSlot: slots[0], scanRow: rows[0] })
    }
  }

  return { mappings: [...input.mappings, ...newMappings], newMappings }
}

export interface CardChangeResult {
  rows: CardRowState[]
  /** Rows that newly CONFIRMED changed this scan, with their measured diff. */
  newlyChanged: Array<{ row: number; diff: number }>
}

/**
 * Advance per-row change state from one scan's card captures. Rows missing
 * from `current` (failed crops) keep their previous state.
 */
export function detectCardChanges(input: {
  baselines: PlayerCardCapture[]
  current: PlayerCardCapture[]
  rows: CardRowState[]
  nowMs: number
  threshold?: number
}): CardChangeResult {
  const threshold = input.threshold ?? PLAYER_CARD_DIFF_THRESHOLD
  const baselineByRow = new Map(input.baselines.map((b) => [b.row, b.tile]))
  const currentByRow = new Map(input.current.map((c) => [c.row, c.tile]))

  const newlyChanged: Array<{ row: number; diff: number }> = []
  const rows = input.rows.map((state) => {
    const baseline = baselineByRow.get(state.row)
    const tile = currentByRow.get(state.row)
    if (!baseline || !tile) return state

    const diff = meanAbsDiff(baseline, tile)
    if (diff <= threshold) {
      // Reads as the baseline NO HERO art: verifies the baseline, and reverts
      // any change (replay rewound past the pick, or a pending flicker).
      return {
        ...state,
        baselineVerified: true,
        status: 'static' as const,
        firstChangedAtMs: null,
      }
    }
    if (state.status === 'static') {
      return { ...state, status: 'pending' as const, firstChangedAtMs: input.nowMs }
    }
    if (state.status === 'pending') {
      newlyChanged.push({ row: state.row, diff })
      return { ...state, status: 'changed' as const }
    }
    return state
  })

  return { rows, newlyChanged }
}

export interface CorrelationResult {
  mappings: SlotRowMapping[]
  /** Mappings committed by THIS step (subset of mappings). */
  newMappings: SlotRowMapping[]
  /** Surviving unmapped events (latest per slot, dead events pruned). */
  events: GsiHeroEvent[]
  /** Slots whose event was dropped as unmatchable (no row ever changed in
   * window — e.g. the pick was already baked into the baseline). */
  prunedSlots: number[]
}

function sameTeam(slot: number, row: number): boolean {
  return slot < 5 === row < 5
}

/**
 * Try to resolve GSI hero events against changed card rows. Pure step function:
 * call after every scan and/or GSI update with the accumulated state.
 */
export function correlateSlotRows(input: {
  events: GsiHeroEvent[]
  rows: CardRowState[]
  mappings: SlotRowMapping[]
  nowMs: number
  slackBeforeMs?: number
  slackAfterMs?: number
}): CorrelationResult {
  const slackBefore = input.slackBeforeMs ?? SLOT_MAP_EVENT_SLACK_BEFORE_MS
  const slackAfter = input.slackAfterMs ?? SLOT_MAP_EVENT_SLACK_AFTER_MS

  const mappings = [...input.mappings]
  const newMappings: SlotRowMapping[] = []
  const mappedSlots = new Set(mappings.map((m) => m.gsiSlot))
  const mappedRows = new Set(mappings.map((m) => m.scanRow))

  // Latest event per still-unmapped slot (rewind re-picks supersede older events)
  const eventBySlot = new Map<number, GsiHeroEvent>()
  for (const event of input.events) {
    if (mappedSlots.has(event.slot)) continue
    const prev = eventBySlot.get(event.slot)
    if (!prev || event.atMs >= prev.atMs) eventBySlot.set(event.slot, event)
  }

  const eligibleRow = (r: CardRowState): boolean =>
    r.status === 'changed' && r.baselineVerified && !mappedRows.has(r.row)
  const inWindow = (e: GsiHeroEvent, r: CardRowState): boolean =>
    r.firstChangedAtMs !== null &&
    r.firstChangedAtMs >= e.atMs - slackBefore &&
    r.firstChangedAtMs <= e.atMs + slackAfter
  const windowClosed = (e: GsiHeroEvent): boolean => input.nowMs > e.atMs + slackAfter

  function commit(gsiSlot: number, scanRow: number): void {
    const mapping = { gsiSlot, scanRow }
    mappings.push(mapping)
    newMappings.push(mapping)
    mappedSlots.add(gsiSlot)
    mappedRows.add(scanRow)
    eventBySlot.delete(gsiSlot)
  }

  let progress = true
  while (progress) {
    progress = false
    const unmappedEvents = [...eventBySlot.values()]

    // Rule 1: an event whose CLOSED window contains exactly one eligible row,
    // where that row is claimed by no other event — commit.
    for (const event of unmappedEvents) {
      if (mappedSlots.has(event.slot) || !windowClosed(event)) continue
      const candidates = input.rows.filter(
        (r) => eligibleRow(r) && sameTeam(event.slot, r.row) && inWindow(event, r),
      )
      if (candidates.length !== 1) continue
      const row = candidates[0]
      const claims = [...eventBySlot.values()].filter(
        (other) => sameTeam(other.slot, row.row) && inWindow(other, row),
      )
      if (claims.length !== 1) continue
      commit(event.slot, row.row)
      progress = true
    }

    // Rule 2: per-team elimination — when a team is down to exactly one
    // unmapped event and one eligible row, they must belong together even if
    // the timing window misses (late confirmation, tooltip retry storms).
    // Both sides must be past their arrival windows: the event's window must
    // be closed (its own row can no longer show up and make this ambiguous)
    // and the row must be older than the GSI lag allowance (its own event can
    // no longer be in flight).
    for (const teamStart of [0, 5]) {
      const teamEvents = [...eventBySlot.values()].filter(
        (e) => e.slot >= teamStart && e.slot < teamStart + 5,
      )
      const teamRows = input.rows.filter(
        (r) => eligibleRow(r) && r.row >= teamStart && r.row < teamStart + 5,
      )
      if (teamEvents.length !== 1 || teamRows.length !== 1) continue
      const [event] = teamEvents
      const [row] = teamRows
      if (!windowClosed(event)) continue
      if (row.firstChangedAtMs === null || input.nowMs <= row.firstChangedAtMs + slackBefore) {
        continue
      }
      commit(event.slot, row.row)
      progress = true
    }
  }

  // Prune events that can never match: window long closed (2x grace so a row
  // confirming late can still arrive) and NO eligible same-team row left at all
  // (in-window or not — an out-of-window row keeps the event alive for Rule 2).
  // Typical cause: the pick happened before the baseline capture, so its card
  // change is baked into the baseline. Keeping such events would block Rule 2.
  const prunedSlots: number[] = []
  const events: GsiHeroEvent[] = []
  for (const event of eventBySlot.values()) {
    const expired = input.nowMs > event.atMs + 2 * slackAfter
    const possibleRows = input.rows.filter(
      (r) => eligibleRow(r) && sameTeam(event.slot, r.row),
    )
    if (expired && possibleRows.length === 0) {
      prunedSlots.push(event.slot)
    } else {
      events.push(event)
    }
  }

  return { mappings, newMappings, events, prunedSlots }
}
