import { ipcMain, nativeTheme, screen, app, shell } from 'electron'
import log from 'electron-log/main'
import type { WindowManager } from '../services/window-manager'
import type { DatabaseService } from '../services/database-service'
import type { BackupService } from '../services/backup-service'
import type { MlService } from '../services/ml-service'
import type { LayoutService } from '../services/layout-service'
import type { ScreenshotService } from '../services/screenshot-service'
import type { ScanProcessingService } from '../services/scan-processing-service'
import type { WindowTrackerService } from '../services/window-tracker-service'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { AppStore } from '../store/app-store'
import type { ZustandBridge } from '@zubridge/electron/main'
import type { UpdateService } from '../services/update-service'
import type { ScraperService } from '../services/scraper-service'
import { registerDatabaseHandlers } from './database-handlers'
import { registerMlHandlers } from './ml-handlers'
import { registerDraftHandlers } from './draft-handlers'
import { registerScraperHandlers } from './scraper-handlers'
import { registerResolutionHandlers } from './resolution-handlers'
import { loadApiConfig } from '../services/api-config'

// @DEV-GUIDE: Central IPC handler registration. All renderer↔main communication goes through
// typed IPC channels following the domain:action naming convention (e.g. 'ml:scan', 'hero:getAll').
//
// Two IPC patterns are used:
// - ipcMain.handle(channel, handler) → renderer invokes with ipcRenderer.invoke() → returns Promise
// - ipcMain.on(channel, handler) → renderer sends with ipcRenderer.send() → fire-and-forget
//
// Handlers are split into domain-grouped files for maintainability:
// - database-handlers: hero, ability, settings, backup CRUD
// - ml-handlers: ML init, scan (screenshot → ML → scan processing → overlay:data)
// - draft-handlers: My Spot / My Model selection (broadcast to both windows)
// - scraper-handlers: Windrun + Liquipedia scrape triggers
// - resolution-handlers: layout CRUD, calibration, screenshot capture/submit
//
// This file handles: app domain (version, system info, theme), overlay domain (activate/close/
// mouse events), and update domain (check/download/install). The overlay:activate handler
// is the most complex -- see its inline comment below.

const logger = log.scope('ipc')

