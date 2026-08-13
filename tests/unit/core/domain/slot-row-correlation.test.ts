import { describe, it, expect } from 'vitest'
import {
  initialCardRows,
  detectCardChanges,
  correlateSlotRows,
} from '@core/domain/slot-row-correlation'
import type {
  PlayerCardCapture,
  CardRowState,
  GsiHeroEvent,
  SlotRowMapping,
} from '@core/domain/slot-row-correlation'

function card(row: number, fill: number, length = 27): PlayerCardCapture {
  return { row, tile: new Uint8Array(length).fill(fill) }
}

/** All 10 cards at the given fill, with per-row overrides. */
function cards(overrides: Record<number, number> = {}): PlayerCardCapture[] {
  return Array.from({ length: 10 }, (_, row) => card(row, overrides[row] ?? 100))
}

const ALL_ROWS = Array.from({ length: 10 }, (_, i) => i)

/** Rows after one clean scan (all static, baselines verified). */
function verifiedRows(): CardRowState[] {
  return detectCardChanges({
    baselines: cards(),
    current: cards(),
    rows: initialCardRows(ALL_ROWS),
    nowMs: 0,
  }).rows
}

/** Shorthand: run detectCardChanges over a sequence of scans. */
function scanSequence(
  rows: CardRowState[],
  scans: Array<{ overrides: Record<number, number>; nowMs: number }>,
): CardRowState[] {
  let state = rows
  for (const scan of scans) {
    state = detectCardChanges({
      baselines: cards(),
      current: cards(scan.overrides),
      rows: state,
      nowMs: scan.nowMs,
    }).rows
  }
  return state
}

const event = (slot: number, atMs: number, npcName = 'sand_king'): GsiHeroEvent => ({
  slot,
  npcName,
  atMs,
})

// Slacks used throughout: before 10s, after 20s (defaults from thresholds)
const AFTER = 20_000
const BEFORE = 10_000

describe('initialCardRows', () => {
  it('starts every row static and unverified', () => {
    const rows = initialCardRows([0, 1])
    expect(rows).toEqual([
      { row: 0, baselineVerified: false, status: 'static', firstChangedAtMs: null },
      { row: 1, baselineVerified: false, status: 'static', firstChangedAtMs: null },
    ])
  })
})

describe('detectCardChanges', () => {
  it('verifies the baseline when a card reads equal to it', () => {
    const rows = verifiedRows()
    expect(rows.every((r) => r.baselineVerified && r.status === 'static')).toBe(true)
  })

  it('requires two consecutive changed reads to confirm (tooltip guard)', () => {
    const afterFirst = detectCardChanges({
      baselines: cards(),
      current: cards({ 3: 200 }),
      rows: verifiedRows(),
      nowMs: 5_000,
    })
    expect(afterFirst.newlyChanged).toEqual([])
    expect(afterFirst.rows[3]).toMatchObject({ status: 'pending', firstChangedAtMs: 5_000 })

    const afterSecond = detectCardChanges({
      baselines: cards(),
      current: cards({ 3: 200 }),
      rows: afterFirst.rows,
      nowMs: 10_000,
    })
    expect(afterSecond.newlyChanged).toEqual([{ row: 3, diff: 100 }])
    // firstChangedAtMs stays at the FIRST sighting — that is the pick-adjacent time
    expect(afterSecond.rows[3]).toMatchObject({ status: 'changed', firstChangedAtMs: 5_000 })
  })

  it('clears a pending flicker that reads static again', () => {
    const rows = scanSequence(verifiedRows(), [
      { overrides: { 3: 200 }, nowMs: 5_000 },
      { overrides: {}, nowMs: 10_000 },
    ])
    expect(rows[3]).toMatchObject({ status: 'static', firstChangedAtMs: null })
  })

  it('reverts a confirmed change when the card matches the baseline again (replay rewind)', () => {
    const rows = scanSequence(verifiedRows(), [
      { overrides: { 3: 200 }, nowMs: 5_000 },
      { overrides: { 3: 210 }, nowMs: 10_000 },
      { overrides: {}, nowMs: 15_000 },
    ])
    expect(rows[3]).toMatchObject({ status: 'static', firstChangedAtMs: null })
    // ...and a later re-pick starts a fresh change with a fresh timestamp
    const repicked = scanSequence(rows, [
      { overrides: { 3: 220 }, nowMs: 60_000 },
      { overrides: { 3: 230 }, nowMs: 65_000 },
    ])
    expect(repicked[3]).toMatchObject({ status: 'changed', firstChangedAtMs: 60_000 })
  })

  it('never verifies a row that always differs from its baseline (pre-drafted card)', () => {
    const rows = scanSequence(initialCardRows(ALL_ROWS), [
      { overrides: { 2: 250 }, nowMs: 5_000 },
      { overrides: { 2: 240 }, nowMs: 10_000 },
    ])
    expect(rows[2]).toMatchObject({ status: 'changed', baselineVerified: false })
  })

  it('keeps state for rows missing from the capture (failed crop)', () => {
    const before = scanSequence(verifiedRows(), [
      { overrides: { 3: 200 }, nowMs: 5_000 },
      { overrides: { 3: 200 }, nowMs: 10_000 },
    ])
    const result = detectCardChanges({
      baselines: cards(),
      current: cards({ 3: 200 }).filter((c) => c.row !== 3),
      rows: before,
      nowMs: 15_000,
    })
    expect(result.rows[3]).toMatchObject({ status: 'changed', firstChangedAtMs: 5_000 })
  })

  it('ignores sub-threshold noise', () => {
    const result = detectCardChanges({
      baselines: cards(),
      current: cards({ 3: 105 }),
      rows: verifiedRows(),
      nowMs: 5_000,
    })
    expect(result.rows[3].status).toBe('static')
  })
})

