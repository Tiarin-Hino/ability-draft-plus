import { describe, it, expect } from 'vitest'
import {
  resolveModelAssignments,
  reconcileModelMarkers,
} from '@core/domain/model-picks-from-ocr'
import type { ModelAssignment } from '@core/domain/model-picks-from-ocr'
import type { PickEvent } from '@shared/types/stream'

// Fixture: live lobby draft, match 9000867845 (2026-09-15). Pool order and card
// reads are exactly as logged; ground truth is the strategy-screen screenshot.
// Tile diffing committed Oracle (never picked) and missed Disruptor (the last
// pick); card OCR had all ten right.
const POOL = [
  'troll_warlord', // 0
  'undying', // 1
  'arc_warden', // 2
  'abyssal_underlord', // 3 — never picked
  'venomancer', // 4
  'dragon_knight', // 5
  'naga_siren', // 6
  'tinker', // 7
  'oracle', // 8 — never picked
  'bane', // 9
  'disruptor', // 10 — the last pick of the draft
  'windrunner', // 11
].map((heroName, heroOrder) => ({ heroOrder, heroName }))

const LIVE_READS: Record<number, { name: string; similarity: number }> = {
  0: { name: 'tinker', similarity: 0.667 },
  1: { name: 'undying', similarity: 1 },
  2: { name: 'arc_warden', similarity: 1 },
  3: { name: 'windrunner', similarity: 1 },
  4: { name: 'dragonknight', similarity: 0.667 },
  5: { name: 'nagasiren', similarity: 0.889 },
  6: { name: 'bane', similarity: 1 },
  7: { name: 'venomancer', similarity: 0.9 },
  8: { name: 'trollwarlord', similarity: 1 },
  9: { name: 'disruptor', similarity: 1 },
}

function marker(seq: number, playerIndex: number, poolHeroOrder?: number): PickEvent {
  return {
    seq,
    playerIndex,
    abilityName: null,
    kind: 'modelSelectionMarker',
    clockTime: -3,
    ...(poolHeroOrder !== undefined ? { poolHeroOrder } : {}),
  }
}

function ability(seq: number, playerIndex: number, abilityName: string): PickEvent {
  return { seq, playerIndex, abilityName, kind: 'ability', clockTime: -3 }
}

describe('resolveModelAssignments', () => {
  it('recovers the live draft exactly: all ten models, nothing phantom', () => {
    const assignments = resolveModelAssignments({
      poolModels: POOL,
      ocrByRow: LIVE_READS,
      local: { heroName: 'venomancer', row: 7 },
    })
    const byRow = Object.fromEntries(
      assignments.map((a) => [a.playerIndex, POOL[a.poolHeroOrder].heroName]),
    )
    expect(byRow).toEqual({
      0: 'tinker',
      1: 'undying',
      2: 'arc_warden',
      3: 'windrunner',
      4: 'dragon_knight',
      5: 'naga_siren',
      6: 'bane',
      7: 'venomancer',
      8: 'troll_warlord',
      9: 'disruptor',
    })
    const picked = new Set(assignments.map((a) => a.poolHeroOrder))
    expect(picked.has(8)).toBe(false) // Oracle: tile flicker, never picked
    expect(picked.has(3)).toBe(false)
  })

  it('ignores reads that name no pool hero', () => {
    const assignments = resolveModelAssignments({
      poolModels: POOL,
      ocrByRow: { 0: { name: 'zeus', similarity: 1 }, 1: { name: 'undying', similarity: 1 } },
      local: null,
    })
    expect(assignments).toEqual([{ poolHeroOrder: 1, playerIndex: 1 }])
  })

  it('anchors the local model to the known row, overruling a card misread', () => {
    const assignments = resolveModelAssignments({
      poolModels: POOL,
      ocrByRow: {
        3: { name: 'venomancer', similarity: 1 }, // misread elsewhere
        7: { name: 'bane', similarity: 1 }, // misread of the local row itself
      },
      local: { heroName: 'venomancer', row: 7 },
    })
    expect(assignments).toEqual([{ poolHeroOrder: 4, playerIndex: 7 }])
  })

  it('two rows claiming one model: the stronger read wins', () => {
    const assignments = resolveModelAssignments({
      poolModels: POOL,
      ocrByRow: {
        2: { name: 'tinker', similarity: 0.7 },
        0: { name: 'tinker', similarity: 1 },
      },
      local: null,
    })
    expect(assignments).toEqual([{ poolHeroOrder: 7, playerIndex: 0 }])
  })

  describe('a hero the pool scan missed (2026-09-18 sweep: 1 draft in 3)', () => {
    // Pool row 10 (Disruptor) came back unidentified from the initial scan
    const GAPPED = POOL.map((m) =>
      m.heroOrder === 10 ? { heroOrder: 10, heroName: 'unknown_model_10' } : m,
    )

    it('a clean read of the missing hero takes the single unidentified row', () => {
      const assignments = resolveModelAssignments({
        poolModels: GAPPED,
        ocrByRow: LIVE_READS,
        local: null,
      })
      expect(assignments).toContainEqual({ poolHeroOrder: 10, playerIndex: 9 })
      expect(assignments).toHaveLength(10)
    })

    it('with two unidentified rows it cannot tell which is which: skipped, not guessed', () => {
      const twoGaps = GAPPED.map((m) =>
        m.heroOrder === 3 ? { heroOrder: 3, heroName: 'unknown_model_3' } : m,
      )
      const assignments = resolveModelAssignments({
        poolModels: twoGaps,
        ocrByRow: LIVE_READS,
        local: null,
      })
      expect(assignments.map((a) => a.playerIndex)).not.toContain(9)
      expect(assignments).toHaveLength(9)
    })

    it('two rows reading off-pool heroes cannot both have the one gap', () => {
      const assignments = resolveModelAssignments({
        poolModels: GAPPED,
        ocrByRow: { ...LIVE_READS, 5: { name: 'pudge', similarity: 0.9 } },
        local: null,
      })
      expect(assignments.filter((a) => a.poolHeroOrder === 10)).toEqual([
        { poolHeroOrder: 10, playerIndex: 9 },
      ])
    })
  })

  it('does nothing before the pool is identified', () => {
    expect(
      resolveModelAssignments({ poolModels: [], ocrByRow: LIVE_READS, local: null }),
    ).toEqual([])
  })
})

