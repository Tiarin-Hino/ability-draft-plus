import { describe, it, expect } from 'vitest'
import {
  reconcileAbilityPicks,
  orderByDraftTurns,
  assignDraftTurns,
} from '@core/domain/pick-attribution'
import { buildTurnSchedule } from '@core/gsi/draft-clock'
import type { ScanResult } from '@shared/types'
import type { PickEvent } from '@shared/types/stream'

type Read = string | null | 'unknown'

function box(row: number, index: number, read: Read, is_ultimate = false): ScanResult {
  const unknown = read === 'unknown'
  return {
    name: unknown ? null : read,
    confidence: read === null ? 0 : unknown ? 0.3 : 0.99,
    hero_order: row,
    ability_order: 0,
    is_ultimate,
    coord: { x: row * 100 + index * 10, y: is_ultimate ? 0 : 50, width: 46, height: 46, hero_order: row },
    ...(unknown ? { rejectedMatch: { bestName: 'x', secondName: 'y', margin: 0.01 } } : {}),
  }
}

/** A player's whole card: three standard boxes + the ultimate box. */
function card(row: number, std: [Read, Read, Read], ult: Read = null): ScanResult[] {
  return [box(row, 0, std[0]), box(row, 1, std[1]), box(row, 2, std[2]), box(row, 3, ult, true)]
}

function pick(seq: number, row: number, name: string, group: 'std' | 'ult' = 'std', vacated = false): PickEvent {
  return {
    seq,
    playerIndex: row,
    abilityName: name,
    kind: 'ability',
    clockTime: -3,
    box: group,
    ...(vacated ? { vacated: true } : {}),
  }
}

function marker(seq: number, row: number): PickEvent {
  return { seq, playerIndex: row, abilityName: null, kind: 'modelSelectionMarker', clockTime: -3 }
}

const run = (timeline: PickEvent[], next: ScanResult[]) =>
  reconcileAbilityPicks({ timeline, nextSelected: next, clockTime: -5 })

describe('reconcileAbilityPicks — new picks', () => {
  it('a name appearing on a card is that player’s pick, tagged with its box group', () => {
    const update = run([], card(3, ['sven_storm_bolt', null, null]))
    expect(update.added).toEqual([
      { playerIndex: 3, abilityName: 'sven_storm_bolt', kind: 'ability', clockTime: -5, box: 'std' },
    ])
  })

  it('an unchanged card adds nothing', () => {
    const update = run([pick(0, 0, 'lion_impale')], [...card(0, ['lion_impale', null, null]), ...card(1, [null, null, null])])
    expect(update.added).toEqual([])
    expect(update.vacatedChanged).toBe(false)
  })

  it('Dota reordering the standard boxes is not a change (live: 127/127 box changes were shifts)', () => {
    const timeline = [pick(0, 9, 'axe_counter_helix')]
    // Berserker's Call lands and pushes Counter Helix from box 1 to box 2
    const update = run(timeline, card(9, ['axe_berserkers_call', 'axe_counter_helix', null]))
    expect(update.timeline).toEqual(timeline)
    expect(update.corrected).toEqual([])
    expect(update.added.map((e) => e.abilityName)).toEqual(['axe_berserkers_call'])
  })

  it('the same ability on a DIFFERENT card is that player’s pick', () => {
    const update = run([pick(0, 2, 'juggernaut_blade_fury')], [
      ...card(2, ['juggernaut_blade_fury', null, null]),
      ...card(4, ['juggernaut_blade_fury', null, null]),
    ])
    expect(update.added.map((e) => e.playerIndex)).toEqual([4])
  })
})

