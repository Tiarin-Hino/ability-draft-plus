import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { join, normalize, extname } from 'path'
import { promises as fs } from 'fs'
import { app } from 'electron'
import log from 'electron-log/main'
import type { OverlayDataPayload } from '@shared/types'
import type { StreamServerStatusInfo, StreamStateMessage } from '@shared/types/stream'
import { STREAM_PROTOCOL_VERSION } from '@shared/constants/thresholds'
import { buildStreamBoardState } from '@core/domain/stream-board'
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
// - /icons/*, /gsi   -> added in later phases
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

export interface StreamServerService {
  start(port: number): Promise<boolean>
  stop(): Promise<void>
  isRunning(): boolean
  getStatus(): StreamServerStatusInfo
  /** Fed by scan-processing-service after every successful scan. */
  onScanProcessed(payload: OverlayDataPayload, isInitialScan: boolean): void
  /** Clears the cached draft (overlay reset / overlay closed). */
  onSessionReset(): void
  /** Re-push current state to clients (e.g. after a language change). */
  refresh(): void
}

export function createStreamServerService(
  dbService: DatabaseService,
  appStore: AppStore,
  iconCache: IconCacheService,
): StreamServerService {
  let server: Server | null = null
  let activePort: number | null = null
  let errorKey: string | null = null
  const sseClients = new Set<ServerResponse>()
  let heartbeatTimer: NodeJS.Timeout | null = null

  let initialPayload: OverlayDataPayload | null = null
  let latestPayload: OverlayDataPayload | null = null

  const staticRoot = join(app.getAppPath(), 'out', 'renderer')

  function syncStoreStatus(): void {
    appStore.setState({
      streamServerStatus: errorKey ? 'error' : server ? 'running' : 'stopped',
      streamServerPort: activePort,
      streamServerError: errorKey,
      streamClientCount: sseClients.size,
    })
  }

  function buildState(): StreamStateMessage {
    const state = buildStreamBoardState({
      initialPayload,
      latestPayload,
      gsi: null,
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

  function sseWrite(res: ServerResponse, message: StreamStateMessage): void {
    res.write(`data: ${JSON.stringify(message)}\n\n`)
  }

  function broadcast(): void {
    if (sseClients.size === 0) return
    const message = buildState()
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

  async function handleStatic(urlPath: string, res: ServerResponse): Promise<void> {
    // '/' and '/stream' load the SPA; anything else is an asset relative to out/renderer.
    const relative =
      urlPath === '/' || urlPath === '/stream' || urlPath === '/stream/'
        ? 'stream/index.html'
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

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const urlPath = (req.url ?? '/').split('?')[0]

    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }

    if (urlPath === '/events') {
      handleSse(res)
      return
    }

    if (urlPath.startsWith('/icons/')) {
      void handleIcon(urlPath, res)
      return
    }

    // Dev: the SPA bundle lives on the electron-vite dev server, not on disk.
    const devRendererUrl = !app.isPackaged && process.env['ELECTRON_RENDERER_URL']
    if (devRendererUrl && (urlPath === '/' || urlPath === '/stream' || urlPath === '/stream/')) {
      const api = encodeURIComponent(`http://127.0.0.1:${activePort}`)
      res.writeHead(302, {
        Location: `${devRendererUrl}/stream/index.html?api=${api}`,
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
            for (const client of sseClients) {
              try {
                client.write(': heartbeat\n\n')
              } catch {
                sseClients.delete(client)
              }
            }
          }, SSE_HEARTBEAT_MS)
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
      for (const client of sseClients) {
        try {
          client.end()
        } catch {
          // already gone
        }
      }
      sseClients.clear()

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
        clientCount: sseClients.size,
        errorKey,
      }
    },

    onScanProcessed(payload: OverlayDataPayload, isInitialScan: boolean): void {
      if (isInitialScan) {
        initialPayload = payload
      }
      latestPayload = payload
      broadcast()
    },

    onSessionReset(): void {
      initialPayload = null
      latestPayload = null
      broadcast()
    },

    refresh(): void {
      broadcast()
    },
  }
}
