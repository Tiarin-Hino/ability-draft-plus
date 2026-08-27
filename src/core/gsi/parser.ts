import type { GsiMode, GsiPlayer, GsiSnapshot } from './types'

// @DEV-GUIDE: Pure GSI payload parser — zero Electron/node imports, fixture-tested.
// Tolerant by design: Valve's GSI payloads vary by game phase and data sections
// enabled in the cfg, so every field is optional and unknown shapes degrade to null
// rather than throwing. The slot mapping player0..player9 -> scan player index 0-9
// is isolated in slotIndexFromKey() — if real Ability Draft captures show a different
// ordering, the fix is one line here.

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** "player7" -> 7; null for anything else. */
function slotIndexFromKey(key: string): number | null {
  const match = /^player([0-9])$/.exec(key)
  return match ? parseInt(match[1], 10) : null
}

/** "npc_dota_hero_sand_king" -> "sand_king"; null for empty/absent names. */
function heroNpcShortName(value: unknown): string | null {
  const name = asString(value)
  if (!name || !name.startsWith('npc_dota_hero_')) return null
  return name.slice('npc_dota_hero_'.length)
}

/**
 * Global 0-9 slot for a team-block entry. Real captures carry an authoritative
 * team_slot (0-4 within the team) — prefer it over the playerN key, whose
 * numbering varies across GSI versions (per-team 0-4 vs global 0-9).
 */
function resolveSlotIndex(
  key: string,
  player: Record<string, unknown>,
  isDire: boolean,
): number | null {
  const teamSlot = asNumber(player['team_slot'])
  if (teamSlot !== null && teamSlot >= 0 && teamSlot <= 4) {
    return (isDire ? 5 : 0) + teamSlot
  }
  const rawIndex = slotIndexFromKey(key)
  if (rawIndex === null) return null
  return isDire && rawIndex < 5 ? rawIndex + 5 : rawIndex
}

/**
 * Playing-mode local player block -> slot index 0-9 from team_name
 * ("radiant"/"dire") + team_slot (0-4 within the team). Null when either is
 * absent (menus, spectating) — callers treat that as "slot unknown".
 * WARNING: this is LOBBY order. Only the team half (<5 / >=5) matches the
 * draft screen; the within-team order does NOT (disproven on live games
 * 2026-08-25, and player_slot doesn't match either). Never use it to place
 * anything on a visual row — see core/domain/own-row-detection.ts.
 */
function localSlotIndex(player: Record<string, unknown>): number | null {
  const teamName = asString(player['team_name'])
  const teamSlot = asNumber(player['team_slot'])
  if (teamSlot === null || teamSlot < 0 || teamSlot > 4) return null
  if (teamName === 'radiant') return teamSlot
  if (teamName === 'dire') return 5 + teamSlot
  return null
}

function parseTeamPlayers(
  team: unknown,
  into: GsiPlayer[],
  heroesByKey: Map<number, string>,
  isDire: boolean,
): void {
  const teamRecord = asRecord(team)
  if (!teamRecord) return
  for (const [key, value] of Object.entries(teamRecord)) {
    const player = asRecord(value)
    const keyIndex = slotIndexFromKey(key)
    if (!player || keyIndex === null) continue
    const slotIndex = resolveSlotIndex(key, player, isDire)
    const name = asString(player['name'])
    if (slotIndex === null || !name) continue
    into.push({
      slotIndex,
      name,
      accountId: asString(player['accountid']),
      // Hero entries share the player block's key numbering — join by raw key,
      // NOT by resolved slot, so team_slot reordering can't mismatch them.
      heroNpcName: heroesByKey.get(keyIndex) ?? null,
    })
  }
}

/** Spectator hero block team: { playerN: { name: "npc_dota_hero_x" } } — keyed by raw playerN. */
function parseTeamHeroes(team: unknown): Map<number, string> {
  const heroes = new Map<number, string>()
  const teamRecord = asRecord(team)
  if (!teamRecord) return heroes
  for (const [key, value] of Object.entries(teamRecord)) {
    const keyIndex = slotIndexFromKey(key)
    const hero = asRecord(value)
    if (keyIndex === null || !hero) continue
    const npcName = heroNpcShortName(hero['name'])
    if (npcName) heroes.set(keyIndex, npcName)
  }
  return heroes
}

/**
 * Normalize a raw GSI POST body into a GsiSnapshot. Never throws on unexpected
 * shapes — missing sections yield nulls/empties.
 */
export function parseGsiPayload(json: unknown): GsiSnapshot {
  const root = asRecord(json) ?? {}
  const map = asRecord(root['map'])
  const playerBlock = asRecord(root['player'])

  const players: GsiPlayer[] = []
  let localPlayer: GsiSnapshot['localPlayer'] = null

  const heroBlock = asRecord(root['hero'])
  let localHeroNpcName: string | null = null

  if (playerBlock) {
    const team2 = playerBlock['team2']
    const team3 = playerBlock['team3']
    if (asRecord(team2) || asRecord(team3)) {
      // Spectator mode: allplayers split into team2 (radiant) / team3 (dire);
      // picked hero MODELS mirror the same per-team key structure in the hero block
      const radiantHeroes = parseTeamHeroes(heroBlock?.['team2'])
      const direHeroes = parseTeamHeroes(heroBlock?.['team3'])
      parseTeamPlayers(team2, players, radiantHeroes, false)
      parseTeamPlayers(team3, players, direHeroes, true)
      players.sort((a, b) => a.slotIndex - b.slotIndex)
    } else {
      const name = asString(playerBlock['name'])
      if (name) {
        localPlayer = {
          name,
          accountId: asString(playerBlock['accountid']),
          slotIndex: localSlotIndex(playerBlock),
        }
      }
      // Playing: the hero block is the local player's own model
      localHeroNpcName = heroBlock ? heroNpcShortName(heroBlock['name']) : null
    }
  }

  return {
    gamePhase: map ? asString(map['game_state']) : null,
    clockTime: map ? asNumber(map['clock_time']) : null,
    matchId: map ? asString(map['matchid']) : null,
    players,
    localPlayer,
    localHeroNpcName,
  }
}

/**
 * Classify how a snapshot was produced. Spectating payloads carry allplayers
 * slots; playing payloads carry only the local player block; menu/loading
 * payloads carry neither.
 */
export function gsiSnapshotMode(snapshot: GsiSnapshot): GsiMode {
  if (snapshot.players.length > 0) return 'spectating'
  if (snapshot.localPlayer !== null) return 'playing'
  return 'unknown'
}
