import { ipcMain } from 'electron'
import log from 'electron-log/main'
import type { TwitchPublisherService } from '../services/twitch-publisher-service'

// @DEV-GUIDE: Twitch extension IPC (pairing + broadcast toggle). Pairing goes through
// dedicated channels rather than settings:set because the channel token must be
// obtained from the EBS (code exchange) and must never round-trip through
// settings:get to renderers. The broadcast toggle is a setting, but it is set here
// so the publisher reacts immediately (and republishes) instead of polling. Errors
// travel as i18n keys (streaming namespace, twitch.*), translated in the renderer.

const logger = log.scope('ipc:twitch')

export function registerTwitchHandlers(publisher: TwitchPublisherService): void {
  ipcMain.handle('twitch:getStatus', () => ({
    link: publisher.getLinkInfo(),
    broadcastEnabled: publisher.isBroadcastEnabled(),
    ebsUrl: publisher.getEbsUrl(),
  }))

  ipcMain.handle('twitch:pair', (_event, data: { code: string }) => {
    return publisher.pair(typeof data?.code === 'string' ? data.code : '')
  })

  ipcMain.handle('twitch:unpair', async () => {
    await publisher.unpair()
  })

  ipcMain.handle('twitch:setBroadcastEnabled', (_event, data: { enabled: boolean }) => {
    publisher.setBroadcastEnabled(data?.enabled === true)
  })

  ipcMain.handle('twitch:republish', () => {
    return publisher.republish()
  })

  logger.info('Twitch IPC handlers registered')
}
