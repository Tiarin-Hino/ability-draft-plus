import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('userData must not be touched when storage is injected')
    },
    getVersion: () => '3.0.0-test',
    isPackaged: false,
  },
}))

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

import {
  createTwitchPublisherService,
  type TwitchStateStorage,
} from '../../../../src/main/services/twitch-publisher-service'
import {
  TwitchEbsError,
  type TwitchEbsClient,
} from '../../../../src/main/services/twitch-ebs-client'
import type {
  StreamServerService,
  StreamStateContext,
  StreamStateSubscriber,
} from '../../../../src/main/services/stream-server-service'
import type { DatabaseService } from '../../../../src/main/services/database-service'
import { createAppStore } from '../../../../src/main/store/app-store'
import { buildStreamBoardState } from '../../../../src/core/domain/stream-board'
import type { GsiSnapshot } from '../../../../src/core/gsi/types'
import type {
  EnrichedScanSlot,
  HeroModelDisplay,
  OverlayDataPayload,
} from '../../../../src/shared/types'
import type { StreamStateMessage } from '../../../../src/shared/types/stream'
import type { TwitchPublishEnvelope } from '../../../../src/shared/types/twitch'
import { DEFAULT_SETTINGS } from '../../../../src/shared/constants/defaults'
import {
  TWITCH_PUBLISH_DEBOUNCE_MS,
  TWITCH_PUBLISH_MIN_INTERVAL_MS,
  TWITCH_STATE_STALE_MS,
} from '../../../../src/shared/constants/thresholds'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSlot(
  name: string,
  heroOrder: number,
  abilityOrder: number,
  isUltimate: boolean,
): EnrichedScanSlot {
  return {
    name,
    confidence: 0.95,
    hero_order: heroOrder,
    ability_order: abilityOrder,
    is_ultimate: isUltimate,
    coord: {
      x: 100,
      y: 100,
      width: 47,
      height: 42,
      hero_order: heroOrder,
      ability_order: abilityOrder,
    },
    displayName: name,
    winrate: 0.5,
    pickRate: 20,
    consolidatedScore: 0.5,
    isGeneralTopTier: false,
    isSynergySuggestionForMySpot: false,
    isUltimateFromDb: isUltimate,
    highWinrateCombinations: [],
    lowWinrateCombinations: [],
    strongHeroSynergies: [],
    weakHeroSynergies: [],
  }
}

function makeHeroModel(heroOrder: number): HeroModelDisplay {
  return {
    heroOrder,
    heroName: `hero${heroOrder}`,
    heroDisplayName: `Hero ${heroOrder}`,
    dbHeroId: heroOrder + 1,
    winrate: 0.5,
    pickRate: 20,
    consolidatedScore: 0.5,
    isGeneralTopTier: false,
    identificationConfidence: 0.95,
    strongAbilitySynergies: [],
    weakAbilitySynergies: [],
  }
}

function makePayload(
  picks: Array<{ name: string; player: number; ult: boolean }> = [],
): OverlayDataPayload {
  const standard: EnrichedScanSlot[] = []
  const ultimates: EnrichedScanSlot[] = []
  for (let h = 0; h < 12; h++) {
    for (let a = 1; a <= 3; a++) standard.push(makeSlot(`hero${h}_slot${a}`, h, a, false))
    ultimates.push(makeSlot(`hero${h}_ult`, h, 0, true))
  }
  return {
    initialSetup: false,
    scanData: {
      ultimates,
      standard,
      selectedAbilities: picks.map((p) => makeSlot(p.name, p.player, p.ult ? 0 : 1, p.ult)),
    },
    targetResolution: '1920x1080',
    scaleFactor: 1,
    opCombinations: [],
    trapCombinations: [],
    heroSynergies: [],
    heroTraps: [],
    heroModels: Array.from({ length: 12 }, (_, i) => makeHeroModel(i)),
    heroesForMySpotUI: [],
    selectedHeroForDraftingDbId: null,
    selectedSpotHeroOrder: null,
    selectedModelHeroOrder: null,
    heroesCoords: [],
    heroesParams: { width: 0, height: 0 },
    modelsCoords: [],
    autoDraftTrackingEnabled: false,
  }
}

