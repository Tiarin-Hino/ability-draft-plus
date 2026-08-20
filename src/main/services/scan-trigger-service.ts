import { screen, app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
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
import type { OcrService } from './ocr-service'
import type { AppStore } from '../store/app-store'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { ScanResult, SlotCoordinate } from '@shared/types'
import {
  mergeRetriedPoolSlots,
  unresolvedPoolSlots,
} from '@core/domain/pool-retry'
import { POOL_RETRY_MAX_ATTEMPTS } from '@shared/constants/thresholds'
import type { InitialScanResults, PickCandidates } from '@shared/types/ml'

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
// Pool retry: the pool is scanned ONCE, so a slot the classifier could not read
// stays Unknown all draft AND its pick box becomes unmatchable (scoping). Every
// rescan therefore re-reads the still-Unknown pool slots (bounded by
// POOL_RETRY_MAX_ATTEMPTS) and merges whatever resolves — see core/domain/pool-retry.ts.

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
  ocrService: OcrService,
): ScanTriggerService {
  // Pick-slot template-matching candidates, split by pick-box type: a standard
  // box can only contain one of the pool's 36 standard abilities, the ultimate
  // box one of its 12 ultimates.
  //
  // These sets only ever GROW within a draft (cleared on each initial scan).
  // Deriving them fresh from the caches each time was a real bug: the pool
  // cache DROPS a name once it is picked, so the name survives only in
  // selectedAbilitiesCache — and a single transient bad read of that box (the
  // game briefly redraws it, the slot reads EMPTY) evicted it from there too.
  // The name was then in NEITHER set, so the matcher could never propose it
  // again and the slot stayed Unknown for the rest of the draft, scoring an
  // identical wrong-best every scan. Observed 2026-08-19: bristleback_warpath
  // matched at 0.460, blinked empty, then sat at 0.429/centaur_stampede for 5
  // straight scans while an unrestricted match scored warpath at 0.979.
  const candidateStandard = new Set<string>()
  const candidateUltimates = new Set<string>()

  // Pool slots that read Unknown are re-classified on later scans (pool art is
  // static until drafted). Attempts are counted per slot so an unreadable slot
  // cannot re-crop for the whole draft.
  const poolRetryAttempts = new Map<string, number>()

  function getRetryPoolSlots(): SlotCoordinate[] {
    const unresolved = unresolvedPoolSlots(
      draftStore.getState().initialPoolAbilitiesCache,
    )
    const slots: SlotCoordinate[] = []
    for (const slot of unresolved) {
      const key = `${slot.coord.x},${slot.coord.y}`
      const tries = poolRetryAttempts.get(key) ?? 0
      if (tries >= POOL_RETRY_MAX_ATTEMPTS) continue
      poolRetryAttempts.set(key, tries + 1)
      slots.push({ ...slot.coord, ability_order: slot.ability_order, is_ultimate: slot.is_ultimate })
    }
    return slots
  }

  function mergePoolRetry(results: ScanResult[] | undefined): void {
    if (!results || results.length === 0) return
    const state = draftStore.getState()
    const { cache, resolved } = mergeRetriedPoolSlots(
      state.initialPoolAbilitiesCache,
      results,
    )
    if (resolved.length === 0) return
    draftStore.setState({ initialPoolAbilitiesCache: cache })
    // Newly known pool names are immediately valid pick candidates
    for (const slot of cache.ultimates) if (slot.name) candidateUltimates.add(slot.name)
    for (const slot of cache.standard) if (slot.name) candidateStandard.add(slot.name)
    logger.info('Recovered pool slots on retry', { resolved })
    void iconCache.prefetchAbilities(resolved).catch(() => undefined)
  }

  function getPickCandidates(): PickCandidates {
    const state = draftStore.getState()
    for (const slot of state.initialPoolAbilitiesCache.ultimates) {
      if (slot.name) candidateUltimates.add(slot.name)
    }
    for (const slot of state.initialPoolAbilitiesCache.standard) {
      if (slot.name) candidateStandard.add(slot.name)
    }
    for (const slot of state.selectedAbilitiesCache) {
      if (slot.name) {
        ;(slot.is_ultimate ? candidateUltimates : candidateStandard).add(slot.name)
      }
    }
    return { standard: [...candidateStandard], ultimates: [...candidateUltimates] }
  }

  // Dev-only per-scan diagnostic recorder: one JSONL line per scan with the
  // full recognition picture (slot results incl. rejections, model-tile
  // matches, OCR reads). The diagnostic harness's analyzer joins these with
  // the lobby's known ground truth. Fire-and-forget; never fails a scan.
  const diagnosticsPath = app.isPackaged
    ? null
    : join(
        app.getPath('userData'),
        'debug',
        'scan-diagnostics',
        `session-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
      )
  let diagnosticsDirReady = false
  function recordScanDiagnostics(entry: Record<string, unknown>): void {
    if (diagnosticsPath === null) return
    void (async () => {
      try {
        if (!diagnosticsDirReady) {
          await fs.mkdir(join(diagnosticsPath, '..'), { recursive: true })
          diagnosticsDirReady = true
        }
        await fs.appendFile(diagnosticsPath, JSON.stringify(entry) + '\n')
      } catch {
        // Diagnostics must never break scanning
      }
    })()
  }

  return {
    async performScan(isInitialScan, options): Promise<void> {
      try {
        // A new draft starts at the initial scan — drop the previous draft's
        // pick candidates before they leak into this one
        if (isInitialScan) {
          candidateStandard.clear()
          candidateUltimates.clear()
          poolRetryAttempts.clear()
        }
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
          isInitialScan ? undefined : getPickCandidates(),
          isInitialScan ? undefined : getRetryPoolSlots(),
        )

        appStore.setState({ mlStatus: 'ready' })

        // A rejected pick-slot template match renders as Unknown with no trace
        // of what nearly matched — log the score/margin so a live miss (e.g. a
        // stale cached icon after a Valve art rework) is diagnosable afterwards.
        if (!isInitialScan && Array.isArray(result.results)) {
          for (const slot of result.results as ScanResult[]) {
            if (slot.rejectedMatch) {
              logger.warn('Pick slot template match rejected', {
                heroOrder: slot.hero_order,
                slot: `x${slot.coord.x}y${slot.coord.y}${slot.is_ultimate ? ' ult' : ''}`,
                bestName: slot.rejectedMatch.bestName,
                secondName: slot.rejectedMatch.secondName,
                score: Number(slot.confidence.toFixed(4)),
                margin:
                  slot.rejectedMatch.margin === null
                    ? null
                    : Number(slot.rejectedMatch.margin.toFixed(4)),
              })
            }
          }
        }

        // Pool slots recovered by the retry pass feed straight back into the
        // pool cache (and therefore into the pick candidates)
        mergePoolRetry(result.poolRetryResults)

        // Hero-name OCR: a new draft resets per-row state; every scan's name
        // strips queue for recognition (per-row gating keeps this cheap)
        if (isInitialScan) ocrService.reset()
        if (result.nameStrips) ocrService.processStrips(result.nameStrips)

        // Model-tile identification (reference library) — log resolved tiles;
        // consumed by diagnostics and compared against W-slot identification
        if (result.modelTileMatches) {
          const resolved = result.modelTileMatches.filter((m) => m.name !== null)
          if (resolved.length > 0) {
            logger.info('Model tiles identified (reference match)', {
              tiles: resolved.map(
                (m) => `${m.heroOrder}:${m.name} (${m.score.toFixed(3)})`,
              ),
            })
          }
        }

        recordScanDiagnostics({
          ts: new Date().toISOString(),
          isInitialScan,
          heroOrders: options?.heroOrders ?? null,
          results: result.results,
          poolRetryResults: result.poolRetryResults ?? null,
          modelTileMatches: result.modelTileMatches ?? null,
          ocrHeroNamesByRow: draftStore.getState().ocrHeroNamesByRow,
        })

        // Remember exactly what the model saw so "Report Failed Recognition"
        // snapshots the misclassified screenshot, not a fresh capture
        // (raw bitmap; the feedback service PNG-encodes lazily on report).
        // The feedback service ignores targeted rescans — only full-board
        // scans are worth reporting, and a row-restricted result set would
        // clobber the snapshot the user actually saw fail.
        feedbackService.recordScanContext({
          screenshot,
          resolution,
          isInitialScan,
          targetedRows: isInitialScan ? undefined : options?.heroOrders,
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
          const candidates = getPickCandidates()
          const poolNames = [...candidates.standard, ...candidates.ultimates]
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
