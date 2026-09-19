import type { GsiMode, GsiPlayer, GsiPlayerLive, GsiSnapshot } from './types'

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
  heroStatsByKey?: Map<number, GsiPlayerLive>,
  itemsByKey?: Map<number, GsiPlayerLive>,
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
    // Every side block shares the player block's key numbering — join by raw
    // key, NOT by resolved slot, so team_slot reordering can't mismatch them.
    const live: GsiPlayerLive = {
      ...parsePlayerLive(player),
      ...(heroStatsByKey?.get(keyIndex) ?? {}),
      ...(itemsByKey?.get(keyIndex) ?? {}),
    }
    into.push({
      slotIndex,
      name,
      accountId: asString(player['accountid']),
      heroNpcName: heroesByKey.get(keyIndex) ?? null,
      ...(Object.keys(live).length > 0 ? { live } : {}),
    })
  }
}

/**
 * Caster telemetry from a spectator payload. Field names verified against a real
 * GAME_IN_PROGRESS capture (2026-09-04): the player block carries the economy and
 * damage counters, the hero block carries level/buyback/Aghanim's state. Every
 * value is optional — during hero selection none of it exists yet.
 */
function parsePlayerLive(player: Record<string, unknown>): GsiPlayerLive {
  const damageTaken =
    (asNumber(player['damage_received_post_reduction_physical']) ?? 0) +
    (asNumber(player['damage_received_post_reduction_magical']) ?? 0) +
    (asNumber(player['damage_received_post_reduction_pure']) ?? 0)

  const live: GsiPlayerLive = {}
  const put = <K extends keyof GsiPlayerLive>(
    key: K,
    value: GsiPlayerLive[K] | null | undefined,
  ): void => {
    if (value !== null && value !== undefined) live[key] = value
  }
  put('netWorth', asNumber(player['net_worth']))
  put('gold', asNumber(player['gold']))
  put('gpm', asNumber(player['gpm']))
  put('xpm', asNumber(player['xpm']))
  put('kills', asNumber(player['kills']))
  put('deaths', asNumber(player['deaths']))
  put('assists', asNumber(player['assists']))
  put('lastHits', asNumber(player['last_hits']))
  put('denies', asNumber(player['denies']))
  put('heroDamage', asNumber(player['hero_damage']))
  put('heroHealing', asNumber(player['hero_healing']))
  put('towerDamage', asNumber(player['tower_damage']))
  if (damageTaken > 0) live.damageTaken = damageTaken
  return live
}

/** Spectator hero block team: per-key hero state (level, buyback, Aghanim's). */
function parseTeamHeroStats(team: unknown): Map<number, GsiPlayerLive> {
  const stats = new Map<number, GsiPlayerLive>()
  const teamRecord = asRecord(team)
  if (!teamRecord) return stats
  for (const [key, value] of Object.entries(teamRecord)) {
    const keyIndex = slotIndexFromKey(key)
    const hero = asRecord(value)
    if (keyIndex === null || !hero) continue
    const live: GsiPlayerLive = {}
    const level = asNumber(hero['level'])
    if (level !== null) live.level = level
    if (typeof hero['alive'] === 'boolean') live.alive = hero['alive']
    const respawn = asNumber(hero['respawn_seconds'])
    if (respawn !== null) live.respawnSeconds = respawn
    const buybackCost = asNumber(hero['buyback_cost'])
    if (buybackCost !== null) live.buybackCost = buybackCost
    const buybackCooldown = asNumber(hero['buyback_cooldown'])
    if (buybackCooldown !== null) live.buybackCooldown = buybackCooldown
    if (typeof hero['aghanims_scepter'] === 'boolean') {
      live.hasScepter = hero['aghanims_scepter']
    }
    if (typeof hero['aghanims_shard'] === 'boolean') {
      live.hasShard = hero['aghanims_shard']
    }
    stats.set(keyIndex, live)
  }
  return stats
}

/** "item_blink" -> "item_blink"; Dota's empty slots read "empty". */
function itemName(slot: unknown): string | null {
  const name = asString(asRecord(slot)?.['name'])
  return !name || name === 'empty' ? null : name
}

/**
 * Spectator items block: { playerN: { slot0..slot8, stash0.., neutral0, teleport0 } }.
 * Slots 0-5 are the inventory, 6-8 the backpack. Requires `"items" "1"` in the
 * cfg — an installed cfg from before the caster edition omits the whole block.
 */
function parseTeamItems(team: unknown): Map<number, GsiPlayerLive> {
  const items = new Map<number, GsiPlayerLive>()
  const teamRecord = asRecord(team)
  if (!teamRecord) return items
  for (const [key, value] of Object.entries(teamRecord)) {
    const keyIndex = slotIndexFromKey(key)
    const block = asRecord(value)
    if (keyIndex === null || !block) continue
    // Verified against a live capture: slot0-5 inventory, slot6-8 backpack, with
    // teleport0 and neutral0/neutral1 (the enchantment) as their own slots — a
    // TP scroll never appears in slot0-5, so reading only the inventory loses it.
    items.set(keyIndex, {
      items: [0, 1, 2, 3, 4, 5].map((i) => itemName(block[`slot${i}`])),
      backpack: [6, 7, 8].map((i) => itemName(block[`slot${i}`])),
      neutral: itemName(block['neutral0']),
      neutralEnchant: itemName(block['neutral1']),
      teleport: itemName(block['teleport0']),
    })
  }
  return items
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
      const radiantStats = parseTeamHeroStats(heroBlock?.['team2'])
      const direStats = parseTeamHeroStats(heroBlock?.['team3'])
      const itemBlock = asRecord(root['items'])
      const radiantItems = parseTeamItems(itemBlock?.['team2'])
      const direItems = parseTeamItems(itemBlock?.['team3'])
      parseTeamPlayers(team2, players, radiantHeroes, false, radiantStats, radiantItems)
      parseTeamPlayers(team3, players, direHeroes, true, direStats, direItems)
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
