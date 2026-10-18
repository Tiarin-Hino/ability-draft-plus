import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

describe('auto-rescan: a draft that restarts for the SAME match (2026-10-17, match 9049573510)', () => {
  const MATCH = '9049573510'
  const PLAYERS = Array.from({ length: 10 }, () => ({})) as unknown as GsiSnapshot['players']
  let current: GsiSnapshot | null
  let emit: (s: GsiSnapshot) => void
  /** Wall ms the draft screen became visible; the pool only reads after it rendered. */
  let draftScreenSinceMs: number | null
  let calls: { isInitial: boolean; heroOrders: number[] | undefined; atMs: number }[]
  let service: ReturnType<typeof createAutoRescanService>

  function send(gamePhase: string | null, matchId: string | null, clockTime: number | null): void {
    const s: GsiSnapshot = {
      gamePhase,
      matchId,
      clockTime,
      players: gamePhase === null ? [] : PLAYERS,
      localPlayer: null,
      localHeroNpcName: null,
    }
    if (gamePhase === GSI_HERO_SELECTION_PHASE && current?.gamePhase !== GSI_HERO_SELECTION_PHASE) {
      draftScreenSinceMs = Date.now()
    } else if (gamePhase !== GSI_HERO_SELECTION_PHASE) {
      draftScreenSinceMs = null
    }
    current = s
    emit(s)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    current = null
    draftScreenSinceMs = null
    calls = []
    const draftStore = createDraftStore()
    const streamService = {
      onGsiSnapshot: (listener: (s: GsiSnapshot) => void) => {
        emit = listener
      },
      getGsiState: () => ({ snapshot: current, connected: true }),
      refresh: vi.fn(),
    }
    const scanTrigger = {
      performScan: vi.fn(async (isInitial: boolean, options?: { heroOrders?: number[] }) => {
        calls.push({ isInitial, heroOrders: options?.heroOrders, atMs: Date.now() })
        // Captured before the draft screen finished rendering: nothing to read
        const rendered = draftScreenSinceMs !== null && Date.now() - draftScreenSinceMs >= 3_000
        if (isInitial && rendered) {
          draftStore.setState({
            initialPoolAbilitiesCache: {
              ultimates: [{ name: 'ult_a' }] as never,
              standard: [{ name: 'std_a' }] as never,
            },
          })
        }
      }),
    }
    service = createAutoRescanService(
      { getState: () => ({ overlayActive: true, mlStatus: 'ready' }) } as unknown as Deps[0],
      draftStore,
      {
        metadata: {
          getSettings: () => ({ experimentalAutoDraftTracking: true, autoInitialScanDelayS: 15 }),
        },
      } as unknown as Deps[2],
      streamService as unknown as Deps[3],
      scanTrigger as unknown as Deps[4],
      { settle: async () => true },
      vi.fn(),
    )
    service.start()
  })

  afterEach(() => {
    service.stop()
    vi.useRealTimers()
  })

  /** One hero-selection snapshot per second, the clock advancing by `clockAt(i)`. */
  async function heroSelectionFor(seconds: number, clockAt: (i: number) => number): Promise<void> {
    for (let i = 0; i < seconds; i++) {
      send(GSI_HERO_SELECTION_PHASE, MATCH, clockAt(i))
      await vi.advanceTimersByTimeAsync(1_000)
    }
  }

  it('re-arms the initial scan, the turn rescans and the draft-end final pass', async () => {
    // 19:09:44 spectator lands in hero selection, preview clock -59...
    await heroSelectionFor(10, (i) => -59 + i)
    // 19:09:54 an empty payload (no map block), then back to loading
    send(null, null, null)
    await vi.advanceTimersByTimeAsync(50_000)
    send('DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD', MATCH, -44)
    await vi.advanceTimersByTimeAsync(61_000)
    // 19:11:45 the real draft: preview from -59 again, then per-turn countdowns
    const draftStartMs = Date.now()
    await heroSelectionFor(59, (i) => -59 + i)
    await heroSelectionFor(120, (i) => (i % 7) - 7)

    // The pool was read once the draft screen had rendered
    const initial = calls.filter((c) => c.isInitial)
    expect(initial.length).toBeGreaterThanOrEqual(1)
    expect(initial[0].atMs - draftStartMs).toBeGreaterThanOrEqual(3_000)
    // ...and the turn clock drove targeted rescans
    const targeted = calls.filter((c) => !c.isInitial && c.heroOrders !== undefined)
    expect(targeted.length).toBeGreaterThan(0)
    // The first turn (row 0, 0-7s) is read ~2s after it ends, timed from the
    // REAL preview — not the aborted first one 2 minutes earlier
    const firstTurnScanS = (targeted[0].atMs - (draftStartMs + 59_000)) / 1000
    expect(firstTurnScanS).toBeGreaterThanOrEqual(7)
    expect(firstTurnScanS).toBeLessThanOrEqual(11)
    expect(targeted[0].heroOrders).toContain(0)

    // 19:19:00 hero selection ends: the final pass captures the last picks
    const before = calls.length
    send('DOTA_GAMERULES_STATE_STRATEGY_TIME', MATCH, -29)
    await vi.advanceTimersByTimeAsync(10_000)
    const final = calls.slice(before).filter((c) => !c.isInitial && c.heroOrders === undefined)
    expect(final.length).toBe(1)
  })

  it('an empty payload mid-draft is not a phase change', async () => {
    await heroSelectionFor(20, (i) => -59 + i) // pool read at ~15s
    expect(calls.filter((c) => c.isInitial)).toHaveLength(1)
    send(null, null, null)
    await vi.advanceTimersByTimeAsync(1_000)
    // No final pass for a payload that says nothing about the phase
    expect(calls.filter((c) => !c.isInitial)).toHaveLength(0)
  })

  it('retries the auto initial scan when it read no pool', async () => {
    // A slow render: the screen is still blank at the first attempt
    draftScreenSinceMs = null
    send(GSI_HERO_SELECTION_PHASE, MATCH, -59)
    draftScreenSinceMs = Date.now() + 20_000 // renders 20s in
    await heroSelectionFor(45, (i) => -58 + i)
    const initial = calls.filter((c) => c.isInitial)
    expect(initial.length).toBe(2)
    expect(initial[1].atMs - initial[0].atMs).toBeGreaterThanOrEqual(15_000)
  })
})
