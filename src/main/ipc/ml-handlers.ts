import { ipcMain } from 'electron'
import sharp from 'sharp'
import log from 'electron-log/main'
import type { MlService } from '../services/ml-service'
import type { LayoutService } from '../services/layout-service'
import type { ScreenshotService } from '../services/screenshot-service'
import type { WindowManager } from '../services/window-manager'
import type { ScanProcessingService } from '../services/scan-processing-service'
import type { WindowTrackerService } from '../services/window-tracker-service'
import type { ScanResult } from '@shared/types'
import type { InitialScanResults } from '@shared/types/ml'
import type { AppStore } from '../store/app-store'

// @DEV-GUIDE: ML domain IPC handlers. Two channels:
// - ml:init (handle): Explicit re-init from UI retry button. Sets mlStatus in AppStore.
// - ml:scan (on/fire-and-forget): Full scan pipeline triggered by overlay buttons.
//
// Scan pipeline: capture screenshot → (lazy init if needed) → get layout coords for active
// resolution → crop to game window if windowed mode → ML inference → broadcast raw results
// to both windows → hand off to ScanProcessingService for enrichment + overlay:data push.
//
// The lazy-init fallback in ml:scan handles the case where auto-init failed on startup
// but the user activated the overlay anyway. It transparently retries initialization.

const logger = log.scope('ipc-ml')

export function registerMlHandlers(
  mlService: MlService,
  layoutService: LayoutService,
  screenshotService: ScreenshotService,
  windowManager: WindowManager,
  scanProcessingService: ScanProcessingService,
  appStore: AppStore,
  windowTracker: WindowTrackerService,
): void {
  ipcMain.handle('ml:getModelGaps', () => {
    return appStore.getState().mlModelGaps
  })

  ipcMain.handle('ml:init', async () => {
    try {
      appStore.setState({ mlStatus: 'initializing', mlError: null })
      await mlService.initialize()
      appStore.setState({ mlStatus: 'ready', mlError: null })
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('ML init failed', { error: message })
      appStore.setState({ mlStatus: 'error', mlError: message })
      return { success: false, error: message }
    }
  })

  ipcMain.on(
    'ml:scan',
    async (
      _event,
      data: { heroOrder: number; isInitialScan: boolean },
    ) => {
      try {
        // Read resolution from app store (set at overlay activation)
        const resolution = appStore.getState().activeResolution
        if (!resolution) {
          sendScanResults(windowManager, {
            error: 'No active resolution — overlay may not be activated',
          })
          return
        }

        if (!mlService.isReady()) {
          // Lazy init fallback: auto-init may still be in progress or failed
          try {
            appStore.setState({ mlStatus: 'initializing', mlError: null })
            await mlService.initialize()
            appStore.setState({ mlStatus: 'ready', mlError: null })
          } catch (initError) {
            const msg = initError instanceof Error ? initError.message : String(initError)
            logger.error('ML lazy init failed', { error: msg })
            appStore.setState({ mlStatus: 'error', mlError: msg })
            sendScanResults(windowManager, {
              error: 'ML Worker failed to initialize: ' + msg,
            })
            return
          }
        }

        appStore.setState({ mlStatus: 'scanning' })
        let screenshotBuffer = await screenshotService.capture(true)

        const layout = layoutService.getLayout(resolution)
        if (!layout) {
          sendScanResults(windowManager, {
            error: `No layout coordinates for resolution: ${resolution}`,
          })
          appStore.setState({ mlStatus: 'ready' })
          return
        }

        // In windowed mode, crop the full-screen screenshot to the game window
        // so that JSON coordinates (relative to the game window) align correctly
        const gameBounds = windowTracker.getGameWindowPhysicalBounds()
        if (gameBounds) {
          const meta = await sharp(screenshotBuffer).metadata()
          const screenW = meta.width ?? 0
          const screenH = meta.height ?? 0
          if (
            gameBounds.width < screenW ||
            gameBounds.height < screenH
          ) {
            screenshotBuffer = await sharp(screenshotBuffer)
              .extract({
                left: gameBounds.x,
                top: gameBounds.y,
                width: gameBounds.width,
                height: gameBounds.height,
              })
              .toBuffer()
          }
        }

        const result = await mlService.scan(
          screenshotBuffer,
          layout,
          data.isInitialScan,
        )

        appStore.setState({ mlStatus: 'ready' })

        // Broadcast raw results for status/debug display in control panel
        sendScanResults(windowManager, {
          results: result.results,
          isInitialScan: result.isInitialScan,
        })

        // Process and enrich scan results, then broadcast overlay:data
        const scaleFactor = layoutService.getScaleFactor()
        scanProcessingService.handleScanResults(
          result.results as InitialScanResults | ScanResult[],
          result.isInitialScan,
          resolution,
          scaleFactor,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Scan failed', { error: message })
        appStore.setState({ mlStatus: 'ready' })
        sendScanResults(windowManager, { error: message })
      }
    },
  )
}

// @DEV-GUIDE: Broadcasts raw ML results to both windows. Control panel uses this for status/debug
// display. Overlay uses it for scan-in-progress feedback. Separate from overlay:data (enriched).
function sendScanResults(
  windowManager: WindowManager,
  data: {
    error?: string
    results?: unknown
    isInitialScan?: boolean
  },
): void {
  const cp = windowManager.getControlPanelWindow()
  const overlay = windowManager.getOverlayWindow()
  if (cp && !cp.isDestroyed()) {
    cp.webContents.send('ml:scanResults', data)
  }
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send('ml:scanResults', data)
  }
}
