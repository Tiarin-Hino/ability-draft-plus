import { ipcMain, dialog } from 'electron'
import log from 'electron-log/main'
import type { FeedbackService } from '../services/feedback-service'
import type { WindowManager } from '../services/window-manager'
import type { FeedbackStatus, IpcOnMap } from '@shared/ipc/api'

// @DEV-GUIDE: Feedback domain IPC handlers — the main-process half of the
// "Report Failed Recognition" loop (the renderer half lives in the overlay's
// ControlsPanel and the control panel's FeedbackCard).
//
// - feedback:takeSnapshot — saves the last scan's screenshot + raw predictions locally
// - feedback:exportSamples — zips all samples to a user-chosen path (save dialog)
// - feedback:uploadSamples — sends pending samples to the feedback API (HMAC-signed)
//
// All three reply with a feedback:*Status event carrying an i18n messageKey that the
// receiving renderer resolves in its own locale namespace.

const logger = log.scope('ipc-feedback')

type FeedbackStatusChannel = {
  [K in keyof IpcOnMap]: IpcOnMap[K] extends FeedbackStatus ? K : never
}[keyof IpcOnMap]

export function registerFeedbackHandlers(
  feedbackService: FeedbackService,
  windowManager: WindowManager,
): void {
  function sendStatus(channel: FeedbackStatusChannel, status: FeedbackStatus): void {
    const overlay = windowManager.getOverlayWindow()
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send(channel, status)
    }
    const cp = windowManager.getControlPanelWindow()
    if (cp && !cp.isDestroyed()) {
      cp.webContents.send(channel, status)
    }
  }

  ipcMain.on('feedback:takeSnapshot', async () => {
    if (!feedbackService.hasScanContext()) {
      sendStatus('feedback:snapshotStatus', {
        messageKey: 'snapshot.noScan',
        error: true,
      })
      return
    }
    try {
      const { storedCount } = await feedbackService.saveSnapshot()
      sendStatus('feedback:snapshotStatus', {
        messageKey: 'snapshot.saved',
        params: { count: storedCount },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Snapshot failed', { error: message })
      sendStatus('feedback:snapshotStatus', {
        messageKey: 'snapshot.error',
        params: { error: message },
        error: true,
      })
    }
  })

  ipcMain.on('feedback:exportSamples', async () => {
    try {
      const samples = await feedbackService.listSamples()
      if (samples.length === 0) {
        sendStatus('feedback:exportStatus', { messageKey: 'feedback.exportNone' })
        return
      }

      const cp = windowManager.getControlPanelWindow()
      const date = new Date().toISOString().slice(0, 10)
      const options: Electron.SaveDialogOptions = {
        defaultPath: `ability-draft-feedback-${date}.zip`,
        filters: [{ name: 'Zip archive', extensions: ['zip'] }],
      }
      const result = cp && !cp.isDestroyed()
        ? await dialog.showSaveDialog(cp, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return

      const { count } = await feedbackService.exportSamples(result.filePath)
      sendStatus('feedback:exportStatus', {
        messageKey: 'feedback.exportSuccess',
        params: { count, path: result.filePath },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Export failed', { error: message })
      sendStatus('feedback:exportStatus', {
        messageKey: 'feedback.exportError',
        params: { error: message },
        error: true,
      })
    }
  })

  ipcMain.on('feedback:uploadSamples', async () => {
    if (!feedbackService.isUploadConfigured()) {
      sendStatus('feedback:uploadStatus', {
        messageKey: 'feedback.apiNotConfigured',
        error: true,
      })
      return
    }
    try {
      const { uploaded, failed, total } = await feedbackService.uploadSamples()
      if (total === 0) {
        sendStatus('feedback:uploadStatus', { messageKey: 'feedback.uploadNone' })
      } else if (failed === 0) {
        sendStatus('feedback:uploadStatus', {
          messageKey: 'feedback.uploadSuccess',
          params: { count: uploaded },
        })
      } else {
        sendStatus('feedback:uploadStatus', {
          messageKey: 'feedback.uploadPartial',
          params: { count: uploaded, total, failed },
          error: true,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Upload failed', { error: message })
      sendStatus('feedback:uploadStatus', {
        messageKey: 'feedback.uploadError',
        params: { error: message },
        error: true,
      })
    }
  })
}
