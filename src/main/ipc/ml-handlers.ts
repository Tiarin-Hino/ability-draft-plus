import { ipcMain, dialog, app } from 'electron'
import { writeFile } from 'fs/promises'
import sharp from 'sharp'
import log from 'electron-log/main'
import type { MlService } from '../services/ml-service'
import type { DatabaseService } from '../services/database-service'
import type { LayoutService } from '../services/layout-service'
import type { ScreenshotService } from '../services/screenshot-service'
import type { WindowManager } from '../services/window-manager'
import type { ScanProcessingService } from '../services/scan-processing-service'
import type { WindowTrackerService } from '../services/window-tracker-service'
import type { FeedbackService } from '../services/feedback-service'
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

export interface ModelGapsPayload {
  generatedAt: string
  appVersion: string
  staleInModel: string[]
  missing: Array<{
    ability: string
    hero: string | null
    heroDisplayName: string | null
    isUltimate: boolean | null
    abilityOrder: number | null
  }>
}

/** Gap list + hero mapping from the DB, or null when the model has no gaps. */
export function buildModelGapsPayload(
  appStore: AppStore,
  dbService: DatabaseService,
): ModelGapsPayload | null {
  const gaps = appStore.getState().mlModelGaps
  if (!gaps || gaps.missingFromModel.length === 0) {
    return null
  }

  const abilityByName = new Map(dbService.abilities.getAll().map((a) => [a.name, a]))
  const heroes = dbService.heroes.getAll()
  const heroById = new Map(heroes.map((h) => [h.heroId, h]))
  // Longest-first so 'dragon_knight_...' matches dragon_knight, never a shorter hero
  const heroesByNameLength = [...heroes].sort((a, b) => b.name.length - a.name.length)

  const missing = gaps.missingFromModel.map((abilityName) => {
    const ability = abilityByName.get(abilityName)
    // Fresh Windrun data for brand-new abilities may lack the hero_id linkage —
    // fall back to prefix matching, since ability internal names are always
    // prefixed with the hero's internal name.
    const hero =
      (ability ? heroById.get(ability.heroId) : undefined) ??
      heroesByNameLength.find((h) => abilityName.startsWith(h.name + '_'))
    // Windrun-scraped rows default to abilityOrder 0 / isUltimate false, which is
    // NOT real slot data (0 is the ultimate slot; standard slots are 1-3). Only
    // export the combo when it is internally consistent, so the gather script
    // falls back to Liquipedia instead of trusting junk defaults.
    const order = ability?.abilityOrder ?? null
    const isUlt = ability?.isUltimate ?? null
    const slotValid =
      isUlt !== null &&
      order !== null &&
      ((isUlt && order === 0) || (!isUlt && order >= 1 && order <= 3))
    return {
      ability: abilityName,
      hero: hero?.name ?? null,
      heroDisplayName: hero?.displayName ?? null,
      isUltimate: slotValid ? isUlt : null,
      abilityOrder: slotValid ? order : null,
    }
  })

  return {
    generatedAt: gaps.detectedAt,
    appVersion: app.getVersion(),
    staleInModel: gaps.staleInModel,
    missing,
  }
}

export function registerMlHandlers(
  mlService: MlService,
  layoutService: LayoutService,
  screenshotService: ScreenshotService,
  windowManager: WindowManager,
  scanProcessingService: ScanProcessingService,
  appStore: AppStore,
  windowTracker: WindowTrackerService,
  feedbackService: FeedbackService,
  dbService: DatabaseService,
): void {
  ipcMain.handle('ml:getModelGaps', () => {
    return appStore.getState().mlModelGaps
  })

  // Exports the staleness-detector gap list (with hero mapping from the DB) as JSON
  // for the training-data gather script — closes the loop between "the app knows
  // which abilities the model can't recognize" and "collect data for exactly those".
  ipcMain.handle('ml:exportModelGaps', async () => {
    const payload = buildModelGapsPayload(appStore, dbService)
    if (!payload) {
      return { success: false, error: 'no-gaps' }
    }

    try {
      const cp = windowManager.getControlPanelWindow()
      const options: Electron.SaveDialogOptions = {
        defaultPath: 'model-gaps.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      }
      const result = cp && !cp.isDestroyed()
        ? await dialog.showSaveDialog(cp, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) {
        return { success: false, error: 'cancelled' }
      }

      await writeFile(result.filePath, JSON.stringify(payload, null, 2))

      const count = payload.missing.length
      logger.info('Model gaps exported', { path: result.filePath, count })
      return { success: true, path: result.filePath, count }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Model gaps export failed', { error: message })
      return { success: false, error: message }
    }
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
        let screenshotBuffer = await screenshotService.capture()

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

        // DB ability names = classes still in the draft pool. Model classes
        // outside this list (removed abilities kept in the model in case they
        // return) are masked and can never be predicted.
        const result = await mlService.scan(
          screenshotBuffer,
          layout,
          data.isInitialScan,
          dbService.abilities.getAllNames(),
        )

        appStore.setState({ mlStatus: 'ready' })

        // Remember exactly what the model saw so "Report Failed Recognition"
        // snapshots the misclassified screenshot, not a fresh capture
        feedbackService.recordScanContext({
          screenshot: screenshotBuffer,
          resolution,
          isInitialScan: data.isInitialScan,
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
