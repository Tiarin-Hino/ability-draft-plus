import { describe, it, expect } from 'vitest'
import { parseGsiPayload } from '@core/gsi/parser'

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
      { slotIndex: 0, name: 'Valid', accountId: null },
    ])
  })

  it('accepts clock_time of zero', () => {
    const snapshot = parseGsiPayload({ map: { clock_time: 0, game_state: 'X' } })
    expect(snapshot.clockTime).toBe(0)
  })
})
