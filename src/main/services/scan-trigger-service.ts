import { screen } from 'electron'
import sharp from 'sharp'
import log from 'electron-log/main'
import { GAME_WINDOW_TITLE } from './window-tracker-service'
import type { MlService } from './ml-service'
import type { DatabaseService } from './database-service'
import type { LayoutService } from './layout-service'
import type { ScreenshotService } from './screenshot-service'
import type { WindowManager } from './window-manager'
import type { ScanProcessingService } from './scan-processing-service'
import type { WindowTrackerService } from './window-tracker-service'
import type { FeedbackService } from './feedback-service'
import type { AppStore } from '../store/app-store'
import type { ScanResult } from '@shared/types'
import type { InitialScanResults } from '@shared/types/ml'

// @DEV-GUIDE: The single scan pipeline, factored out of the ml:scan IPC handler so the
// experimental auto-rescan service can trigger scans WITHOUT round-tripping through the
// overlay renderer (previous flow: globalShortcut -> renderer -> ml:scan -> here).
// Pipeline: capture -> (lazy ML init) -> layout -> crop to game window -> inference ->
// broadcast raw results -> ScanProcessingService enrichment + overlay:data fan-out.
// Hover-tooltip contamination is handled downstream by the scan-processor's rescan
// guard (rejected scans leave state untouched) — the pipeline itself never touches
// the user's mouse. performScan resolves after enrichment is fully dispatched, so
// callers can read the updated DraftStore pool immediately after awaiting it.

const logger = log.scope('scan-trigger')

export interface ScanTriggerService {
  performScan(isInitialScan: boolean): Promise<void>
}

export function createScanTriggerService(
  mlService: MlService,
  layoutService: LayoutService,
  screenshotService: ScreenshotService,
  windowManager: WindowManager,
  scanProcessingService: ScanProcessingService,
  appStore: AppStore,
  windowTracker: WindowTrackerService,
  feedbackService: FeedbackService,
  dbService: DatabaseService,
): ScanTriggerService {
  return {
    async performScan(isInitialScan): Promise<void> {
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

        // Fullscreen/borderless: capture ONLY the game window — far cheaper than a
        // full-display capture session and it leaves the cursor/compositor alone.
        // Windowed mode (game smaller than the display) keeps the screen path,
        // whose crop logic below aligns coordinates to the game client area.
        const primary = screen.getPrimaryDisplay()
        const physicalScreen = {
          width: Math.round(primary.size.width * primary.scaleFactor),
          height: Math.round(primary.size.height * primary.scaleFactor),
        }
        const gameBounds = windowTracker.getGameWindowPhysicalBounds()
        const isFullscreen =
          !gameBounds ||
          (gameBounds.width >= physicalScreen.width &&
            gameBounds.height >= physicalScreen.height)

        let screenshotBuffer: Buffer | null = null
        if (isFullscreen) {
          screenshotBuffer = await screenshotService.captureWindow(
            GAME_WINDOW_TITLE,
            physicalScreen,
          )
        }
        screenshotBuffer ??= await screenshotService.capture()

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

        // DB ability names = classes still in the draft pool. Model classes
        // outside this list (removed abilities kept in the model in case they
        // return) are masked and can never be predicted.
        const result = await mlService.scan(
          screenshotBuffer,
          layout,
          isInitialScan,
          dbService.abilities.getAllNames(),
        )

        appStore.setState({ mlStatus: 'ready' })

        // Remember exactly what the model saw so "Report Failed Recognition"
        // snapshots the misclassified screenshot, not a fresh capture
        feedbackService.recordScanContext({
          screenshot: screenshotBuffer,
          resolution,
          isInitialScan,
          results: result.results,
        })

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
  }
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
