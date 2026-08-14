import { screen } from 'electron'
import sharp from 'sharp'
import log from 'electron-log/main'
import { GAME_WINDOW_TITLE } from './window-tracker-service'
import type { MlService } from './ml-service'
import type { DatabaseService } from './database-service'
import type { LayoutService } from './layout-service'
import type { ScreenshotService } from './screenshot-service'
import type { CachedWindowCaptureService } from './cached-window-capture-service'
import type { DecodedScreenshot } from '@core/ml/preprocessing'
import type { WindowManager } from './window-manager'
import type { ScanProcessingService } from './scan-processing-service'
import type { WindowTrackerService } from './window-tracker-service'
import type { FeedbackService } from './feedback-service'
import type { IconCacheService } from './icon-cache-service'
import type { AppStore } from '../store/app-store'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { ScanResult } from '@shared/types'
import type { InitialScanResults } from '@shared/types/ml'

// @DEV-GUIDE: The single scan pipeline, factored out of the ml:scan IPC handler so the
// experimental auto-rescan service can trigger scans WITHOUT round-tripping through the
// overlay renderer (previous flow: globalShortcut -> renderer -> ml:scan -> here).
// Pipeline: capture (raw RGB, no PNG round-trip) -> (lazy ML init) -> layout -> crop to
// game window -> inference -> broadcast raw results -> ScanProcessingService enrichment
// + overlay:data fan-out.
// Hover-tooltip contamination is handled downstream by the scan-processor's rescan
// guard (rejected scans leave state untouched) — the pipeline itself never touches
// the user's mouse. performScan resolves after enrichment is fully dispatched, so
// callers can read the updated DraftStore pool immediately after awaiting it.
// Pick-slot template matching support: rescans pass the draft's candidate names
// (pool + picked, from DraftStore) to scope icon matching, and each initial scan
// prefetches the pool's official icons so the worker's template set is warm
// before the first pick — independent of the streamer view.

const logger = log.scope('scan-trigger')

export interface ScanTriggerService {
  /**
   * @param options.heroOrders Rescan only: restrict the selected-abilities
   * scan to these player rows (targeted auto-rescan). Omitted → all rows.
   */
  performScan(
    isInitialScan: boolean,
    options?: { heroOrders?: number[] },
  ): Promise<void>
}

export function createScanTriggerService(
  mlService: MlService,
  layoutService: LayoutService,
  screenshotService: ScreenshotService,
  cachedWindowCapture: CachedWindowCaptureService,
  windowManager: WindowManager,
  scanProcessingService: ScanProcessingService,
  appStore: AppStore,
  windowTracker: WindowTrackerService,
  feedbackService: FeedbackService,
  dbService: DatabaseService,
  draftStore: StoreApi<DraftStore>,
  iconCache: IconCacheService,
): ScanTriggerService {
  // Pick-slot template-matching candidates: the draft can only contain the
  // initial pool plus names already picked (the pool cache removes picked
  // names, so the union reconstructs the original 48). Empty before the first
  // initial scan → the worker matches against every cached icon instead.
  function getPickCandidateNames(): string[] {
    const state = draftStore.getState()
    const names = new Set<string>()
    for (const slot of state.initialPoolAbilitiesCache.ultimates) {
      if (slot.name) names.add(slot.name)
    }
    for (const slot of state.initialPoolAbilitiesCache.standard) {
      if (slot.name) names.add(slot.name)
    }
    for (const slot of state.selectedAbilitiesCache) {
      if (slot.name) names.add(slot.name)
    }
    return [...names]
  }

  return {
    async performScan(isInitialScan, options): Promise<void> {
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

        // Capture cascade: cached-source frame grab (persistent renderer
        // stream, ~10-50ms) -> per-scan getSources window capture (~1s) ->
        // full-display capture. Each step returns null to hand off downward.
        let screenshot: DecodedScreenshot | null = null
        if (isFullscreen) {
          screenshot = await cachedWindowCapture.captureFrame(
            GAME_WINDOW_TITLE,
            physicalScreen,
          )
          screenshot ??= await screenshotService.captureWindow(
            GAME_WINDOW_TITLE,
            physicalScreen,
          )
        }
        screenshot ??= await screenshotService.capture()

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
        if (
          gameBounds &&
          (gameBounds.width < screenshot.width ||
            gameBounds.height < screenshot.height)
        ) {
          const cropped = await sharp(screenshot.data, {
            raw: {
              width: screenshot.width,
              height: screenshot.height,
              channels: 3,
            },
          })
            .extract({
              left: gameBounds.x,
              top: gameBounds.y,
              width: gameBounds.width,
              height: gameBounds.height,
            })
            .raw()
            .toBuffer()
          screenshot = {
            data: cropped,
            width: gameBounds.width,
            height: gameBounds.height,
          }
        }

        // DB ability names = classes still in the draft pool. Model classes
        // outside this list (removed abilities kept in the model in case they
        // return) are masked and can never be predicted.
        const result = await mlService.scan(
          screenshot,
          layout,
          isInitialScan,
          dbService.abilities.getAllNames(),
          isInitialScan ? undefined : options?.heroOrders,
          isInitialScan ? undefined : getPickCandidateNames(),
        )

        appStore.setState({ mlStatus: 'ready' })

        // Remember exactly what the model saw so "Report Failed Recognition"
        // snapshots the misclassified screenshot, not a fresh capture
        // (raw bitmap; the feedback service PNG-encodes lazily on report)
        feedbackService.recordScanContext({
          screenshot,
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
          result.modelTiles?.map((t) => ({
            heroOrder: t.heroOrder,
            tile: new Uint8Array(t.tile),
          })),
          result.playerCardTiles?.map((t) => ({
            row: t.row,
            tile: new Uint8Array(t.tile),
          })),
        )

        // Warm the icon cache for the recognized pool so pick-slot template
        // matching has its candidates before the first pick lands — even with
        // the streamer view (the cache's other consumer) turned off.
        // Fire-and-forget: rescans fall back to the classifier until icons land.
        if (isInitialScan) {
          const poolNames = getPickCandidateNames()
          if (poolNames.length > 0) {
            void iconCache.prefetchAbilities(poolNames).catch((error) => {
              logger.warn('Pool icon prefetch failed', {
                error: error instanceof Error ? error.message : String(error),
              })
            })
          }
        }
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
