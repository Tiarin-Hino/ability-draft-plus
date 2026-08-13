import { describe, it, expect } from 'vitest'
import { parseGsiPayload, gsiSnapshotMode } from '@core/gsi/parser'

// Fixtures are synthetic but shape-accurate for Dota GSI (provider/map/player sections).
// The real-lobby capture spike (plan phase 4) replaces/extends these with recorded
// payloads in __tests__/fixtures/ once verified in an actual AD lobby.

const SPECTATOR_PAYLOAD = {
  provider: { name: 'Dota 2', appid: 570, version: 47, timestamp: 1700000000 },
  map: {
    name: 'start',
    matchid: '7000000001',
    game_time: 12,
    clock_time: -75,
    daytime: true,
    game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION',
    paused: false,
    win_team: 'none',
  },
  player: {
    team2: {
      player0: { steamid: '76561198000000001', accountid: '40000001', name: 'Alice' },
      player1: { steamid: '76561198000000002', accountid: '40000002', name: 'Bob' },
      player4: { steamid: '76561198000000005', accountid: '40000005', name: 'Eve' },
    },
    team3: {
      player5: { steamid: '76561198000000006', accountid: '40000006', name: 'Frank' },
      player9: { steamid: '76561198000000010', accountid: '40000010', name: 'Judy' },
    },
  },
  hero: {
    team2: {
      player0: { facet: 0, id: 28, name: 'npc_dota_hero_slardar' },
      player1: { facet: 0, id: 0, name: '' },
    },
    team3: {
      player5: { facet: 0, id: 74, name: 'npc_dota_hero_sand_king' },
    },
  },
}

const PLAYING_PAYLOAD = {
  provider: { name: 'Dota 2', appid: 570, version: 47, timestamp: 1700000000 },
  map: {
    name: 'start',
    game_time: 100,
    clock_time: 42,
    game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
  },
  player: {
    steamid: '76561198000000001',
    accountid: '40000001',
    name: 'LocalHero',
    activity: 'playing',
    kills: 0,
  },
  hero: { facet: 0, id: 56, name: 'npc_dota_hero_clinkz' },
}

