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

function parseTeamPlayers(team: unknown, into: GsiPlayer[]): void {
  const teamRecord = asRecord(team)
  if (!teamRecord) return
  for (const [key, value] of Object.entries(teamRecord)) {
    const slotIndex = slotIndexFromKey(key)
    const player = asRecord(value)
    if (slotIndex === null || !player) continue
    const name = asString(player['name'])
    if (!name) continue
    into.push({
      slotIndex,
      name,
      accountId: asString(player['accountid']),
    })
  }
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

  if (playerBlock) {
    const team2 = playerBlock['team2']
    const team3 = playerBlock['team3']
    if (asRecord(team2) || asRecord(team3)) {
      // Spectator mode: allplayers keyed player0..player9 across the two teams
      parseTeamPlayers(team2, players)
      parseTeamPlayers(team3, players)
      players.sort((a, b) => a.slotIndex - b.slotIndex)
    } else {
      const name = asString(playerBlock['name'])
      if (name) {
        localPlayer = { name, accountId: asString(playerBlock['accountid']) }
      }
    }
  }

  return {
    gamePhase: map ? asString(map['game_state']) : null,
    clockTime: map ? asNumber(map['clock_time']) : null,
    players,
    localPlayer,
  }
}
