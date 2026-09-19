import type { AbilityDetail, Hero, OverlayDataPayload, SlotCoordinate } from '@shared/types'
import type { PickEvent, StreamBoardState } from '@shared/types/stream'
import {
  TWITCH_MODEL_PICKED_BIT,
  TWITCH_PROTOCOL_VERSION,
  type TwitchCompactState,
  type TwitchFeedEvent,
  type TwitchPhase,
  type TwitchPickRef,
  type TwitchPlayerRow,
  type TwitchPoolIndex,
  type TwitchPoolRow,
  type TwitchRect,
  type TwitchRichAbility,
  type TwitchRichGeometry,
  type TwitchRichHero,
  type TwitchRichState,
} from '@shared/types/twitch'
import {
  TWITCH_COMPACT_MAX_BYTES,
  TWITCH_PLAYER_NAME_MAX_CHARS,
  TWITCH_RECT_DECIMALS,
} from '@shared/constants/thresholds'
import { parseResolution } from '../resolution/scaling-engine'
import { GSI_POST_DRAFT_PHASES, GSI_POST_GAME_PHASE } from '../gsi/overlay-lifecycle'
import { GSI_HERO_SELECTION_PHASE } from '../gsi/types'
import type { PairSynergyInput } from './player-draft-score'

// @DEV-GUIDE: Pure projection of the streamer-view board into the Twitch extension's two
// payloads (src/shared/types/twitch.ts) plus the draft-phase state machine the publisher
// drives. Mirrors picks-view.ts: derived from a BUILT StreamBoardState, never from the
// raw scan — the board is the single source of truth for the OBS view and the extension
// alike ("transport swap, not a second data path", docs/STREAMER_VIEW.md).
//
// Pool INDEX convention (TwitchPoolIndex): heroOrder * 4 + k, k = 0 ultimate, 1..3 = the
// row's standard slots in ability_order (the board sorts them). The index map is built from
// the board's hero rows — the INITIAL grid — so indices are stable for the whole draft while
// names can still resolve later (pool-retry). Picks/feed entries that name an ability the
// grid never read fall back to the raw internal name.
//
// Size discipline: encodeTwitchCompact() measures the UTF-8 length and degrades in a fixed
// order (player names, then the feed) until the message fits TWITCH_COMPACT_MAX_BYTES —
// both are mirrored in the rich state, so nothing is lost, only moved off PubSub.
//
// Phase machine (nextTwitchPhase): the only place that decides drafting/ingame/ended/waiting.
// Overlay close/reset must NOT wipe the in-game snapshot (picks-view precedent): a session
// reset while drafting means "the draft is over", never "forget the draft".

export const TWITCH_POOL_SLOT_COUNT = 48
export const TWITCH_POOL_ROW_COUNT = 12
export const TWITCH_PLAYER_COUNT = 10
export const TWITCH_PICK_BOX_COUNT = 40
/** Feed entry for an ability event whose name is unknown (distinct from the -1 marker). */
export const TWITCH_UNKNOWN_PICK_REF = ''

export function twitchPoolIndex(heroOrder: number, abilityOrder: number): TwitchPoolIndex {
  return heroOrder * 4 + abilityOrder
}

/** Draft id from the initial scan's timestamp (base36 keeps it short on the wire). */
export function twitchDraftId(ts: number): string {
  return Math.max(0, Math.floor(ts)).toString(36)
}

// ---------------------------------------------------------------------------
// Pool index map
// ---------------------------------------------------------------------------

/**
 * Internal name -> pool index, built from the board's (initial-grid) hero rows.
 * Standard slots are indexed by their POSITION in the sorted row (k+1), which equals
 * ability_order when the row is complete — the scan always yields 3 standard slots
 * per row (unknown ones with a null name), so positions and orders agree.
 */