describe('correlateSlotRows', () => {
  /** Verified rows with the given rows confirmed changed at the given times. */
  function changedRows(changes: Record<number, number>): CardRowState[] {
    return verifiedRows().map((r) =>
      changes[r.row] !== undefined
        ? { ...r, status: 'changed' as const, firstChangedAtMs: changes[r.row] }
        : r,
    )
  }

  it('maps a lone in-window pair once the event window closes', () => {
    const input = {
      events: [event(2, 50_000)],
      rows: changedRows({ 4: 53_000 }),
      mappings: [] as SlotRowMapping[],
      nowMs: 50_000 + AFTER + 1,
    }
    const result = correlateSlotRows(input)
    expect(result.newMappings).toEqual([{ gsiSlot: 2, scanRow: 4 }])
    expect(result.events).toEqual([])
  })

  it('does not commit while the event window is still open', () => {
    const result = correlateSlotRows({
      events: [event(2, 50_000)],
      rows: changedRows({ 4: 53_000 }),
      mappings: [],
      nowMs: 60_000,
    })
    expect(result.newMappings).toEqual([])
    expect(result.events).toHaveLength(1)
  })

  it('restricts candidates to the event team half', () => {
    // Dire slot 7 event; only a radiant row changed in window -> no mapping
    const result = correlateSlotRows({
      events: [event(7, 50_000)],
      rows: changedRows({ 4: 53_000 }),
      mappings: [],
      nowMs: 50_000 + AFTER + 1,
    })
    expect(result.newMappings).toEqual([])
  })

  it('leaves a simultaneous two-pick window ambiguous', () => {
    const result = correlateSlotRows({
      events: [event(1, 50_000), event(2, 51_000)],
      rows: changedRows({ 3: 52_000, 4: 53_000 }),
      mappings: [],
      nowMs: 200_000,
    })
    expect(result.newMappings).toEqual([])
    expect(result.events).toHaveLength(2)
  })

  it('resolves an ambiguous pair by elimination when one side gets mapped', () => {
    // Slot 1 already mapped to row 3 — slot 2's only remaining candidate is row 4
    const result = correlateSlotRows({
      events: [event(1, 50_000), event(2, 51_000)],
      rows: changedRows({ 3: 52_000, 4: 53_000 }),
      mappings: [{ gsiSlot: 1, scanRow: 3 }],
      nowMs: 200_000,
    })
    expect(result.newMappings).toEqual([{ gsiSlot: 2, scanRow: 4 }])
  })

  it('excludes unverified rows (hero already drafted at baseline time)', () => {
    const rows = changedRows({ 4: 53_000 }).map((r) =>
      r.row === 4 ? { ...r, baselineVerified: false } : r,
    )
    const result = correlateSlotRows({
      events: [event(2, 50_000)],
      rows,
      mappings: [],
      nowMs: 50_000 + AFTER + 1,
    })
    expect(result.newMappings).toEqual([])
  })

  it('blocks a commit when another event also claims the row', () => {
    // Both events in window of row 4; only one row changed -> mutual claim, no commit
    const result = correlateSlotRows({
      events: [event(1, 50_000), event(2, 52_000)],
      rows: changedRows({ 4: 53_000 }),
      mappings: [],
      nowMs: 80_000,
    })
    expect(result.newMappings).toEqual([])
  })

  it('resolves out-of-window pairs by per-team elimination', () => {
    // Row confirmed way outside the event window (tooltip storm), but they are
    // the last unmapped event+row of the team and both arrival windows passed
    const eventAt = 50_000
    const rowAt = eventAt + AFTER + 15_000
    const result = correlateSlotRows({
      events: [event(2, eventAt)],
      rows: changedRows({ 4: rowAt }),
      mappings: [],
      nowMs: rowAt + BEFORE + 1,
    })
    expect(result.newMappings).toEqual([{ gsiSlot: 2, scanRow: 4 }])
  })

  it('holds per-team elimination until the row could still have an in-flight event', () => {
    const eventAt = 50_000
    const rowAt = eventAt + AFTER + 15_000
    const result = correlateSlotRows({
      events: [event(2, eventAt)],
      rows: changedRows({ 4: rowAt }),
      mappings: [],
      nowMs: rowAt + BEFORE - 1,
    })
    expect(result.newMappings).toEqual([])
    // The eligible row keeps the event alive past the prune grace so the
    // elimination can still happen on a later call
    expect(result.events).toHaveLength(1)
  })

  it('uses the latest event per slot (replay rewind re-pick)', () => {
    const result = correlateSlotRows({
      events: [event(2, 10_000, 'lion'), event(2, 90_000, 'sand_king')],
      rows: changedRows({ 4: 92_000 }),
      mappings: [],
      nowMs: 90_000 + AFTER + 1,
    })
    expect(result.newMappings).toEqual([{ gsiSlot: 2, scanRow: 4 }])
  })

  it('prunes unmatchable events after the grace period', () => {
    const result = correlateSlotRows({
      events: [event(2, 10_000)],
      rows: verifiedRows(),
      mappings: [],
      nowMs: 10_000 + 2 * AFTER + 1,
    })
    expect(result.prunedSlots).toEqual([2])
    expect(result.events).toEqual([])
  })

  it('keeps unmatched events through the grace period', () => {
    const result = correlateSlotRows({
      events: [event(2, 10_000)],
      rows: verifiedRows(),
      mappings: [],
      nowMs: 10_000 + 2 * AFTER - 1,
    })
    expect(result.prunedSlots).toEqual([])
    expect(result.events).toHaveLength(1)
  })

  it('ignores events for already-mapped slots and preserves mappings', () => {
    const result = correlateSlotRows({
      events: [event(2, 90_000)],
      rows: changedRows({ 4: 92_000 }),
      mappings: [{ gsiSlot: 2, scanRow: 0 }],
      nowMs: 200_000,
    })
    expect(result.mappings).toEqual([{ gsiSlot: 2, scanRow: 0 }])
    expect(result.newMappings).toEqual([])
    expect(result.events).toEqual([])
  })

  it('cascades: a rule-1 commit unlocks a per-team elimination', () => {
    // Slot 1 cleanly matches row 3; slot 2 + row 4 are then the last pair
    const result = correlateSlotRows({
      events: [event(1, 50_000), event(2, 100_000)],
      rows: changedRows({ 3: 52_000, 4: 160_000 }),
      mappings: [],
      nowMs: 200_000,
    })
    expect(result.mappings).toEqual([
      { gsiSlot: 1, scanRow: 3 },
      { gsiSlot: 2, scanRow: 4 },
    ])
  })
})
