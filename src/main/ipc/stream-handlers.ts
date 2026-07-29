import { ipcMain } from 'electron'
import log from 'electron-log/main'
import type { StreamServerService } from '../services/stream-server-service'
import type { DatabaseService } from '../services/database-service'

// @DEV-GUIDE: Streamer-view IPC handlers. All invoke-style (renderer awaits the result).
// stream:start persists the chosen port (stream_port setting) before binding so the next
// autostart uses it. Error details flow to the renderer as i18n keys via the AppStore
// (streamServerError) — this file never produces display strings.

const logger = log.scope('ipc:stream')

export function registerStreamHandlers(
  streamService: StreamServerService,
  dbService: DatabaseService,
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

  logger.info('Stream IPC handlers registered')
}
