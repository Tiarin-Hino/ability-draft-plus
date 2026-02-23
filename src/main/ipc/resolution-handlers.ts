import { ipcMain, screen } from 'electron'
import sharp from 'sharp'
import log from 'electron-log/main'
import type { LayoutService } from '../services/layout-service'
import type { ScreenshotService } from '../services/screenshot-service'
import type { WindowTrackerService } from '../services/window-tracker-service'
import type { WindowManager } from '../services/window-manager'
import type { ApiConfig } from '../services/api-config'
import { generateHmacSignature, generateNonce } from '../services/api-config'
import type { CalibrationAnchors } from '@core/resolution/types'
import type { ResolutionLayout } from '@shared/types'
import { deriveAffineParams, applyAffineTransform } from '@core/resolution/anchor-calibration'
import { validateCoordinates } from '@core/resolution/validation'
import { parseResolution } from '@core/resolution/scaling-engine'

// @DEV-GUIDE: Resolution domain IPC handlers for the layout mapper wizard and resolution management.
//
// Channels:
// - resolution:getAll — Returns all resolutions with their sources (preset/auto/custom)
// - resolution:getLayout — Returns layout + source for a specific resolution
// - resolution:save — Saves a custom layout (from manual mapper or calibration wizard)
// - resolution:calibrate — Runs 4-anchor affine calibration: derives transform from anchor
//   clicks, applies it to the 1920x1080 base layout, validates bounds within resolution
// - resolution:deleteCustom — Removes a user-created custom layout
// - resolution:captureScreenshot — Hides control panel, captures screen, detects game window,
//   crops to game bounds if windowed, returns base64 PNG + detected resolution
// - resolution:submitScreenshot — Sends screenshot to the API endpoint with HMAC auth for
//   server-side layout generation (when user doesn't want to calibrate manually)

const logger = log.scope('ipc:resolution')

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function registerResolutionHandlers(
  layoutService: LayoutService,
  screenshotService: ScreenshotService,
  windowTracker: WindowTrackerService,
  windowManager: WindowManager,
  apiConfig: ApiConfig | null,
): void {
  ipcMain.handle('resolution:getAll', () =>
    layoutService.getAllResolutionsWithSources(),
  )

  ipcMain.handle('resolution:getLayout', (_event, data: { resolution: string }) => {
    const layout = layoutService.getLayout(data.resolution)
    const source = layoutService.getLayoutSource(data.resolution)
    return { layout, source }
  })

  ipcMain.handle(
    'resolution:save',
    (_event, data: { resolution: string; layout: ResolutionLayout; method: string }) => {
      try {
        layoutService.saveCustomLayout(data.resolution, data.layout, data.method)
        return { success: true }
      } catch (err) {
        logger.error('Failed to save custom layout', { error: String(err) })
        return { success: false, error: String(err) }
      }
    },
  )

  ipcMain.handle(
    'resolution:calibrate',
    (_event, data: { resolution: string; anchors: CalibrationAnchors }) => {
      const baseConfig = layoutService.getConfig()
      const baseLayout = baseConfig.resolutions['1920x1080']

      const params = deriveAffineParams(data.anchors)
      const layout = applyAffineTransform(baseLayout, params)

      const parsed = parseResolution(data.resolution)
      const validation = parsed
        ? validateCoordinates(layout, parsed.width, parsed.height)
        : { passed: false, errors: ['Invalid resolution format'], warnings: [] }

      return { layout, validation }
    },
  )

  ipcMain.handle('resolution:deleteCustom', (_event, data: { resolution: string }) => {
    const success = layoutService.deleteCustomLayout(data.resolution)
    return { success }
  })

  ipcMain.handle('resolution:captureScreenshot', async () => {
    // Hide the control panel so it doesn't appear in the screenshot
    const cpWindow = windowManager.getControlPanelWindow()
    if (cpWindow && !cpWindow.isDestroyed()) {
      cpWindow.hide()
      await delay(300) // Wait for window to disappear from screen
    }

    let buffer: Buffer
    try {
      buffer = await screenshotService.capture(true)
    } finally {
      // Always restore the control panel, even on capture failure
      if (cpWindow && !cpWindow.isDestroyed()) {
        cpWindow.show()
        cpWindow.focus()
      }
    }

    // Detect Dota 2 game window for correct resolution
    const gameBounds = windowTracker.getGameWindowPhysicalBounds()
    let gameWidth: number
    let gameHeight: number

    if (gameBounds) {
      // Game window found — use its physical dimensions as the game resolution
      gameWidth = gameBounds.width
      gameHeight = gameBounds.height

      // Crop screenshot to game window if it's smaller than the full screen
      const meta = await sharp(buffer).metadata()
      const screenW = meta.width ?? 0
      const screenH = meta.height ?? 0
      if (gameBounds.width < screenW || gameBounds.height < screenH) {
        buffer = await sharp(buffer)
          .extract({
            left: gameBounds.x,
            top: gameBounds.y,
            width: gameBounds.width,
            height: gameBounds.height,
          })
          .toBuffer()
        logger.info('Cropped screenshot to game window', {
          gameWidth,
          gameHeight,
        })
      }
    } else {
      // No game window found — fall back to screen native resolution
      const primaryDisplay = screen.getPrimaryDisplay()
      gameWidth = Math.round(primaryDisplay.size.width * primaryDisplay.scaleFactor)
      gameHeight = Math.round(primaryDisplay.size.height * primaryDisplay.scaleFactor)
      logger.info('No game window detected, using screen resolution', {
        gameWidth,
        gameHeight,
      })
    }

    return {
      imageBase64: buffer.toString('base64'),
      width: gameWidth,
      height: gameHeight,
    }
  })

  ipcMain.handle(
    'resolution:submitScreenshot',
    async (_event, data: { imageBase64: string; width: number; height: number }) => {
      if (!apiConfig) {
        return { success: false, error: 'API not configured' }
      }

      try {
        const screenshotBuffer = Buffer.from(data.imageBase64, 'base64')
        const resolutionString = `${data.width}x${data.height}`
        const scaleFactor = screen.getPrimaryDisplay().scaleFactor

        const timestamp = new Date().toISOString()
        const nonce = generateNonce()
        const requestPath = '/resolution-request'
        const signature = generateHmacSignature(
          apiConfig.sharedSecret,
          'POST',
          requestPath,
          timestamp,
          nonce,
          apiConfig.apiKey,
        )

        logger.info('Submitting resolution screenshot', { resolution: resolutionString })

        const response = await fetch(`${apiConfig.endpointUrl}${requestPath}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'image/png',
            'x-resolution-string': resolutionString,
            'x-scale-factor': scaleFactor.toString(),
            'x-api-key': apiConfig.apiKey,
            'x-request-timestamp': timestamp,
            'x-nonce': nonce,
            'x-signature': signature,
          },
          body: screenshotBuffer,
        })

        const responseData = (await response.json()) as Record<string, string>

        if (response.ok && responseData.message) {
          logger.info('Screenshot submitted successfully', { message: responseData.message })
          return { success: true, message: responseData.message }
        }

        const errorMsg =
          responseData.error || responseData.message || `API returned status ${response.status}`
        logger.error('Screenshot submission failed', { error: errorMsg })
        return { success: false, error: errorMsg }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.error('Screenshot submission error', { error: errorMsg })
        return { success: false, error: errorMsg }
      }
    },
  )
}
