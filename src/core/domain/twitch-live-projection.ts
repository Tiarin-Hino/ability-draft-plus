import type { GsiPlayer, GsiPlayerLive } from '@core/gsi/types'
import {
  TWITCH_LIVE_ALIVE,
  TWITCH_LIVE_BUYBACK_READY,
  TWITCH_LIVE_SCEPTER,
  TWITCH_LIVE_SHARD,
  TWITCH_PROTOCOL_VERSION,
  type TwitchLivePlayer,
  type TwitchLiveState,
} from '@shared/types/twitch'
import { TWITCH_PLAYER_COUNT } from './twitch-projection'
import { TWITCH_COMPACT_MAX_BYTES } from '@shared/constants/thresholds'

// @DEV-GUIDE: Pure projection of spectator GSI into the caster-edition telemetry
// message. Pure like twitch-projection.ts — zero Electron imports, so the unit
// suite covers it without a running app.
//
// Two things this module is responsible for:
// 1. SLOT -> ROW. GSI reports players by slot; every other payload is keyed by
//    draft row, and the orders differ (measured: slot 0 = row 4). Callers pass
//    the learned mapping and unmapped slots are DROPPED rather than guessed —
//    telemetry under the wrong portrait is worse than an empty panel.
// 2. SIZE. This rides PubSub next to the same 5 KB ceiling as the compact.
//    Positional arrays plus prefix-stripped item names keep a full ten-player
//    tick near 2 KB; the encoder degrades (items first, then per-player detail)
//    if a pathological payload ever approaches the cap.

/** "item_blink" -> "blink"; null stays null. */
function shortItem(name: string | null | undefined): string | null {
  if (!name) return null
  return name.startsWith('item_') ? name.slice(5) : name
}

function flagsOf(live: GsiPlayerLive): number {
  let flags = 0
  if (live.alive !== false) flags |= TWITCH_LIVE_ALIVE
  if (live.hasScepter) flags |= TWITCH_LIVE_SCEPTER
  if (live.hasShard) flags |= TWITCH_LIVE_SHARD
  // Off cooldown AND affordable — reported for the living too, since "is this
  // player holding buyback while they take this fight" is the interesting form
  // of the question.
  const affordable =
    live.buybackCost !== undefined && (live.gold ?? 0) >= live.buybackCost
  if ((live.buybackCooldown ?? 0) <= 0 && affordable) {
    flags |= TWITCH_LIVE_BUYBACK_READY
  }
  return flags
}

function toLivePlayer(live: GsiPlayerLive): TwitchLivePlayer {
  const items: (string | null)[] = [
    ...(live.items ?? [null, null, null, null, null, null]).map(shortItem),
    ...(live.backpack ?? [null, null, null]).map(shortItem),
    shortItem(live.neutral),
    shortItem(live.teleport),
  ]
  return [
    Math.round(live.netWorth ?? 0),
    Math.round(live.gpm ?? 0),
    Math.round(live.xpm ?? 0),
    Math.round(live.level ?? 0),
    Math.round(live.kills ?? 0),
    Math.round(live.deaths ?? 0),
    Math.round(live.assists ?? 0),
    Math.round(live.lastHits ?? 0),
    Math.round(live.denies ?? 0),
    Math.round(live.heroDamage ?? 0),
    Math.round(live.towerDamage ?? 0),
    Math.round(live.heroHealing ?? 0),
    Math.round(live.damageTaken ?? 0),
    flagsOf(live),
    Math.round(live.respawnSeconds ?? 0),
    Math.round(live.buybackCost ?? 0),
    Math.round(live.buybackCooldown ?? 0),
    items,
  ]
}

export interface TwitchLiveInput {
  /** Spectator GSI players (slot-keyed). A playing snapshot yields nothing. */
  players: readonly GsiPlayer[]
  /** Learned GSI slot -> draft row mappings. Unmapped slots are dropped. */
  slotRowMappings: ReadonlyArray<{ gsiSlot: number; scanRow: number }>
  draftId: string
  rev: number
  ts: number
  clockTime?: number | null
}

/**
 * Build a telemetry message, or null when there is nothing worth sending —
 * no spectator data, no mapping yet, or no player carrying live numbers (the
 * draft phase, where GSI has no economy blocks at all).
 */
export function buildTwitchLiveState(
  input: TwitchLiveInput,
): TwitchLiveState | null {
  if (input.players.length === 0) return null
  const rowBySlot = new Map(
    input.slotRowMappings.map((m) => [m.gsiSlot, m.scanRow]),
  )
  if (rowBySlot.size === 0) return null

  const players: (TwitchLivePlayer | null)[] = Array.from(
    { length: TWITCH_PLAYER_COUNT },
    () => null,
  )
  let any = false
  for (const player of input.players) {
    const row = rowBySlot.get(player.slotIndex)
    if (row === undefined || row < 0 || row >= TWITCH_PLAYER_COUNT) continue
    if (!player.live || Object.keys(player.live).length === 0) continue
    players[row] = toLivePlayer(player.live)
    any = true
  }
  if (!any) return null

  const state: TwitchLiveState = {
    v: TWITCH_PROTOCOL_VERSION,
    kind: 'live',
    d: input.draftId,
    r: input.rev,
    t: input.ts,
    players,
  }
  if (input.clockTime !== null && input.clockTime !== undefined) {
    state.clock = Math.round(input.clockTime)
  }
  return state
}

export interface EncodedTwitchLive {
  state: TwitchLiveState
  json: string
  bytes: number
  fits: boolean
}

/**
 * Serialize under the PubSub budget, degrading rather than failing: items go
 * first (the bulkiest part, and a viewer can live without them for one tick),
 * then the per-player tail beyond the headline economy numbers.
 */
export function encodeTwitchLive(
  state: TwitchLiveState,
  maxBytes = TWITCH_COMPACT_MAX_BYTES,
): EncodedTwitchLive {
  const measure = (candidate: TwitchLiveState): EncodedTwitchLive => {
    const json = JSON.stringify(candidate)
    const bytes = new TextEncoder().encode(json).length
    return { state: candidate, json, bytes, fits: bytes <= maxBytes }
  }

  const full = measure(state)
  if (full.fits) return full

  const withoutItems: TwitchLiveState = {
    ...state,
    players: state.players.map((p) =>
      p === null ? null : ([...p.slice(0, 17), []] as unknown as TwitchLivePlayer),
    ),
  }
  const stripped = measure(withoutItems)
  if (stripped.fits) return stripped

  // Last resort: headline economy only (net worth, GPM, level, K/D/A, buyback)
  const minimal: TwitchLiveState = {
    ...state,
    players: state.players.map((p) =>
      p === null
        ? null
        : ([p[0], p[1], 0, p[3], p[4], p[5], p[6], 0, 0, 0, 0, 0, 0, p[13], p[14], p[15], p[16], []] as TwitchLivePlayer),
    ),
  }
  return measure(minimal)
}

/** Content identity ignoring the volatile stamps, so an unchanged tick is skippable. */
export function twitchLiveContentKey(state: TwitchLiveState): string {
  return JSON.stringify({ d: state.d, players: state.players })
}
