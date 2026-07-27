import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log/main'
import type { AppStore } from '../store/app-store'

// @DEV-GUIDE: Wires electron-updater's autoUpdater to the AppStore.
// autoUpdater checks GitHub Releases for new versions (configured in electron-builder.yml).
// All update state flows through AppStore fields (updateStatus, updateProgress,
// updateVersion, updateError), synced to renderers via @zubridge.
//
// autoDownload is disabled (user must explicitly click "Download"). autoInstallOnAppQuit is
// enabled so the update installs silently when the user quits naturally.
//
// startPeriodicChecks() restores the v1 behavior lost in the v2 rewrite: an automatic
// check shortly after startup plus a low-frequency interval. Checking is automatic;
// downloading and installing remain explicit user actions.

const logger = log.scope('update-service')

// Delay the startup check so it never competes with app initialization
const AUTO_CHECK_INITIAL_DELAY = 30_000
const AUTO_CHECK_INTERVAL = 4 * 60 * 60 * 1000

export interface UpdateService {
  checkForUpdates(): void
  downloadUpdate(): void
  installUpdate(): void
  startPeriodicChecks(): void
  stopPeriodicChecks(): void
}

export function createUpdateService(appStore: AppStore): UpdateService {
  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    appStore.setState({ updateStatus: 'checking' })
    logger.info('Checking for updates...')
  })

  autoUpdater.on('update-available', (info) => {
    appStore.setState({
      updateStatus: 'available',
      updateVersion: info.version,
    })
    logger.info('Update available:', info.version)
  })

  autoUpdater.on('update-not-available', () => {
    appStore.setState({ updateStatus: 'idle' })
    logger.info('No updates available')
  })

  autoUpdater.on('download-progress', (progress) => {
    appStore.setState({
      updateStatus: 'downloading',
      updateProgress: progress.percent,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    appStore.setState({
      updateStatus: 'downloaded',
      updateVersion: info.version,
      updateProgress: null,
    })
    logger.info('Update downloaded:', info.version)
  })

  autoUpdater.on('error', (err) => {
    appStore.setState({
      updateStatus: 'error',
      updateError: err.message,
      updateProgress: null,
    })
    logger.error('Update error:', err)
  })

  let initialTimer: ReturnType<typeof setTimeout> | null = null
  let intervalTimer: ReturnType<typeof setInterval> | null = null

  function checkForUpdates(): void {
    autoUpdater.checkForUpdates().catch((err) => {
      logger.error('Failed to check for updates:', err)
    })
  }

  return {
    checkForUpdates,

    downloadUpdate() {
      autoUpdater.downloadUpdate().catch((err) => {
        logger.error('Failed to download update:', err)
      })
    },

    installUpdate() {
      autoUpdater.quitAndInstall()
    },

    startPeriodicChecks() {
      if (!app.isPackaged) {
        logger.info('Skipping automatic update checks (unpackaged build)')
        return
      }
      if (initialTimer || intervalTimer) return
      initialTimer = setTimeout(() => {
        initialTimer = null
        checkForUpdates()
      }, AUTO_CHECK_INITIAL_DELAY)
      intervalTimer = setInterval(checkForUpdates, AUTO_CHECK_INTERVAL)
      logger.info('Automatic update checks scheduled', {
        initialDelayMs: AUTO_CHECK_INITIAL_DELAY,
        intervalMs: AUTO_CHECK_INTERVAL,
      })
    },

    stopPeriodicChecks() {
      if (initialTimer) {
        clearTimeout(initialTimer)
        initialTimer = null
      }
      if (intervalTimer) {
        clearInterval(intervalTimer)
        intervalTimer = null
      }
    },
  }
}
