import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import log from 'electron-log/main'
import type { StreamStateMessage } from '@shared/types/stream'
import {
  TWITCH_PROTOCOL_VERSION,
  type TwitchCompactState,
  type TwitchLinkInfo,
  type TwitchPublishStatus,
  type TwitchRichState,
} from '@shared/types/twitch'
import {
  TWITCH_COMPACT_MAX_BYTES,
  TWITCH_PUBLISH_DEBOUNCE_MS,
  TWITCH_PUBLISH_MIN_INTERVAL_MS,
  TWITCH_PUBLISH_RETRY_BACKOFF_MS,
  TWITCH_STATE_STALE_MS,
  TWITCH_LIVE_INTERVAL_MS,
} from '@shared/constants/thresholds'
import {
  buildTwitchLiveState,
  encodeTwitchLive,
  twitchLiveContentKey,
} from '@core/domain/twitch-live-projection'
import type { GsiSnapshot } from '@core/gsi/types'
import {
  buildTwitchCompactState,
  buildTwitchRichState,
  encodeTwitchCompact,
  initialTwitchPhaseState,
  nextTwitchPhase,
  restampCompact,
  twitchCompactContentKey,
  twitchRichContentKey,
  type TwitchPhaseEvent,
  type TwitchPhaseState,
} from '@core/domain/twitch-projection'
import type { DatabaseService } from './database-service'
import type { AppStore } from '../store/app-store'
import type { StreamServerService, StreamStateContext } from './stream-server-service'
import { TwitchEbsError, type TwitchEbsClient } from './twitch-ebs-client'

// @DEV-GUIDE: Twitch extension publisher — the "transport swap" consumer of the stream
// board (docs/STREAMER_VIEW.md). Subscribes to stream-server-service's built states, projects
// them (core/domain/twitch-projection.ts) and POSTs compact + rich payloads to the EBS,
// which relays the compact one to viewers over Twitch PubSub.
//
// Lifecycle rules (all pure decisions live in nextTwitchPhase):
// - A new initial payload (reference change) = a new draft: fresh draft id, revisions reset.
// - Overlay reset/close (onSessionReset) turns 'drafting' into 'ingame' and REPUBLISHES the
//   last drafting compact under the new phase — the board itself is blank by then, so the
//   publisher keeps its own last snapshot (picks-view precedent). GSI phases refine it
//   (STRATEGY_TIME.. -> ingame, POST_GAME -> ended, a NEW match's hero selection -> waiting).
// - The snapshot persists to userData/twitch-state.json and is restored on start (if fresh),
//   so an app restart mid-game does not blank the viewers' extension.
//
// Send discipline: content keys suppress no-op publishes (GSI-rate rebuilds), a debounce
// coalesces bursts, TWITCH_PUBLISH_MIN_INTERVAL_MS keeps us far below Twitch's per-channel
// budget, one request in flight at a time, latest state wins. Rich rides along only when
// its content changed (rr bump) or the EBS asks (needRich). Transport errors back off on
// the TWITCH_PUBLISH_RETRY_BACKOFF_MS ladder; 401 stops publishing until re-paired;
// protocol version mismatch stops publishing until the app is updated.
//
// Never throws into the stream server; never touches the OBS data path. With the toggle
// off or no pairing, isActive() is false and the server skips builds exactly as before.

const logger = log.scope('twitch-publisher')

/** Metadata keys (Metadata table, all TEXT). Empty string = absent. */
const KEY_CHANNEL_ID = 'twitch_channel_id'
const KEY_CHANNEL_NAME = 'twitch_channel_name'
const KEY_CHANNEL_TOKEN = 'twitch_channel_token'
const KEY_PAIRED_AT = 'twitch_paired_at'

const STATE_FILE = 'twitch-state.json'
const STATE_SAVE_DEBOUNCE_MS = 1_000
/** ~6 s of consecutive telemetry rejections before it becomes a user-visible error. */
const LIVE_FAILURES_BEFORE_ALERT = 3
/** Then a warning roughly every minute, so the log shows it without flooding. */
const LIVE_FAILURE_LOG_EVERY = 30
const STALE_CHECK_MS = 60_000
const QUIT_PUBLISH_TIMEOUT_MS = 2_000
const RATE_LIMIT_RETRY_MS = 2_000