describe('reconcileAbilityPicks — healing (live lobby drafts, 2026-09-16)', () => {
  it('a name replaced while every box reads cleanly was a misread: renamed in place', () => {
    const timeline = [pick(0, 6, 'wisp_overcharge')]
    const update = run(timeline, card(6, ['witch_doctor_paralyzing_cask', null, null]))
    expect(update.timeline).toEqual([{ ...timeline[0], abilityName: 'witch_doctor_paralyzing_cask' }])
    expect(update.added).toEqual([])
    expect(update.corrected).toEqual([
      { playerIndex: 6, from: 'wisp_overcharge', to: 'witch_doctor_paralyzing_cask' },
    ])
  })

  it('a name hidden while a box is unreadable is only flagged, never removed', () => {
    const update = run([pick(0, 5, 'windrunner_focusfire', 'ult')], card(5, [null, null, null], 'unknown'))
    expect(update.timeline).toEqual([pick(0, 5, 'windrunner_focusfire', 'ult', true)])
    expect(update.phantoms).toEqual([])
    expect(update.vacatedChanged).toBe(true)
  })

  it('flagged, then another ability once readable: phantom removed, real pick new (Focus Fire -> Mana Void)', () => {
    const timeline = [marker(0, 5), pick(1, 5, 'windrunner_focusfire', 'ult', true)]
    const update = run(timeline, card(5, ['wisp_spirits', null, null], 'antimage_mana_void'))
    expect(update.timeline).toEqual([marker(0, 5)])
    expect(update.phantoms).toEqual([{ playerIndex: 5, name: 'windrunner_focusfire' }])
    expect(update.corrected).toEqual([]) // NOT renamed into Focus Fire's turn
    expect(update.added.map((e) => e.abilityName)).toEqual(['wisp_spirits', 'antimage_mana_void'])
  })

  it('flagged, then the same ability: it was only hidden, the flag clears', () => {
    const update = run([pick(0, 5, 'antimage_mana_void', 'ult', true)], card(5, [null, null, null], 'antimage_mana_void'))
    expect(update.timeline).toEqual([pick(0, 5, 'antimage_mana_void', 'ult')])
    expect(update.vacatedChanged).toBe(true)
  })

  it('a name gone from a cleanly read card with nothing replacing it was a phantom', () => {
    const update = run([pick(0, 1, 'tusk_snowball')], card(1, [null, null, null]))
    expect(update.timeline).toEqual([])
    expect(update.phantoms).toEqual([{ playerIndex: 1, name: 'tusk_snowball' }])
  })

  it('an incomplete card (not every box in the state) never removes anything', () => {
    const partial = [box(1, 0, null), box(1, 1, null)]
    const update = run([pick(0, 1, 'tusk_snowball')], partial)
    expect(update.phantoms).toEqual([])
    expect(update.timeline[0].vacated).toBe(true)
  })

  it('never touches model markers', () => {
    const update = run([marker(0, 6), pick(1, 6, 'wisp_overcharge')], card(6, [null, null, null]))
    expect(update.timeline[0]).toEqual(marker(0, 6))
  })
})

