import { describe, it, expect } from 'vitest'
import {
  buildTwitchLiveState,
  encodeTwitchLive,
  twitchLiveContentKey,
} from '@core/domain/twitch-live-projection'
import {
  TWITCH_LIVE_ALIVE,
  TWITCH_LIVE_BUYBACK_READY,
  TWITCH_LIVE_SCEPTER,
  TWITCH_LIVE_SHARD,
} from '@shared/types/twitch'
import { TWITCH_COMPACT_MAX_BYTES } from '@shared/constants/thresholds'
import type { GsiPlayer } from '@core/gsi/types'

// Values mirror a real spectator capture (2026-09-04): six inventory items, a TP
// in its own slot, damage taken summed post-reduction.
function player(slot: number, over: Partial<GsiPlayer['live']> = {}): GsiPlayer {
  return {
    slotIndex: slot,
    name: `p${slot}`,
    accountId: null,
    heroNpcName: 'kunkka',
    live: {
      netWorth: 1051,
      gold: 66,
      gpm: 300,
      xpm: 365,
      level: 2,
      kills: 0,
      deaths: 0,
      assists: 0,
      lastHits: 7,
      denies: 2,
      heroDamage: 680,
      towerDamage: 0,
      heroHealing: 0,
      damageTaken: 760,
      alive: true,
      respawnSeconds: 0,
      buybackCost: 280,
      buybackCooldown: 0,
      hasScepter: false,
      hasShard: false,
      items: [
        'item_gauntlets',
        'item_branches',
        'item_gauntlets',
        'item_tango',
        'item_quelling_blade',
        'item_faerie_fire',
      ],
      backpack: [null, null, null],
      neutral: null,
      teleport: 'item_tpscroll',
      ...over,
    },
  }
}

const MAPPINGS = [
  { gsiSlot: 0, scanRow: 4 },
  { gsiSlot: 1, scanRow: 2 },
  { gsiSlot: 2, scanRow: 3 },
  { gsiSlot: 3, scanRow: 0 },
  { gsiSlot: 4, scanRow: 1 },
  { gsiSlot: 5, scanRow: 5 },
  { gsiSlot: 6, scanRow: 6 },
  { gsiSlot: 7, scanRow: 8 },
  { gsiSlot: 8, scanRow: 7 },
  { gsiSlot: 9, scanRow: 9 },
]

const BASE = { draftId: 'abc123', rev: 1, ts: 1_757_000_000_000 }

