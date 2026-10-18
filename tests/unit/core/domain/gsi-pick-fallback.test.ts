import { describe, it, expect } from 'vitest'
import type { AbilityDetail } from '@shared/types'
import { parseGsiPayload } from '@core/gsi/parser'
import {
  buildGsiFallbackPicks,
  emptyFallbackPayload,
  hasScannedPicks,
  mergeLatchedPicks,
  withFallbackPicks,
} from '@core/domain/gsi-pick-fallback'
import { buildStreamBoardState } from '@core/domain/stream-board'
import { buildTwitchCompactState, buildTwitchRichState } from '@core/domain/twitch-projection'

function detail(name: string, isUltimate = false): AbilityDetail {
  return {
    abilityId: 1,
    name,
    displayName: name,
    heroId: 1,
    winrate: 0.5,
    highSkillWinrate: null,
    pickRate: 10,
    hsPickRate: null,
    isUltimate,
    abilityOrder: isUltimate ? 0 : 1,
  }
}

// Shape of a real spectate GAME_IN_PROGRESS capture (2026-10-17 cast)
const payload = {
  map: { matchid: '9049573510', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' },
  player: {
    team2: { player0: { name: 'A', team_slot: 0 }, player1: { name: 'B', team_slot: 1 } },
    team3: { player5: { name: 'C', team_slot: 0 } },
  },
  hero: {
    team2: {
      player0: { name: 'npc_dota_hero_furion' },
      player1: { name: 'npc_dota_hero_hoodwink' },
    },
    team3: { player5: { name: 'npc_dota_hero_legion_commander' } },
  },
  abilities: {
    team2: {
      player0: {
        ability0: { name: 'death_prophet_carrion_swarm' },
        ability1: { name: 'weaver_shukuchi' },
        ability2: { name: 'legion_commander_moment_of_courage' },
        ability3: { name: 'furion_wrath_of_nature' },
      },
      player1: {
        ability0: { name: 'hoodwink_acorn_shot' },
        ability1: { name: 'weaver_geminate_attack' },
        ability2: { name: 'hoodwink_scurry' },
        ability3: { name: 'windrunner_focusfire' },
        ability4: { name: 'hoodwink_mistwoods_wayfarer' },
      },
    },
    team3: {
      player5: {
        ability1: { name: 'windrunner_powershot' },
        ability0: { name: 'brewmaster_cinder_brew' },
      },
    },
  },
}

const details = new Map(
  [
    detail('death_prophet_carrion_swarm'),
    detail('weaver_shukuchi'),
    detail('legion_commander_moment_of_courage'),
    detail('furion_wrath_of_nature', true),
    detail('hoodwink_acorn_shot'),
    detail('weaver_geminate_attack'),
    detail('hoodwink_scurry'),
    detail('windrunner_focusfire', true),
    detail('windrunner_powershot'),
    detail('brewmaster_cinder_brew'),
  ].map((d) => [d.name, d]),
)

describe('GSI pick fallback', () => {
  it('parses spectator abilities per slot in abilityK order', () => {
    const snapshot = parseGsiPayload(payload)
    const bySlot = new Map(snapshot.players.map((p) => [p.slotIndex, p.abilities]))
    expect(bySlot.get(0)).toHaveLength(4)
    expect(bySlot.get(1)?.at(-1)).toBe('hoodwink_mistwoods_wayfarer')
    expect(bySlot.get(5)).toEqual(['brewmaster_cinder_brew', 'windrunner_powershot'])
  })

  it('keeps only DB-known abilities, ult in box 0, standard in 1-3', () => {
    const snapshot = parseGsiPayload(payload)
    const bySlot: (string[] | null)[] = Array.from({ length: 10 }, () => null)
    for (const p of snapshot.players) bySlot[p.slotIndex] = p.abilities ?? null
    const picks = buildGsiFallbackPicks(bySlot, details, (s) => s)

    const row1 = picks.filter((p) => p.hero_order === 1)
    expect(row1.map((p) => p.name)).not.toContain('hoodwink_mistwoods_wayfarer')
    expect(row1).toHaveLength(4)
    expect(row1.find((p) => p.is_ultimate)?.name).toBe('windrunner_focusfire')
    expect(row1.filter((p) => !p.is_ultimate).map((p) => p.ability_order)).toEqual([1, 2, 3])
    expect(picks.filter((p) => p.hero_order === 5)).toHaveLength(2)
  })

  it('fills board player picks even with no initial scan', () => {
    const snapshot = parseGsiPayload(payload)
    const bySlot: (string[] | null)[] = Array.from({ length: 10 }, () => null)
    for (const p of snapshot.players) bySlot[p.slotIndex] = p.abilities ?? null
    const initial = emptyFallbackPayload()
    expect(hasScannedPicks(initial)).toBe(false)
    const latest = withFallbackPicks(
      initial,
      buildGsiFallbackPicks(bySlot, details, (s) => s),
    )
    expect(hasScannedPicks(latest)).toBe(true)

    const board = buildStreamBoardState({
      initialPayload: initial,
      latestPayload: latest,
      gsi: {
        connected: true,
        gamePhase: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
        clockTime: 600,
        spectating: true,
        playerNames: ['A', 'B', null, null, null, 'C', null, null, null, null],
        playerModels: [],
      },
      slotRowMappings: Array.from({ length: 10 }, (_, i) => ({ gsiSlot: i, scanRow: i })),
      meta: { language: 'en', appVersion: 'test', updatedAt: 0 },
    })
    expect(board.phase).toBe('drafting')
    // Twitch projection must cope with the empty synthetic pool
    const rich = buildTwitchRichState({
      board,
      initialPayload: initial,
      pickEvents: [],
      draftId: 'd1',
      richRev: 0,
      ts: 0,
      thresholds: { op: 0.13, trap: 0.05 },
      meta: { appVersion: 'test', language: 'en' },
      lookups: {
        getAbilityDetails: (names) =>
          new Map(
            names.flatMap((n) => (details.has(n) ? [[n, details.get(n) as AbilityDetail]] : [])),
          ),
        getHeroes: () => [],
        getPairSynergies: () => [],
        getHeroPairSynergies: () => [],
      },
    })
    expect(rich).toBeTruthy()
    const compact = buildTwitchCompactState({
      board,
      pickEvents: [],
      phase: 'ingame',
      draftId: 'd1',
      rev: 1,
      richRev: 0,
      ts: 0,
      matchId: '9049573510',
      myRow: null,
      slotRowMappings: Array.from({ length: 10 }, (_, i) => ({ gsiSlot: i, scanRow: i })),
    })
    expect(compact.seats).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(JSON.stringify(compact.players?.[0])).toContain('carrion')
    expect(board.players[0].playerName).toBe('A')
    expect(board.players[0].picks.map((p) => p?.name ?? null)).toEqual([
      'death_prophet_carrion_swarm',
      'weaver_shukuchi',
      'legion_commander_moment_of_courage',
      'furion_wrath_of_nature',
    ])
  })

  describe('latched picks (casts swap the live ability bar)', () => {
    const row0 = (abilities: string[]): (string[] | null)[] => [
      abilities,
      ...Array.from({ length: 9 }, () => null),
    ]
    const drafted = [
      'death_prophet_carrion_swarm',
      'weaver_shukuchi',
      'legion_commander_moment_of_courage',
      'furion_wrath_of_nature',
    ]
    const read = (abilities: string[]) => buildGsiFallbackPicks(row0(abilities), details, (s) => s)
    const names = (picks: { name: string | null }[]) => picks.map((p) => p.name)

    it('keeps a pick whose slot was swapped for a non-draftable sub-ability', () => {
      const first = mergeLatchedPicks([], read(drafted))
      const swapped = read([
        'death_prophet_carrion_swarm',
        'weaver_shukuchi_end', // not DB-known: the box used to go empty
        'legion_commander_moment_of_courage',
        'furion_wrath_of_nature',
      ])
      expect(names(mergeLatchedPicks(first, swapped))).toEqual(names(first))
    })

    it('keeps every pick when the whole bar is replaced at once', () => {
      const first = mergeLatchedPicks([], read(drafted))
      expect(names(mergeLatchedPicks(first, read(['furion_wrath_of_nature'])))).toEqual(
        names(first),
      )
      expect(names(mergeLatchedPicks(first, []))).toEqual(names(first))
    })

    it('never adds a draftable ability to a full row (stolen/granted spells)', () => {
      const first = mergeLatchedPicks([], read(drafted))
      const merged = mergeLatchedPicks(first, read([...drafted, 'windrunner_powershot']))
      expect(merged).toHaveLength(4)
      expect(names(merged)).not.toContain('windrunner_powershot')
    })

    it('does not reorder boxes when GSI reorders the bar', () => {
      const first = mergeLatchedPicks([], read(drafted))
      const reordered = read([...drafted].reverse())
      expect(names(mergeLatchedPicks(first, reordered))).toEqual(names(first))
    })

    it('fills boxes still empty from a partial first read', () => {
      const first = mergeLatchedPicks([], read(['death_prophet_carrion_swarm']))
      const merged = mergeLatchedPicks(first, read(drafted))
      expect(names(merged)).toEqual(drafted)
      expect(merged.filter((p) => !p.is_ultimate).map((p) => p.ability_order)).toEqual([1, 2, 3])
      expect(merged.find((p) => p.is_ultimate)?.ability_order).toBe(0)
    })
  })
})
