import type { GsiPlayer, GsiSnapshot } from './types'

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

/** Normalize a per-team block key to the global 0-9 slot numbering. */
function globalSlotIndex(key: string, isDire: boolean): number | null {
  const rawIndex = slotIndexFromKey(key)
  if (rawIndex === null) return null
  // Some GSI versions key each team's block player0..player4, others use the
  // global player0..player9 numbering. Normalize dire to global slots 5-9.
  return isDire && rawIndex < 5 ? rawIndex + 5 : rawIndex
}

function parseTeamPlayers(
  team: unknown,
  into: GsiPlayer[],
  isDire: boolean,
): void {
  const teamRecord = asRecord(team)
  if (!teamRecord) return
  for (const [key, value] of Object.entries(teamRecord)) {
    const slotIndex = globalSlotIndex(key, isDire)
    const player = asRecord(value)
    if (slotIndex === null || !player) continue
    const name = asString(player['name'])
    if (!name) continue
    into.push({
      slotIndex,
      name,
      accountId: asString(player['accountid']),
      heroNpcName: null,
    })
  }
}

/** Spectator hero block: { team2: { playerN: { name: "npc_dota_hero_x" } }, team3: ... } */
function parseTeamHeroes(team: unknown, isDire: boolean): Map<number, string> {
  const heroes = new Map<number, string>()
  const teamRecord = asRecord(team)
  if (!teamRecord) return heroes
  for (const [key, value] of Object.entries(teamRecord)) {
    const slotIndex = globalSlotIndex(key, isDire)
    const hero = asRecord(value)
    if (slotIndex === null || !hero) continue
    const npcName = heroNpcShortName(hero['name'])
    if (npcName) heroes.set(slotIndex, npcName)
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
      // Spectator mode: allplayers split into team2 (radiant) / team3 (dire)
      parseTeamPlayers(team2, players, false)
      parseTeamPlayers(team3, players, true)
      players.sort((a, b) => a.slotIndex - b.slotIndex)

      // Picked hero MODELS mirror the same team structure in the hero block
      if (heroBlock) {
        const heroBySlot = new Map([
          ...parseTeamHeroes(heroBlock['team2'], false),
          ...parseTeamHeroes(heroBlock['team3'], true),
        ])
        for (const player of players) {
          player.heroNpcName = heroBySlot.get(player.slotIndex) ?? null
        }
      }
    } else {
      const name = asString(playerBlock['name'])
      if (name) {
        localPlayer = { name, accountId: asString(playerBlock['accountid']) }
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
