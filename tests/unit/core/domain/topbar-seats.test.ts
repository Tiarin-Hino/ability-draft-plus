import { describe, it, expect } from 'vitest'
import {
  topbarPortraitRects,
  assignTeamSeats,
  completeSeats,
  mergeIdentifiedSeats,
} from '@core/domain/topbar-seats'

describe('topbarPortraitRects', () => {
  it('scales the measured 1080p bar to 2560x1440', () => {
    const rects = topbarPortraitRects({ width: 2560, height: 1440 })
    expect(rects).toHaveLength(10)
    // 544 / 1062 / 63 / 62x35 at 1080 -> x4/3 at 1440
    expect(rects[0]).toEqual({ x: 725, y: 5, w: 83, h: 47 })
    expect(rects[4].x).toBe(Math.round((544 + 4 * 63) * (4 / 3)))
    expect(rects[5].x).toBe(Math.round(1062 * (4 / 3)))
  })

  it('pillarboxes a 21:9 frame so the bar stays centred', () => {
    const wide = topbarPortraitRects({ width: 3440, height: 1440 })
    const standard = topbarPortraitRects({ width: 2560, height: 1440 })
    expect(wide[0].x - standard[0].x).toBe((3440 - 2560) / 2)
    expect(wide[0].y).toBe(standard[0].y)
  })
})

describe('assignTeamSeats', () => {
  // The live Dire half (2026-09-16 frame, production scores): seats in top-bar
  // order, candidates in draft-row order 5..9 (Dark Willow, Slark, Slardar,
  // Centaur, Sniper). Slardar is the weak portrait.
  const DIRE_ROWS = [5, 6, 7, 8, 9]
  const DIRE_SCORES = [
    [0.3, 0.77, 0.2, 0.25, 0.22], // Slark
    [0.93, 0.35, 0.4, 0.589, 0.3], // Dark Willow
    [0.15, 0.27, 0.537, 0.2, 0.25], // Slardar
    [0.3, 0.2, 0.25, 0.375, 0.819], // Sniper
    [0.504, 0.3, 0.35, 0.924, 0.28], // Centaur
  ]

  it('recovers the live Dire seats, weak portrait included', () => {
    expect(assignTeamSeats(DIRE_SCORES, DIRE_ROWS)).toEqual([6, 5, 7, 9, 8])
  })

  it('prefers the best one-to-one assignment over per-seat greed', () => {
    // Seat 0 likes candidate 0 slightly more, but seat 1 can only be candidate 0
    const scores = [
      [0.9, 0.85],
      [0.8, 0.1],
    ]
    // Per-seat greed would reject seat 0 (0.85 trails its own 0.9); the joint
    // solution is still certain: swapping costs 0.65
    expect(assignTeamSeats(scores, [0, 1])).toEqual([1, 0])
  })

  it('rejects a portrait that matches too weakly', () => {
    const scores = [
      [0.25, 0.1], // best pairing, but below minScore
      [0.05, 0.9],
    ]
    expect(assignTeamSeats(scores, [3, 4])).toEqual([null, 4])
  })

  it('rejects seats whose assignment is too close to call', () => {
    // Swapping the two pairings costs only 0.03 in total
    const scores = [
      [0.62, 0.6],
      [0.6, 0.61],
    ]
    expect(assignTeamSeats(scores, [3, 4])).toEqual([null, null])
  })

  it('leaves a seat open when a model has no art (fewer candidates than seats)', () => {
    const scores = [
      [0.9, 0.1],
      [0.1, 0.1],
      [0.2, 0.85],
    ]
    expect(assignTeamSeats(scores, [0, 2])).toEqual([0, null, 2])
  })
})

describe('completeSeats', () => {
  const LIVE = [4, 3, 1, 2, 0, 6, 5, 7, 9, 8]

  it('keeps a fully identified bar as-is, nothing guessed', () => {
    expect(completeSeats({ identified: LIVE, local: null })).toEqual({ seats: LIVE, guessed: [] })
  })

  it('a single open seat per team is elimination, not a guess', () => {
    const identified = [...LIVE] as (number | null)[]
    identified[2] = null
    identified[7] = null
    expect(completeSeats({ identified, local: null })).toEqual({ seats: LIVE, guessed: [] })
  })

  it('anchors the local seat to the row that drafted the hero they control (swap-safe)', () => {
    // Kunkka game: the local player drafted row 1 (Shadow Fiend) but swapped and
    // controls Kunkka, drafted by row 4, at seat 0 — the anchor must be row 4
    const identified = [...LIVE] as (number | null)[]
    identified[0] = null
    identified[1] = null
    expect(completeSeats({ identified, local: { seat: 0, row: 4 } })).toEqual({
      seats: LIVE,
      guessed: [],
    })
  })

  it('never lets the anchor override a confident match or cross teams', () => {
    const identified = [...LIVE] as (number | null)[]
    expect(completeSeats({ identified, local: { seat: 0, row: 1 } }).seats).toEqual(LIVE)
    const open = [...LIVE] as (number | null)[]
    open[0] = null
    // Row 7 is Dire: a Radiant seat can never take it
    expect(completeSeats({ identified: open, local: { seat: 0, row: 7 } }).seats[0]).toBe(4)
  })

  it('always fills every seat within its own team, guessing in order as a last resort', () => {
    const nothing = Array.from({ length: 10 }, () => null)
    const { seats, guessed } = completeSeats({ identified: nothing, local: null })
    expect(seats).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(guessed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})

describe('mergeIdentifiedSeats', () => {
  const none = Array.from({ length: 10 }, () => null)

  it('keeps a seat an earlier capture proved when a later one cannot read it', () => {
    const first = [...none] as (number | null)[]
    first[3] = 2 // identified while alive
    const later = [...none] as (number | null)[] // dead, greyed out
    later[4] = 0
    expect(mergeIdentifiedSeats(first, later)).toEqual([null, null, null, 2, 0, null, null, null, null, null])
  })

  it('a newer confident reading moves a row, never duplicating it', () => {
    const first = [...none] as (number | null)[]
    first[0] = 1
    const later = [...none] as (number | null)[]
    later[2] = 1
    const merged = mergeIdentifiedSeats(first, later)
    expect(merged[0]).toBeNull()
    expect(merged[2]).toBe(1)
  })
})
