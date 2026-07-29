import { ipcMain } from 'electron'
import log from 'electron-log/main'
import type { StreamServerService } from '../services/stream-server-service'
import type { IconCacheService } from '../services/icon-cache-service'
import { loadAbilityClassNames } from '../services/icon-cache-service'
import type { DatabaseService } from '../services/database-service'

// @DEV-GUIDE: Streamer-view IPC handlers. All invoke-style (renderer awaits the result).
// stream:start persists the chosen port (stream_port setting) before binding so the next
// autostart uses it. Error details flow to the renderer as i18n keys via the AppStore
// (streamServerError) — this file never produces display strings.

const logger = log.scope('ipc:stream')

export function registerStreamHandlers(
  streamService: StreamServerService,
  dbService: DatabaseService,
  iconCache: IconCacheService,
): void {
  ipcMain.handle('stream:start', async (_event, data: { port: number }) => {
    const port = Math.floor(data.port)
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      logger.warn('Rejected stream server start with invalid port', { port: data.port })
      return { success: false, errorKey: 'server.errorInvalidPort' }
    }

    dbService.metadata.setSettings({ streamPort: port })
    dbService.persist()

    const success = await streamService.start(port)
    const status = streamService.getStatus()
    logger.info('Stream server start requested', { port, success })
    return { success, errorKey: status.errorKey ?? undefined }
  })

  ipcMain.handle('stream:stop', async () => {
    await streamService.stop()
    return { success: true }
  })

  ipcMain.handle('stream:getStatus', () => streamService.getStatus())

  // One in-flight prefetch at a time; repeat clicks while running are no-ops.
  let prefetchInFlight = false
  ipcMain.handle('stream:prefetchIcons', async () => {
    if (prefetchInFlight) return { success: false }
    prefetchInFlight = true
    try {
      const names = await loadAbilityClassNames()
      const summary = await iconCache.prefetchAbilities(names)
      return { success: true, ...summary }
    } catch (error) {
      logger.error('Icon prefetch failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return { success: false }
    } finally {
      prefetchInFlight = false
    }
  })

  logger.info('Stream IPC handlers registered')
}
