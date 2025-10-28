/**
 * @file Main process for the Electron application.
 * Handles application lifecycle events, initializes services (database, ML, auto-updater),
 * and performs an automatic update check on startup.
 * manages windows, and registers IPC handlers for communication with renderer processes.
 */

const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;

// --- Logging Setup (must be early) ---
const { logStartup, logShutdown, flushLogs, createLogger } = require('./src/main/logger');
const logger = createLogger('Main');

// --- Memory Monitoring ---
const memoryMonitor = require('./src/main/memoryMonitor');

// --- Cache Management ---
const { cacheManager } = require('./src/main/cacheManager');

// --- Performance Metrics ---
const performanceMetrics = require('./src/main/performanceMetrics');

// --- Debug Mode ---
const debugMode = require('./src/main/debugMode');

// --- Hot Reload (Development Only) ---
const hotReload = require('./src/main/hotReload');

// --- Local Modules ---
// Note: setupDatabase is loaded inside app.whenReady() to avoid accessing app too early
const {
  BASE_RESOURCES_PATH,
  DB_FILENAME,
  LAYOUT_COORDS_FILENAME,
  MODEL_DIR_NAME, // Used for ML Worker setup
  MODEL_FILENAME, // Used for ML Worker setup
  CLASS_NAMES_FILENAME, // Used for ML Worker setup & loadClassNamesForMain
} = require('./config');
const { sendStatusUpdate } = require('./src/main/utils');
const { loadTranslations, getCurrentLang } = require('./src/main/localization');
const { setupAutoUpdater } = require('./src/main/autoUpdaterSetup');
const { createBackup, checkDatabaseIntegrity } = require('./src/main/databaseBackup');
const windowManager = require('./src/main/windowManager');
const mlManager = require('./src/main/mlManager');
const scanProcessor = require('./src/main/scanProcessor');
const stateManager = require('./src/main/stateManager');
const { registerAppContextHandlers } = require('./src/main/ipcHandlers/appContextHandlers');
const { registerDataHandlers } = require('./src/main/ipcHandlers/dataHandlers');
const { registerOverlayHandlers } = require('./src/main/ipcHandlers/overlayHandlers');
const { registerFeedbackHandlers } = require('./src/main/ipcHandlers/feedbackHandlers');
const { registerLocalizationHandlers } = require('./src/main/ipcHandlers/localizationHandlers');
const { registerBackupHandlers } = require('./src/main/ipcHandlers/backupHandlers');
const { registerMemoryHandlers } = require('./src/main/ipcHandlers/memoryHandlers');
const { registerCacheHandlers } = require('./src/main/ipcHandlers/cacheHandlers');
const { registerPerformanceHandlers } = require('./src/main/ipcHandlers/performanceHandlers');
const { registerDebugHandlers } = require('./src/main/ipcHandlers/debugHandlers');
const { registerHotReloadHandlers } = require('./src/main/ipcHandlers/hotReloadHandlers');

windowManager.setAppInstance(app);

/**
 * Loads class names required for the ML model from a JSON file.
 * Caches the loaded class names in the stateManager to avoid redundant file reads.
 * Throws an error if loading or parsing fails, or if class names are empty.
 * @async
 * @returns {Promise<string[]>} A promise that resolves with the array of class names.
 * @throws {Error} If class names cannot be loaded, parsed, or are invalid.
 */
async function loadClassNamesForMain() {
  if (!stateManager.getClassNamesCache()) {
    const classNamesJsonPath = path.join(BASE_RESOURCES_PATH, 'model', MODEL_DIR_NAME, CLASS_NAMES_FILENAME);
    try {
      const data = await fs.readFile(classNamesJsonPath, 'utf8');
      const loadedClassNames = JSON.parse(data);
      if (!loadedClassNames || loadedClassNames.length === 0) {
        logger.error('Failed to load or parse class names', { path: classNamesJsonPath });
        throw new Error('Class names are empty or invalid.');
      }
      stateManager.setClassNamesCache(loadedClassNames);
      logger.debug('Class names loaded', { count: loadedClassNames.length });
    } catch (err) {
      logger.error('Error loading class_names.json', { error: err.message, path: classNamesJsonPath });
      throw err;
    }
  }
  return stateManager.getClassNamesCache();
}

