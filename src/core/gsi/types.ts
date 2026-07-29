// @DEV-GUIDE: Types for Dota 2 Game State Integration (GSI) ingestion. Dota POSTs JSON
// to the stream server's /gsi endpoint (cfg written by gsi-cfg-service). GSI does NOT
// carry the Ability Draft pool or ability picks — the ML scan remains the source for
// those; GSI contributes player identity, game phase, and clock only.
//
// Payload shapes differ by role:
// - SPECTATING/casting: player block is { team2: { player0..player4 }, team3: { player5..player9 } }
//   — global slot indices matching the scan's player index convention (0-4 radiant, 5-9 dire).
// - PLAYING: player block is the local player object only (no slot index available).
// The parser normalizes both into GsiSnapshot.

/** One known player slot, parsed from spectator-mode allplayers data. */
export interface GsiPlayer {
  /** 0–9, matching the scan pipeline's selected-abilities player index. */
  slotIndex: number
  name: string
  accountId: string | null
}

export interface GsiSnapshot {
  /** e.g. "DOTA_GAMERULES_STATE_HERO_SELECTION"; null when the map block is absent. */
  gamePhase: string | null
  clockTime: number | null
  /** map.matchid — distinguishes a NEW draft from phase flapping (replay seeking). */
  matchId: string | null
  /** Empty while playing (only spectators receive allplayers data). */
  players: GsiPlayer[]
  /** The local player when Dota reports one (playing, not spectating). */
  localPlayer: { name: string; accountId: string | null } | null
}

export const GSI_HERO_SELECTION_PHASE = 'DOTA_GAMERULES_STATE_HERO_SELECTION'
