// @DEV-GUIDE: Wire contract for the Twitch extension. These types cross FOUR boundaries:
// the pure projection (src/core/domain/twitch-projection.ts), the publisher in the main
// process (twitch-publisher-service), the EBS Lambda (twitch/ebs — HTTPS in, Twitch PubSub
// out) and the extension frontend (twitch/frontend — runs inside Twitch's iframe). The
// twitch/ packages import ONLY types from here (relative path, no runtime coupling).
//
// Two payloads, deliberately split by how they travel:
// - TwitchCompactState rides Extension PubSub, which has a HARD 5 KB message limit and a
//   ~100 msg/min/channel budget. It carries everything TIME-VARYING and nothing else:
//   internal names + pool indices, picked masks, player picks, the attributed feed. Never
//   display names, icon paths or geometry. Arrays with positional meaning instead of
//   objects keep it ~2-3 KB in practice (worst case ~3.4 KB; see the projection's encoder
//   and its size test).
// - TwitchRichState is fetched over HTTPS from the EBS once per draft (keyed by draft id +
//   rich revision). It holds what is STABLE for the draft: Windrun numbers, the pool-internal
//   synergy graph, normalized slot geometry, thresholds. The frontend derives "still in
//   pool", partner lists and OP/trap panels from rich + the delayed compact itself.
//
// - TwitchLiveState is the CASTER EDITION telemetry (net worth, items, damage, buyback,
//   Aghanim's). It rides PubSub as its OWN message rather than widening the compact,
//   because it ticks every 2 s in game: folding it into the compact would defeat the
//   content-key dedupe and re-send ~3.6 KB of unchanged draft state to carry ~1 KB of new
//   numbers. It is spectator-only — Valve exposes all ten players to observers alone.
//   Draft churn (compact) and telemetry (live) never overlap: one is the 'drafting' phase,
//   the other 'ingame', so they do not compete for Twitch's 1 msg/s/channel budget.
//
// Versioned separately from STREAM_PROTOCOL_VERSION. Bump TWITCH_PROTOCOL_VERSION on any
// incompatible shape change: the EBS rejects mismatched versions and the frontend shows
// "update the app". ADDITIVE changes (a new optional field, a new message kind older
// viewers ignore) must NOT bump it — a bump hard-stops every existing viewer.
// Everything here must stay JSON-serializable.

export const TWITCH_PROTOCOL_VERSION = 1 as const
export type TwitchProtocolVersion = typeof TWITCH_PROTOCOL_VERSION

/**
 * waiting  — no draft recorded (or a NEW match's draft screen was seen and the old board
 *            must be hidden until its initial scan lands)
 * drafting — the draft screen, pool being picked
 * ingame   — draft over, game running (overlay closed/reset or GSI left hero selection);
 *            the compact still carries the finished pool + picks
 * ended    — GSI reported post-game, the app quit, or the snapshot went stale
 */
export type TwitchPhase = 'waiting' | 'drafting' | 'ingame' | 'ended'

/**
 * Pool slot index 0..47 = heroOrder * 4 + k, k: 0 = ultimate, 1..3 = Q/W/E (the app's
 * ability_order convention). Stable for the whole draft even when a slot's NAME is resolved
 * later — names travel in the compact pool rows, indices in picks/feed/rich.
 */
export type TwitchPoolIndex = number

/** A pick reference: a pool index when the ability is in the pool grid, otherwise the raw
 * internal name (template matching can name a pick the initial scan never read). */
export type TwitchPickRef = TwitchPoolIndex | string

/**
 * One pool hero row: [heroCdnName | null, [ult, q, w, e] internal names (null = unknown),
 * mask]. mask bit k (0..3) = slot k has been picked; bit 4 (value 16) = the hero MODEL was
 * picked.
 */
export type TwitchPoolRow = [
  string | null,
  [string | null, string | null, string | null, string | null],
  number,
]

/** Bit set on TwitchPoolRow[2] when the row's hero model was drafted. */
export const TWITCH_MODEL_PICKED_BIT = 16

/**
 * One player row: [model, [std, std, std, ult] picks (null = empty box), draftScore
 * 0..100 | null, playerName?].
 * model: pool row index 0..11 when attributed from the pool (playing mode), a Valve npc
 * short name when it came from GSI only, null when unknown.
 * playerName is OMITTED (not null) when unknown or when dropped for size (see `trunc`).
 */
