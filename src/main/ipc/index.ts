import { ipcMain, nativeTheme, screen, app, shell, globalShortcut } from 'electron'
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
import type { StreamServerService } from '../services/stream-server-service'
import type { IconCacheService } from '../services/icon-cache-service'
import type { GsiCfgService } from '../services/gsi-cfg-service'
import { registerDatabaseHandlers } from './database-handlers'
import { registerPlayerHandlers } from './player-handlers'
import type { PlayerStatsService } from '../services/player-stats-service'
import { registerMlHandlers } from './ml-handlers'
import { registerDraftHandlers } from './draft-handlers'
import { registerScraperHandlers } from './scraper-handlers'
import { registerResolutionHandlers } from './resolution-handlers'
import { registerFeedbackHandlers } from './feedback-handlers'
import { registerDevHandlers } from './dev-handlers'
import { registerStreamHandlers } from './stream-handlers'
import { loadApiConfig } from '../services/api-config'
import type { FeedbackService } from '../services/feedback-service'
import type { ScanTriggerService } from '../services/scan-trigger-service'
import type { SlotMappingService } from '../services/slot-mapping-service'
import { startDevControlServer } from '../services/dev-control-service'
import type { LayoutSource } from '@shared/types'

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
  streamService: StreamServerService,
  iconCache: IconCacheService,
  gsiCfgService: GsiCfgService,
  feedbackService: FeedbackService,
  scanTrigger: ScanTriggerService,
  slotMappingService: SlotMappingService,
  playerStatsService: PlayerStatsService,
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
  // Exposed as a plain function too (activateOverlay) so the dev-only control server can
  // re-activate the overlay between automated game restarts (diagnostic harness).
  function activateOverlay(): {
    success: boolean
    resolution?: string
    source?: LayoutSource
    error?: string
  } {
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

    // Personalization: refresh the linked profile's stats snapshot if stale
    // (fire-and-forget — a failed/slow fetch must never delay the overlay)
    void playerStatsService.refreshIfStale()

    // Global scan hotkeys, active only while the overlay is open. The overlay never
    // holds keyboard focus (showInactive + click-through), so in-window key handlers
    // can't work — globalShortcut is the only way to trigger a scan from the game.
    const sendHotkey = (action: 'scan' | 'rescan'): void => {
      const win = windowManager.getOverlayWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('overlay:hotkey', { action })
      }
    }
    globalShortcut.register('Control+Shift+S', () => sendHotkey('scan'))
    globalShortcut.register('Control+Shift+R', () => sendHotkey('rescan'))

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
      selectedSpotHeroOrder: null,
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
      globalShortcut.unregister('Control+Shift+S')
      globalShortcut.unregister('Control+Shift+R')
      windowTracker.stopTracking()
      appStore.setState({ overlayActive: false, activeResolution: null, activeResolutionSource: null })
      draftStore.getState().resetSession()
      streamService.onSessionReset()
      slotMappingService.onSessionReset()
      pendingOverlayData = null

      const cp = windowManager.getControlPanelWindow()
      if (cp && !cp.isDestroyed()) {
        cp.restore()
        cp.focus()
      }
    })

    logger.info('Overlay activated with auto-detected resolution', { resolution, source })
    return { success: true, resolution, source }
  }

  ipcMain.handle('overlay:activate', () => activateOverlay())

  // Dev-only loopback control for the diagnostic harness (no-op in packaged builds)
  let scanCount = 0
  startDevControlServer(appStore, {
    activateOverlay,
    performInitialScan: async () => {
      scanCount++
      await scanTrigger.performScan(true)
    },
    getScanCount: () => scanCount,
    isAutoDraftTrackingEnabled: () =>
      dbService.metadata.getSettings().experimentalAutoDraftTracking === true,
  })

  ipcMain.on('overlay:close', () => {
    windowTracker.stopTracking()
    windowManager.closeOverlay()
    appStore.setState({ overlayActive: false, activeResolution: null, activeResolutionSource: null })
  })

  // Overlay Reset button: clear the main-process draft session (pool caches + selections).
  // Without this, a Reset followed by a Rescan diffs against the previous draft's pool.
  ipcMain.on('overlay:reset', () => {
    draftStore.getState().resetSession()
    streamService.onSessionReset()
    slotMappingService.onSessionReset()
  })

  ipcMain.on(
    'overlay:setMouseIgnore',
    (_event, data: { ignore: boolean; forward?: boolean }) => {
      windowManager.setOverlayMouseEvents(data.ignore, data.forward ?? true)
    },
  )

  // Database domain (hero, ability, settings, backup)
  registerDatabaseHandlers(dbService, backupService)

  // Linked Windrun profile (personalized suggestions)
  registerPlayerHandlers(playerStatsService)

  // API config is shared by the resolution and feedback domains
  const apiConfig = loadApiConfig()

  // Feedback domain (Report Failed Recognition → export/upload samples).
  // The service itself is created in main/index.ts (shared with ScanTriggerService).
  registerFeedbackHandlers(feedbackService, windowManager)

  // ML domain
  registerMlHandlers(mlService, windowManager, scanTrigger, appStore, dbService)

  // Draft domain (My Spot, My Model)
  registerDraftHandlers(draftStore, windowManager)

  // Scraper domain
  registerScraperHandlers(scraperService)

  // Streamer view domain
  registerStreamHandlers(streamService, dbService, iconCache, gsiCfgService, windowManager)

  // Resolution domain
  registerResolutionHandlers(layoutService, screenshotService, windowTracker, windowManager, apiConfig)

  // Dev-only ML pipeline cockpit (gather/upload/retrain shortcuts)
  if (!app.isPackaged) {
    registerDevHandlers(appStore, dbService)
  }

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