// --- ML Worker Callback Handlers ---

/**
 * Handles messages received from the ML worker thread.
 * If successful, processes scan results. If an error occurs, logs it and notifies the overlay.
 * @param {object} result - The result object from the ML worker.
 */
function handleMlWorkerMessage(result) {
  if (result.status === 'success') {
    logger.debug('Received successful scan results from ML Worker');

    const currentMainState = {
      activeDbPath: stateManager.getActiveDbPath(),
      fullLayoutConfigCache: stateManager.getFullLayoutConfigCache(),
      lastScanTargetResolution: stateManager.getLastScanTargetResolution(),
      lastUsedScaleFactor: stateManager.getLastUsedScaleFactor(),
      initialPoolAbilitiesCache: stateManager.getInitialPoolAbilitiesCache(),
      identifiedHeroModelsCache: stateManager.getIdentifiedHeroModelsCache(),
      mySelectedSpotDbIdForDrafting: stateManager.getMySelectedSpotDbIdForDrafting(),
      mySelectedSpotOriginalOrder: stateManager.getMySelectedSpotOriginalOrder(),
      mySelectedModelDbHeroId: stateManager.getMySelectedModelDbHeroId(),
      mySelectedModelScreenOrder: stateManager.getMySelectedModelScreenOrder()
    };
    const overlayWebContents = windowManager.getOverlayWindow()?.webContents;

    scanProcessor.processAndFinalizeScanData(result.results, result.isInitialScan, currentMainState, overlayWebContents)
      .then(processingOutcome => {
        if (processingOutcome.success) {
          stateManager.updateStateProperties(processingOutcome.updatedMainState);
        }
        // Error handling is done within processAndFinalizeScanData by sending to overlay
        stateManager.setIsScanInProgress(false); // Always reset after processing attempt
      })
      .catch(error => { // Catch errors from the promise itself, though processAndFinalizeScanData tries to handle its own
        logger.error('Critical error calling scanProcessor', { error: error.message, stack: error.stack });
        stateManager.setIsScanInProgress(false);
        if (overlayWebContents && !overlayWebContents.isDestroyed()) {
          sendStatusUpdate(overlayWebContents, 'overlay-data', {
            error: `Core processing error: ${error.message}`,
            scaleFactor: stateManager.getLastUsedScaleFactor()
          });
        }
      });

  } else if (result.status === 'error') {
    logger.error('ML Worker Error', { error: result.error });
    stateManager.setIsScanInProgress(false);
    const overlayWindow = windowManager.getOverlayWindow();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      sendStatusUpdate(overlayWindow.webContents, 'overlay-data', {
        error: `Worker Error: ${result.error.message}`,
        scaleFactor: stateManager.getLastUsedScaleFactor()
      });
    }
  }
}

/**
 * Handles unhandled errors originating from the ML worker thread.
 * @param {Error} err - The error object.
 */
function handleMlWorkerError(err) {
  logger.error('ML Worker Unhandled Error', { error: err.message, stack: err.stack });
  stateManager.setIsScanInProgress(false); // Ensure scan progress is reset
  const overlayWindow = windowManager.getOverlayWindow();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    sendStatusUpdate(overlayWindow.webContents, 'overlay-data', {
      error: `ML Worker encountered an unhandled error: ${err.message}. Please try restarting the app.`,
      scaleFactor: stateManager.getLastUsedScaleFactor()
    });
  }
  // Optionally, attempt to terminate and re-initialize the worker, or notify the user more prominently.
}

/**
 * Handles the exit event of the ML worker thread.
 * @param {number} code - The exit code of the worker.
 */
