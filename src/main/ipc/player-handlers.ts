import { ipcMain } from 'electron'
import log from 'electron-log/main'
import type { PlayerStatsService } from '../services/player-stats-service'

// @DEV-GUIDE: Linked Windrun profile IPC (personalized suggestions). The profile id
// is only ever stored through player:linkProfile, which validates the input against
// the live windrun.io profile endpoint first — that's why this is dedicated IPC and
// not part of settings:set. Errors travel as i18n keys (settings namespace),
// translated in the renderer (FeedbackStatus pattern).

const logger = log.scope('ipc:player')

export function registerPlayerHandlers(playerStatsService: PlayerStatsService): void {
  ipcMain.handle('player:getProfile', () => {
    return playerStatsService.getProfile()
  })

  ipcMain.handle('player:linkProfile', (_event, data: { input: string }) => {
    return playerStatsService.linkProfile(data.input)
  })

  ipcMain.handle('player:unlinkProfile', () => {
    playerStatsService.unlinkProfile()
  })

  ipcMain.handle('player:refreshStats', () => {
    return playerStatsService.refreshStats()
  })

  logger.info('Player IPC handlers registered')
}
