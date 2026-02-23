import { app, nativeTheme } from 'electron'
import log from 'electron-log/main'
import { createZustandBridge } from '@zubridge/electron/main'
import { createWindowManager } from './services/window-manager'
import { createDatabaseService } from './services/database-service'
import { createBackupService } from './services/backup-service'
import { createMlService } from './services/ml-service'
import { createLayoutService } from './services/layout-service'
import { createScreenshotService } from './services/screenshot-service'
import { createScanProcessingService } from './services/scan-processing-service'
import { createUpdateService } from './services/update-service'
import { createWindowTrackerService } from './services/window-tracker-service'
import { createScraperService } from './services/scraper-service'
import { createSentryService } from './services/sentry-service'
import { loadSentryDsn } from './services/api-config'
import { createDraftStore } from './store/draft-store'
import { createAppStore, createAppStoreHandlers } from './store/app-store'
import { registerIpcHandlers } from './ipc'
import { APP_ID } from '@shared/constants/defaults'

// @DEV-GUIDE: Electron main process entry point. Orchestrates the full application lifecycle.
// Startup sequence: logging → error handlers → Sentry → database (sql.js in-memory) → backup →
// create services (window manager, ML, layout, screenshot, scraper, window tracker, updater) →
// Zustand AppStore + @zubridge bridge → load persisted settings → register IPC handlers →
// create control panel window → subscribe to @zubridge → auto-init ML worker (non-blocking).
//
// Two state systems coexist:
// - AppStore (@zubridge): Reactive UI state synced to both renderers automatically.
//   Renderers use useAppStore() hook, main uses appStore.setState().
// - DraftStore (Zustand vanilla, main-only): Ephemeral draft session state (ability caches,
//   hero models, user selections). Not synced to renderers -- accessed via IPC when needed.
//
// Services use factory pattern (createXxxService) returning interfaces for testability.
// The main process owns all services; renderers communicate only via typed IPC.

// Initialize logging early
log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = 'debug'
log.transports.file.maxSize = 10 * 1024 * 1024 // 10MB

const logger = log.scope('main')

// Sentry reference for global error handlers (initialized lazily in app.whenReady)
let sentryRef: import('./services/sentry-service').SentryService | null = null

// @DEV-GUIDE: Global error handlers are registered BEFORE app.whenReady() so they catch
// crashes during early startup. Sentry is initialized lazily inside whenReady(), so
// sentryRef is null during the earliest phase. Errors are always logged first.
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack })
  sentryRef?.captureException(error, { context: 'uncaughtException' })
})

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason))
  logger.error('Unhandled rejection', { message: error.message, stack: error.stack })
  sentryRef?.captureException(error, { context: 'unhandledRejection' })
})