export function buildPoolIndexMap(board: StreamBoardState): Map<string, TwitchPoolIndex> {
  const map = new Map<string, TwitchPoolIndex>()
  for (const row of board.heroes) {
    if (row.ultimate?.name && !row.ultimate.isUnknown) {
      map.set(row.ultimate.name, twitchPoolIndex(row.heroOrder, 0))
    }
    row.standard.forEach((slot, k) => {
      if (slot.name && !slot.isUnknown) {
        map.set(slot.name, twitchPoolIndex(row.heroOrder, k + 1))
      }
    })
  }
  return map
}

// ---------------------------------------------------------------------------
// Compact state
// ---------------------------------------------------------------------------

export interface TwitchCompactInput {
  board: StreamBoardState
  /** FULL attributed timeline (draftStore.draftTimeline), not the board's capped feed. */
  pickEvents: PickEvent[]
  phase: TwitchPhase
  draftId: string
  rev: number
  richRev: number
  ts: number
  matchId: string | null
  /** Streamer's own player row (My Spot); null when unknown. */
  myRow: number | null
  /** Learned GSI slot -> draft row mappings (spectate); empty when playing. */
  slotRowMappings?: Array<{ gsiSlot: number; scanRow: number }>
}

/**
 * Top-bar seat order -> draft row. Index is the GSI slot (the player's position
 * in Dota's in-game top bar); value is their row in `players`. Unmapped seats
 * are null rather than guessed — showing nothing beats showing someone else's
 * draft. Returns undefined when nothing is known, so the key stays off the wire.
 */
function buildSeats(
  mappings: Array<{ gsiSlot: number; scanRow: number }> | undefined,
): (number | null)[] | undefined {
  if (!mappings || mappings.length === 0) return undefined
  const seats: (number | null)[] = Array.from({ length: 10 }, () => null)
  for (const { gsiSlot, scanRow } of mappings) {
    if (gsiSlot < 0 || gsiSlot > 9 || scanRow < 0 || scanRow > 9) continue
    seats[gsiSlot] = scanRow
  }
  return seats
}

function truncateName(name: string): string {
  const chars = Array.from(name)
  return chars.length <= TWITCH_PLAYER_NAME_MAX_CHARS
    ? name
    : chars.slice(0, TWITCH_PLAYER_NAME_MAX_CHARS).join('')
}

function toFeed(
  pickEvents: PickEvent[],
  index: ReadonlyMap<string, TwitchPoolIndex>,
): TwitchFeedEvent[] {
  return pickEvents.map((event) => {
    if (event.kind === 'modelSelectionMarker') return [event.playerIndex, -1]
    if (event.abilityName === null) return [event.playerIndex, TWITCH_UNKNOWN_PICK_REF]
    return [event.playerIndex, index.get(event.abilityName) ?? event.abilityName]
  })
}

/**
 * Build the compact (PubSub) state. Pool/players/feed are only present when the board
 * is a drafting board; for other phases the publisher re-stamps its last drafting
 * compact (restampCompact) instead of rebuilding from a blank board.
 */
