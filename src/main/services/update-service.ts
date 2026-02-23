import { autoUpdater } from 'electron-updater'
import log from 'electron-log/main'
import type { AppStore } from '../store/app-store'
import type { WindowManager } from './window-manager'
import type { UpdateNotification } from '@shared/types'

// @DEV-GUIDE: Wires electron-updater's autoUpdater to the AppStore and control panel window.
// autoUpdater checks GitHub Releases for new versions (configured in electron-builder.yml).
//
// Two state channels:
// - AppStore fields (updateStatus, updateProgress, updateVersion, updateError) -- synced to
//   renderers via @zubridge for reactive UI updates (progress bars, badges).
// - IPC send 'app:updateNotification' -- direct messages to the control panel for toast/banner.
//
// autoDownload is disabled (user must explicitly click "Download"). autoInstallOnAppQuit is
// enabled so the update installs silently when the user quits naturally.

const logger = log.scope('update-service')

export interface UpdateService {
  checkForUpdates(): void
  downloadUpdate(): void
  installUpdate(): void
}

export function createUpdateService(
  appStore: AppStore,
  windowManager: WindowManager,
): UpdateService {
  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  function broadcast(notification: UpdateNotification) {
    const cpWin = windowManager.getControlPanelWindow()
    if (cpWin && !cpWin.isDestroyed()) {
      cpWin.webContents.send('app:updateNotification', notification)
    }
  }

  autoUpdater.on('checking-for-update', () => {
    appStore.setState({ updateStatus: 'checking' })
    logger.info('Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    appStore.setState({
      updateStatus: 'available',
      updateVersion: info.version,
    })
    broadcast({ status: 'available', info: info as unknown as Record<string, unknown> })
    logger.info('Update available:', info.version)
  })

  autoUpdater.on('update-not-available', () => {
    appStore.setState({ updateStatus: 'idle' })
    broadcast({ status: 'not-available' })
    logger.info('No updates available')
  })

  autoUpdater.on('download-progress', (progress) => {
    appStore.setState({
      updateStatus: 'downloading',
      updateProgress: progress.percent,
    })
    broadcast({
      status: 'downloading',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
      },
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    appStore.setState({
      updateStatus: 'downloaded',
      updateVersion: info.version,
      updateProgress: null,
    })
    broadcast({ status: 'downloaded', info: info as unknown as Record<string, unknown> })
    logger.info('Update downloaded:', info.version)
  })

  autoUpdater.on('error', (err) => {
    appStore.setState({
      updateStatus: 'error',
      updateError: err.message,
      updateProgress: null,
    })
    broadcast({ status: 'error', error: err.message })
    logger.error('Update error:', err)
  })

  return {
    checkForUpdates() {
      autoUpdater.checkForUpdates().catch((err) => {
        logger.error('Failed to check for updates:', err)
      })
    },

    downloadUpdate() {
      autoUpdater.downloadUpdate().catch((err) => {
        logger.error('Failed to download update:', err)
      })
    },

    installUpdate() {
      autoUpdater.quitAndInstall()
    },
  }
}