interface PersistedTwitchState {
  v: number
  phase: TwitchPhaseState
  rev: number
  richRev: number
  compact: TwitchCompactState | null
  rich: TwitchRichState | null
  updatedAt: number
}

interface ChannelLink extends TwitchLinkInfo {
  token: string
}

export interface TwitchPublisherService {
  start(): void
  /** Publishes 'ended' for a live draft (bounded) and flushes the snapshot to disk. */
  stop(): Promise<void>
  getLinkInfo(): TwitchLinkInfo | null
  getEbsUrl(): string
  isBroadcastEnabled(): boolean
  setBroadcastEnabled(enabled: boolean): void
  pair(code: string): Promise<{ success: boolean; link?: TwitchLinkInfo; errorKey?: string }>
  unpair(): Promise<void>
  /** Force a publish of the current snapshot (test button, after pairing). */
  republish(): Promise<{ success: boolean; errorKey?: string }>
  /**
   * For top-bar seat identification in game (topbar-seat-service): the model each
   * draft row drafted, as Valve CDN names, read from the last published compact —
   * by then auto-close has reset the draft session, so the publisher's snapshot
   * is the only place the draft still exists. Null when not broadcasting or when
   * there is no draft.
   */
  getDraftedModels(): { draftId: string; models: (string | null)[] } | null
  /** Top-bar seat -> draft row for that draft; republishes only on a change. */
  setSeats(draftId: string, seats: number[]): void
}

/** Snapshot persistence; defaults to userData/twitch-state.json on disk. */
export interface TwitchStateStorage {
  read(): Promise<string | null>
  write(body: string): Promise<void>
}

export function createFileTwitchStateStorage(filePath: string): TwitchStateStorage {
  return {
    async read() {
      try {
        return await fs.readFile(filePath, 'utf-8')
      } catch {
        return null
      }
    },
    async write(body) {
      await fs.writeFile(filePath, body)
    },
  }
}

export interface TwitchPublisherOptions {
  storage?: TwitchStateStorage
  now?: () => number
  /**
   * Learned GSI slot -> draft row mappings, for placing caster telemetry on the
   * right row. Omitted in tests that do not exercise telemetry.
   */
  getSlotRowMappings?: () => Array<{ gsiSlot: number; scanRow: number }>
}

