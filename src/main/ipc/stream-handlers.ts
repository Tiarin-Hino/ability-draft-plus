import { ipcMain, dialog } from 'electron'
import log from 'electron-log/main'
import type { StreamServerService } from '../services/stream-server-service'
import type { IconCacheService } from '../services/icon-cache-service'
import { loadAbilityClassNames } from '../services/icon-cache-service'
import type { GsiCfgService } from '../services/gsi-cfg-service'
import type { WindowManager } from '../services/window-manager'
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
  gsiCfgService: GsiCfgService,
  windowManager: WindowManager,
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

  // GSI cfg management. writeCfg uses the CURRENT stream port from settings so the
  // cfg and server always agree; the streaming page reminds users to rewrite the cfg
  // after changing the port.
  ipcMain.handle('gsi:detect', () => gsiCfgService.detect())

  ipcMain.handle('gsi:writeCfg', (_event, data: { dotaDir?: string }) => {
    const { streamPort } = dbService.metadata.getSettings()
    return gsiCfgService.writeCfg(streamPort, data?.dotaDir)
  })

  ipcMain.handle('gsi:pickDotaFolder', async (_event, data: { title: string }) => {
    const cp = windowManager.getControlPanelWindow()
    if (!cp || cp.isDestroyed()) return { dir: null }
    const result = await dialog.showOpenDialog(cp, {
      properties: ['openDirectory'],
      title: data.title,
    })
    return { dir: result.canceled ? null : (result.filePaths[0] ?? null) }
  })

  logger.info('Stream IPC handlers registered')
}