app.whenReady().then(async () => {
  logger.info('=== Ability Draft Plus v2 Starting ===')
  logger.info(`Version: ${app.getVersion()}`)
  logger.info(`Platform: ${process.platform} ${process.arch}`)
  logger.info(`Electron: ${process.versions.electron}`)
  logger.info(`Chrome: ${process.versions.chrome}`)
  logger.info(`Node: ${process.versions.node}`)
  logger.info(`Packaged: ${app.isPackaged}`)
  logger.info(`User data: ${app.getPath('userData')}`)

  app.setAppUserModelId(APP_ID)

  // Initialize Sentry crash reporting (no-op if DSN not configured)
  const sentryDsn = loadSentryDsn()
  const sentryService = createSentryService(sentryDsn)
  sentryRef = sentryService

  // DevTools shortcut (F12) in development only
  if (!app.isPackaged) {
    app.on('browser-window-created', (_, window) => {
      window.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12') {
          if (window.webContents.isDevToolsOpened()) {
            window.webContents.closeDevTools()
          } else {
            window.webContents.openDevTools()
          }
          event.preventDefault()
        }
      })
    })
  }

  // @DEV-GUIDE: Database must initialize first — it loads the sql.js WASM engine, opens the
  // .db file into memory, runs schema creation (IF NOT EXISTS), and creates all repositories.
  // Everything downstream (settings, backup, scraper, scan processing) depends on it.
  const dbService = createDatabaseService()
  await dbService.initialize()
  sentryService.addBreadcrumb('Database initialized', 'db')

  // Create backup service
  const backupService = createBackupService(
    () => dbService.getDbPath(),
    (data) => dbService.reload(data),
  )

  // Create startup backup (skip on first run -- no meaningful data yet)
  if (!dbService.isFirstRun()) {
    await backupService.createBackup('startup')
  }

  // @DEV-GUIDE: All services are created here with factory functions. Each returns an interface
  // for loose coupling. ScanProcessingService depends on DraftStore + DB + Layout + WindowManager
  // because it bridges ML scan results with the overlay UI (enriches raw detections with DB data).
  const windowManager = createWindowManager()
  const mlService = createMlService()
  const layoutService = createLayoutService()
  const screenshotService = createScreenshotService()
  const draftStore = createDraftStore()
  const scanProcessingService = createScanProcessingService(
    draftStore,
    dbService,
    layoutService,
    windowManager,
  )

  // @DEV-GUIDE: @zubridge bridge wires the Zustand AppStore in main to all subscribed
  // BrowserWindows. When main calls appStore.setState(), the bridge serializes the delta
  // and pushes it to renderers via IPC. Renderers dispatch actions that the bridge routes
  // to the appHandlers map (see app-store.ts). The bridge is the single source of truth.
  const appStore = createAppStore()
  const appHandlers = createAppStoreHandlers(appStore)
  const bridge = createZustandBridge(appStore, { handlers: appHandlers })

  // Initialize app store from persisted settings
  const settings = dbService.metadata.getSettings()
  const resolvedThemeMode = settings.themeMode ?? 'system'
  nativeTheme.themeSource = resolvedThemeMode
  appStore.setState({
    themeMode: resolvedThemeMode,
    resolvedDarkMode: nativeTheme.shouldUseDarkColors,
    language: (settings.language as 'en' | 'ru') ?? 'en',
  })

  // Sync nativeTheme changes to app store
  nativeTheme.on('updated', () => {
    appStore.setState({ resolvedDarkMode: nativeTheme.shouldUseDarkColors })
  })

  // Sync app store changes to nativeTheme + persist to database
  let prevThemeMode = appStore.getState().themeMode
  let prevLanguage = appStore.getState().language
  appStore.subscribe((state) => {
    if (nativeTheme.themeSource !== state.themeMode) {
      nativeTheme.themeSource = state.themeMode
      // Immediately sync resolved dark mode (don't rely solely on async 'updated' event)
      const resolved = nativeTheme.shouldUseDarkColors
      if (state.resolvedDarkMode !== resolved) {
        appStore.setState({ resolvedDarkMode: resolved })
      }
    }
    if (state.themeMode !== prevThemeMode) {
      prevThemeMode = state.themeMode
      dbService.metadata.setSettings({ themeMode: state.themeMode })
      dbService.persist()
    }
    if (state.language !== prevLanguage) {
      prevLanguage = state.language
      dbService.metadata.setSettings({ language: state.language })
      dbService.persist()
    }
  })

  // Create update service (wires autoUpdater events to appStore + IPC)
  const updateService = createUpdateService(appStore, windowManager)
  const windowTracker = createWindowTrackerService()
  const scraperService = createScraperService(dbService, appStore)

  // Load last scrape date + persisted model gaps into app store
  const lastScrapeDate = dbService.metadata.getLastScrapeDate()
  if (lastScrapeDate) {
    appStore.setState({ scraperLastUpdated: lastScrapeDate })
  }
  scraperService.restorePersistedState()

  registerIpcHandlers(
    windowManager,
    dbService,
    backupService,
    mlService,
    layoutService,
    screenshotService,
    draftStore,
    scanProcessingService,
    appStore,
    bridge,
    updateService,
    windowTracker,
    scraperService,
  )

  // Cleanup on quit
  app.on('before-quit', async () => {
    windowTracker.stopTracking()
    bridge.destroy()
    await mlService.terminate()
    screenshotService.stopPrefetch()
    dbService.close()
  })

  const cpWin = windowManager.createControlPanelWindow()
  bridge.subscribe([cpWin])

  // @DEV-GUIDE: ML worker init is fire-and-forget so the app window appears instantly.
  // If init fails, mlStatus becomes 'error' and the dashboard shows a retry button.
  // The scan handler in ml-handlers.ts has a lazy-init fallback if the worker isn't ready yet.
  appStore.setState({ mlStatus: 'initializing', mlError: null })
  mlService
    .initialize()
    .then(() => {
      appStore.setState({ mlStatus: 'ready', mlError: null })
      logger.info('ML Worker initialized successfully')
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('ML auto-init failed', { error: message })
      appStore.setState({ mlStatus: 'error', mlError: message })
    })

  sentryService.addBreadcrumb('Application ready', 'lifecycle')
  logger.info('Application ready')
})

app.on('window-all-closed', () => {
  logger.info('All windows closed, quitting')
  app.quit()
})
