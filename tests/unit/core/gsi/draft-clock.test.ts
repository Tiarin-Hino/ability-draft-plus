import { describe, it, expect } from 'vitest'
import {
  buildTurnSchedule,
  turnAt,
  turnsEndedBetween,
  isRoundBreak,
} from '@core/gsi/draft-clock'

// Small config for arithmetic-friendly tests: 4 players (2 per team), 5s turns,
// 3s breaks, 2 rounds. Interleaved order: [0, 2, 1, 3]; round 2 reversed.
const CFG = { turnDurationS: 5, roundBreakS: 3, playerCount: 4, rounds: 2 }

describe('buildTurnSchedule', () => {
  it('interleaves radiant/dire and reverses on even rounds, with round breaks', () => {
    const schedule = buildTurnSchedule(CFG)
    expect(schedule).toHaveLength(8)
    // Offsets are relative to clock zero — the first turn starts immediately
    expect(schedule[0]).toEqual({
      seq: 0,
      round: 0,
      playerIndex: 0,
      startS: 0,
      endS: 5,
    })
    // Round 1 forward: R1,D1,R2,D2 = [0,2,1,3] — round 2 reversed: [3,1,2,0]
    expect(schedule.map((w) => w.playerIndex)).toEqual([0, 2, 1, 3, 3, 1, 2, 0])
    // Contiguous inside a round; the break separates rounds
    expect(schedule[1].startS).toBe(5)
    expect(schedule[3].endS).toBe(20)
    expect(schedule[4].startS).toBe(23) // 20 + 3s break
    expect(schedule[7].endS).toBe(43)
    schedule.forEach((w, i) => expect(w.seq).toBe(i))
  })

  it('default config covers 50 turns (4 ability picks + model pick) for 10 players', () => {
    const schedule = buildTurnSchedule()
    expect(schedule).toHaveLength(50)
    expect(schedule[0].startS).toBe(0)
    expect(new Set(schedule.map((w) => w.playerIndex)).size).toBe(10)
    // Round 1: radiant 1st (0), dire 1st (5), radiant 2nd (1), ...
    expect(schedule.slice(0, 10).map((w) => w.playerIndex)).toEqual([
      0, 5, 1, 6, 2, 7, 3, 8, 4, 9,
    ])
    // Serpentine boundary: last pick of round 1 and first of round 2 are both player 9
    expect(schedule[9].playerIndex).toBe(9)
    expect(schedule[10].playerIndex).toBe(9)
    // Round break: round 1 ends at 70, round 2 starts at 75
    expect(schedule[9].endS).toBe(70)
    expect(schedule[10].startS).toBe(75)
    // Full draft: 5 rounds * 70s + 4 breaks * 5s
    expect(schedule[49].endS).toBe(5 * 70 + 4 * 5)
  })
})

describe('turnAt', () => {
  const schedule = buildTurnSchedule(CFG)

  it('returns null before clock zero (preview)', () => {
    expect(turnAt(-10, schedule)).toBeNull()
    expect(turnAt(-0.1, schedule)).toBeNull()
  })

  it('returns the active turn, inclusive start exclusive end', () => {
    expect(turnAt(0, schedule)?.seq).toBe(0)
    expect(turnAt(4.99, schedule)?.seq).toBe(0)
    expect(turnAt(5, schedule)?.seq).toBe(1)
  })

  it('returns null during a round break', () => {
    expect(turnAt(21, schedule)).toBeNull()
    expect(turnAt(23, schedule)?.seq).toBe(4)
  })

  it('returns null after the draft ends', () => {
    expect(turnAt(1000, schedule)).toBeNull()
  })
})

describe('turnsEndedBetween', () => {
  const schedule = buildTurnSchedule(CFG)

  it('returns turns that fully ended inside the window', () => {
    // Turn 0 ends at 5, turn 1 at 10
    expect(turnsEndedBetween(schedule, 0, 6).map((w) => w.seq)).toEqual([0])
    expect(turnsEndedBetween(schedule, 0, 10).map((w) => w.seq)).toEqual([0, 1])
  })

  it('excludes turns ending exactly at the window start', () => {
    expect(turnsEndedBetween(schedule, 5, 10).map((w) => w.seq)).toEqual([1])
  })

  it('returns empty when no turn completed', () => {
    expect(turnsEndedBetween(schedule, 0, 4)).toEqual([])
  })
})

describe('isRoundBreak', () => {
  const schedule = buildTurnSchedule(CFG)

  it('is false during the preview and during turns', () => {
    expect(isRoundBreak(-5, schedule)).toBe(false)
    expect(isRoundBreak(2, schedule)).toBe(false)
    expect(isRoundBreak(24, schedule)).toBe(false)
  })

  it('is true between rounds and after the final turn', () => {
    expect(isRoundBreak(20, schedule)).toBe(true)
    expect(isRoundBreak(22.9, schedule)).toBe(true)
    expect(isRoundBreak(43, schedule)).toBe(true)
    expect(isRoundBreak(9999, schedule)).toBe(true)
  })
})