export type TwitchPlayerRow = [
  number | string | null,
  [TwitchPickRef | null, TwitchPickRef | null, TwitchPickRef | null, TwitchPickRef | null],
  number | null,
  string?,
]

/** [playerIndex, pick] — pick is a pool index / raw name, or -1 for a model-selection
 * marker (turn where no ability left the pool). seq = array position. */
export type TwitchFeedEvent = [number, TwitchPickRef | -1]

export interface TwitchCompactState {
  v: TwitchProtocolVersion
  /** Draft id (base36 of the initial scan's epoch ms). NEVER changes mid-draft. */
  d: string
  p: TwitchPhase
  /** Monotonic per draft id; consumers drop r <= last seen for the same d. */
  r: number
  /** App send time (epoch ms) — the frontend delays presentation by hlsLatencyBroadcaster. */
  t: number
  /** Rich-state revision the consumer should hold; refetch the rich state when it changes. */
  rr: number
  /** GSI match id when known. */
  mid?: string
  /** Streamer's own player row 0..9 (My Spot), absent when unknown. */
  me?: number
  /** Exactly 12 rows in drafting/ingame/ended; absent in waiting. */
  pool?: TwitchPoolRow[]
  /** Exactly 10 rows when pool is present (0-4 radiant, 5-9 dire). */
  players?: TwitchPlayerRow[]
  /** Full attributed timeline (experimental auto draft tracking). Absent when the feature
   * is off, no event was recorded yet, or dropped for size (rich carries the mirror). */
  f?: TwitchFeedEvent[]
  /**
   * IN-GAME SEAT ORDER: index = the player's position in Dota's top bar (GSI
   * slot, 0-4 radiant left-to-right then 5-9 dire), value = that player's index
   * into `players` (their DRAFT ROW), or null while unresolved.
   *
   * The two orders are NOT the same — a live game measured seat 0 = draft row 4
   * — so anything drawn over the top bar must translate through this or it
   * renders one player's draft under another's portrait. Spectate only: the
   * mapping is learned from GSI + card OCR (slot-row-correlation.ts), and
   * playing sessions omit it because GSI reports only the local player.
   * Optional and additive — a viewer that predates it just ignores the key.
   */
  seats?: (number | null)[]
  /** Set when player names and/or the feed were stripped to fit the PubSub limit. */
  trunc?: 1
}

/** [x, y, w, h] as fractions of the game frame (TWITCH_RECT_DECIMALS decimals). */
export type TwitchRect = [number, number, number, number]

export interface TwitchRichAbility {
  i: TwitchPoolIndex
  /** Valve internal name. */
  n: string
  /** Display name in the app's language (the Dota catalog is English only). */
  dn: string
  /** Windrun winrate [0,1] / high-skill winrate [0,1] / average pick position. */
  wr: number | null
  hs: number | null
  pp: number | null
  /** App consolidated score [0,1] and top-tier flag as computed at the initial scan. */
  sc: number
  tt: boolean
}

export interface TwitchRichHero {
  /** Pool row 0..11. */
  i: number
  /** Valve CDN short name (portrait + catalog key); null when underivable. */
  cdn: string | null
  dn: string | null
  wr: number | null
  hs: number | null
  /** Windrun pick rate / pick position for the model. */
  pr: number | null
}

export interface TwitchRichGeometry {
  /** Pool index order 0..47; null for slots without coordinates. */
  pool: (TwitchRect | null)[]
  /** Pool row order 0..11 (hero model tiles). */
  models: (TwitchRect | null)[]
  /** Player order 0..9 (draft-screen player cards). */
  cards: (TwitchRect | null)[]
  /** playerIndex * 4 + box (0-2 standard, 3 ultimate). */
  picks: (TwitchRect | null)[]
}

