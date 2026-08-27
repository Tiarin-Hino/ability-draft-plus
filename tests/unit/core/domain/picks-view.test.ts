import { describe, it, expect } from 'vitest'
import { buildPicksViewState } from '@core/domain/picks-view'
import type {
  StreamAbilitySlot,
  StreamBoardState,
  StreamPlayerRow,
} from '@shared/types/stream'

function slot(name: string, extra: Partial<StreamAbilitySlot> = {}): StreamAbilitySlot {
  return {
    name,
    displayName: name,
    iconPath: `/icons/abilities/${name}.png`,
    winrate: 0.5,
    pickPosition: 10,
    consolidatedScore: 0.5,
    isTopTier: false,
    isUnknown: false,
    isPicked: false,
    ...extra,
  }
}

function player(playerIndex: number, extra: Partial<StreamPlayerRow> = {}): StreamPlayerRow {
  return {
    playerIndex,
    team: playerIndex < 5 ? 'radiant' : 'dire',
    playerName: null,
    model: null,
    picks: [null, null, null, null],
    draftScore: null,
    ...extra,
  }
}

function board(overrides: Partial<StreamBoardState> = {}): StreamBoardState {
  return {
    phase: 'drafting',
    heroes: [],
    players: Array.from({ length: 10 }, (_, i) => player(i)),
    panels: { topWinrateInPool: [], opCombos: [], trapCombos: [], topTier: [] },
    gsi: {
      connected: false,
      gamePhase: null,
      clockTime: null,
      spectating: false,
      playerNames: [],
      playerModels: [],
    },
    meta: { language: 'en', appVersion: '1.0.0', updatedAt: 123 },
    ...overrides,
  }
}

describe('buildPicksViewState', () => {
  it('returns null for a waiting board (caller keeps its previous snapshot)', () => {
    expect(buildPicksViewState(board({ phase: 'waiting', players: [] }))).toBeNull()
  })

  it('projects players down to the picks strip shape', () => {
    const input = board()
    input.players[0] = player(0, {
      playerName: 'Aurora',
      model: {
        npcName: 'sand_king',
        displayName: 'Sand King',
        portraitPath: '/icons/heroes/sand_king.png',
      },
      picks: [
        slot('sandking_burrowstrike'),
        slot('lich_frost_nova', { isUnknown: true }),
        null,
        slot('sandking_epicenter'),
      ],
    })

    const state = buildPicksViewState(input)
    expect(state).not.toBeNull()
    expect(state?.players).toHaveLength(10)
    expect(state?.meta).toEqual(input.meta)

    const first = state?.players[0]
    expect(first).toEqual({
      playerIndex: 0,
      team: 'radiant',
      playerName: 'Aurora',
      heroDisplayName: 'Sand King',
      portraitPath: '/icons/heroes/sand_king.png',
      picks: [
        {
          name: 'sandking_burrowstrike',
          displayName: 'sandking_burrowstrike',
          iconPath: '/icons/abilities/sandking_burrowstrike.png',
          isUnknown: false,
        },
        {
          name: 'lich_frost_nova',
          displayName: 'lich_frost_nova',
          iconPath: '/icons/abilities/lich_frost_nova.png',
          isUnknown: true,
        },
        null,
        {
          name: 'sandking_epicenter',
          displayName: 'sandking_epicenter',
          iconPath: '/icons/abilities/sandking_epicenter.png',
          isUnknown: false,
        },
      ],
    })
  })

  it('maps an unidentified hero and empty rows to nulls', () => {
    const state = buildPicksViewState(board())
    const last = state?.players[9]
    expect(last?.team).toBe('dire')
    expect(last?.playerName).toBeNull()
    expect(last?.heroDisplayName).toBeNull()
    expect(last?.portraitPath).toBeNull()
    expect(last?.picks).toEqual([null, null, null, null])
  })
})