function makeMessage(
  initialPayload: OverlayDataPayload | null,
  latestPayload: OverlayDataPayload | null,
): StreamStateMessage {
  return {
    v: 2,
    type: 'state',
    ts: 0,
    payload: buildStreamBoardState({
      initialPayload,
      latestPayload,
      gsi: null,
      meta: { language: 'en', appVersion: '3.0.0-test', updatedAt: 0 },
    }),
  }
}

function makeContext(
  initialPayload: OverlayDataPayload | null,
  latestPayload = initialPayload,
): StreamStateContext {
  return { initialPayload, latestPayload, pickEvents: [], myRow: null, gsiMatchId: null }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  service: ReturnType<typeof createTwitchPublisherService>
  appStore: ReturnType<typeof createAppStore>
  ebs: {
    publish: ReturnType<typeof vi.fn>
    pairComplete: ReturnType<typeof vi.fn>
    unpair: ReturnType<typeof vi.fn>
  }
  metadata: Map<string, string>
  settings: { twitchBroadcastEnabled: boolean }
  subscriber: () => StreamStateSubscriber
  gsi: (snapshot: Partial<GsiSnapshot>) => void
  refresh: ReturnType<typeof vi.fn>
  storage: MemoryStorage
}

interface MemoryStorage extends TwitchStateStorage {
  data: string | null
}

function makeStorage(initial: string | null = null): MemoryStorage {
  return {
    data: initial,
    async read() {
      return this.data
    },
    async write(body: string) {
      this.data = body
    },
  }
}

function makeHarness(
  opts: { paired?: boolean; enabled?: boolean; storage?: MemoryStorage } = {},
): Harness {
  const metadata = new Map<string, string>()
  if (opts.paired !== false) {
    metadata.set('twitch_channel_id', '123')
    metadata.set('twitch_channel_token', 'tok')
    metadata.set('twitch_channel_name', 'streamer')
    metadata.set('twitch_paired_at', '2026-09-01T00:00:00.000Z')
  }
  const settings = { twitchBroadcastEnabled: opts.enabled !== false }

  const dbService = {
    persist: vi.fn(),
    metadata: {
      get: (key: string) => metadata.get(key) ?? null,
      set: (key: string, value: string) => {
        metadata.set(key, value)
      },
      getSettings: () => ({ ...DEFAULT_SETTINGS, ...settings }),
      setSettings: (partial: { twitchBroadcastEnabled?: boolean }) => {
        if (partial.twitchBroadcastEnabled !== undefined) {
          settings.twitchBroadcastEnabled = partial.twitchBroadcastEnabled
        }
      },
    },
    abilities: { getDetails: () => new Map() },
    heroes: { getAll: () => [] },
    synergies: { getSynergiesAmong: () => [], getHeroSynergiesAmong: () => [] },
  } as unknown as DatabaseService

  let subscriber: StreamStateSubscriber | null = null
  const gsiListeners: Array<(s: GsiSnapshot) => void> = []
  const refresh = vi.fn()
  const streamService = {
    subscribeState: (s: StreamStateSubscriber) => {
      subscriber = s
      return () => {
        subscriber = null
      }
    },
    onGsiSnapshot: (l: (s: GsiSnapshot) => void) => {
      gsiListeners.push(l)
    },
    refresh,
  } as unknown as StreamServerService

  const ebs = {
    baseUrl: 'http://ebs.test/twitch',
    publish: vi.fn().mockResolvedValue({ ok: true, r: 1, pubsub: 'sent' }),
    pairComplete: vi.fn(),
    unpair: vi.fn().mockResolvedValue(undefined),
  }

  const appStore = createAppStore()
  const storage = opts.storage ?? makeStorage()
  const service = createTwitchPublisherService(
    dbService,
    appStore,
    streamService,
    ebs as unknown as TwitchEbsClient,
    { storage },
  )

  return {
    service,
    appStore,
    ebs,
    metadata,
    settings,
    subscriber: () => {
      if (!subscriber) throw new Error('not subscribed')
      return subscriber
    },
    gsi: (snapshot) => {
      const full: GsiSnapshot = {
        gamePhase: null,
        clockTime: null,
        matchId: null,
        players: [],
        localPlayer: null,
        localHeroNpcName: null,
        ...snapshot,
      }
      for (const l of gsiListeners) l(full)
    },
    refresh,
    storage,
  }
}