export function buildTwitchCompactState(input: TwitchCompactInput): TwitchCompactState {
  const { board } = input
  const state: TwitchCompactState = {
    v: TWITCH_PROTOCOL_VERSION,
    d: input.draftId,
    p: input.phase,
    r: input.rev,
    t: input.ts,
    rr: input.richRev,
  }
  if (input.matchId) state.mid = input.matchId
  if (input.myRow !== null && input.myRow >= 0 && input.myRow < TWITCH_PLAYER_COUNT) {
    state.me = input.myRow
  }
  if (input.phase === 'waiting' || board.phase !== 'drafting') return state

  const index = buildPoolIndexMap(board)
  const toRef = (name: string): TwitchPickRef => index.get(name) ?? name

  const pool: TwitchPoolRow[] = []
  for (let heroOrder = 0; heroOrder < TWITCH_POOL_ROW_COUNT; heroOrder++) {
    const row = board.heroes.find((h) => h.heroOrder === heroOrder)
    const names: TwitchPoolRow[1] = [null, null, null, null]
    let mask = 0
    if (row) {
      const slots = [row.ultimate, row.standard[0], row.standard[1], row.standard[2]]
      slots.forEach((slot, k) => {
        if (!slot || slot.isUnknown || !slot.name) return
        names[k] = slot.name
        if (slot.isPicked) mask |= 1 << k
      })
      if (row.modelPicked) mask |= TWITCH_MODEL_PICKED_BIT
    }
    pool.push([row?.cdnName ?? null, names, mask])
  }

  const players: TwitchPlayerRow[] = []
  for (let playerIndex = 0; playerIndex < TWITCH_PLAYER_COUNT; playerIndex++) {
    const player = board.players.find((p) => p.playerIndex === playerIndex)
    const picks: TwitchPlayerRow[1] = [null, null, null, null]
    player?.picks.forEach((pick, k) => {
      if (k > 3 || !pick || pick.isUnknown || !pick.name) return
      picks[k] = toRef(pick.name)
    })
    const model: TwitchPlayerRow[0] = player?.model
      ? (player.model.poolHeroOrder ?? player.model.cdnName)
      : null
    const score =
      player?.draftScore?.score !== null && player?.draftScore?.score !== undefined
        ? Math.round(player.draftScore.score * 100)
        : null
    const row: TwitchPlayerRow = [model, picks, score]
    if (player?.playerName) row.push(truncateName(player.playerName))
    players.push(row)
  }

  state.pool = pool
  state.players = players
  const seats = buildSeats(input.slotRowMappings)
  if (seats) state.seats = seats
  if (input.pickEvents.length > 0) state.f = toFeed(input.pickEvents, index)
  return state
}

/**
 * Re-stamp a previously built compact for a new revision/phase without touching the
 * board-derived content. 'waiting' strips the draft content entirely.
 */
export function restampCompact(
  compact: TwitchCompactState,
  patch: { phase?: TwitchPhase; rev: number; ts: number; richRev?: number },
): TwitchCompactState {
  const next: TwitchCompactState = {
    ...compact,
    p: patch.phase ?? compact.p,
    r: patch.rev,
    t: patch.ts,
    rr: patch.richRev ?? compact.rr,
  }
  if (next.p === 'waiting') {
    delete next.pool
    delete next.players
    delete next.f
    delete next.me
    delete next.trunc
  }
  return next
}

