import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { join, normalize, extname } from 'path'
import { promises as fs } from 'fs'
import { app } from 'electron'
import log from 'electron-log/main'
import type { OverlayDataPayload } from '@shared/types'
import type {
  PicksStateMessage,
  PicksViewState,
  StreamServerStatusInfo,
  StreamStateMessage,
} from '@shared/types/stream'
import { STREAM_PROTOCOL_VERSION } from '@shared/constants/thresholds'
import { buildStreamBoardState } from '@core/domain/stream-board'
import { buildPicksViewState } from '@core/domain/picks-view'
import { parseGsiPayload, gsiSnapshotMode } from '@core/gsi/parser'
import type { GsiSnapshot } from '@core/gsi/types'
import type { PickEvent, StreamGsiInfo } from '@shared/types/stream'
import type { DatabaseService } from './database-service'
import type { AppStore } from '../store/app-store'
import type { IconCacheService, IconKind } from './icon-cache-service'

// @DEV-GUIDE: Local HTTP server powering the Streamer View (OBS browser source).
// One server, one port (user-configurable, persisted as the stream_port setting),
// bound to 127.0.0.1 ONLY — no firewall prompt, never reachable from the network.
//
// Routes:
// - GET /            -> stream SPA index.html (and /stream as an alias)
// - GET /<asset>     -> static files from out/renderer (works from inside app.asar:
//                       Electron patches fs so readFile reads archive contents)
// - GET /events      -> SSE: full StreamBoardState envelope on connect + on every
//                       scan/reset/language change; comment heartbeat every 15s
// - GET /picks       -> Picks View SPA (per-team drafted-picks strips; /picks?team=…
//                       are the OBS sources, bare /picks is the setup page)
// - GET /picks/events-> SSE: PicksStateMessage envelopes (payload null until a draft
//                       has been recorded)
// - GET /icons/*     -> icon-cache-service (official art, locally cached)
// - POST /gsi        -> Dota 2 Game State Integration ingest (cfg written by
//                       gsi-cfg-service). Always answers 200 fast; parsed snapshots
//                       merge player names/phase/clock into the board state with a
//                       500ms debounced push. 30s of silence = disconnected.
//
// Picks snapshot lifecycle: every 'drafting' board build is projected down to a
// PicksViewState which is cached here AND persisted to userData/picks-view.json.
// onSessionReset does NOT touch it — the strips keep showing the finished draft
// through the game (overlay reset/closed, even across an app restart); the next
// draft's initial scan naturally replaces it.
//
// Dev quirk: with `npm run dev` the renderer bundle only exists on the electron-vite
// dev server (ELECTRON_RENDERER_URL), so /stream redirects there with ?api=<our origin>
// and the SPA points its EventSource at that origin (SSE responses send CORS headers).
//
// State ownership: this service caches the draft's INITIAL scan payload (full pool grid)
// and the LATEST payload (subtracted pool + picks) itself. Do NOT rely on
// pendingOverlayData in src/main/ipc/index.ts — it is never updated after scans.
// EADDRINUSE is surfaced as an error status (i18n key) and never auto-remapped: the
// OBS scene and (later) the GSI cfg pin the chosen port.

const logger = log.scope('stream-server')

const SSE_HEARTBEAT_MS = 15_000
// GSI heartbeats arrive every 10s (cfg); 30s of silence = Dota gone/closed.
const GSI_STALE_MS = 30_000
const GSI_STALE_CHECK_MS = 10_000
const GSI_BROADCAST_DEBOUNCE_MS = 500
const GSI_MAX_BODY_BYTES = 512 * 1024

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** What a state subscriber gets alongside every built board (Twitch publisher). */
export interface StreamStateContext {
  initialPayload: OverlayDataPayload | null
  latestPayload: OverlayDataPayload | null
  /** FULL attributed timeline (draftStore.draftTimeline), not the board's capped feed. */
  pickEvents: PickEvent[]
  /** My Spot player row 0-9, null when unknown. */
  myRow: number | null
  gsiMatchId: string | null
  /**
   * Learned GSI slot <-> draft row mappings (spectate). The in-game top bar is
   * ordered by GSI slot while picks are keyed by draft row, and the two orders
   * differ — consumers rendering over the top bar MUST translate through this
   * or they show one player's draft under another's portrait.
   */
  slotRowMappings: Array<{ gsiSlot: number; scanRow: number }>
  /** True while GSI reports all ten players (spectating/casting). */
  spectating: boolean
}

