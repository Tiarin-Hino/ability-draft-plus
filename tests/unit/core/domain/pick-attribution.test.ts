import { describe, it, expect } from 'vitest'
import { attributePicksByRow } from '@core/domain/pick-attribution'
import type { ScanResult } from '@shared/types'

function slot(
  hero_order: number,
  name: string | null,
  is_ultimate = false,
): ScanResult {
  return {
    name,
    confidence: name ? 0.99 : 0,
    hero_order,
    ability_order: 0,
    is_ultimate,
    coord: { x: hero_order * 100, y: is_ultimate ? 0 : 50, width: 46, height: 46, hero_order },
  }
}

describe('attributePicksByRow', () => {
  it('attributes a new name in a row to that row player', () => {
    const prev = [slot(3, null)]
    const next = [slot(3, 'sven_storm_bolt')]

    const events = attributePicksByRow({
      prevSelected: prev,
      nextSelected: next,
      nextSeq: 7,
      clockTime: 42,
    })

    expect(events).toEqual([
      {
        seq: 7,
        playerIndex: 3,
        abilityName: 'sven_storm_bolt',
        kind: 'ability',
        clockTime: 42,
      },
    ])
  })

  it('emits nothing when rows are unchanged', () => {
    const prev = [slot(0, 'sven_storm_bolt'), slot(1, null)]
    const next = [slot(0, 'sven_storm_bolt'), slot(1, null)]

    expect(
      attributePicksByRow({
        prevSelected: prev,
        nextSelected: next,
        nextSeq: 0,
        clockTime: null,
      }),
    ).toEqual([])
  })

  it('attributes multiple new picks across rows with sequential seq', () => {
    const prev = [slot(0, 'lion_impale'), slot(5, null), slot(9, null)]
    const next = [
      slot(0, 'lion_impale'),
      slot(5, 'axe_culling_blade', true),
      slot(9, 'lina_laguna_blade', true),
    ]

    const events = attributePicksByRow({
      prevSelected: prev,
      nextSelected: next,
      nextSeq: 10,
      clockTime: 100,
    })

    expect(events.map((e) => [e.seq, e.playerIndex, e.abilityName])).toEqual([
      [10, 5, 'axe_culling_blade'],
      [11, 9, 'lina_laguna_blade'],
    ])
  })

  it('the same ability appearing in a DIFFERENT row is a new pick for that row', () => {
    // Misread correction moved a name between rows — the new row gets the event
    const prev = [slot(2, 'juggernaut_blade_fury'), slot(4, null)]
    const next = [slot(2, 'juggernaut_blade_fury'), slot(4, 'juggernaut_blade_fury')]

    const events = attributePicksByRow({
      prevSelected: prev,
      nextSelected: next,
      nextSeq: 0,
      clockTime: null,
    })

    expect(events).toHaveLength(1)
    expect(events[0].playerIndex).toBe(4)
  })

  it('deduplicates repeated names within the same row', () => {
    // Two slots of the same row misread as the same ability -> one event
    const prev = [slot(6, null), slot(6, null, true)]
    const next = [slot(6, 'pudge_meat_hook'), slot(6, 'pudge_meat_hook', true)]

    const events = attributePicksByRow({
      prevSelected: prev,
      nextSelected: next,
      nextSeq: 0,
      clockTime: null,
    })

    expect(events).toHaveLength(1)
  })

  it('works with partial next state (only rescanned rows present)', () => {
    // Targeted rescan returns only row 8's slots; prev holds the full board
    const prev = [slot(0, 'lion_impale'), slot(8, null)]
    const next = [slot(8, 'zuus_arc_lightning')]

    const events = attributePicksByRow({
      prevSelected: prev,
      nextSelected: next,
      nextSeq: 3,
      clockTime: -5,
    })

    expect(events).toEqual([
      {
        seq: 3,
        playerIndex: 8,
        abilityName: 'zuus_arc_lightning',
        kind: 'ability',
        clockTime: -5,
      },
    ])
  })
})