describe('orderByDraftTurns', () => {
  const SCHEDULE = buildTurnSchedule()
  const ORDER = SCHEDULE.map((t) => t.playerIndex)

  it('uses the serpentine draft order: 0,5,1,6,...,4,9 then reversed', () => {
    expect(ORDER.slice(0, 10)).toEqual([0, 5, 1, 6, 2, 7, 3, 8, 4, 9])
    expect(ORDER.slice(10, 20)).toEqual([9, 4, 8, 3, 7, 2, 6, 1, 5, 0])
    expect(ORDER).toHaveLength(50)
  })

  function event(row: number, name: string | null, seenAtS?: number): PickEvent {
    return {
      seq: 0,
      playerIndex: row,
      abilityName: name,
      kind: name === null ? 'modelSelectionMarker' : 'ability',
      clockTime: null,
      ...(seenAtS !== undefined ? { seenAtS } : {}),
    }
  }

  /** The player's turn windows, round by round. */
  const turnsOf = (row: number) => SCHEDULE.filter((t) => t.playerIndex === row)
  /** Seen `lag` seconds after the player's turn in `round` (0-based) ended. */
  const seen = (row: number, round: number, lag = 4) => turnsOf(row)[round].endS + lag
  /** Round (0-based) each pick lands in, by name ('model' for a marker). */
  const roundsOf = (picks: PickEvent[]) => {
    const turns = assignDraftTurns(picks, SCHEDULE)
    return Object.fromEntries(
      picks.map((e, i) => [e.abilityName ?? 'model', turns[i] === null ? null : SCHEDULE[turns[i]].round]),
    )
  }

  describe('untimed picks (no anchor: replay, mid-draft join, spectate GSI markers)', () => {
    const ROUND_1 = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9].map((row) => event(row, `r1-${row}`))

    it('a pick discovered late lands at its turn (Io after a double turn)', () => {
      const discovered = [...ROUND_1, event(4, 'r2-4'), event(8, 'r2-8'), event(9, 'r2-9')]
      const ordered = orderByDraftTurns(discovered, SCHEDULE)
      expect(ordered.slice(10).map((e) => e.abilityName)).toEqual(['r2-9', 'r2-4', 'r2-8'])
      expect(ordered.map((e) => e.seq)).toEqual(ordered.map((_, i) => i))
    })

    it('picks found together in one scan follow turn order, not card order', () => {
      const round2 = [9, 4, 8, 3, 7, 2, 6, 1].map((row) => event(row, `r2-${row}`))
      const discovered = [...ROUND_1, ...round2, event(0, 'r2-0 ice blast'), event(5, 'r2-5 spirits')]
      const tail = orderByDraftTurns(discovered, SCHEDULE).slice(18).map((e) => e.abilityName)
      expect(tail).toEqual(['r2-5 spirits', 'r2-0 ice blast'])
    })

    it("an extra pick beyond a player's turns stays after the scheduled ones", () => {
      const tooMany = [0, 1, 2, 3, 4, 5].map((i) => event(0, `p${i}`))
      expect(orderByDraftTurns(tooMany, SCHEDULE).map((e) => e.abilityName)).toEqual([
        'p0',
        'p1',
        'p2',
        'p3',
        'p4',
        'p5',
      ])
    })
  })

  describe('timed picks (seenAtS)', () => {
    it('a model pick that was never read leaves a gap (live 2026-09-17: Io card unread)', () => {
      const picks = [
        event(3, 'mana break', seen(3, 0)),
        event(3, 'atrophy aura', seen(3, 2)),
        event(3, 'powershot', seen(3, 3)),
        event(3, 'focus fire', seen(3, 4)),
      ]
      expect(roundsOf(picks)).toEqual({
        'mana break': 0,
        'atrophy aura': 2,
        powershot: 3,
        'focus fire': 4,
      })
    })

    it('the missing pick, read at the very end, fills its gap', () => {
      const picks = [
        event(3, 'mana break', seen(3, 0)),
        event(3, 'atrophy aura', seen(3, 2)),
        event(3, 'powershot', seen(3, 3)),
        event(3, 'focus fire', seen(3, 4)),
        event(3, null, seen(3, 4, 30)),
      ]
      expect(roundsOf(picks)).toEqual({
        'mana break': 0,
        model: 1,
        'atrophy aura': 2,
        powershot: 3,
        'focus fire': 4,
      })
    })

    it('a late read does not take a turn that a timely read proves', () => {
      // The round-2 model read during round 4, just after Powershot showed at its own turn
      const picks = [
        event(3, 'mana break', seen(3, 0)),
        event(3, 'atrophy aura', seen(3, 2)),
        event(3, 'powershot', seen(3, 3, -3)),
        event(3, null, seen(3, 3, 6)),
        event(3, 'focus fire', seen(3, 4)),
      ]
      expect(roundsOf(picks)).toEqual({
        'mana break': 0,
        model: 1,
        'atrophy aura': 2,
        powershot: 3,
        'focus fire': 4,
      })
    })

    it('the first pick of a double turn read late stays first (live 2026-09-16: Death Ward, 14 s late)', () => {
      const [r1, r2] = turnsOf(9)
      expect(r2.endS - r1.endS).toBe(12) // back to back at the round break
      const deathWard = event(9, 'death ward', r1.endS + 14)
      for (const secondSeen of [r1.endS + 16, r2.endS + 9]) {
        expect(roundsOf([event(9, 'second', secondSeen), deathWard])).toEqual({ 'death ward': 0, second: 1 })
      }
    })

    it('a pick seen long after its turn, with nothing missing earlier, keeps its round', () => {
      const picks = [event(4, 'r1', seen(4, 0)), event(4, 'r2', seen(4, 1, 25))]
      expect(roundsOf(picks)).toEqual({ r1: 0, r2: 1 })
    })

    it('discovery order does not matter', () => {
      const picks = [
        event(6, 'c', seen(6, 2)),
        event(1, 'x', seen(1, 0)),
        event(6, 'a', seen(6, 0)),
        event(6, 'b', seen(6, 1)),
      ]
      expect(orderByDraftTurns(picks, SCHEDULE).map((e) => e.abilityName)).toEqual(['x', 'a', 'b', 'c'])
    })

    it('untimed picks fill the gaps timed ones leave', () => {
      const picks = [event(2, 'untimed marker'), event(2, 'r1', seen(2, 0)), event(2, 'r3', seen(2, 2))]
      expect(roundsOf(picks)).toEqual({
        r1: 0,
        'untimed marker': 1,
        r3: 2,
      })
    })
  })

  it('is idempotent (random drafts with gaps, late reads, untimed picks, duplicates)', () => {
    let state = 12345
    const random = () => {
      state = (state * 1103515245 + 12345) % 2 ** 31
      return state / 2 ** 31
    }
    for (let draft = 0; draft < 500; draft++) {
      const picks: PickEvent[] = []
      for (const turn of SCHEDULE) {
        const roll = random()
        if (roll < 0.1) continue // never read
        const lag = roll < 0.2 ? 20 + random() * 120 : roll < 0.25 ? -30 : random() * 10 - 3
        const count = random() < 0.05 ? 2 : 1
        for (let i = 0; i < count; i++) {
          const timed = random() >= 0.1
          picks.push(event(turn.playerIndex, `t${turn.seq}-${i}`, timed ? Math.round(turn.endS + lag) : undefined))
        }
      }
      for (let i = picks.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[picks[i], picks[j]] = [picks[j], picks[i]]
      }
      const once = orderByDraftTurns(picks, SCHEDULE)
      expect(once).toHaveLength(picks.length)
      expect(orderByDraftTurns(once, SCHEDULE)).toEqual(once)
    }
  })
})