/**
 * Secondary consumer of built board states (the Twitch publisher). While no
 * subscriber is active the server behaves exactly as without subscribers:
 * builds are skipped with zero SSE clients, and nothing else changes.
 */
export interface StreamStateSubscriber {
  isActive(): boolean
  onState(message: StreamStateMessage, context: StreamStateContext): void
  onSessionReset(): void
}

export interface StreamServerService {
  start(port: number): Promise<boolean>
  stop(): Promise<void>
  isRunning(): boolean
  getStatus(): StreamServerStatusInfo
  /** Fed by scan-processing-service after every successful scan. */
  onScanProcessed(payload: OverlayDataPayload, isInitialScan: boolean): void
  /** Clears the cached draft (overlay reset / overlay closed). The picks
   * snapshot deliberately survives — see the dev-guide above. */
  onSessionReset(): void
  /** Re-push current state to clients (e.g. after a language change). */
  refresh(): void
  /** Subscribe to parsed GSI snapshots (auto-rescan service). */
  onGsiSnapshot(listener: (snapshot: GsiSnapshot) => void): void
  /** Latest parsed GSI snapshot + liveness (null before the first POST). */
  getGsiState(): { snapshot: GsiSnapshot | null; connected: boolean }
  /** Register a secondary state consumer; returns an unsubscribe function. */
  subscribeState(subscriber: StreamStateSubscriber): () => void
}