export function registerIpcHandlers(
  windowManager: WindowManager,
  dbService: DatabaseService,
  backupService: BackupService,
  mlService: MlService,
  layoutService: LayoutService,
  screenshotService: ScreenshotService,
  draftStore: StoreApi<DraftStore>,
  scanProcessingService: ScanProcessingService,
  appStore: AppStore,
  bridge: ZustandBridge,
  updateService: UpdateService,
  windowTracker: WindowTrackerService,
  scraperService: ScraperService,
): void {
  logger.info('Registering IPC handlers...')

  // App domain
  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('app:isPackaged', () => app.isPackaged)

  ipcMain.handle('app:getSystemInfo', () => {
    const primaryDisplay = screen.getPrimaryDisplay()
    return {
      width: primaryDisplay.size.width,
      height: primaryDisplay.size.height,
      scaleFactor: primaryDisplay.scaleFactor,
      resolutionString: `${primaryDisplay.size.width}x${primaryDisplay.size.height}`,
    }
  })

  ipcMain.handle('theme:get', () => ({
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  }))

  ipcMain.on('app:openExternal', (_event, data: { url: string }) => {
    try {
      const url = new URL(data.url)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        shell.openExternal(data.url)
      } else {
        logger.warn('Blocked opening non-HTTP URL', { url: data.url })
      }
    } catch {
      logger.warn('Invalid URL', { url: data.url })
    }
  })

  // Overlay domain
  let pendingOverlayData: import('@shared/types').OverlayDataPayload | null = null

  // Renderer calls this on mount to get initial data (avoids did-finish-load race)
  ipcMain.handle('overlay:getInitialData', () => pendingOverlayData)

  // @DEV-GUIDE: Overlay activation is the most complex IPC handler. Sequence:
  // 1. Auto-detect resolution from game window (physical bounds) or primary display
  // 2. Look up layout coordinates via layout service cascade (custom → preset → auto-scale)
  // 3. Minimize control panel, create overlay window, subscribe to @zubridge
  // 4. Store initial overlay data (pendingOverlayData) for the renderer to fetch on mount
  // 5. Start window tracking (polls game window every 2s for windowed-mode repositioning)
  // 6. Listen to overlay 'closed' event to clean up state (tracker, appStore, pendingData)
  //
  // The pendingOverlayData pattern avoids a race: overlay renderer mounts asynchronously,
  // so overlay:getInitialData lets it pull data when ready instead of relying on did-finish-load.
  ipcMain.handle('overlay:activate', () => {
    // Auto-detect resolution from game window or primary display
    const primaryDisplay = screen.getPrimaryDisplay()
    const gameBounds = windowTracker.getGameWindowPhysicalBounds()
    const resolution = gameBounds
      ? `${gameBounds.width}x${gameBounds.height}`
      : `${Math.round(primaryDisplay.size.width * primaryDisplay.scaleFactor)}x${Math.round(primaryDisplay.size.height * primaryDisplay.scaleFactor)}`

    const source = layoutService.getLayoutSource(resolution)
    const coords = layoutService.getLayout(resolution)

    if (!coords) {
      logger.warn('No layout coordinates for auto-detected resolution', { resolution, source })
      return { success: false, error: `Unsupported resolution: ${resolution}. No layout coordinates available.` }
    }

    const controlPanel = windowManager.getControlPanelWindow()
    if (controlPanel && !controlPanel.isDestroyed()) {
      controlPanel.minimize()
    }

    const overlayWin = windowManager.createOverlayWindow()
    bridge.subscribe([overlayWin])
    appStore.setState({ overlayActive: true, activeResolution: resolution, activeResolutionSource: source })

    // Store initial setup data so the renderer can request it after mounting
    const scaleFactor = layoutService.getScaleFactor()
    pendingOverlayData = {
      initialSetup: true,
      scanData: null,
      targetResolution: resolution,
      scaleFactor,
      opCombinations: [],
      trapCombinations: [],
      heroSynergies: [],
      heroTraps: [],
      heroModels: [],
      heroesForMySpotUI: [],
      selectedHeroForDraftingDbId: null,
      selectedModelHeroOrder: null,
      heroesCoords: coords.heroes_coords ?? [],
      heroesParams: coords.heroes_params ?? { width: 0, height: 0 },
      modelsCoords: coords.models_coords ?? [],
    }

    // Auto-detect game window and reposition overlay for windowed mode
    const displayBounds = primaryDisplay.bounds

    windowTracker.startTracking((trackBounds) => {
      if (trackBounds && (
        trackBounds.width < displayBounds.width ||
        trackBounds.height < displayBounds.height
      )) {
        // Game window is smaller than display → windowed mode
        windowManager.repositionOverlay(trackBounds)
      } else {
        // Fullscreen/borderless or game not found → use full display
        windowManager.repositionOverlay(displayBounds)
      }
    })

    // Reset state when overlay window closes for any reason (user close, crash, etc.)
    overlayWin.on('closed', () => {
      windowTracker.stopTracking()
      appStore.setState({ overlayActive: false, activeResolution: null, activeResolutionSource: null })
      pendingOverlayData = null

      const cp = windowManager.getControlPanelWindow()
      if (cp && !cp.isDestroyed()) {
        cp.restore()
        cp.focus()
      }
    })

    logger.info('Overlay activated with auto-detected resolution', { resolution, source })
    return { success: true, resolution, source }
  })

  ipcMain.on('overlay:close', () => {
    windowTracker.stopTracking()
    windowManager.closeOverlay()
    appStore.setState({ overlayActive: false, activeResolution: null, activeResolutionSource: null })
  })

  ipcMain.on(
    'overlay:setMouseIgnore',
    (_event, data: { ignore: boolean; forward?: boolean }) => {
      windowManager.setOverlayMouseEvents(data.ignore, data.forward ?? true)
    },
  )

  // Database domain (hero, ability, settings, backup)
  registerDatabaseHandlers(dbService, backupService)

  // ML domain
  registerMlHandlers(
    mlService,
    layoutService,
    screenshotService,
    windowManager,
    scanProcessingService,
    appStore,
    windowTracker,
  )

  // Draft domain (My Spot, My Model)
  registerDraftHandlers(draftStore, windowManager)

  // Scraper domain
  registerScraperHandlers(scraperService)

  // Resolution domain
  const apiConfig = loadApiConfig()
  registerResolutionHandlers(layoutService, screenshotService, windowTracker, windowManager, apiConfig)

  // Update domain
  ipcMain.on('app:checkUpdate', () => {
    updateService.checkForUpdates()
  })

  ipcMain.on('app:downloadUpdate', () => {
    updateService.downloadUpdate()
  })

  ipcMain.on('app:installUpdate', () => {
    updateService.installUpdate()
  })

  logger.info('IPC handlers registered')
}
