// @DEV-GUIDE: Type contract for the Streamer View — the locally hosted draft board served
// to OBS browser sources. These types cross THREE boundaries: the pure board builder in
// src/core/domain/stream-board.ts, the HTTP/SSE server in the main process, and the stream
// SPA (src/renderer/stream/) which runs in OBS's Chromium with NO preload/electron access.
// Everything here must stay JSON-serializable. The envelope is versioned (see
// STREAM_PROTOCOL_VERSION in @shared/constants/thresholds) so future consumers (e.g. a
// Twitch extension backend) can negotiate compatibility.

/** Versioned wire envelope for every message pushed over the SSE channel. */
export interface StreamEnvelope<TType extends string, TPayload> {
  /** Protocol version — bump when the payload shape changes incompatibly. */
  v: number
  type: TType
  /** Unix epoch ms at send time. */
  ts: number
  payload: TPayload
}

export type StreamStateMessage = StreamEnvelope<'state', StreamBoardState>
export type StreamServerMessage = StreamStateMessage

/** One ability tile on the stream board. */
export interface StreamAbilitySlot {
  /** Valve internal name (e.g. "abaddon_aphotic_shield"); null when the ML scan could not identify the slot. */
  name: string | null
  displayName: string
  /** Server-relative icon path (e.g. "/icons/abilities/<name>.png"); null when name is unknown. */
  iconPath: string | null
  winrate: number | null
  /** Average pick position from Windrun (lower = usually taken earlier); null if unknown. */
  pickPosition: number | null
  consolidatedScore: number
  isTopTier: boolean
  isUnknown: boolean
  /** True once this ability has left the pool (detected in a player's picked slots). */
  isPicked: boolean
}

/** One of the 12 pool hero rows: portrait + 3 standard abilities + ultimate. */
export interface StreamHeroRow {
  /** Pool hero index 0–11 (NOT a player index). */
  heroOrder: number
  /** Localized display name from hero identification; null when the hero could not be identified. */
  heroDisplayName: string | null
  /** Server-relative portrait path; null when the hero's CDN name could not be derived. */
  portraitPath: string | null
  /** ability_order 1–3 (Q/W/E), sorted. */
  standard: StreamAbilitySlot[]
  ultimate: StreamAbilitySlot | null
  /** True once this hero MODEL was drafted by a player (tile-diff detection while
   * playing, GSI while spectating feeds the player rows instead). */
  modelPicked: boolean
}

export type StreamTeam = 'radiant' | 'dire'

/** A player's picked hero model (from GSI). */
export interface StreamPlayerModel {
  /** Valve npc short name (e.g. "sand_king") — also the CDN portrait key. */
  npcName: string
  displayName: string
  /** Server-relative portrait path. */
  portraitPath: string
}

/** One of the 10 player rows with their picked abilities. */
export interface StreamPlayerRow {
  /** Player index 0–9 as scanned from selected-ability tiles (0–4 radiant, 5–9 dire). */
  playerIndex: number
  team: StreamTeam
  /** From GSI when available; null until known. */
  playerName: string | null
  /** Picked hero model from GSI (spectating: every player; playing: the local
   * player only); null until picked/unknown. */
  model: StreamPlayerModel | null
  /** Fixed length 4, mirroring the in-game pick boxes: indexes 0–2 are standard
   * picks (left to right), index 3 is the ultimate box; null = still empty. */
  picks: (StreamAbilitySlot | null)[]
  draftScore: PlayerDraftScore | null
}

export type PlayerScoreConfidence = 'none' | 'low' | 'medium' | 'high'

/** Computed draft strength for one player. See src/core/domain/player-draft-score.ts. */
export interface PlayerDraftScore {
  /** [0, 1] combined score; null when the player has no recognized picks. */
  score: number | null
  /** Mean normalized winrate of picks before synergy adjustment; null when no picks. */
  base: number | null
  /** Net synergy lift among the player's picks (already weighted into score). */
  synergyAdjustment: number
  /** Scales with pick count: 0 → none, 1 → low, 2–3 → medium, 4 → high. */
  confidence: PlayerScoreConfidence
}

export interface StreamComboAbilityRef {
  name: string | null
  displayName: string
  iconPath: string | null
}

export interface StreamComboDisplay {
  ability1: StreamComboAbilityRef
  ability2: StreamComboAbilityRef
  synergyWinrate: number
}

export interface StreamPanels {
  /** Highest-winrate abilities still in the pool, best first. */
  topWinrateInPool: StreamAbilitySlot[]
  /** OP combinations available in the current pool, strongest first. */
  opCombos: StreamComboDisplay[]
  /** Trap combinations lurking in the current pool, worst first. */
  trapCombos: StreamComboDisplay[]
  /** Slots flagged top-tier by the consolidated score. */
  topTier: StreamAbilitySlot[]
}

/** The board's view of GSI-derived context. Populated in Phase 4; defaults until then. */
export interface StreamGsiInfo {
  connected: boolean
  gamePhase: string | null
  clockTime: number | null
  /**
   * True when GSI carries allplayers data (spectate/replay). In that case the
   * arrays below are indexed by GSI SLOT — whose within-team order does NOT
   * match the draft screen's row order — and entries may only be placed on
   * board rows through a learned slot->row mapping (see
   * core/domain/slot-row-correlation.ts). When false (playing), the index is
   * the scan row directly (local player's team_slot placement is validated).
   */
  spectating: boolean
  /** Player names by slot/player index 0–9; empty or sparse until GSI reports them. */
  playerNames: (string | null)[]
  /** Picked hero models by slot/player index 0–9 (npcName + resolved display name). */
  playerModels: ({ npcName: string; displayName: string } | null)[]
}

/** Full board snapshot — the only message payload v1 pushes. */
export interface StreamBoardState {
  /** 'waiting' until the first successful initial scan of a draft. */
  phase: 'waiting' | 'drafting'
  heroes: StreamHeroRow[]
  players: StreamPlayerRow[]
  panels: StreamPanels
  gsi: StreamGsiInfo
  /** Recent attributed pick events (experimental auto-rescan only), newest last. */
  pickFeed?: PickEvent[]
  meta: {
    language: string
    appVersion: string
    updatedAt: number
  }
}

/** Response shape for the stream:getStatus IPC channel. */
export interface StreamServerStatusInfo {
  status: 'stopped' | 'running' | 'error'
  port: number | null
  clientCount: number
  /** i18n key in the 'streaming' namespace; null when healthy. */
  errorKey: string | null
}

/**
 * One attributed pick in the draft timeline (experimental auto-rescan feature, Phase 5).
 * kind 'modelSelectionMarker' records a turn where no ability left the pool — the player
 * picked a hero model instead; model recognition itself is future work.
 */
export interface PickEvent {
  seq: number
  playerIndex: number
  abilityName: string | null
  kind: 'ability' | 'modelSelectionMarker'
  clockTime: number | null
}