export function createTwitchPublisherService(
  dbService: DatabaseService,
  appStore: AppStore,
  streamService: StreamServerService,
  ebs: TwitchEbsClient,
  options: TwitchPublisherOptions = {},
): TwitchPublisherService {
  const getSlotRowMappings = options.getSlotRowMappings
  const now = options.now ?? (() => Date.now())
  const storage =
    options.storage ?? createFileTwitchStateStorage(join(app.getPath('userData'), STATE_FILE))

  let link: ChannelLink | null = null
  let enabled = false
  /** 401 from the EBS — the pairing is dead until the user pairs again. */
  let authFailed = false
  /** Protocol version refused by the EBS — nothing to do until the app updates. */
  let versionFailed = false
  let started = false
  let unsubscribeState: (() => void) | null = null

  let phaseState: TwitchPhaseState = initialTwitchPhaseState()
  let rev = 0
  let richRev = 0
  let lastCompact: TwitchCompactState | null = null
  let lastRich: TwitchRichState | null = null
  let compactKey = ''
  let richKey = ''
  let richDirty = false
  let lastInitialPayload: unknown = null
  let lastChangeAt = 0

  let pending = false
  let inFlight = false
  let lastSentAt = 0
  let backoffIndex = 0
  let publishTimer: NodeJS.Timeout | null = null
  let saveTimer: NodeJS.Timeout | null = null
  let staleTimer: NodeJS.Timeout | null = null

  // Caster telemetry: its own revision, dedupe key and in-flight guard so a
  // slow telemetry send can never delay a draft update (or vice versa).
  let liveTimer: NodeJS.Timeout | null = null
  let liveInFlight = false
  let liveRev = 0
  let liveKey = ''
  let liveFailures = 0
  let lastGsiSnapshot: GsiSnapshot | null = null

  // ---------------------------------------------------------------------------
  // Link + settings
  // ---------------------------------------------------------------------------

  function loadLink(): ChannelLink | null {
    const channelId = dbService.metadata.get(KEY_CHANNEL_ID)
    const token = dbService.metadata.get(KEY_CHANNEL_TOKEN)
    if (!channelId || !token) return null
    return {
      channelId,
      token,
      channelName: dbService.metadata.get(KEY_CHANNEL_NAME) || null,
      pairedAt: dbService.metadata.get(KEY_PAIRED_AT) || '',
    }
  }

  function storeLink(next: ChannelLink | null): void {
    dbService.metadata.set(KEY_CHANNEL_ID, next?.channelId ?? '')
    dbService.metadata.set(KEY_CHANNEL_TOKEN, next?.token ?? '')
    dbService.metadata.set(KEY_CHANNEL_NAME, next?.channelName ?? '')
    dbService.metadata.set(KEY_PAIRED_AT, next?.pairedAt ?? '')
    dbService.persist()
    link = next
  }

  function isActive(): boolean {
    return enabled && link !== null && !authFailed && !versionFailed
  }

  function setStatus(
    status: TwitchPublishStatus,
    errorKey: string | null = null,
    publishedAt?: number,
  ): void {
    appStore.setState({
      twitchPaired: link !== null,
      twitchChannelName: link?.channelName ?? null,
      twitchBroadcastEnabled: enabled,
      twitchPublishStatus: status,
      twitchErrorKey: errorKey,
      ...(publishedAt !== undefined ? { twitchLastPublishAt: publishedAt } : {}),
    })
  }

  function refreshStatus(): void {
    if (!enabled || !link) setStatus('off')
    else if (authFailed) setStatus('error', 'twitch.errorUnauthorized')
    else if (versionFailed) setStatus('error', 'twitch.errorVersion')
    else setStatus(appStore.getState().twitchPublishStatus === 'ok' ? 'ok' : 'idle')
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  function scheduleSave(): void {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void save()
    }, STATE_SAVE_DEBOUNCE_MS)
  }

  async function save(): Promise<void> {
    const body: PersistedTwitchState = {
      v: TWITCH_PROTOCOL_VERSION,
      phase: phaseState,
      rev,
      richRev,
      compact: lastCompact,
      rich: lastRich,
      updatedAt: lastChangeAt,
    }
    try {
      await storage.write(JSON.stringify(body))
    } catch (error) {
      logger.warn('Twitch state write failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function restore(): Promise<boolean> {
    let raw: string | null
    try {
      raw = await storage.read()
    } catch {
      return false
    }
    if (raw === null) return false
    try {
      const data = JSON.parse(raw) as Partial<PersistedTwitchState>
      if (data.v !== TWITCH_PROTOCOL_VERSION || !data.phase || !data.compact) return false
      if (typeof data.updatedAt !== 'number' || now() - data.updatedAt > TWITCH_STATE_STALE_MS) {
        return false
      }
      if (data.phase.phase === 'waiting' || data.phase.phase === 'ended') return false
      phaseState = data.phase
      rev = typeof data.rev === 'number' ? data.rev : 0
      richRev = typeof data.richRev === 'number' ? data.richRev : 0
      lastCompact = data.compact
      lastRich = data.rich ?? null
      compactKey = twitchCompactContentKey(lastCompact)
      richKey = lastRich ? twitchRichContentKey(lastRich) : ''
      richDirty = lastRich !== null
      lastChangeAt = data.updatedAt
      logger.info('Twitch snapshot restored', {
        phase: phaseState.phase,
        draftId: phaseState.draftId,
      })
      return true
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------------------
  // Projection
  // ---------------------------------------------------------------------------

  function applyPhaseEvent(event: TwitchPhaseEvent): boolean {
    const transition = nextTwitchPhase(phaseState, event)
    phaseState = transition.state
    if (transition.newDraft) {
      rev = 0
      richRev = 0
      lastRich = null
      richKey = ''
      richDirty = false
    }
    if (transition.changed && lastCompact && !transition.newDraft) {
      lastCompact = restampCompact(lastCompact, {
        phase: phaseState.phase,
        rev,
        ts: now(),
        richRev,
      })
      compactKey = twitchCompactContentKey(lastCompact)
      lastChangeAt = now()
      scheduleSave()
    }
    return transition.changed
  }

  function onState(message: StreamStateMessage, context: StreamStateContext): void {
    const board = message.payload
    if (board.phase !== 'drafting' || !context.initialPayload) return

    const settings = dbService.metadata.getSettings()
    const stamp = now()

    if (context.initialPayload !== lastInitialPayload || phaseState.draftId === null) {
      lastInitialPayload = context.initialPayload
      applyPhaseEvent({ type: 'initialScan', ts: stamp })
    } else {
      applyPhaseEvent({ type: 'rescan' })
    }
    const draftId = phaseState.draftId as string

    const rich = buildTwitchRichState({
      board,
      initialPayload: context.initialPayload,
      pickEvents: context.pickEvents,
      draftId,
      richRev,
      ts: stamp,
      thresholds: { op: settings.opThreshold, trap: settings.trapThreshold },
      meta: { appVersion: app.getVersion(), language: board.meta.language },
      lookups: {
        getAbilityDetails: (names) => dbService.abilities.getDetails(names),
        getHeroes: () => dbService.heroes.getAll(),
        getPairSynergies: (names) => dbService.synergies.getSynergiesAmong(names),
        getHeroPairSynergies: (heroNames, abilityNames) =>
          dbService.synergies.getHeroSynergiesAmong(heroNames, abilityNames),
      },
    })
    const nextRichKey = twitchRichContentKey(rich)
    if (nextRichKey !== richKey) {
      richRev += 1
      rich.rr = richRev
      richKey = nextRichKey
      lastRich = rich
      richDirty = true
    }

    const compact = buildTwitchCompactState({
      board,
      pickEvents: context.pickEvents,
      phase: phaseState.phase,
      draftId,
      rev,
      richRev,
      ts: stamp,
      matchId: context.gsiMatchId ?? phaseState.matchId,
      // My Spot is a PLAYING-mode concept (the streamer's own draft row). While
      // spectating there is no "own" row, and publishing a stale one makes the
      // viewer overlay highlight an unrelated player.
      myRow: context.spectating ? null : context.myRow,
      slotRowMappings: context.slotRowMappings,
    })
    // Seats identified from the in-game top bar belong to this draft but cannot
    // be derived from the board — a rebuild (overlay kept open in game) must not
    // drop them
    if (!compact.seats && lastCompact?.d === compact.d && lastCompact.seats) {
      compact.seats = lastCompact.seats
    }
    const nextCompactKey = twitchCompactContentKey(compact)
    if (nextCompactKey === compactKey && !richDirty) return

    compactKey = nextCompactKey
    lastCompact = compact
    lastChangeAt = stamp
    scheduleSave()
    schedulePublish()
  }

  function getDraftedModels(): { draftId: string; models: (string | null)[] } | null {
    if (!isActive() || !lastCompact?.players) return null
    const pool = lastCompact.pool
    const models = lastCompact.players.map((row) => {
      const model = row[0]
      // Pool index while playing; a raw npc short name when only GSI knew it
      if (typeof model === 'number') return pool?.[model]?.[0] ?? null
      return typeof model === 'string' ? model : null
    })
    return { draftId: lastCompact.d, models }
  }

  function setSeats(draftId: string, seats: number[]): void {
    if (!lastCompact || lastCompact.d !== draftId) return // a newer draft took over
    const current = lastCompact.seats
    if (current && current.length === seats.length && current.every((row, i) => row === seats[i])) {
      return
    }
    lastCompact = { ...lastCompact, seats: [...seats] }
    compactKey = twitchCompactContentKey(lastCompact)
    lastChangeAt = now()
    scheduleSave()
    schedulePublish()
  }

  function onSessionReset(): void {
    if (applyPhaseEvent({ type: 'sessionReset' })) schedulePublish()
  }

  function onGsi(snapshot: { gamePhase: string | null; matchId: string | null }): void {
    if (!isActive()) {
      // Track phases even while inactive so enabling mid-game starts correct
      applyPhaseEvent({ type: 'gsi', gamePhase: snapshot.gamePhase, matchId: snapshot.matchId })
      return
    }
    if (
      applyPhaseEvent({ type: 'gsi', gamePhase: snapshot.gamePhase, matchId: snapshot.matchId })
    ) {
      schedulePublish()
    }
  }

  // ---------------------------------------------------------------------------
  // Caster telemetry (spectate only, in game only)
  // ---------------------------------------------------------------------------

  /**
   * Publish one telemetry tick. Deliberately separate from flush():
   * - It only runs in the `ingame` phase, where the draft path publishes
   *   nothing but phase re-stamps, so the two never compete for Twitch's
   *   1 msg/s/channel budget despite sharing it.
   * - It never queues or retries. A stale net worth is worthless — if a tick is
   *   skipped (in flight, unchanged, rate limited) the next one two seconds
   *   later carries fresher numbers anyway.
   */
  async function publishLive(): Promise<void> {
    if (!isActive() || !link || inFlight || liveInFlight) return
    if (phaseState.phase !== 'ingame') return
    const snapshot = lastGsiSnapshot
    if (!snapshot || snapshot.players.length === 0) return
    const liveDraftId = phaseState.draftId
    if (!liveDraftId) return

    const state = buildTwitchLiveState({
      players: snapshot.players,
      slotRowMappings: getSlotRowMappings?.() ?? [],
      draftId: liveDraftId,
      rev: liveRev + 1,
      ts: now(),
      clockTime: snapshot.clockTime,
    })
    if (!state) return

    const key = twitchLiveContentKey(state)
    if (key === liveKey) return
    liveKey = key
    liveRev += 1

    const encoded = encodeTwitchLive(state, TWITCH_COMPACT_MAX_BYTES)
    if (!encoded.fits) {
      logger.warn('Live telemetry exceeds the PubSub budget even after degradation', {
        bytes: encoded.bytes,
      })
    }
    const channel = link
    liveInFlight = true
    try {
      await ebs.publish(channel.token, {
        v: TWITCH_PROTOCOL_VERSION,
        channelId: channel.channelId,
        live: encoded.state,
      })
      logger.debug('Twitch live telemetry sent', {
        r: liveRev,
        bytes: encoded.bytes,
      })
      liveFailures = 0
    } catch (error) {
      // A single failed tick is not worth reporting — the next one is 2 s away.
      // A PERSISTENT one is: it means telemetry is not reaching viewers at all,
      // and the likeliest cause is an EBS that predates the caster edition and
      // rejects the message outright. Staying silent here cost a live debugging
      // session (2026-09-04), so it now escalates to a real status.
      liveFailures += 1
      const message = error instanceof Error ? error.message : String(error)
      if (liveFailures === LIVE_FAILURES_BEFORE_ALERT) {
        setStatus('error', 'twitch.errorLiveFailed')
        logger.warn('Live telemetry rejected repeatedly — is the EBS up to date?', {
          failures: liveFailures,
          error: message,
          status: error instanceof TwitchEbsError ? error.status : null,
        })
      } else if (liveFailures % LIVE_FAILURE_LOG_EVERY === 0) {
        logger.warn('Live telemetry still failing', { failures: liveFailures, error: message })
      } else {
        logger.debug('Twitch live telemetry send failed', { error: message })
      }
    } finally {
      liveInFlight = false
    }
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  function schedulePublish(delayMs: number = TWITCH_PUBLISH_DEBOUNCE_MS): void {
    pending = true
    if (!isActive() || !lastCompact) return
    if (publishTimer) return
    publishTimer = setTimeout(() => {
      publishTimer = null
      void flush()
    }, delayMs)
  }

  async function flush(): Promise<void> {
    if (inFlight || !pending || !isActive() || !lastCompact || !link) return
    const wait = lastSentAt + TWITCH_PUBLISH_MIN_INTERVAL_MS - now()
    if (wait > 0) {
      schedulePublish(wait)
      return
    }
    pending = false
    inFlight = true
    const sentWithRich = richDirty
    rev += 1
    const compact = restampCompact(lastCompact, { rev, ts: now(), richRev })
    lastCompact = compact
    const encoded = encodeTwitchCompact(compact, TWITCH_COMPACT_MAX_BYTES)
    if (!encoded.fits) {
      logger.warn('Compact state exceeds the PubSub budget even after degradation', {
        bytes: encoded.bytes,
      })
    }
    const channel = link
    try {
      const response = await ebs.publish(channel.token, {
        v: TWITCH_PROTOCOL_VERSION,
        channelId: channel.channelId,
        compact: encoded.state,
        ...(sentWithRich && lastRich ? { rich: lastRich } : {}),
      })
      lastSentAt = now()
      if (response.ok) {
        backoffIndex = 0
        if (sentWithRich) richDirty = false
        if (response.needRich && lastRich) {
          richDirty = true
          pending = true
        }
        setStatus('ok', null, lastSentAt)
        logger.debug('Twitch publish ok', {
          rev,
          bytes: encoded.bytes,
          rich: sentWithRich,
          pubsub: response.pubsub,
        })
      } else {
        handleRefusal(response.error)
      }
    } catch (error) {
      const status = error instanceof TwitchEbsError ? error.status : null
      const delay =
        TWITCH_PUBLISH_RETRY_BACKOFF_MS[
          Math.min(backoffIndex, TWITCH_PUBLISH_RETRY_BACKOFF_MS.length - 1)
        ]
      backoffIndex += 1
      pending = true
      setStatus('error', 'twitch.errorNetwork')
      logger.warn('Twitch publish failed, backing off', {
        status,
        retryInMs: delay,
        error: error instanceof Error ? error.message : String(error),
      })
      inFlight = false
      schedulePublish(delay)
      return
    }
    inFlight = false
    if (pending) schedulePublish()
  }

  function handleRefusal(code: string): void {
    switch (code) {
      case 'unauthorized':
        authFailed = true
        setStatus('error', 'twitch.errorUnauthorized')
        logger.warn('EBS refused the channel token — pairing must be redone')
        break
      case 'version':
        versionFailed = true
        setStatus('error', 'twitch.errorVersion')
        logger.warn('EBS refused the protocol version — app update required')
        break
      case 'rate_limited':
        pending = true
        setStatus('idle')
        schedulePublish(RATE_LIMIT_RETRY_MS)
        break
      case 'too_large':
        setStatus('error', 'twitch.errorTooLarge')
        logger.error('EBS rejected the compact state as too large')
        break
      case 'stale':
        // The EBS holds a newer revision for this draft (e.g. two app instances);
        // our next send carries a higher rev, nothing else to do.
        pending = true
        setStatus('error', 'twitch.errorPublishFailed')
        logger.warn('EBS reported a stale revision', { rev })
        break
      default:
        setStatus('error', 'twitch.errorPublishFailed')
        logger.warn('EBS refused the publish', { code })
    }
  }

  // ---------------------------------------------------------------------------
  // Stale + quit
  // ---------------------------------------------------------------------------

  function checkStale(): void {
    if (phaseState.phase !== 'ingame' || lastChangeAt === 0) return
    if (now() - lastChangeAt < TWITCH_STATE_STALE_MS) return
    if (applyPhaseEvent({ type: 'stale' })) schedulePublish()
  }

  async function publishFinal(): Promise<void> {
    if (!isActive() || !lastCompact || !link) return
    rev += 1
    const compact = restampCompact(lastCompact, { rev, ts: now(), richRev })
    lastCompact = compact
    try {
      await ebs.publish(
        link.token,
        {
          v: TWITCH_PROTOCOL_VERSION,
          channelId: link.channelId,
          compact: encodeTwitchCompact(compact).state,
        },
        QUIT_PUBLISH_TIMEOUT_MS,
      )
    } catch (error) {
      logger.warn('Final Twitch publish failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Service
  // ---------------------------------------------------------------------------

  return {
    start(): void {
      if (started) return
      started = true
      link = loadLink()
      enabled = dbService.metadata.getSettings().twitchBroadcastEnabled === true
      refreshStatus()

      unsubscribeState = streamService.subscribeState({
        isActive,
        onState,
        onSessionReset,
      })
      streamService.onGsiSnapshot((snapshot) => {
        onGsi({ gamePhase: snapshot.gamePhase, matchId: snapshot.matchId })
        // Keep the newest spectator snapshot for the telemetry ticker below.
        // Storing it (rather than publishing here) decouples GSI's ~2/s rate
        // from our send cadence.
        lastGsiSnapshot = snapshot
      })
      staleTimer = setInterval(checkStale, STALE_CHECK_MS)
      liveTimer = setInterval(publishLive, TWITCH_LIVE_INTERVAL_MS)

      void restore().then((restored) => {
        if (restored && isActive()) schedulePublish()
      })
      logger.info('Twitch publisher started', {
        paired: link !== null,
        enabled,
        ebs: ebs.baseUrl,
      })
    },

    async stop(): Promise<void> {
      if (!started) return
      started = false
      if (publishTimer) {
        clearTimeout(publishTimer)
        publishTimer = null
      }
      if (staleTimer) {
        clearInterval(staleTimer)
        staleTimer = null
      }
      if (liveTimer) {
        clearInterval(liveTimer)
        liveTimer = null
      }
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      unsubscribeState?.()
      unsubscribeState = null
      if (applyPhaseEvent({ type: 'quit' })) {
        await Promise.race([
          publishFinal(),
          new Promise<void>((resolve) => setTimeout(resolve, QUIT_PUBLISH_TIMEOUT_MS + 500)),
        ])
      }
      await save()
    },

    getLinkInfo(): TwitchLinkInfo | null {
      if (!link) return null
      return { channelId: link.channelId, channelName: link.channelName, pairedAt: link.pairedAt }
    },

    getEbsUrl(): string {
      return ebs.baseUrl
    },

    isBroadcastEnabled(): boolean {
      return enabled
    },

    setBroadcastEnabled(next: boolean): void {
      if (enabled === next) return
      enabled = next
      dbService.metadata.setSettings({ twitchBroadcastEnabled: next })
      dbService.persist()
      refreshStatus()
      if (next) {
        // Pick up the live board if a draft is already in progress
        richDirty = lastRich !== null
        streamService.refresh()
        if (lastCompact) schedulePublish()
      }
      logger.info('Twitch broadcast toggled', { enabled: next })
    },

    async pair(code: string) {
      const trimmed = code.replace(/[\s-]/g, '').toUpperCase()
      if (trimmed.length < 6) return { success: false, errorKey: 'twitch.errorInvalidCode' }
      try {
        const result = await ebs.pairComplete({ code: trimmed, appVersion: app.getVersion() })
        const next: ChannelLink = {
          channelId: result.channelId,
          channelName: result.channelName,
          token: result.channelToken,
          pairedAt: new Date(now()).toISOString(),
        }
        storeLink(next)
        authFailed = false
        refreshStatus()
        logger.info('Twitch channel paired', { channelId: next.channelId })
        if (isActive()) {
          richDirty = lastRich !== null
          streamService.refresh()
          if (lastCompact) schedulePublish()
        }
        return {
          success: true,
          link: {
            channelId: next.channelId,
            channelName: next.channelName,
            pairedAt: next.pairedAt,
          },
        }
      } catch (error) {
        const status = error instanceof TwitchEbsError ? error.status : null
        logger.warn('Twitch pairing failed', {
          status,
          error: error instanceof Error ? error.message : String(error),
        })
        return {
          success: false,
          errorKey:
            status !== null && status >= 400 && status < 500
              ? 'twitch.errorInvalidCode'
              : 'twitch.errorNetwork',
        }
      }
    },

    async unpair(): Promise<void> {
      const previous = link
      storeLink(null)
      authFailed = false
      refreshStatus()
      if (previous) {
        try {
          await ebs.unpair(previous.token, previous.channelId)
        } catch (error) {
          logger.warn('EBS unpair call failed (local pairing removed anyway)', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      logger.info('Twitch channel unpaired')
    },

    async republish() {
      if (!link) return { success: false, errorKey: 'twitch.errorUnauthorized' }
      if (!enabled) return { success: false, errorKey: 'twitch.errorDisabled' }
      authFailed = false
      versionFailed = false
      refreshStatus()
      if (!lastCompact) {
        streamService.refresh()
        if (!lastCompact) return { success: false, errorKey: 'twitch.errorNothingToSend' }
      }
      richDirty = lastRich !== null
      pending = true
      if (publishTimer) {
        clearTimeout(publishTimer)
        publishTimer = null
      }
      await flush()
      const state = appStore.getState()
      return state.twitchPublishStatus === 'ok'
        ? { success: true }
        : { success: false, errorKey: state.twitchErrorKey ?? 'twitch.errorPublishFailed' }
    },

    getDraftedModels,
    setSeats,
  }
}