describe('parseGsiPayload', () => {
  it('parses spectator payloads into slot-indexed players', () => {
    const snapshot = parseGsiPayload(SPECTATOR_PAYLOAD)
    expect(snapshot.gamePhase).toBe('DOTA_GAMERULES_STATE_HERO_SELECTION')
    expect(snapshot.clockTime).toBe(-75)
    expect(snapshot.localPlayer).toBeNull()
    expect(snapshot.players.map((p) => [p.slotIndex, p.name])).toEqual([
      [0, 'Alice'],
      [1, 'Bob'],
      [4, 'Eve'],
      [5, 'Frank'],
      [9, 'Judy'],
    ])
    expect(snapshot.players[0].accountId).toBe('40000001')
  })

  it('parses playing payloads into localPlayer only', () => {
    const snapshot = parseGsiPayload(PLAYING_PAYLOAD)
    expect(snapshot.players).toEqual([])
    expect(snapshot.localPlayer).toEqual({
      name: 'LocalHero',
      accountId: '40000001',
    })
    expect(snapshot.gamePhase).toBe('DOTA_GAMERULES_STATE_GAME_IN_PROGRESS')
    expect(snapshot.clockTime).toBe(42)
  })

  it('attaches spectator hero models to players by slot (empty names = unpicked)', () => {
    const snapshot = parseGsiPayload(SPECTATOR_PAYLOAD)
    const bySlot = new Map(snapshot.players.map((p) => [p.slotIndex, p.heroNpcName]))
    expect(bySlot.get(0)).toBe('slardar')
    expect(bySlot.get(1)).toBeNull()
    expect(bySlot.get(5)).toBe('sand_king')
    expect(bySlot.get(9)).toBeNull()
    expect(snapshot.localHeroNpcName).toBeNull()
  })

  it('extracts the local hero model while playing', () => {
    const snapshot = parseGsiPayload(PLAYING_PAYLOAD)
    expect(snapshot.localHeroNpcName).toBe('clinkz')
  })

  it('parses a REAL spectated hero-selection capture (regression fixture)', async () => {
    const { default: liveCapture } = await import(
      './fixtures/live-spectated-hero-selection.json'
    )
    const snapshot = parseGsiPayload(liveCapture)

    expect(snapshot.gamePhase).toBe('DOTA_GAMERULES_STATE_HERO_SELECTION')
    expect(snapshot.players).toHaveLength(10)
    expect(snapshot.players.map((p) => p.name)).toEqual([
      'fish', 'Drea', 'Mangology', 'Dad Inside', 'Mahaximus',
      'sifla', 'Spooner', 'Ipelius', 'Kenny', 'noertti',
    ])

    const models = new Map(snapshot.players.map((p) => [p.slotIndex, p.heroNpcName]))
    expect(models.get(7)).toBe('kunkka')
    expect(models.get(8)).toBe('keeper_of_the_light')
    expect(models.get(9)).toBe('death_prophet')
    expect(models.get(0)).toBeNull()
  })

  it('prefers team_slot over the playerN key for slot ordering', () => {
    const snapshot = parseGsiPayload({
      player: {
        team2: {
          player0: { name: 'SecondOnScreen', team_slot: 1 },
          player1: { name: 'FirstOnScreen', team_slot: 0 },
        },
      },
    })
    expect(snapshot.players.map((p) => [p.slotIndex, p.name])).toEqual([
      [0, 'FirstOnScreen'],
      [1, 'SecondOnScreen'],
    ])
  })

  it('joins hero models by raw key even when team_slot reorders players', () => {
    const snapshot = parseGsiPayload({
      player: {
        team2: {
          player0: { name: 'Reordered', team_slot: 1 },
        },
      },
      hero: {
        team2: { player0: { name: 'npc_dota_hero_luna' } },
      },
    })
    // player0's hero must follow the player to their team_slot-resolved slot 1
    expect(snapshot.players).toEqual([
      { slotIndex: 1, name: 'Reordered', accountId: null, heroNpcName: 'luna' },
    ])
  })

  it('normalizes dire hero blocks keyed player0..player4 to slots 5-9', () => {
    const snapshot = parseGsiPayload({
      player: {
        team2: { player0: { name: 'R1' } },
        team3: { player0: { name: 'D1' } },
      },
      hero: {
        team2: { player0: { name: 'npc_dota_hero_luna' } },
        team3: { player0: { name: 'npc_dota_hero_lich' } },
      },
    })
    const bySlot = new Map(snapshot.players.map((p) => [p.slotIndex, p.heroNpcName]))
    expect(bySlot.get(0)).toBe('luna')
    expect(bySlot.get(5)).toBe('lich')
  })

  it('extracts the match id for draft-session identity', () => {
    expect(parseGsiPayload(SPECTATOR_PAYLOAD).matchId).toBe('7000000001')
    expect(parseGsiPayload({ map: {} }).matchId).toBeNull()
  })

  it('normalizes dire blocks keyed player0..player4 to global slots 5-9', () => {
    const snapshot = parseGsiPayload({
      player: {
        team2: { player0: { name: 'R1' }, player4: { name: 'R5' } },
        team3: { player0: { name: 'D1' }, player4: { name: 'D5' } },
      },
    })
    expect(snapshot.players.map((p) => [p.slotIndex, p.name])).toEqual([
      [0, 'R1'],
      [4, 'R5'],
      [5, 'D1'],
      [9, 'D5'],
    ])
  })

  it('degrades gracefully on heartbeat payloads without map/player', () => {
    const snapshot = parseGsiPayload({
      provider: { name: 'Dota 2', appid: 570 },
    })
    expect(snapshot).toEqual({
      gamePhase: null,
      clockTime: null,
      matchId: null,
      players: [],
      localPlayer: null,
      localHeroNpcName: null,
    })
  })

  it('never throws on garbage input', () => {
    for (const garbage of [null, undefined, 42, 'x', [], { player: 7 }, { map: [] }]) {
      expect(() => parseGsiPayload(garbage)).not.toThrow()
    }
  })

  it('skips malformed player entries but keeps valid ones', () => {
    const snapshot = parseGsiPayload({
      player: {
        team2: {
          player0: { name: 'Valid' },
          player1: { accountid: 'no-name' },
          playerX: { name: 'BadKey' },
          player3: 'not-an-object',
        },
      },
    })
    expect(snapshot.players).toEqual([
      { slotIndex: 0, name: 'Valid', accountId: null, heroNpcName: null },
    ])
  })

  it('accepts clock_time of zero', () => {
    const snapshot = parseGsiPayload({ map: { clock_time: 0, game_state: 'X' } })
    expect(snapshot.clockTime).toBe(0)
  })
})

describe('gsiSnapshotMode', () => {
  it('classifies spectator payloads as spectating', () => {
    expect(gsiSnapshotMode(parseGsiPayload(SPECTATOR_PAYLOAD))).toBe('spectating')
  })

  it('classifies local-player payloads as playing', () => {
    expect(gsiSnapshotMode(parseGsiPayload(PLAYING_PAYLOAD))).toBe('playing')
  })

  it('classifies heartbeat payloads without player data as unknown', () => {
    expect(
      gsiSnapshotMode(parseGsiPayload({ provider: { name: 'Dota 2' } })),
    ).toBe('unknown')
  })
})