async function settle(
  ms = TWITCH_PUBLISH_DEBOUNCE_MS + TWITCH_PUBLISH_MIN_INTERVAL_MS + 50,
): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

/** Drain resolved promise chains (storage read on start, etc.). */
async function flushIo(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

function lastEnvelope(h: Harness): TwitchPublishEnvelope {
  const calls = h.ebs.publish.mock.calls
  return calls[calls.length - 1][1] as TwitchPublishEnvelope
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('twitch-publisher-service', () => {
  beforeEach(() => {
    // Keep setImmediate/nextTick real so fs.promises I/O can complete (flushIo)
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('is inactive while disabled or unpaired and never publishes', async () => {
    const unpaired = makeHarness({ paired: false })
    unpaired.service.start()
    expect(unpaired.subscriber().isActive()).toBe(false)
    expect(unpaired.appStore.getState().twitchPublishStatus).toBe('off')

    const disabled = makeHarness({ enabled: false })
    disabled.service.start()
    expect(disabled.subscriber().isActive()).toBe(false)
    const payload = makePayload()
    disabled.subscriber().onState(makeMessage(payload, payload), makeContext(payload))
    await settle()
    expect(disabled.ebs.publish).not.toHaveBeenCalled()
  })

  it('publishes compact + rich for a new draft, then compact only for rescans', async () => {
    const h = makeHarness()
    h.service.start()
    expect(h.subscriber().isActive()).toBe(true)

    const initial = makePayload()
    h.subscriber().onState(makeMessage(initial, initial), makeContext(initial))
    await settle()

    expect(h.ebs.publish).toHaveBeenCalledTimes(1)
    const first = lastEnvelope(h)
    expect(first.channelId).toBe('123')
    expect(first.compact.p).toBe('drafting')
    expect(first.compact.r).toBe(1)
    expect(first.compact.pool).toHaveLength(12)
    expect(first.rich).toBeDefined()
    expect(first.rich?.d).toBe(first.compact.d)
    expect(first.compact.rr).toBe(first.rich?.rr)
    expect(h.appStore.getState().twitchPublishStatus).toBe('ok')

    // Rescan: a pick landed — same draft id, rev bumps, rich unchanged so omitted
    const rescan = makePayload([{ name: 'hero3_ult', player: 7, ult: true }])
    h.subscriber().onState(makeMessage(initial, rescan), makeContext(initial, rescan))
    await settle()
    expect(h.ebs.publish).toHaveBeenCalledTimes(2)
    const second = lastEnvelope(h)
    expect(second.compact.d).toBe(first.compact.d)
    expect(second.compact.r).toBe(2)
    expect(second.rich).toBeUndefined()
    expect(second.compact.players?.[7][1][3]).toBe(12)
  })

  it('coalesces bursts into one request and skips identical content', async () => {
    const h = makeHarness()
    h.service.start()
    const initial = makePayload()
    for (let i = 0; i < 5; i++) {
      h.subscriber().onState(makeMessage(initial, initial), makeContext(initial))
    }
    await settle()
    expect(h.ebs.publish).toHaveBeenCalledTimes(1)

    // GSI-rate rebuild with identical content -> no request
    h.subscriber().onState(makeMessage(initial, initial), makeContext(initial))
    await settle()
    expect(h.ebs.publish).toHaveBeenCalledTimes(1)
  })

  it('resends rich immediately when the EBS asks for it', async () => {
    const h = makeHarness()
    h.ebs.publish
      .mockResolvedValueOnce({ ok: true, r: 1, pubsub: 'sent' })
      .mockResolvedValueOnce({ ok: true, r: 2, pubsub: 'sent', needRich: true })
      .mockResolvedValue({ ok: true, r: 3, pubsub: 'sent' })
    h.service.start()
    const initial = makePayload()
    h.subscriber().onState(makeMessage(initial, initial), makeContext(initial))
    await settle()
    const rescan = makePayload([{ name: 'hero3_ult', player: 7, ult: true }])
    h.subscriber().onState(makeMessage(initial, rescan), makeContext(initial, rescan))
    await settle()
    await settle()
    expect(h.ebs.publish).toHaveBeenCalledTimes(3)
    expect(lastEnvelope(h).rich).toBeDefined()
  })

  it('turns a session reset into an in-game publish carrying the last pool', async () => {
    const h = makeHarness()
    h.service.start()
    const initial = makePayload()
    h.subscriber().onState(makeMessage(initial, initial), makeContext(initial))
    await settle()

    h.subscriber().onSessionReset()
    // The board is blank now — the publisher must not depend on it
    h.subscriber().onState(makeMessage(null, null), makeContext(null))
    await settle()

    expect(h.ebs.publish).toHaveBeenCalledTimes(2)
    const env = lastEnvelope(h)
    expect(env.compact.p).toBe('ingame')
    expect(env.compact.pool).toHaveLength(12)
    expect(env.compact.d).toBe(h.ebs.publish.mock.calls[0][1].compact.d)
  })

  it('publishes in-game seats for the current draft only, and only on a change', async () => {
    const h = makeHarness()
    h.service.start()
    const initial = makePayload()
    h.subscriber().onState(makeMessage(initial, initial), makeContext(initial))
    await settle()
    h.subscriber().onSessionReset()
    await settle()
    const before = h.ebs.publish.mock.calls.length

    // The draft session is gone by now; the publisher's snapshot still has it
    const drafted = h.service.getDraftedModels()
    expect(drafted).not.toBeNull()
    expect(drafted!.draftId).toBe(lastEnvelope(h).compact.d)
    expect(drafted!.models).toHaveLength(10)

    const seats = [4, 3, 1, 2, 0, 6, 5, 7, 9, 8]
    h.service.setSeats(drafted!.draftId, seats)
    await settle()
    expect(h.ebs.publish).toHaveBeenCalledTimes(before + 1)
    expect(lastEnvelope(h).compact.seats).toEqual(seats)

    h.service.setSeats(drafted!.draftId, [...seats]) // unchanged
    h.service.setSeats('some-older-draft', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    await settle()
    expect(h.ebs.publish).toHaveBeenCalledTimes(before + 1)
  })

  it('a drafting rebuild (overlay kept open in game) keeps identified seats', async () => {
    const h = makeHarness()
    h.service.start()
    const initial = makePayload()
    h.subscriber().onState(makeMessage(initial, initial), makeContext(initial))
    await settle()
    const seats = [4, 3, 1, 2, 0, 6, 5, 7, 9, 8]
    h.service.setSeats(h.service.getDraftedModels()!.draftId, seats)
    await settle()

    const rescan = makePayload([{ name: 'hero0_slot1', player: 2, ult: false }])
    h.subscriber().onState(makeMessage(initial, rescan), makeContext(initial, rescan))
    await settle()
    expect(lastEnvelope(h).compact.seats).toEqual(seats)
  })

  it('follows GSI phases and hides the board for a new match', async () => {
    const h = makeHarness()
    h.service.start()
    const initial = makePayload()
    h.gsi({ gamePhase: 'DOTA_GAMERULES_STATE_HERO_SELECTION', matchId: 'm1' })
    h.subscriber().onState(makeMessage(initial, initial), makeContext(initial))
    await settle()
    expect(lastEnvelope(h).compact.mid).toBe('m1')

    h.gsi({ gamePhase: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', matchId: 'm1' })
    await settle()
    expect(lastEnvelope(h).compact.p).toBe('ingame')

    h.gsi({ gamePhase: 'DOTA_GAMERULES_STATE_POST_GAME', matchId: 'm1' })
    await settle()
    expect(lastEnvelope(h).compact.p).toBe('ended')

    h.gsi({ gamePhase: 'DOTA_GAMERULES_STATE_HERO_SELECTION', matchId: 'm2' })
    await settle()
    const waiting = lastEnvelope(h).compact
    expect(waiting.p).toBe('waiting')
    expect(waiting.pool).toBeUndefined()
  })

  it('backs off on transport errors and recovers', async () => {
    const h = makeHarness()
    h.ebs.publish
      .mockRejectedValueOnce(new TwitchEbsError('boom', 503))
      .mockResolvedValue({ ok: true, r: 1, pubsub: 'sent' })
    h.service.start()
    const initial = makePayload()
    h.subscriber().onState(makeMessage(initial, initial), makeContext(initial))
    await settle()
    expect(h.ebs.publish).toHaveBeenCalledTimes(1)
    expect(h.appStore.getState().twitchPublishStatus).toBe('error')
    expect(h.appStore.getState().twitchErrorKey).toBe('twitch.errorNetwork')

    await vi.advanceTimersByTimeAsync(2_500)
    expect(h.ebs.publish).toHaveBeenCalledTimes(2)
    expect(h.appStore.getState().twitchPublishStatus).toBe('ok')
  })

  it('stops publishing after the EBS rejects the token', async () => {
    const h = makeHarness()
    h.ebs.publish.mockResolvedValue({ ok: false, error: 'unauthorized' })
    h.service.start()
    const initial = makePayload()
    h.subscriber().onState(makeMessage(initial, initial), makeContext(initial))
    await settle()
    expect(h.appStore.getState().twitchErrorKey).toBe('twitch.errorUnauthorized')
    expect(h.subscriber().isActive()).toBe(false)

    const rescan = makePayload([{ name: 'hero3_ult', player: 7, ult: true }])
    h.subscriber().onState(makeMessage(initial, rescan), makeContext(initial, rescan))
    await settle()
    expect(h.ebs.publish).toHaveBeenCalledTimes(1)
  })

  it('persists the snapshot and republishes it after a restart', async () => {
    const h = makeHarness()
    h.service.start()
    const initial = makePayload()
    h.subscriber().onState(makeMessage(initial, initial), makeContext(initial))
    await settle()
    await vi.advanceTimersByTimeAsync(1_500)
    expect(h.storage.data).not.toBeNull()
    const saved = JSON.parse(h.storage.data as string)
    expect(saved.phase.phase).toBe('drafting')
    expect(saved.compact.pool).toHaveLength(12)

    // Fresh service over the same storage: restores + republishes once
    const restarted = makeHarness({ storage: h.storage })
    restarted.service.start()
    await flushIo()
    await vi.advanceTimersByTimeAsync(TWITCH_PUBLISH_DEBOUNCE_MS + 50)
    expect(restarted.ebs.publish).toHaveBeenCalledTimes(1)
    const env = lastEnvelope(restarted)
    expect(env.compact.d).toBe(saved.compact.d)
    expect(env.compact.r).toBe(saved.rev + 1)
    expect(env.rich).toBeDefined()
  })

  it('ignores a stale persisted snapshot', async () => {
    const storage = makeStorage(
      JSON.stringify({
        v: 1,
        phase: { phase: 'ingame', draftId: 'old', matchId: null },
        rev: 5,
        richRev: 1,
        compact: { v: 1, d: 'old', p: 'ingame', r: 5, t: 0, rr: 1 },
        rich: null,
        updatedAt: Date.now() - TWITCH_STATE_STALE_MS - 1,
      }),
    )
    const h = makeHarness({ storage })
    h.service.start()
    await flushIo()
    await vi.advanceTimersByTimeAsync(TWITCH_PUBLISH_DEBOUNCE_MS + 50)
    expect(h.ebs.publish).not.toHaveBeenCalled()
  })

  it('ends an in-game snapshot that went stale', async () => {
    const h = makeHarness()
    h.service.start()
    const initial = makePayload()
    h.subscriber().onState(makeMessage(initial, initial), makeContext(initial))
    await settle()
    h.subscriber().onSessionReset()
    await settle()
    expect(lastEnvelope(h).compact.p).toBe('ingame')

    await vi.advanceTimersByTimeAsync(TWITCH_STATE_STALE_MS + 61_000)
    expect(lastEnvelope(h).compact.p).toBe('ended')
  })

  it('publishes ended on stop for a live draft', async () => {
    const h = makeHarness()
    h.service.start()
    const initial = makePayload()
    h.subscriber().onState(makeMessage(initial, initial), makeContext(initial))
    await settle()
    const stopping = h.service.stop()
    await vi.advanceTimersByTimeAsync(100)
    await stopping
    expect(h.ebs.publish).toHaveBeenCalledTimes(2)
    expect(lastEnvelope(h).compact.p).toBe('ended')
  })

  it('pairs through the EBS and stores the link outside the app store', async () => {
    const h = makeHarness({ paired: false, enabled: true })
    h.ebs.pairComplete.mockResolvedValue({
      channelId: '999',
      channelToken: 'secret-token',
      channelName: 'caster',
    })
    h.service.start()

    const result = await h.service.pair('abcd-efgh')
    expect(result.success).toBe(true)
    expect(h.ebs.pairComplete).toHaveBeenCalledWith({ code: 'ABCDEFGH', appVersion: '3.0.0-test' })
    expect(h.metadata.get('twitch_channel_token')).toBe('secret-token')
    expect(h.service.getLinkInfo()?.channelName).toBe('caster')
    expect(h.appStore.getState().twitchPaired).toBe(true)
    expect(JSON.stringify(h.appStore.getState())).not.toContain('secret-token')
    expect(h.subscriber().isActive()).toBe(true)

    await h.service.unpair()
    expect(h.ebs.unpair).toHaveBeenCalledWith('secret-token', '999')
    expect(h.service.getLinkInfo()).toBeNull()
    expect(h.appStore.getState().twitchPublishStatus).toBe('off')
  })

  it('maps a rejected pairing code to the invalid-code key', async () => {
    const h = makeHarness({ paired: false })
    h.ebs.pairComplete.mockRejectedValue(new TwitchEbsError('nope', 404))
    h.service.start()
    expect(await h.service.pair('ABCDEFGH')).toEqual({
      success: false,
      errorKey: 'twitch.errorInvalidCode',
    })
    expect(await h.service.pair('AB')).toEqual({
      success: false,
      errorKey: 'twitch.errorInvalidCode',
    })
  })

  it('toggling broadcast on asks the stream server for the live board', async () => {
    const h = makeHarness({ enabled: false })
    h.service.start()
    h.service.setBroadcastEnabled(true)
    expect(h.settings.twitchBroadcastEnabled).toBe(true)
    expect(h.refresh).toHaveBeenCalledTimes(1)
    expect(h.subscriber().isActive()).toBe(true)
    expect(h.appStore.getState().twitchBroadcastEnabled).toBe(true)
  })
})
