/**
 * @file Main process for the Electron application.
 * Handles application lifecycle events, initializes services (database, ML, auto-updater),
 * and performs an automatic update check on startup.
 * manages windows, and registers IPC handlers for communication with renderer processes.
 */

const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;

const { autoUpdater } = require('electron-updater'); // Added for automatic update check
// --- Local Modules ---
const setupDatabase = require('./src/database/setupDatabase');
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
const windowManager = require('./src/main/windowManager');
const mlManager = require('./src/main/mlManager');
const scanProcessor = require('./src/main/scanProcessor');
const stateManager = require('./src/main/stateManager');
const { registerAppContextHandlers } = require('./src/main/ipcHandlers/appContextHandlers');
const { registerDataHandlers } = require('./src/main/ipcHandlers/dataHandlers');
const { registerOverlayHandlers } = require('./src/main/ipcHandlers/overlayHandlers');
const { registerFeedbackHandlers } = require('./src/main/ipcHandlers/feedbackHandlers');
const { registerLocalizationHandlers } = require('./src/main/ipcHandlers/localizationHandlers');

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
        console.error('[Main] Failed to load or parse class names from:', classNamesJsonPath);
        throw new Error('Class names are empty or invalid.');
      }
      stateManager.setClassNamesCache(loadedClassNames);
    } catch (err) {
      console.error('[Main] Error loading class_names.json:', err);
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
    console.log('[Main] Received successful scan results from ML Worker.');

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
        console.error('[Main] Critical error calling scanProcessor:', error);
        stateManager.setIsScanInProgress(false);
        if (overlayWebContents && !overlayWebContents.isDestroyed()) {
          sendStatusUpdate(overlayWebContents, 'overlay-data', {
            error: `Core processing error: ${error.message}`,
            scaleFactor: stateManager.getLastUsedScaleFactor()
          });
        }
      });

  } else if (result.status === 'error') {
    console.error('[Main] ML Worker Error:', result.error);
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
  console.error('[Main] ML Worker Unhandled Error:', err);
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
    console.error(`[Main] ML Worker stopped with exit code ${code}. This might indicate an issue.`);
    // Notify the user or attempt to restart the worker if appropriate.
    // For now, errors during processing will be caught by handleMlWorkerError or handleMlWorkerMessage.
  }
}

app.whenReady().then(async () => {
  await loadTranslations(getCurrentLang()); // Load default language on startup
  try {
    await loadClassNamesForMain();
    console.log('[MainInit] Class names loaded successfully for main process.');
  } catch (classNamesError) {
    console.error('[MainInit] Failed to load class names for ML model:', classNamesError);
    dialog.showErrorBox('Application Error', `Failed to load critical ML model data (class names): ${classNamesError.message}. The application will close.`);
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
    console.log('[MainInit] Database not found in userData. Copying bundled database.');
    try {
      await fs.mkdir(userDataPath, { recursive: true });
      await fs.copyFile(bundledDbPathInApp, stateManager.getActiveDbPath());
      console.log('[MainInit] Bundled database copied successfully.');
    } catch (copyError) {
      stateManager.setIsFirstAppRun(false);
      console.error('[MainInit] Failed to copy bundled database:', copyError);
      dialog.showErrorBox('Database Error', `Failed to copy local database: ${copyError.message}.`);
    }
  }

  try {
    setupDatabase();
  } catch (dbSetupError) {
    console.error('[MainInit] Failed to set up database schema:', dbSetupError);
    dialog.showErrorBox('Database Setup Error', `Failed to prepare database: ${dbSetupError.message}. App will close.`);
    app.quit();
    return;
  }

  // Register IPC handlers that are needed early by the main window
  // and do NOT depend on mlManager being initialized.
  registerAppContextHandlers();
  registerDataHandlers();
  registerFeedbackHandlers();
  registerLocalizationHandlers();

  windowManager.initMainWindow(stateManager.getIsFirstAppRun(), stateManager.getActiveDbPath());

  try {
    // Initialize ML Manager and wait for the worker to be ready
    await mlManager.initialize(handleMlWorkerMessage, handleMlWorkerError, handleMlWorkerExit, __dirname);
    console.log('[MainInit] ML Manager initialized and worker is ready.');
    // Register IPC handlers that DO depend on mlManager.postMessage *after* it's ready
    registerOverlayHandlers(); // This one uses mlManager.postMessage

  } catch (mlInitError) {
    console.error('[MainInit] Failed to initialize ML Manager or ML Worker:', mlInitError);
    dialog.showErrorBox('Application Error', `Failed to initialize critical ML component: ${mlInitError.message}. The application will close.`);
    app.quit();
    return;
  }

  setupAutoUpdater(windowManager.getMainWindow);
  windowManager.setupNativeThemeListener();

  // Perform an automatic check for updates on application startup
  // This is done after the autoUpdater has been configured by setupAutoUpdater.
  console.log('[MainAppStart] Performing automatic check for updates...');
  autoUpdater.checkForUpdates().catch(err => {
    // This catch is primarily to prevent unhandled promise rejections.
    // The 'error' event emitted by autoUpdater (handled in autoUpdaterSetup.js)
    // is responsible for notifying the renderer/UI about the error.
    console.error('[MainAppStart] Error during automatic checkForUpdates() promise:', err.message);
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

app.on('will-quit', () => {
  stateManager.setIsScanInProgress(false);
  mlManager.terminate(); // Clean up the worker on quit
});