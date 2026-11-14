import { describe, it, expect } from 'vitest'
import { buildDemoFixture } from '../src/dev/fixtures'
import {
  abilityPartnersForHero,
  combosInPool,
  displayName,
  heroDisplayName,
  partnersInPool,
  pickOrder,
  pickedBy,
  playerModel,
  poolSlots,
  refName,
  slotByIndex,
  slotByName,
} from '../src/data/selectors'
import { parseBroadcasterConfig } from '../src/twitch/config-service'

describe('selectors over the demo fixture', () => {
  const { compact, rich } = buildDemoFixture()

  it('exposes 48 pool slots with picked flags from the compact masks', () => {
    const slots = poolSlots(compact)
    expect(slots).toHaveLength(48)
    const hook = slotByName(compact, 'pudge_meat_hook')
    expect(hook?.picked).toBe(true)
    expect(hook?.i).toBe(1)
    expect(slots.filter((s) => s.picked).length).toBeGreaterThan(0)
  })

  it('resolves picks to players and pick refs to names', () => {
    expect(pickedBy(compact, 'pudge_meat_hook')).toBe(0)
    expect(pickedBy(compact, 'tidehunter_ravage')).toBe(8)
    expect(refName(compact, 1)).toBe('pudge_meat_hook')
    expect(playerModel(compact, 1).cdn).toBeNull()
    expect(playerModel(compact, 0).cdn).not.toBeNull()
  })

  it('lists pool-internal partners and combos', () => {
    const { strong, weak } = partnersInPool(rich, compact, 1)
    expect(strong.length + weak.length).toBeGreaterThan(0)
    for (const p of [...strong, ...weak]) expect(p.i).not.toBe(1)
    const { op, trap } = combosInPool(rich, compact)
    for (const row of op) expect(row.increase).toBeGreaterThanOrEqual(rich.thresholds.op)
    for (const row of trap) expect(row.increase).toBeLessThanOrEqual(-rich.thresholds.trap)
  })

  it('numbers the pick order and marks model markers', () => {
    const order = pickOrder(compact)
    expect(order.length).toBeGreaterThan(0)
    expect(order[0].seq).toBe(0)
    expect(order.some((e) => e.isModelMarker)).toBe(true)
  })

  it('caches WeakMap indexes and returns identical lookup results across calls', () => {
    const firstSlot = slotByIndex(compact, 1)
    const secondSlot = slotByIndex(compact, 1)
    expect(firstSlot).not.toBeNull()
    expect(secondSlot).toEqual(firstSlot)

    const abilityTitle1 = displayName(rich, null, 'pudge_meat_hook', 1)
    const abilityTitle2 = displayName(rich, null, 'pudge_meat_hook', 1)
    expect(abilityTitle1).toBe(abilityTitle2)
    expect(abilityTitle1.length).toBeGreaterThan(0)

    const firstHero = rich.heroes[0]
    expect(heroDisplayName(rich, null, firstHero?.cdn ?? null, firstHero?.i)).toBe(
      heroDisplayName(rich, null, firstHero?.cdn ?? null, firstHero?.i),
    )

    const heroPartners1 = abilityPartnersForHero(rich, compact, 0)
    const heroPartners2 = abilityPartnersForHero(rich, compact, 0)
    expect(heroPartners1).toEqual(heroPartners2)
  })
})

describe('broadcaster config parsing', () => {
  it('clamps and defaults', () => {
    expect(parseBroadcasterConfig(null).gameRect).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(parseBroadcasterConfig('garbage').launcherCorner).toBe('tl')
    const parsed = parseBroadcasterConfig(
      JSON.stringify({ v: 1, gameRect: { x: 2, y: -1, w: 0.01, h: 0.5 }, ingame: { scale: 9 }, launcherCorner: 'br' }),
    )
    expect(parsed.gameRect).toEqual({ x: 0.9, y: 0, w: 0.1, h: 0.5 })
    expect(parsed.ingame).toEqual({ dx: 0, dy: 0, scale: 1.5 })
    expect(parsed.launcherCorner).toBe('br')
  })
})
