import { describe, it, expect } from 'vitest'
import {
  buildTurnSchedule,
  turnAt,
  elapsedTurnsBetween,
  DEFAULT_AD_DRAFT_CLOCK,
} from '@core/gsi/draft-clock'

const CFG = { previewDurationS: 10, turnDurationS: 5, playerCount: 4, rounds: 2 }

describe('buildTurnSchedule', () => {
  it('builds playerCount * rounds serpentine turns after the preview', () => {
    const schedule = buildTurnSchedule(CFG)
    expect(schedule).toHaveLength(8)
    expect(schedule[0]).toEqual({ seq: 0, playerIndex: 0, startS: 10, endS: 15 })
    // Round 1 forward: 0,1,2,3 — round 2 reversed: 3,2,1,0
    expect(schedule.map((w) => w.playerIndex)).toEqual([0, 1, 2, 3, 3, 2, 1, 0])
    // Contiguous windows
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].startS).toBe(schedule[i - 1].endS)
      expect(schedule[i].seq).toBe(i)
    }
  })

  it('default config covers 40 picks for 10 players', () => {
    const schedule = buildTurnSchedule()
    expect(schedule).toHaveLength(40)
    expect(schedule[0].startS).toBe(DEFAULT_AD_DRAFT_CLOCK.previewDurationS)
    expect(new Set(schedule.map((w) => w.playerIndex)).size).toBe(10)
    // Serpentine boundary: last pick of round 1 and first of round 2 are both player 9
    expect(schedule[9].playerIndex).toBe(9)
    expect(schedule[10].playerIndex).toBe(9)
  })
})

describe('turnAt', () => {
  const schedule = buildTurnSchedule(CFG)

  it('returns null during the preview period', () => {
    expect(turnAt(0, schedule)).toBeNull()
    expect(turnAt(9.9, schedule)).toBeNull()
  })

  it('returns the active turn, inclusive start exclusive end', () => {
    expect(turnAt(10, schedule)?.seq).toBe(0)
    expect(turnAt(14.99, schedule)?.seq).toBe(0)
    expect(turnAt(15, schedule)?.seq).toBe(1)
  })

  it('returns null after the draft ends', () => {
    expect(turnAt(1000, schedule)).toBeNull()
  })
})

describe('elapsedTurnsBetween', () => {
  const schedule = buildTurnSchedule(CFG)

  it('returns turns that fully ended inside the window', () => {
    // Turn 0 ends at 15, turn 1 at 20
    expect(elapsedTurnsBetween(schedule, 0, 16).map((w) => w.seq)).toEqual([0])
    expect(elapsedTurnsBetween(schedule, 0, 20).map((w) => w.seq)).toEqual([0, 1])
  })

  it('excludes turns ending exactly at the window start', () => {
    expect(elapsedTurnsBetween(schedule, 15, 20).map((w) => w.seq)).toEqual([1])
  })

  it('returns empty when no turn completed', () => {
    expect(elapsedTurnsBetween(schedule, 10, 12)).toEqual([])
  })
})