export interface TwitchCompactEncoding {
  state: TwitchCompactState
  json: string
  bytes: number
  /** False only when even the fully degraded message exceeds maxBytes. */
  fits: boolean
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * Serialize the compact state for PubSub, degrading in a fixed order until it fits:
 * 1. drop player names, 2. drop the feed. Both set `trunc` so the frontend reads them
 * from the rich state instead.
 */
export function encodeTwitchCompact(
  state: TwitchCompactState,
  maxBytes: number = TWITCH_COMPACT_MAX_BYTES,
): TwitchCompactEncoding {
  const measure = (s: TwitchCompactState): TwitchCompactEncoding => {
    const json = JSON.stringify(s)
    const bytes = utf8Length(json)
    return { state: s, json, bytes, fits: bytes <= maxBytes }
  }

  let current = measure(state)
  if (current.fits) return current

  if (current.state.players?.some((row) => row.length > 3)) {
    current = measure({
      ...current.state,
      players: current.state.players.map((row): TwitchPlayerRow => [row[0], row[1], row[2]]),
      trunc: 1,
    })
    if (current.fits) return current
  }

  if (current.state.f) {
    const stripped: TwitchCompactState = { ...current.state, trunc: 1 }
    delete stripped.f
    current = measure(stripped)
  }
  return current
}

/** Identity of the compact CONTENT — ignores the send stamp (t) and revision (r). */
export function twitchCompactContentKey(compact: TwitchCompactState): string {
  const rest: Partial<TwitchCompactState> = { ...compact }
  delete rest.t
  delete rest.r
  return JSON.stringify(rest)
}

// ---------------------------------------------------------------------------
// Rich state
// ---------------------------------------------------------------------------

/** Structurally matches SynergyRepository.getHeroSynergiesAmong rows. */
export interface TwitchHeroPairInput {
  heroName: string
  abilityName: string
  synergyWinrate: number
  synergyIncrease: number | null
}

export interface TwitchRichLookups {
  getAbilityDetails(names: string[]): Map<string, AbilityDetail>
  getHeroes(): Hero[]
  getPairSynergies(names: string[]): PairSynergyInput[]
  getHeroPairSynergies(heroNames: string[], abilityNames: string[]): TwitchHeroPairInput[]
}

export interface TwitchRichInput {
  board: StreamBoardState
  /** The draft's INITIAL payload — geometry + hero model stats. */
  initialPayload: OverlayDataPayload
  pickEvents: PickEvent[]
  draftId: string
  richRev: number
  ts: number
  thresholds: { op: number; trap: number }
  meta: { appVersion: string; language: string }
  lookups: TwitchRichLookups
}

function roundFraction(value: number): number {
  const factor = 10 ** TWITCH_RECT_DECIMALS
  return Math.round(value * factor) / factor
}

function toRect(
  coord: SlotCoordinate | undefined,
  frame: { w: number; h: number },
  params?: { width: number; height: number },
): TwitchRect | null {
  if (!coord || frame.w <= 0 || frame.h <= 0) return null
  const width = Number.isFinite(coord.width) && coord.width > 0 ? coord.width : params?.width
  const height = Number.isFinite(coord.height) && coord.height > 0 ? coord.height : params?.height
  if (!width || !height) return null
  return [
    roundFraction(coord.x / frame.w),
    roundFraction(coord.y / frame.h),
    roundFraction(width / frame.w),
    roundFraction(height / frame.h),
  ]
}

function buildGeometry(
  payload: OverlayDataPayload,
  frame: { w: number; h: number },
): TwitchRichGeometry {
  const pool: (TwitchRect | null)[] = Array.from({ length: TWITCH_POOL_SLOT_COUNT }, () => null)
  for (const slot of payload.scanData?.ultimates ?? []) {
    const i = twitchPoolIndex(slot.hero_order, 0)
    if (i >= 0 && i < TWITCH_POOL_SLOT_COUNT) pool[i] = toRect(slot.coord, frame)
  }
  for (const slot of payload.scanData?.standard ?? []) {
    if (slot.ability_order < 1 || slot.ability_order > 3) continue
    const i = twitchPoolIndex(slot.hero_order, slot.ability_order)
    if (i >= 0 && i < TWITCH_POOL_SLOT_COUNT) pool[i] = toRect(slot.coord, frame)
  }

  const models: (TwitchRect | null)[] = Array.from({ length: TWITCH_POOL_ROW_COUNT }, () => null)
  for (const coord of payload.modelsCoords) {
    if (coord.hero_order >= 0 && coord.hero_order < TWITCH_POOL_ROW_COUNT) {
      models[coord.hero_order] = toRect(coord, frame)
    }
  }

  const cards: (TwitchRect | null)[] = Array.from({ length: TWITCH_PLAYER_COUNT }, () => null)
  for (const coord of payload.heroesCoords) {
    if (coord.hero_order >= 0 && coord.hero_order < TWITCH_PLAYER_COUNT) {
      cards[coord.hero_order] = toRect(coord, frame, payload.heroesParams)
    }
  }

  // Pick boxes: per player in screen order, ultimate box last (layout-coordinates.test.ts)
  const picks: (TwitchRect | null)[] = Array.from({ length: TWITCH_PICK_BOX_COUNT }, () => null)
  const nextStandardBox = new Map<number, number>()
  for (const coord of payload.pickBoxCoords ?? []) {
    const player = coord.hero_order
    if (player < 0 || player >= TWITCH_PLAYER_COUNT) continue
    let box: number
    if (coord.is_ultimate) box = 3
    else {
      box = nextStandardBox.get(player) ?? 0
      if (box > 2) continue
      nextStandardBox.set(player, box + 1)
    }
    picks[player * 4 + box] = toRect(coord, frame, payload.pickBoxParams)
  }

  return { pool, models, cards, picks }
}

export function buildTwitchRichState(input: TwitchRichInput): TwitchRichState {
  const { board, initialPayload, lookups } = input
  const parsed = parseResolution(initialPayload.targetResolution)
  const frame = { w: parsed?.width ?? 0, h: parsed?.height ?? 0 }

  const index = buildPoolIndexMap(board)
  const poolNames = [...index.keys()]
  const details = lookups.getAbilityDetails(poolNames)

  const abilities: TwitchRichAbility[] = []
  for (const row of board.heroes) {
    const slots = [row.ultimate, row.standard[0], row.standard[1], row.standard[2]]
    slots.forEach((slot, k) => {
      if (!slot || slot.isUnknown || !slot.name) return
      abilities.push({
        i: twitchPoolIndex(row.heroOrder, k),
        n: slot.name,
        dn: slot.displayName,
        wr: slot.winrate,
        hs: details.get(slot.name)?.highSkillWinrate ?? null,
        pp: slot.pickPosition,
        sc: slot.consolidatedScore,
        tt: slot.isTopTier,
      })
    })
  }
  abilities.sort((a, b) => a.i - b.i)

  const heroesByName = new Map(lookups.getHeroes().map((h) => [h.name, h]))
  const modelByOrder = new Map(initialPayload.heroModels.map((m) => [m.heroOrder, m]))
  const heroes: TwitchRichHero[] = board.heroes.map((row) => {
    const model = modelByOrder.get(row.heroOrder)
    const known = model && model.dbHeroId !== null ? model : undefined
    return {
      i: row.heroOrder,
      cdn: row.cdnName,
      dn: row.heroDisplayName,
      wr: known?.winrate ?? null,
      hs: known ? (heroesByName.get(known.heroName)?.highSkillWinrate ?? null) : null,
      pr: known?.pickRate ?? null,
    }
  })

  const pairs: TwitchRichState['pairs'] = []
  for (const pair of lookups.getPairSynergies(poolNames)) {
    const i = index.get(pair.ability1Name)
    const j = index.get(pair.ability2Name)
    if (i === undefined || j === undefined || i === j) continue
    const hero1 = details.get(pair.ability1Name)?.heroId
    const hero2 = details.get(pair.ability2Name)?.heroId
    if (hero1 !== undefined && hero2 !== undefined && hero1 === hero2) continue
    pairs.push([Math.min(i, j), Math.max(i, j), pair.synergyWinrate, pair.synergyIncrease])
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  const heroOrderByName = new Map<string, number>()
  for (const model of initialPayload.heroModels) {
    if (model.dbHeroId !== null) heroOrderByName.set(model.heroName, model.heroOrder)
  }
  const heroPairs: TwitchRichState['heroPairs'] = []
  for (const row of lookups.getHeroPairSynergies([...heroOrderByName.keys()], poolNames)) {
    const heroRow = heroOrderByName.get(row.heroName)
    const i = index.get(row.abilityName)
    if (heroRow === undefined || i === undefined) continue
    heroPairs.push([heroRow, i, row.synergyWinrate, row.synergyIncrease])
  }
  heroPairs.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  const playerNames: (string | null)[] = Array.from({ length: TWITCH_PLAYER_COUNT }, () => null)
  for (const player of board.players) {
    if (player.playerIndex >= 0 && player.playerIndex < TWITCH_PLAYER_COUNT) {
      playerNames[player.playerIndex] = player.playerName
    }
  }

  const rich: TwitchRichState = {
    v: TWITCH_PROTOCOL_VERSION,
    d: input.draftId,
    rr: input.richRev,
    t: input.ts,
    frame: { w: frame.w, h: frame.h, res: initialPayload.targetResolution },
    geometry: buildGeometry(initialPayload, frame),
    abilities,
    heroes,
    pairs,
    heroPairs,
    thresholds: input.thresholds,
    playerNames,
    spectating: board.gsi.spectating,
    meta: input.meta,
  }
  if (input.pickEvents.length > 0) rich.f = toFeed(input.pickEvents, index)
  return rich
}

/** Identity of the rich CONTENT — ignores the send stamp (t) and revision (rr). */
export function twitchRichContentKey(rich: TwitchRichState): string {
  const rest: Partial<TwitchRichState> = { ...rich }
  delete rest.t
  delete rest.rr
  return JSON.stringify(rest)
}

// ---------------------------------------------------------------------------
// Phase state machine
// ---------------------------------------------------------------------------

export interface TwitchPhaseState {
  phase: TwitchPhase
  /** Current draft id; null before the first initial scan. */
  draftId: string | null
  /** Last GSI match id seen (new-draft detection). */
  matchId: string | null
}

export type TwitchPhaseEvent =
  | { type: 'initialScan'; ts: number }
  | { type: 'rescan' }
  | { type: 'gsi'; gamePhase: string | null; matchId: string | null }
  /** Overlay reset/close — the draft is over for the streamer; keep the snapshot. */
  | { type: 'sessionReset' }
  /** In-game snapshot older than TWITCH_STATE_STALE_MS. */
  | { type: 'stale' }
  | { type: 'quit' }

export function initialTwitchPhaseState(): TwitchPhaseState {
  return { phase: 'waiting', draftId: null, matchId: null }
}

export interface TwitchPhaseTransition {
  state: TwitchPhaseState
  changed: boolean
  /** True when an initial scan started a new draft (fresh draft id). */
  newDraft: boolean
}

export function nextTwitchPhase(
  state: TwitchPhaseState,
  event: TwitchPhaseEvent,
): TwitchPhaseTransition {
  const done = (
    phase: TwitchPhase,
    extra: Partial<TwitchPhaseState> = {},
  ): TwitchPhaseTransition => {
    const next = { ...state, ...extra, phase }
    const changed =
      next.phase !== state.phase || next.draftId !== state.draftId || next.matchId !== state.matchId
    return { state: next, changed, newDraft: false }
  }

  switch (event.type) {
    case 'initialScan': {
      const next: TwitchPhaseState = {
        ...state,
        phase: 'drafting',
        draftId: twitchDraftId(event.ts),
      }
      return { state: next, changed: true, newDraft: true }
    }
    case 'rescan':
      return done(state.phase)
    case 'gsi': {
      const matchId = event.matchId ?? state.matchId
      const phase = event.gamePhase
      if (phase === GSI_HERO_SELECTION_PHASE) {
        // A draft screen after the game started: the same id is replay/lobby
        // flapping, anything else is the NEXT match — hide the old board until
        // its initial scan lands.
        if (
          (state.phase === 'ingame' || state.phase === 'ended') &&
          !(event.matchId !== null && state.matchId !== null && event.matchId === state.matchId)
        ) {
          return done('waiting', { matchId })
        }
        return done(state.phase, { matchId })
      }
      if (phase !== null && GSI_POST_DRAFT_PHASES.has(phase)) {
        return done(state.phase === 'drafting' ? 'ingame' : state.phase, { matchId })
      }
      if (phase === GSI_POST_GAME_PHASE) {
        return done(
          state.phase === 'drafting' || state.phase === 'ingame' ? 'ended' : state.phase,
          { matchId },
        )
      }
      return done(state.phase, { matchId })
    }
    case 'sessionReset':
      return done(state.phase === 'drafting' ? 'ingame' : state.phase)
    case 'stale':
      return done(state.phase === 'ingame' ? 'ended' : state.phase)
    case 'quit':
      return done(state.phase === 'drafting' || state.phase === 'ingame' ? 'ended' : state.phase)
  }
}