describe('reconcileModelMarkers', () => {
  it('appends one labelled marker per newly drafting row', () => {
    const update = reconcileModelMarkers(
      [ability(0, 3, 'shadowraze1')],
      [{ poolHeroOrder: 7, playerIndex: 0 }],
      -5,
    )
    expect(update.added).toEqual([
      {
        playerIndex: 0,
        abilityName: null,
        kind: 'modelSelectionMarker',
        poolHeroOrder: 7,
        clockTime: -5,
      },
    ])
    expect(update.timeline).toEqual([ability(0, 3, 'shadowraze1')])
  })

  it('the lost last pick: nine markers present, the tenth row appends', () => {
    const nine: ModelAssignment[] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((row) => ({
      poolHeroOrder: row,
      playerIndex: row,
    }))
    const timeline = nine.map((a, seq) => marker(seq, a.playerIndex, a.poolHeroOrder))
    const update = reconcileModelMarkers(
      timeline,
      [...nine, { poolHeroOrder: 10, playerIndex: 9 }],
      0,
    )
    expect(update.added.map((m) => [m.playerIndex, m.poolHeroOrder])).toEqual([[9, 10]])
    expect(update.corrected).toEqual([])
    expect(update.dropped).toBe(0)
  })

  it('never appends a second marker for a row already marked', () => {
    const assignments = [{ poolHeroOrder: 7, playerIndex: 0 }]
    const first = reconcileModelMarkers([], assignments, 0)
    const timeline = first.added.map((m, seq) => ({ ...m, seq }))
    const second = reconcileModelMarkers(timeline, assignments, 0)
    expect(second.added).toEqual([])
    expect(second.timeline).toEqual(timeline)
  })

  it('re-labels a row whose read changed, in place', () => {
    const timeline = [marker(0, 1, 8), ability(1, 2, 'fireball')]
    const update = reconcileModelMarkers(timeline, [{ poolHeroOrder: 1, playerIndex: 1 }], 0)
    expect(update.timeline).toEqual([marker(0, 1, 1), ability(1, 2, 'fireball')])
    expect(update.added).toEqual([])
    expect(update.corrected).toEqual([{ poolHeroOrder: 1, fromRow: 1, toRow: 1, fromModel: 8 }])
  })

  it('moves a marker to the model\'s new owner instead of appending a second one', () => {
    const timeline = [marker(0, 7, 2), ability(1, 4, 'fireball')]
    const update = reconcileModelMarkers(timeline, [{ poolHeroOrder: 2, playerIndex: 2 }], 0)
    expect(update.timeline).toEqual([marker(0, 2, 2), ability(1, 4, 'fireball')])
    expect(update.added).toEqual([])
    expect(update.corrected).toEqual([{ poolHeroOrder: 2, fromRow: 7, toRow: 2, fromModel: 2 }])
  })

  it('drops a marker no assignment accounts for (the phantom Oracle)', () => {
    const timeline = [marker(0, 1, 1), marker(1, 1, 8), ability(2, 0, 'fireball')]
    const update = reconcileModelMarkers(timeline, [{ poolHeroOrder: 1, playerIndex: 1 }], 0)
    expect(update.timeline).toEqual([marker(0, 1, 1), ability(2, 0, 'fireball')])
    expect(update.dropped).toBe(1)
  })

  it('stamps when the pick was seen: new markers get it, a re-label keeps it, a move re-stamps it', () => {
    const added = reconcileModelMarkers([], [{ poolHeroOrder: 7, playerIndex: 0 }], 0, 41.5)
    expect(added.added[0].seenAtS).toBe(41.5)

    const relabel = reconcileModelMarkers(
      [{ ...marker(0, 1, 8), seenAtS: 30 }],
      [{ poolHeroOrder: 1, playerIndex: 1 }],
      0,
      90,
    )
    expect(relabel.timeline[0].seenAtS).toBe(30)

    // The misread row's time says nothing about when the real owner picked
    const move = reconcileModelMarkers(
      [{ ...marker(0, 7, 2), seenAtS: 30 }],
      [{ poolHeroOrder: 2, playerIndex: 2 }],
      0,
      90,
    )
    expect(move.timeline[0]).toMatchObject({ playerIndex: 2, seenAtS: 90 })
    const untimed = reconcileModelMarkers(
      [{ ...marker(0, 7, 2), seenAtS: 30 }],
      [{ poolHeroOrder: 2, playerIndex: 2 }],
      0,
    )
    expect(untimed.timeline[0].seenAtS).toBeUndefined()
  })

  it('never touches ability events', () => {
    const timeline = [ability(0, 0, 'a'), ability(1, 5, 'b')]
    const update = reconcileModelMarkers(timeline, [], 0)
    expect(update.timeline).toEqual(timeline)
    expect(update.added).toEqual([])
    expect(update.dropped).toBe(0)
  })
})
