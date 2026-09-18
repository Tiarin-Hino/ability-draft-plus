import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GsiSnapshot } from '@core/gsi/types'
import { GSI_HERO_SELECTION_PHASE } from '@core/gsi/types'

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}))

const { createAutoRescanService } = await import('../../../../src/main/services/auto-rescan-service')
const { createDraftStore } = await import('../../../../src/main/store/draft-store')

type Deps = Parameters<typeof createAutoRescanService>

function snapshot(gamePhase: string | null, matchId: string | null): GsiSnapshot {
  return {
    gamePhase,
    matchId,
    clockTime: null,
    players: [],
    localPlayer: { name: 'me', accountId: null, slotIndex: 0 },
    localHeroNpcName: null,
  }
}

describe('auto-rescan: a new match clears the previous draft (2026-09-18, background mode)', () => {
  let emit: (s: GsiSnapshot) => void
  let resetDraftState: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetDraftState = vi.fn()
    const streamService = {
      onGsiSnapshot: (listener: (s: GsiSnapshot) => void) => {
        emit = listener
      },
      getGsiState: () => ({ snapshot: null, connected: false }),
    }
    createAutoRescanService(
      { getState: () => ({ overlayActive: true, mlStatus: 'ready' }) } as unknown as Deps[0],
      createDraftStore(),
      {
        metadata: { getSettings: () => ({ experimentalAutoDraftTracking: false }) },
      } as unknown as Deps[2],
      streamService as unknown as Deps[3],
      {} as Deps[4],
      { settle: async () => true },
      resetDraftState,
    )
  })

  it('a draft of a different match clears the leftover draft (game closed mid-draft)', () => {
    emit(snapshot(GSI_HERO_SELECTION_PHASE, 'A'))
    emit(snapshot(null, null)) // game closed
    emit(snapshot('DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD', 'B'))
    emit(snapshot(GSI_HERO_SELECTION_PHASE, 'B'))
    expect(resetDraftState).toHaveBeenCalledTimes(1)
  })

  it('a draft of a different match after a completed one clears it too', () => {
    emit(snapshot(GSI_HERO_SELECTION_PHASE, 'A'))
    emit(snapshot('DOTA_GAMERULES_STATE_STRATEGY_TIME', 'A'))
    emit(snapshot('DOTA_GAMERULES_STATE_POST_GAME', 'A'))
    emit(snapshot(GSI_HERO_SELECTION_PHASE, 'B'))
    expect(resetDraftState).toHaveBeenCalledTimes(1)
  })

  it('never clears on the first draft, a re-entry of the same match, or an unknown match id', () => {
    emit(snapshot(GSI_HERO_SELECTION_PHASE, 'A')) // first draft since start
    emit(snapshot('DOTA_GAMERULES_STATE_STRATEGY_TIME', 'A'))
    emit(snapshot(GSI_HERO_SELECTION_PHASE, 'A')) // replay seeking flaps back in
    emit(snapshot('DOTA_GAMERULES_STATE_STRATEGY_TIME', 'A'))
    emit(snapshot(GSI_HERO_SELECTION_PHASE, null)) // no proof of a new match
    expect(resetDraftState).not.toHaveBeenCalled()
  })
})