function handleMlWorkerExit(code) {
  if (code !== 0) {
    logger.error('ML Worker stopped unexpectedly', { exitCode: code });
    // Notify the user or attempt to restart the worker if appropriate.
    // For now, errors during processing will be caught by handleMlWorkerError or handleMlWorkerMessage.
  }
}

app.whenReady().then(async () => {
  // Log application startup
  logStartup();

  // Start memory monitoring
  memoryMonitor.startMonitoring();
  memoryMonitor.onMemoryWarning((level, usage, status) => {
    logger.warn(`Memory ${level} threshold exceeded`, {
      heapUsed: memoryMonitor.formatBytes(usage.heapUsed),
      external: memoryMonitor.formatBytes(usage.external),
      status
    });

    // Attempt garbage collection on critical warnings
    if (level === 'critical') {
      memoryMonitor.forceGarbageCollection();
    }
  });

  // Start cache periodic cleanup
  cacheManager.startPeriodicCleanup();

  // Start performance metrics reporting
  performanceMetrics.startPeriodicReporting();

  await loadTranslations(getCurrentLang()); // Load default language on startup
  try {
    await loadClassNamesForMain();
    logger.info('Class names loaded successfully for main process');
  } catch (classNamesError) {
    logger.error('Failed to load class names for ML model', { error: classNamesError.message, stack: classNamesError.stack });
    dialog.showErrorBox(
      'Application Error',
      `Failed to load critical ML model data (class names): ${classNamesError.message}. The application will close.`
    );
    app.quit(); // Critical failure, exit app
    return; // Stop further execution if class names can't be loaded
  }


  const userDataPath = app.getPath('userData');
  stateManager.setActiveDbPath(path.join(userDataPath, DB_FILENAME));
  stateManager.setLayoutCoordinatesPath(path.join(BASE_RESOURCES_PATH, 'config', LAYOUT_COORDS_FILENAME));
  const bundledDbPathInApp = path.join(BASE_RESOURCES_PATH, DB_FILENAME);

  try {
    await fs.access(stateManager.getActiveDbPath());
  } catch (e) {
    stateManager.setIsFirstAppRun(true);
    logger.info('Database not found in userData. Copying bundled database');
    try {
      await fs.mkdir(userDataPath, { recursive: true });
      await fs.copyFile(bundledDbPathInApp, stateManager.getActiveDbPath());
      logger.info('Bundled database copied successfully');
    } catch (copyError) {
      stateManager.setIsFirstAppRun(false);
      logger.error('Failed to copy bundled database', { error: copyError.message });
      dialog.showErrorBox('Database Error', `Failed to copy local database: ${copyError.message}.`);
    }
  }

  try {
    // Load setupDatabase here (after app is ready) to avoid early app access
    const setupDatabase = require('./src/database/setupDatabase');
    setupDatabase();
    logger.info('Database schema initialized successfully');
  } catch (dbSetupError) {
    logger.error('Failed to set up database schema', { error: dbSetupError.message, stack: dbSetupError.stack });
    dialog.showErrorBox(
      'Database Setup Error',
      `Failed to prepare database: ${dbSetupError.message}. App will close.`
    );
    app.quit();
    return;
  }

  // Check database integrity
  const integrityCheck = await checkDatabaseIntegrity(stateManager.getActiveDbPath());
  if (!integrityCheck.valid) {
    logger.error('Database integrity check failed', { error: integrityCheck.error });
    dialog.showErrorBox(
      'Database Error',
      `Database file is corrupted: ${integrityCheck.error}. Please restore from backup or reinstall.`
    );
    app.quit();
    return;
  }

  // Create automatic startup backup (not on first run to avoid backing up bundled DB)
  if (!stateManager.getIsFirstAppRun()) {
    logger.info('Creating automatic startup backup');
    const backupResult = await createBackup(stateManager.getActiveDbPath(), 'startup');
    if (backupResult.success) {
      logger.info('Automatic startup backup created', { path: backupResult.backupPath });
    } else {
      logger.warn('Failed to create automatic startup backup', { error: backupResult.error });
      // Don't block app startup if backup fails
    }
  }

  // Register IPC handlers that are needed early by the main window
  // and do NOT depend on mlManager being initialized.
  registerAppContextHandlers();
  registerDataHandlers();
  registerFeedbackHandlers();
  registerLocalizationHandlers();
  registerBackupHandlers();
  registerMemoryHandlers();
  registerCacheHandlers();
  registerPerformanceHandlers();
  registerDebugHandlers();
  registerHotReloadHandlers();

  // Enable debug mode if DEBUG environment variable is set
  if (process.env.DEBUG === 'true' || process.env.DEBUG === '1') {
    logger.info('Enabling debug mode from environment variable');
    debugMode.enable({
      verboseLogging: true,
      operationLogging: true
    });
  }

  // Enable hot reload if HOT_RELOAD environment variable is set
  if (process.env.HOT_RELOAD === 'true' || process.env.HOT_RELOAD === '1') {
    logger.info('Enabling hot reload from environment variable');
    hotReload.enable({
      debounceDelay: 500
    });
  }

  windowManager.initMainWindow(stateManager.getIsFirstAppRun(), stateManager.getActiveDbPath());

  try {
    // Initialize ML Manager and wait for the worker to be ready
    await mlManager.initialize(handleMlWorkerMessage, handleMlWorkerError, handleMlWorkerExit, __dirname);
    logger.info('ML Manager initialized and worker is ready');
    // Register IPC handlers that DO depend on mlManager.postMessage *after* it's ready
    registerOverlayHandlers(); // This one uses mlManager.postMessage

  } catch (mlInitError) {
    logger.error('Failed to initialize ML Manager or ML Worker', {
      error: mlInitError.message,
      stack: mlInitError.stack
    });
    dialog.showErrorBox(
      'Application Error',
      `Failed to initialize critical ML component: ${mlInitError.message}. The application will close.`
    );
    app.quit();
    return;
  }

  setupAutoUpdater(windowManager.getMainWindow);
  windowManager.setupNativeThemeListener();

  // Perform an automatic check for updates on application startup
  // This is done after the autoUpdater has been configured by setupAutoUpdater.
  logger.info('Performing automatic check for updates');
  const { autoUpdater } = require('electron-updater');
  autoUpdater.checkForUpdates().catch((err) => {
    // This catch is primarily to prevent unhandled promise rejections.
    // The 'error' event emitted by autoUpdater (handled in autoUpdaterSetup.js)
    // is responsible for notifying the renderer/UI about the error.
    logger.error('Error during automatic checkForUpdates', { error: err.message });
  });

  app.on('activate', () => {
    if (windowManager.getMainWindow() === null) {
      windowManager.initMainWindow(stateManager.getIsFirstAppRun(), stateManager.getActiveDbPath());
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', async (event) => {
  event.preventDefault(); // Prevent immediate quit to allow cleanup

  logger.info('Application will quit - cleaning up resources');
  stateManager.setIsScanInProgress(false);
  mlManager.terminate(); // Clean up the worker on quit

  // Log final memory stats and stop monitoring
  logger.info(memoryMonitor.getSummary());
  memoryMonitor.stopMonitoring();

  // Log cache stats and stop cleanup
  logger.info(cacheManager.getSummary());
  cacheManager.stopPeriodicCleanup();

  // Log performance metrics and stop reporting
  logger.info(performanceMetrics.getSummary());
  performanceMetrics.stopPeriodicReporting();

  // Log debug mode report if enabled
  if (debugMode.isEnabled()) {
    logger.info('Debug mode was enabled during session');
    logger.info(debugMode.getDebugReport());
  }

  logShutdown();
  await flushLogs(); // Ensure all logs are written

  app.exit(0); // Now quit for real
});