export function createStreamServerService(
  dbService: DatabaseService,
  appStore: AppStore,
  iconCache: IconCacheService,
  getPickEvents?: () => PickEvent[],
  getModelAssignments?: () => Array<{ poolHeroOrder: number; playerIndex: number }>,
  getSlotRowMappings?: () => Array<{ gsiSlot: number; scanRow: number }>,
  getLocalPlayerRow?: () => number | null,
): StreamServerService {
  let server: Server | null = null
  let activePort: number | null = null
  let errorKey: string | null = null
  const sseClients = new Set<ServerResponse>()
  const picksSseClients = new Set<ServerResponse>()
  let heartbeatTimer: NodeJS.Timeout | null = null

  let initialPayload: OverlayDataPayload | null = null
  let latestPayload: OverlayDataPayload | null = null

  // Last recorded draft's picks — survives session resets; see dev-guide above.
  let picksSnapshot: PicksViewState | null = null
  // Change key (players + language, NOT updatedAt) so 2/s GSI-driven builds
  // don't spam picks clients and the disk with identical snapshots.
  let picksSnapshotKey = ''
  let picksSaveTimer: NodeJS.Timeout | null = null
  const picksFilePath = join(app.getPath('userData'), 'picks-view.json')

  let gsiSnapshot: GsiSnapshot | null = null
  let gsiLastAt: number | null = null
  let gsiStaleTimer: NodeJS.Timeout | null = null
  let gsiBroadcastTimer: NodeJS.Timeout | null = null
  const gsiListeners: Array<(snapshot: GsiSnapshot) => void> = []
  const stateSubscribers = new Set<StreamStateSubscriber>()
  // Raw-payload capture for empirical validation (slot ordering, phase names,
  // AD turn timings): latest payload per mode+game_state, overwritten, throttled.
  // Mode prefix keeps playing captures from overwriting spectating ones.
  const gsiCaptureDir = join(app.getPath('userData'), 'gsi-captures')
  const gsiCaptureLastWrite = new Map<string, number>()
  let gsiLastPlayersLog = ''
  let gsiLastLocalLog = ''
  let gsiLastLoggedPhase: string | null = null

  // Same path convention as window-manager's loadWindowContent: resolve renderer
  // output relative to the compiled main bundle (out/main -> out/renderer). Works in
  // dev-build launches AND packaged (app.asar/out/main -> asar-aware readFile).
  // app.getAppPath() is NOT reliable here (electron <file.js> resolves it to the
  // default_app wrapper).
  const staticRoot = join(__dirname, '..', 'renderer')

  function gsiConnected(): boolean {
    return gsiLastAt !== null && Date.now() - gsiLastAt < GSI_STALE_MS
  }

  // Hero display names, cached: this runs on EVERY GSI broadcast (up to 2/s,
  // once per player in spectate), and querying the Heroes table each time was
  // the hottest DB path in the app — together with a sql.js statement leak in
  // drizzle it crashed a 5-hour session with "out of memory" (2026-09-18; the
  // leak itself is fixed by patches/drizzle-orm+0.45.2.patch). The table only
  // changes on a data update, so a miss re-reads it, at most once a minute.
  let heroNamesCache: Map<string, string> | null = null
  let heroNamesLoadedAt = 0
  const HERO_NAMES_RELOAD_MS = 60_000
  function cachedHeroDisplayName(shortName: string): string | undefined {
    const stale = Date.now() - heroNamesLoadedAt > HERO_NAMES_RELOAD_MS
    if (heroNamesCache === null || (!heroNamesCache.has(shortName) && stale)) {
      heroNamesCache = new Map(dbService.heroes.getAll().map((h) => [h.name, h.displayName]))
      heroNamesLoadedAt = Date.now()
    }
    return heroNamesCache.get(shortName)
  }

  /** npc short name -> display name via the DB (Windrun short names are the npc
   * name without underscores, e.g. sand_king -> sandking); title-case fallback. */
  function heroDisplayName(npcName: string): string {
    const displayName = cachedHeroDisplayName(npcName.replace(/_/g, ''))
    if (displayName) return displayName
    return npcName
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  function gsiInfo(): StreamGsiInfo {
    const connected = gsiConnected()
    const playerNames: (string | null)[] = Array.from({ length: 10 }, () => null)
    const playerModels: ({ npcName: string; displayName: string } | null)[] =
      Array.from({ length: 10 }, () => null)
    if (gsiSnapshot) {
      // Spectating: allplayers carries every slot
      for (const player of gsiSnapshot.players) {
        if (player.slotIndex >= 0 && player.slotIndex < 10) {
          playerNames[player.slotIndex] = player.name
          if (player.heroNpcName) {
            playerModels[player.slotIndex] = {
              npcName: player.heroNpcName,
              displayName: heroDisplayName(player.heroNpcName),
            }
          }
        }
      }
      // Playing: GSI only knows the LOCAL player. Placement uses the OCR-derived
      // My Spot row (own-row-detection.ts) — localPlayer.slotIndex is lobby-order
      // and does NOT match the draft screen, so until the row is derived the
      // local name shows nowhere rather than on a probably-wrong row (same
      // principle as the spectate slot-row mappings).
      const local = gsiSnapshot.localPlayer
      const localRow = getLocalPlayerRow?.() ?? null
      if (local && localRow !== null && localRow >= 0 && localRow < 10) {
        playerNames[localRow] ??= local.name
        if (gsiSnapshot.localHeroNpcName && !playerModels[localRow]) {
          playerModels[localRow] = {
            npcName: gsiSnapshot.localHeroNpcName,
            displayName: heroDisplayName(gsiSnapshot.localHeroNpcName),
          }
        }
      }
    }
    return {
      connected,
      gamePhase: connected ? (gsiSnapshot?.gamePhase ?? null) : null,
      clockTime: connected ? (gsiSnapshot?.clockTime ?? null) : null,
      spectating: gsiSnapshot
        ? gsiSnapshotMode(gsiSnapshot) === 'spectating'
        : false,
      playerNames,
      playerModels,
    }
  }

  function syncStoreStatus(): void {
    appStore.setState({
      streamServerStatus: errorKey ? 'error' : server ? 'running' : 'stopped',
      streamServerPort: activePort,
      streamServerError: errorKey,
      streamClientCount: sseClients.size + picksSseClients.size,
    })
  }

  function picksMessage(): PicksStateMessage {
    return {
      v: STREAM_PROTOCOL_VERSION,
      type: 'picks',
      ts: Date.now(),
      payload: picksSnapshot,
    }
  }

  function schedulePicksSave(): void {
    if (picksSaveTimer) return
    picksSaveTimer = setTimeout(() => {
      picksSaveTimer = null
      const body = JSON.stringify({ v: STREAM_PROTOCOL_VERSION, snapshot: picksSnapshot })
      void fs.writeFile(picksFilePath, body).catch((error: unknown) => {
        logger.warn('Picks snapshot write failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, 1_000)
  }

  function broadcastPicks(): void {
    if (picksSseClients.size === 0) return
    const message = picksMessage()
    for (const client of picksSseClients) {
      try {
        sseWrite(client, message)
      } catch (error) {
        logger.warn('Picks SSE write failed, dropping client', {
          error: error instanceof Error ? error.message : String(error),
        })
        picksSseClients.delete(client)
      }
    }
    syncStoreStatus()
  }

  /** Cache + persist the picks projection of a drafting board build. */
  function updatePicksSnapshot(state: StreamStateMessage): void {
    const derived = buildPicksViewState(state.payload)
    if (!derived) return
    const key = `${derived.meta.language}|${JSON.stringify(derived.players)}`
    if (key === picksSnapshotKey) return
    picksSnapshot = derived
    picksSnapshotKey = key
    schedulePicksSave()
    broadcastPicks()
  }

  // Restore the last draft's picks from disk (app restarted mid-game). A live
  // snapshot derived before this resolves wins — it is strictly newer.
  void fs
    .readFile(picksFilePath, 'utf-8')
    .then((raw) => {
      const parsed = JSON.parse(raw) as { v?: number; snapshot?: PicksViewState | null }
      if (parsed.v !== STREAM_PROTOCOL_VERSION) return
      if (!parsed.snapshot || !Array.isArray(parsed.snapshot.players)) return
      if (picksSnapshot) return
      picksSnapshot = parsed.snapshot
      picksSnapshotKey = `${parsed.snapshot.meta.language}|${JSON.stringify(parsed.snapshot.players)}`
      broadcastPicks()
      logger.info('Picks snapshot restored from disk')
    })
    .catch(() => {
      // No file yet (or unreadable) — nothing to restore.
    })

  function buildState(): StreamStateMessage {
    const state = buildStreamBoardState({
      initialPayload,
      latestPayload,
      gsi: gsiInfo(),
      pickEvents: getPickEvents?.(),
      modelAssignments: getModelAssignments?.(),
      slotRowMappings: getSlotRowMappings?.(),
      meta: {
        language: appStore.getState().language,
        appVersion: app.getVersion(),
        updatedAt: Date.now(),
      },
      getPairSynergies: (names) => dbService.synergies.getSynergiesAmong(names),
    })
    return {
      v: STREAM_PROTOCOL_VERSION,
      type: 'state',
      ts: Date.now(),
      payload: state,
    }
  }

  function sseWrite(
    res: ServerResponse,
    message: StreamStateMessage | PicksStateMessage,
  ): void {
    res.write(`data: ${JSON.stringify(message)}\n\n`)
  }

  /**
   * forceBuild makes the state build (and thus the picks snapshot update +
   * persistence) happen even with zero clients connected — scans must land in
   * the snapshot regardless of whether OBS currently has a source open.
   */
  function activeSubscribers(): StreamStateSubscriber[] {
    return [...stateSubscribers].filter((s) => {
      try {
        return s.isActive()
      } catch {
        return false
      }
    })
  }

  function broadcast(forceBuild = false): void {
    const subscribers = activeSubscribers()
    if (
      sseClients.size === 0 &&
      picksSseClients.size === 0 &&
      subscribers.length === 0 &&
      !forceBuild
    ) {
      return
    }
    const message = buildState()
    updatePicksSnapshot(message)
    if (subscribers.length > 0) {
      const context: StreamStateContext = {
        initialPayload,
        latestPayload,
        pickEvents: getPickEvents?.() ?? [],
        myRow: getLocalPlayerRow?.() ?? null,
        gsiMatchId: gsiSnapshot?.matchId ?? null,
        slotRowMappings: getSlotRowMappings?.() ?? [],
        spectating: (gsiSnapshot?.players.length ?? 0) > 0,
      }
      for (const subscriber of subscribers) {
        try {
          subscriber.onState(message, context)
        } catch (error) {
          logger.warn('State subscriber threw', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
    for (const client of sseClients) {
      try {
        sseWrite(client, message)
      } catch (error) {
        logger.warn('SSE write failed, dropping client', {
          error: error instanceof Error ? error.message : String(error),
        })
        sseClients.delete(client)
      }
    }
    syncStoreStatus()
  }

  function handleSse(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Dev only in practice: lets the SPA served from the vite dev server connect.
      'Access-Control-Allow-Origin': '*',
    })
    sseWrite(res, buildState())
    sseClients.add(res)
    syncStoreStatus()
    logger.info('SSE client connected', { clients: sseClients.size })

    res.on('close', () => {
      sseClients.delete(res)
      syncStoreStatus()
      logger.info('SSE client disconnected', { clients: sseClients.size })
    })
  }

  function handlePicksSse(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Dev only in practice: lets the SPA served from the vite dev server connect.
      'Access-Control-Allow-Origin': '*',
    })
    sseWrite(res, picksMessage())
    picksSseClients.add(res)
    syncStoreStatus()
    logger.info('Picks SSE client connected', { clients: picksSseClients.size })

    res.on('close', () => {
      picksSseClients.delete(res)
      syncStoreStatus()
      logger.info('Picks SSE client disconnected', { clients: picksSseClients.size })
    })
  }

  async function handleStatic(urlPath: string, res: ServerResponse): Promise<void> {
    // '/', '/stream' and '/picks' load their SPAs; anything else is an asset
    // relative to out/renderer.
    const relative =
      urlPath === '/' || urlPath === '/stream' || urlPath === '/stream/'
        ? 'stream/index.html'
        : urlPath === '/picks' || urlPath === '/picks/'
          ? 'picks/index.html'
          : urlPath.replace(/^\//, '')

    const filePath = normalize(join(staticRoot, relative))
    if (!filePath.startsWith(staticRoot)) {
      res.writeHead(403)
      res.end()
      return
    }

    try {
      const content = await fs.readFile(filePath)
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      })
      res.end(content)
    } catch {
      res.writeHead(404)
      res.end('Not found')
    }
  }

  /**
   * Bundled broadcast art (resources/data/stream): /art/<name> tries .png then
   * .jpg. 404s are expected when optional art was not shipped — the SPA falls
   * back to its CSS gradients.
   */
  async function handleArt(urlPath: string, res: ServerResponse): Promise<void> {
    const match = /^\/art\/([a-z0-9-]+)$/.exec(urlPath)
    if (!match) {
      res.writeHead(404)
      res.end()
      return
    }
    // __dirname convention (out/main -> project root), NOT app.getAppPath():
    // the latter resolves to the default_app wrapper under `electron <file.js>`
    const artDir = app.isPackaged
      ? join(process.resourcesPath, 'data', 'stream')
      : join(__dirname, '..', '..', 'resources', 'data', 'stream')

    for (const ext of ['png', 'jpg'] as const) {
      try {
        const content = await fs.readFile(join(artDir, `${match[1]}.${ext}`))
        res.writeHead(200, {
          'Content-Type': ext === 'png' ? 'image/png' : 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
        })
        res.end(content)
        return
      } catch {
        // try next extension
      }
    }
    res.writeHead(404)
    res.end()
  }

  async function handleIcon(urlPath: string, res: ServerResponse): Promise<void> {
    // /icons/<abilities|heroes>/<safe_name>.png — anything else is a 404.
    const match = /^\/icons\/(abilities|heroes)\/([a-z0-9_]+)\.png$/.exec(urlPath)
    if (!match) {
      res.writeHead(404)
      res.end()
      return
    }
    const { data } = await iconCache.getIcon(match[1] as IconKind, match[2])
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(data)
  }

  function captureGsiPayload(
    rawBody: string,
    phase: string | null,
    mode: string,
  ): void {
    const safePhase = (phase ?? 'unknown').replace(/[^A-Za-z0-9_]/g, '_')
    const captureKey = `${mode}_${safePhase}`
    const now = Date.now()
    const lastWrite = gsiCaptureLastWrite.get(captureKey) ?? 0
    if (now - lastWrite < 5_000) return
    gsiCaptureLastWrite.set(captureKey, now)
    void fs
      .mkdir(gsiCaptureDir, { recursive: true })
      .then(() => fs.writeFile(join(gsiCaptureDir, `${captureKey}.json`), rawBody))
      .catch((error: unknown) => {
        logger.warn('GSI capture write failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
  }

  function logParsedPlayers(snapshot: GsiSnapshot): void {
    if (snapshot.players.length === 0) return
    const mapping = snapshot.players
      .map((p) => `${p.slotIndex}:${p.name}${p.heroNpcName ? `=${p.heroNpcName}` : ''}`)
      .join(', ')
    if (mapping !== gsiLastPlayersLog) {
      gsiLastPlayersLog = mapping
      logger.info('GSI player slots', { mapping })
    }
  }

  // DEBUG (playing-mode validation): the two logs below make the main log answer
  // "did GSI see the draft while PLAYING (not spectating)?" — logParsedPlayers is
  // silent in playing mode (no allplayers block), so without these the log can't
  // distinguish a working playing-mode feed from a dead one.
  function logPhaseTransition(snapshot: GsiSnapshot): void {
    if (snapshot.gamePhase === gsiLastLoggedPhase) return
    const from = gsiLastLoggedPhase
    gsiLastLoggedPhase = snapshot.gamePhase
    logger.info('GSI phase transition', {
      from,
      to: snapshot.gamePhase,
      mode: gsiSnapshotMode(snapshot),
      matchId: snapshot.matchId,
      clockTime: snapshot.clockTime,
      playerCount: snapshot.players.length,
      localPlayer: snapshot.localPlayer?.name ?? null,
    })
  }

  function logLocalPlayer(snapshot: GsiSnapshot): void {
    if (!snapshot.localPlayer) return
    const line = `${snapshot.localPlayer.name}${
      snapshot.localHeroNpcName ? `=${snapshot.localHeroNpcName}` : ''
    }`
    if (line !== gsiLastLocalLog) {
      gsiLastLocalLog = line
      logger.info('GSI local player (playing mode)', {
        name: snapshot.localPlayer.name,
        accountId: snapshot.localPlayer.accountId,
        heroModel: snapshot.localHeroNpcName,
      })
    }
  }

  function scheduleGsiBroadcast(): void {
    if (gsiBroadcastTimer) return
    gsiBroadcastTimer = setTimeout(() => {
      gsiBroadcastTimer = null
      broadcast()
    }, GSI_BROADCAST_DEBOUNCE_MS)
  }

  function handleGsiPost(req: IncomingMessage, res: ServerResponse): void {
    // Respond 200 fast no matter what — a slow/erroring endpoint makes Dota's
    // GSI client back off and drop payloads.
    const chunks: Buffer[] = []
    let size = 0
    let overflow = false

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > GSI_MAX_BODY_BYTES) {
        overflow = true
        req.removeAllListeners('data')
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      res.writeHead(200)
      res.end()
      if (overflow) {
        logger.warn('GSI payload exceeded size cap, dropped', { size })
        return
      }
      try {
        const rawBody = Buffer.concat(chunks).toString('utf-8')
        const json: unknown = JSON.parse(rawBody)
        const wasConnected = gsiConnected()
        gsiSnapshot = parseGsiPayload(json)
        gsiLastAt = Date.now()
        captureGsiPayload(rawBody, gsiSnapshot.gamePhase, gsiSnapshotMode(gsiSnapshot))
        logParsedPlayers(gsiSnapshot)
        logPhaseTransition(gsiSnapshot)
        logLocalPlayer(gsiSnapshot)
        if (!wasConnected) {
          appStore.setState({ gsiConnected: true })
          logger.info('GSI connected')
        }
        for (const listener of gsiListeners) {
          try {
            listener(gsiSnapshot)
          } catch (error) {
            logger.warn('GSI listener threw', {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        scheduleGsiBroadcast()
      } catch {
        logger.warn('Dropped malformed GSI payload')
      }
    })

    req.on('error', () => {
      // socket error mid-body — nothing to do, Dota retries on its throttle
    })
  }

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const urlPath = (req.url ?? '/').split('?')[0]

    if (req.method === 'POST' && urlPath === '/gsi') {
      handleGsiPost(req, res)
      return
    }

    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }

    if (urlPath === '/events') {
      handleSse(res)
      return
    }

    if (urlPath === '/picks/events') {
      handlePicksSse(res)
      return
    }

    if (urlPath.startsWith('/icons/')) {
      void handleIcon(urlPath, res)
      return
    }

    if (urlPath.startsWith('/art/')) {
      void handleArt(urlPath, res)
      return
    }

    // Dev: the SPA bundle lives on the electron-vite dev server, not on disk.
    // Preserve the caller's query params (?demo=1&bg=...&title=...) — only the
    // api origin is appended for the split-origin SSE connection.
    const devRendererUrl = !app.isPackaged && process.env['ELECTRON_RENDERER_URL']
    const devSpa =
      urlPath === '/' || urlPath === '/stream' || urlPath === '/stream/'
        ? 'stream'
        : urlPath === '/picks' || urlPath === '/picks/'
          ? 'picks'
          : null
    if (devRendererUrl && devSpa) {
      const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '')
      query.set('api', `http://127.0.0.1:${activePort}`)
      res.writeHead(302, {
        Location: `${devRendererUrl}/${devSpa}/index.html?${query.toString()}`,
      })
      res.end()
      return
    }

    void handleStatic(urlPath, res)
  }

  return {
    start(port: number): Promise<boolean> {
      if (server) {
        logger.warn('Stream server already running', { port: activePort })
        return Promise.resolve(true)
      }

      return new Promise((resolve) => {
        const srv = createServer(handleRequest)

        srv.on('error', (error: NodeJS.ErrnoException) => {
          logger.error('Stream server error', { code: error.code, message: error.message })
          errorKey =
            error.code === 'EADDRINUSE' ? 'server.errorPortInUse' : 'server.errorGeneric'
          server = null
          activePort = port
          syncStoreStatus()
          resolve(false)
        })

        srv.listen(port, '127.0.0.1', () => {
          server = srv
          activePort = port
          errorKey = null
          heartbeatTimer = setInterval(() => {
            for (const clients of [sseClients, picksSseClients]) {
              for (const client of clients) {
                try {
                  client.write(': heartbeat\n\n')
                } catch {
                  clients.delete(client)
                }
              }
            }
          }, SSE_HEARTBEAT_MS)
          gsiStaleTimer = setInterval(() => {
            if (appStore.getState().gsiConnected && !gsiConnected()) {
              appStore.setState({ gsiConnected: false })
              logger.info('GSI connection stale')
              broadcast()
            }
          }, GSI_STALE_CHECK_MS)
          syncStoreStatus()
          logger.info('Stream server started', { url: `http://127.0.0.1:${port}/stream` })
          resolve(true)
        })
      })
    },

    stop(): Promise<void> {
      if (!server) {
        errorKey = null
        syncStoreStatus()
        return Promise.resolve()
      }
      const srv = server
      server = null

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
      if (gsiStaleTimer) {
        clearInterval(gsiStaleTimer)
        gsiStaleTimer = null
      }
      if (gsiBroadcastTimer) {
        clearTimeout(gsiBroadcastTimer)
        gsiBroadcastTimer = null
      }
      if (appStore.getState().gsiConnected) {
        appStore.setState({ gsiConnected: false })
      }
      for (const client of [...sseClients, ...picksSseClients]) {
        try {
          client.end()
        } catch {
          // already gone
        }
      }
      sseClients.clear()
      picksSseClients.clear()

      return new Promise((resolve) => {
        srv.close(() => {
          activePort = null
          errorKey = null
          syncStoreStatus()
          logger.info('Stream server stopped')
          resolve()
        })
      })
    },

    isRunning(): boolean {
      return server !== null
    },

    getStatus(): StreamServerStatusInfo {
      return {
        status: errorKey ? 'error' : server ? 'running' : 'stopped',
        port: activePort,
        clientCount: sseClients.size + picksSseClients.size,
        errorKey,
      }
    },

    onScanProcessed(payload: OverlayDataPayload, isInitialScan: boolean): void {
      if (isInitialScan) {
        initialPayload = payload
      }
      latestPayload = payload
      // forceBuild: the picks snapshot must record the scan even with no
      // clients connected (an OBS source may connect later, or after restart)
      broadcast(true)
    },

    onSessionReset(): void {
      initialPayload = null
      latestPayload = null
      for (const subscriber of activeSubscribers()) {
        try {
          subscriber.onSessionReset()
        } catch (error) {
          logger.warn('State subscriber threw on reset', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      broadcast()
    },

    refresh(): void {
      broadcast()
    },

    onGsiSnapshot(listener): void {
      gsiListeners.push(listener)
    },

    getGsiState(): { snapshot: GsiSnapshot | null; connected: boolean } {
      return { snapshot: gsiSnapshot, connected: gsiConnected() }
    },

    subscribeState(subscriber): () => void {
      stateSubscribers.add(subscriber)
      return () => {
        stateSubscribers.delete(subscriber)
      }
    },
  }
}
