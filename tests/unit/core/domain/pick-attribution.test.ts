import { describe, it, expect } from 'vitest'
import { attributePicks } from '@core/domain/pick-attribution'
import type { TurnWindow } from '@core/gsi/draft-clock'

function turn(seq: number, playerIndex: number): TurnWindow {
  return { seq, playerIndex, startS: seq * 10, endS: seq * 10 + 10 }
}

const POOL = ['a', 'b', 'c', 'd', 'e']

describe('attributePicks', () => {
  it('attributes a single departure to the single elapsed turn', () => {
    const result = attributePicks({
      prevPoolNames: POOL,
      newPoolNames: ['a', 'c', 'd', 'e'],
      elapsedTurns: [turn(0, 3)],
      nextSeq: 0,
      clockTime: 42,
    })
    expect(result.events).toEqual([
      { seq: 0, playerIndex: 3, abilityName: 'b', kind: 'ability', clockTime: 42 },
    ])
    expect(result.unattributed).toEqual([])
  })

  it('attributes two departures across two elapsed turns in order (post-suppression catch-up)', () => {
    const result = attributePicks({
      prevPoolNames: POOL,
      newPoolNames: ['a', 'd', 'e'],
      elapsedTurns: [turn(4, 4), turn(5, 5)],
      nextSeq: 7,
      clockTime: null,
    })
    expect(result.events.map((e) => [e.seq, e.playerIndex, e.abilityName])).toEqual([
      [7, 4, 'b'],
      [8, 5, 'c'],
    ])
  })

  it('emits model markers for elapsed turns without departures', () => {
    const result = attributePicks({
      prevPoolNames: POOL,
      newPoolNames: POOL,
      elapsedTurns: [turn(2, 7)],
      nextSeq: 3,
      clockTime: 10,
    })
    expect(result.events).toEqual([
      {
        seq: 3,
        playerIndex: 7,
        abilityName: null,
        kind: 'modelSelectionMarker',
        clockTime: 10,
      },
    ])
  })

  it('mixes abilities (earliest turns) and markers (remaining turns)', () => {
    const result = attributePicks({
      prevPoolNames: POOL,
      newPoolNames: ['a', 'c', 'd', 'e'],
      elapsedTurns: [turn(0, 1), turn(1, 2)],
      nextSeq: 0,
      clockTime: null,
    })
    expect(result.events.map((e) => e.kind)).toEqual([
      'ability',
      'modelSelectionMarker',
    ])
    expect(result.events[0].abilityName).toBe('b')
    expect(result.events[1].playerIndex).toBe(2)
  })

  it('returns surplus departures as unattributed (drift)', () => {
    const result = attributePicks({
      prevPoolNames: POOL,
      newPoolNames: ['a', 'e'],
      elapsedTurns: [turn(0, 0)],
      nextSeq: 0,
      clockTime: null,
    })
    expect(result.events).toHaveLength(1)
    expect(result.events[0].abilityName).toBe('b')
    expect(result.unattributed).toEqual(['c', 'd'])
  })

  it('handles no elapsed turns and no departures', () => {
    const result = attributePicks({
      prevPoolNames: POOL,
      newPoolNames: POOL,
      elapsedTurns: [],
      nextSeq: 0,
      clockTime: null,
    })
    expect(result.events).toEqual([])
    expect(result.unattributed).toEqual([])
  })

  it('reports departures with no elapsed turns entirely as unattributed', () => {
    const result = attributePicks({
      prevPoolNames: POOL,
      newPoolNames: ['a', 'b', 'c', 'd'],
      elapsedTurns: [],
      nextSeq: 0,
      clockTime: null,
    })
    expect(result.events).toEqual([])
    expect(result.unattributed).toEqual(['e'])
  })
})