export interface TwitchRichState {
  v: TwitchProtocolVersion
  d: string
  rr: number
  t: number
  /** The streamer's game frame the geometry fractions were computed from. */
  frame: { w: number; h: number; res: string }
  geometry: TwitchRichGeometry
  abilities: TwitchRichAbility[]
  heroes: TwitchRichHero[]
  /** Ability x ability synergy rows among the pool, same-hero pairs excluded:
   * [i, j, synergyWinrate, synergyIncrease | null] with i < j. */
  pairs: Array<[TwitchPoolIndex, TwitchPoolIndex, number, number | null]>
  /** Hero-model x ability synergy rows among the pool: [heroRow, i, winrate, increase]. */
  heroPairs: Array<[number, TwitchPoolIndex, number, number | null]>
  /** The streamer's OP/trap thresholds — the frontend derives the combo panels. */
  thresholds: { op: number; trap: number }
  /** Names by player index (null = unknown). Also in compact when they fit. */
  playerNames: (string | null)[]
  spectating: boolean
  /** Full feed mirror for the `trunc` case. */
  f?: TwitchFeedEvent[]
  meta: { appVersion: string; language: string }
  /** Reserved for the caster edition (spectator-only GSI extras). */
  caster?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Caster edition — live in-game telemetry
// ---------------------------------------------------------------------------

/** Bit flags in TwitchLivePlayer[13]. */
export const TWITCH_LIVE_ALIVE = 1
export const TWITCH_LIVE_SCEPTER = 2
export const TWITCH_LIVE_SHARD = 4
/**
 * Buyback is available RIGHT NOW: off cooldown and affordable. Deliberately
 * independent of being alive — whether a living player is holding enough gold to
 * buy back is exactly what a caster wants while they are taking a fight, not
 * only after they lose it.
 */
export const TWITCH_LIVE_BUYBACK_READY = 8

/**
 * One player's live numbers, positional to stay small (same reasoning as
 * TwitchPlayerRow). Index is fixed:
 *  0 net worth      5 deaths        10 tower damage     15 buyback cost
 *  1 GPM            6 assists       11 hero healing     16 buyback cooldown (s)
 *  2 XPM            7 last hits     12 damage taken     17 items
 *  3 level          8 denies        13 flags (bitmask above)
 *  4 kills          9 hero damage   14 respawn seconds
 *
 * Buyback cooldown distinguishes "cannot afford it" from "used it recently" —
 * different situations that both read as no-buyback without it.
 *
 * Items are internal names with the `item_` prefix stripped ("blink"), ordered
 * inventory 0-5, backpack 6-8, then neutral and TP. Names rather than numeric
 * ids on purpose: an id map would have to stay in lockstep between the app and
 * the viewer catalog, and the whole message still fits the budget without it.
 */
export type TwitchLivePlayer = [
  number, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number,
  (string | null)[],
]

/**
 * The caster-edition telemetry message. Its own PubSub message, keyed like the
 * compact so the viewer's delay buffer can hold it against hlsLatencyBroadcaster
 * with no changes. Spectator-only; a playing session never produces one.
 */
export interface TwitchLiveState {
  v: TwitchProtocolVersion
  /** Discriminator — lets one PubSub channel carry both message kinds. */
  kind: 'live'
  /** Draft id, tying this telemetry to the board it belongs to. */
  d: string
  /** Monotonic per draft id. */
  r: number
  /** App send time (epoch ms) — the delay-buffer anchor. */
  t: number
  /** GSI clock time in seconds, when known. */
  clock?: number
  /** Index = DRAFT ROW (same identity as compact.players), null when unknown. */
  players: (TwitchLivePlayer | null)[]
}

/** Body of POST /channels/{id}/publish. `rich` rides along only when its revision changed
 * or the EBS asked for it (`needRich`). `live` replaces compact/rich for a telemetry tick. */
export interface TwitchPublishEnvelope {
  v: TwitchProtocolVersion
  channelId: string
  compact?: TwitchCompactState
  rich?: TwitchRichState
  live?: TwitchLiveState
}

export type TwitchPublishErrorCode =
  | 'unauthorized'
  | 'rate_limited'
  | 'too_large'
  | 'bad_request'
  | 'version'
  | 'stale'

export type TwitchPublishResponse =
  | { ok: true; r: number; pubsub: 'sent' | 'skipped' | 'failed'; needRich?: boolean }
  | { ok: false; error: TwitchPublishErrorCode }

export interface TwitchPairStartResponse {
  code: string
  expiresAt: number
}

export interface TwitchPairCompleteRequest {
  code: string
  appVersion: string
}

export interface TwitchPairCompleteResponse {
  channelId: string
  channelToken: string
  channelName: string | null
}

/** Pairing status shown by the control panel (never carries the token). */
export interface TwitchLinkInfo {
  channelId: string
  channelName: string | null
  pairedAt: string
}

export type TwitchPublishStatus = 'off' | 'idle' | 'ok' | 'error'
