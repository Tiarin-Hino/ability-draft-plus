import { createServer, type IncomingMessage, type Server } from 'http'
import { app } from 'electron'
import log from 'electron-log/main'
import type { AppStore } from '../store/app-store'

// @DEV-GUIDE: Dev-only localhost control endpoint that lets external tooling
// (the diagnostic draft-cycle script in ../ad_data_gather_script) drive THIS
// app between automated Dota 2 restarts. Every diagnostic iteration kills and
// relaunches the game, which invalidates the overlay session — a one-time
// manual "Activate overlay" cannot survive an 11-draft run (2026-08-18 run
// produced zero scans for exactly this reason). Endpoints:
//   GET  /status                   — overlay/ML/auto-rescan state + scans this session
//   GET  /capture                  — PNG screenshot (?hideOverlay=1 hides visible overlay cleanly)
//   POST /overlay/activate         — same as the control panel button
//   POST /scan/initial             — force an initial scan now
//   POST /settings/auto-tracking   — toggle experimentalAutoDraftTracking ({ enabled })
//   POST /draft/select-spot        — set/clear manual My Spot row ({ heroOrder })
//   POST /overlay/debug-frames     — toggle .debug-calibration-frames wireframe outline ({ enabled })
// Never registered in packaged builds; binds 127.0.0.1 only; no auth because
// it is loopback-only and dev-only.

const logger = log.scope('dev-control')

export const DEV_CONTROL_PORT = 58874

export interface DevControlHooks {
  activateOverlay(): { success: boolean; resolution?: string; error?: string }
  performInitialScan(): Promise<void>
  getScanCount(): number
  /** Read from the DB — the auto-rescan service gates on the persisted value,
   *  and the AppStore settings snapshot is not authoritative for this key. */
  isAutoDraftTrackingEnabled(): boolean
  captureScreen(options?: { hideOverlay?: boolean }): Promise<Buffer>
  setAutoDraftTracking(enabled: boolean): void
  selectSpot(heroOrder: number | null): void
  setDebugFrames(enabled: boolean): Promise<void>
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  if (!raw) return {}
  return JSON.parse(raw) as Record<string, unknown>
}

export function startDevControlServer(appStore: AppStore, hooks: DevControlHooks): Server | null {
  if (app.isPackaged) return null

  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    try {
      if (req.method === 'GET' && path === '/status') {
        const s = appStore.getState()
        send(200, {
          overlayActive: s.overlayActive,
          activeResolution: s.activeResolution,
          mlStatus: s.mlStatus,
          autoDraftTracking: hooks.isAutoDraftTrackingEnabled(),
          scansThisSession: hooks.getScanCount(),
        })
        return
      }
      if (req.method === 'GET' && path === '/capture') {
        const hideOverlay = url.searchParams.get('hideOverlay') === '1'
        const png = await hooks.captureScreen({ hideOverlay })
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(png.length) })
        res.end(png)
        return
      }
      if (req.method === 'POST' && path === '/overlay/activate') {
        if (appStore.getState().overlayActive) {
          send(200, { success: true, alreadyActive: true })
          return
        }
        const result = hooks.activateOverlay()
        logger.info('Overlay activation requested by dev control', result)
        send(result.success ? 200 : 409, result)
        return
      }
      if (req.method === 'POST' && path === '/scan/initial') {
        if (!appStore.getState().overlayActive) {
          send(409, { success: false, error: 'overlay not active' })
          return
        }
        await hooks.performInitialScan()
        send(200, { success: true })
        return
      }
      if (req.method === 'POST' && path === '/settings/auto-tracking') {
        const body = await readJsonBody(req)
        const enabled = body.enabled === true
        hooks.setAutoDraftTracking(enabled)
        send(200, { success: true, autoDraftTracking: enabled })
        return
      }
      if (req.method === 'POST' && path === '/draft/select-spot') {
        const body = await readJsonBody(req)
        const heroOrder = typeof body.heroOrder === 'number' ? body.heroOrder : null
        hooks.selectSpot(heroOrder)
        send(200, { success: true, heroOrder })
        return
      }
      if (req.method === 'POST' && path === '/overlay/debug-frames') {
        const body = await readJsonBody(req)
        const enabled = body.enabled === true
        await hooks.setDebugFrames(enabled)
        send(200, { success: true, debugFrames: enabled })
        return
      }
      send(404, { error: 'unknown endpoint' })
    } catch (error) {
      send(500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  server.on('error', (error) => {
    logger.warn('Dev control server unavailable', { error: error.message })
  })
  server.listen(DEV_CONTROL_PORT, '127.0.0.1', () => {
    logger.info('Dev control server listening', { port: DEV_CONTROL_PORT })
  })
  return server
}