describe('buildTwitchLiveState', () => {
  it('places telemetry on the DRAFT ROW, not the GSI slot', () => {
    const state = buildTwitchLiveState({
      ...BASE,
      players: [player(0, { netWorth: 999 })],
      slotRowMappings: MAPPINGS,
    })
    // Slot 0 maps to row 4 in this (real) permutation
    expect(state?.players[4]?.[0]).toBe(999)
    expect(state?.players[0]).toBeNull()
  })

  it('drops a slot with no mapping rather than guessing a row', () => {
    const state = buildTwitchLiveState({
      ...BASE,
      players: [player(0), player(1)],
      slotRowMappings: [{ gsiSlot: 0, scanRow: 4 }],
    })
    expect(state?.players.filter(Boolean)).toHaveLength(1)
    expect(state?.players[4]).not.toBeNull()
  })

  it('strips the item_ prefix and orders inventory, backpack, neutral, TP', () => {
    const state = buildTwitchLiveState({
      ...BASE,
      players: [player(0)],
      slotRowMappings: MAPPINGS,
    })
    const items = state?.players[4]?.[17]
    expect(items?.slice(0, 6)).toEqual([
      'gauntlets',
      'branches',
      'gauntlets',
      'tango',
      'quelling_blade',
      'faerie_fire',
    ])
    expect(items?.slice(6, 9)).toEqual([null, null, null])
    expect(items?.[9]).toBeNull() // neutral
    expect(items?.[10]).toBe('tpscroll')
  })

  it('packs alive, scepter and shard into the flag bitmask', () => {
    const state = buildTwitchLiveState({
      ...BASE,
      players: [player(0, { hasScepter: true, hasShard: true })],
      slotRowMappings: MAPPINGS,
    })
    const flags = state?.players[4]?.[13] ?? 0
    expect(flags & TWITCH_LIVE_ALIVE).toBeTruthy()
    expect(flags & TWITCH_LIVE_SCEPTER).toBeTruthy()
    expect(flags & TWITCH_LIVE_SHARD).toBeTruthy()
    expect(flags & TWITCH_LIVE_BUYBACK_READY).toBeFalsy()
  })

  const buybackFlag = (over: Partial<GsiPlayer['live']>) =>
    (buildTwitchLiveState({
      ...BASE,
      players: [player(0, over)],
      slotRowMappings: MAPPINGS,
    })?.players[4]?.[13] ?? 0) & TWITCH_LIVE_BUYBACK_READY

  it('flags buyback for LIVING players too — the caster wants it before the death', () => {
    expect(buybackFlag({ alive: true, gold: 5000, buybackCost: 1400, buybackCooldown: 0 })).toBeTruthy()
    expect(buybackFlag({ alive: false, gold: 5000, buybackCost: 1400, buybackCooldown: 0 })).toBeTruthy()
  })

  it('clears the flag when unaffordable or on cooldown, alive or dead', () => {
    expect(buybackFlag({ alive: true, gold: 100, buybackCost: 1400, buybackCooldown: 0 })).toBeFalsy()
    expect(buybackFlag({ alive: true, gold: 5000, buybackCost: 1400, buybackCooldown: 40 })).toBeFalsy()
    expect(buybackFlag({ alive: false, gold: 100, buybackCost: 1400, buybackCooldown: 0 })).toBeFalsy()
  })

  it('carries the buyback cooldown so "broke" and "used it" are distinguishable', () => {
    const state = buildTwitchLiveState({
      ...BASE,
      players: [player(0, { gold: 5000, buybackCost: 1400, buybackCooldown: 200 })],
      slotRowMappings: MAPPINGS,
    })
    expect(state?.players[4]?.[16]).toBe(200)
  })

  it('returns null when there is nothing to send', () => {
    expect(
      buildTwitchLiveState({ ...BASE, players: [], slotRowMappings: MAPPINGS }),
    ).toBeNull()
    expect(
      buildTwitchLiveState({ ...BASE, players: [player(0)], slotRowMappings: [] }),
    ).toBeNull()
    // Draft phase: players exist but carry no economy blocks yet
    const noLive: GsiPlayer = {
      slotIndex: 0,
      name: 'p0',
      accountId: null,
      heroNpcName: null,
    }
    expect(
      buildTwitchLiveState({ ...BASE, players: [noLive], slotRowMappings: MAPPINGS }),
    ).toBeNull()
  })
})

describe('encodeTwitchLive', () => {
  const fullTick = () =>
    buildTwitchLiveState({
      ...BASE,
      players: MAPPINGS.map((m) => player(m.gsiSlot)),
      slotRowMappings: MAPPINGS,
    })!

  it('fits a full ten-player tick well under the PubSub budget', () => {
    const encoded = encodeTwitchLive(fullTick())
    expect(encoded.fits).toBe(true)
    expect(encoded.bytes).toBeLessThan(TWITCH_COMPACT_MAX_BYTES)
    expect(JSON.parse(encoded.json)).toEqual(encoded.state)
  })

  it('drops items first when a pathological tick will not fit', () => {
    const encoded = encodeTwitchLive(fullTick(), 900)
    expect(encoded.state.players[4]?.[17]).toEqual([])
    // Headline economy survives the cut
    expect(encoded.state.players[4]?.[0]).toBe(1051)
  })

  it('content key ignores the volatile stamps', () => {
    const a = fullTick()
    const b = { ...a, r: 99, t: a.t + 5000 }
    expect(twitchLiveContentKey(a)).toBe(twitchLiveContentKey(b))
  })
})
