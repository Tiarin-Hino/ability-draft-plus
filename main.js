const { app, BrowserWindow, ipcMain, screen, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const Database = require('better-sqlite3');
const archiver = require('archiver');
const screenshotDesktop = require('screenshot-desktop');
const sharp = require('sharp');
const axios = require('axios');

// --- Local Modules ---
const setupDatabase = require('./src/database/setupDatabase');
const {
  getAbilityDetails,
  getHighWinrateCombinations,
  getAllOPCombinations,
  getHeroDetailsByAbilityName,
  getHeroDetailsById
} = require('./src/database/queries');
const { scrapeAndStoreAbilitiesAndHeroes } = require('./src/scraper/abilityScraper');
const { scrapeAndStoreAbilityPairs } = require('./src/scraper/abilityPairScraper');
const {
  processDraftScreen: performMlScan, // Renamed for clarity within main.js
  initializeImageProcessor,
  identifySlotsFromCache,
  initializeImageProcessorIfNeeded
} = require('./src/imageProcessor');

// --- Constants ---
const IS_PACKAGED = app.isPackaged;
const APP_ROOT_PATH_DEV = app.getAppPath();
const RESOURCES_PATH = process.resourcesPath;
const BASE_RESOURCES_PATH = IS_PACKAGED ? RESOURCES_PATH : APP_ROOT_PATH_DEV;

const DB_FILENAME = 'dota_ad_data.db';
const LAYOUT_COORDS_FILENAME = 'layout_coordinates.json';
const MODEL_DIR_NAME = 'tfjs_model';
const MODEL_FILENAME = 'model.json';
const CLASS_NAMES_FILENAME = 'class_names.json';

// Scraper URLs
const ABILITIES_URL = 'https://windrun.io/abilities';
const ABILITIES_HIGH_SKILL_URL = 'https://windrun.io/ability-high-skill';
const ABILITY_PAIRS_URL = 'https://windrun.io/ability-pairs';

// ML & Scoring Configuration
const MIN_PREDICTION_CONFIDENCE = 0.90; // Minimum confidence for ML predictions
const NUM_TOP_TIER_SUGGESTIONS = 10;    // Number of top-tier suggestions to highlight

// Scoring Weights (sum to 1.0)
const WEIGHT_VALUE_PERCENTAGE = 0.40;
const WEIGHT_WINRATE = 0.20;
const WEIGHT_PICK_ORDER = 0.40;

// Pick Order Normalization Range (for scoring)
const MIN_PICK_ORDER_FOR_NORMALIZATION = 1.0;
const MAX_PICK_ORDER_FOR_NORMALIZATION = 40.0; // Higher pick order is less desirable

// --- Global State ---
let mainWindow = null;
let overlayWindow = null;
let activeDbPath = '';
let layoutCoordinatesPath = ''; // For layout_coordinates.json

let initialPoolAbilitiesCache = { ultimates: [], standard: [] };
let fullLayoutConfigCache = null; // To cache the content of layout_coordinates.json
let classNamesCache = null;     // To cache class names for the ML model

let isScanInProgress = false;
let lastRawScanResults = null;        // Stores raw results from performMlScan for snapshotting
let lastScanTargetResolution = null;
let lastUsedScaleFactor = 1.0;
let isFirstAppRun = false;            // Flag to manage initial setup/messaging

// State for "My Hero" and "My Model" selections
let mySelectedHeroDbIdForDrafting = null;
let mySelectedHeroOriginalOrder = null;
let mySelectedModelDbHeroId = null;
let mySelectedModelScreenOrder = null;

let identifiedHeroModelsCache = null; // Caches identified hero models from the initial scan

// --- Utility Functions ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let PROD_API_URL, PROD_CLIENT_KEY, PROD_SHARED_SECRET;

if (app.isPackaged) {
  try {
    const appConfig = require('./src/app-config.js');
    PROD_API_URL = appConfig.API_ENDPOINT_URL;
    PROD_CLIENT_KEY = appConfig.CLIENT_API_KEY;
    PROD_SHARED_SECRET = appConfig.CLIENT_SHARED_SECRET;
    console.log('[Main] Loaded production config from app-config.js');
  } catch (e) {
    console.error('[Main] FATAL: Could not load app-config.js in packaged app!', e);
  }
}

if (!app.isPackaged) {
  try {
    require('dotenv').config();
    console.log('[Main] Loaded .env file for development.');
  } catch (e) {
    console.warn('[Main] Could not load .env file for development:', e.message);
  }
}

const API_ENDPOINT_URL = app.isPackaged ? PROD_API_URL : (process.env.API_ENDPOINT_URL || PROD_API_URL);
const CLIENT_API_KEY = app.isPackaged ? PROD_CLIENT_KEY : (process.env.CLIENT_API_KEY || PROD_CLIENT_KEY);
const CLIENT_SHARED_SECRET = app.isPackaged ? PROD_SHARED_SECRET : (process.env.CLIENT_SHARED_SECRET || PROD_SHARED_SECRET);

if (!API_ENDPOINT_URL || !CLIENT_API_KEY || !CLIENT_SHARED_SECRET) {
  console.error("CRITICAL ERROR: API Configuration is missing. Please check .env for dev or app-config.js generation for prod.");
}

// Function to generate HMAC (place it somewhere accessible)
function generateHmacSignature(sharedSecret, httpMethod, requestPath, timestamp, nonce, apiKey) {
  const stringToSign = `${httpMethod}\n${requestPath}\n${timestamp}\n${nonce}\n${apiKey}`;
  return crypto.createHmac('sha256', sharedSecret)
    .update(stringToSign)
    .digest('hex');
}


/**
 * Sends status updates to a specific webContents target.
 * @param {Electron.WebContents | null} targetWebContents - The webContents to send the status to.
 * @param {string} channel - The IPC channel name.
 * @param {any} message - The message payload.
 */
function sendStatusUpdate(targetWebContents, channel, message) {
  if (targetWebContents && !targetWebContents.isDestroyed()) {
    targetWebContents.send(channel, message);
  }
}

/**
 * Loads class names from the JSON file if not already cached.
 * @async
 * @throws {Error} If class names cannot be loaded or parsed, or if the array is empty.
 * @returns {Promise<string[]>} A promise that resolves to an array of class names.
 */
async function loadClassNamesForMain() {
  if (!classNamesCache) {
    const classNamesJsonPath = path.join(BASE_RESOURCES_PATH, 'model', MODEL_DIR_NAME, CLASS_NAMES_FILENAME);
    try {
      const data = await fs.readFile(classNamesJsonPath, 'utf8');
      classNamesCache = JSON.parse(data);
      if (!classNamesCache || classNamesCache.length === 0) {
        console.error('[MainScan] Failed to load or parse class names from:', classNamesJsonPath);
        throw new Error('Class names are empty or invalid.');
      }
    } catch (err) {
      console.error('[MainScan] Error loading class_names.json:', err);
      throw err;
    }
  }
  return classNamesCache;
}

// --- Database Date Management ---
/**
 * Updates or inserts the 'last_successful_scrape_date' in the Metadata table.
 * @param {string} dbPathToUse - Path to the database.
 * @returns {Promise<string | null>} The ISO date string (YYYY-MM-DD) of the update, or null on error.
 */
async function updateLastSuccessfulScrapeDate(dbPathToUse) {
  const currentDate = new Date().toISOString().split('T')[0];
  let db = null;
  try {
    db = new Database(dbPathToUse);
    db.prepare("INSERT OR REPLACE INTO Metadata (key, value) VALUES ('last_successful_scrape_date', ?)")
      .run(currentDate);
    return currentDate;
  } catch (error) {
    console.error('[MainDB] Error updating last successful scrape date:', error);
    return null;
  } finally {
    if (db && db.open) db.close();
  }
}

/**
 * Retrieves the 'last_successful_scrape_date' from the Metadata table.
 * @param {string} dbPathToUse - Path to the database.
 * @returns {Promise<string | null>} The ISO date string (YYYY-MM-DD) or null if not found/error.
 */
async function getLastSuccessfulScrapeDate(dbPathToUse) {
  let db = null;
  try {
    db = new Database(dbPathToUse, { readonly: true });
    const row = db.prepare("SELECT value FROM Metadata WHERE key = 'last_successful_scrape_date'").get();
    return row ? row.value : null;
  } catch (error) {
    console.error('[MainDB] Error fetching last successful scrape date:', error);
    return null;
  } finally {
    if (db && db.open) db.close();
  }
}

/**
 * Sends the formatted last updated date to the main window renderer.
 * @param {Electron.WebContents} webContents - The main window's webContents.
 * @param {string | null} dateStringYYYYMMDD - The date string in YYYY-MM-DD format.
 */
function sendLastUpdatedDateToRenderer(webContents, dateStringYYYYMMDD) {
  let displayDate = "Never";
  if (dateStringYYYYMMDD) {
    try {
      const [year, month, day] = dateStringYYYYMMDD.split('-');
      if (year && month && day) {
        displayDate = `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
      } else {
        displayDate = "Invalid Date";
      }
    } catch (e) {
      console.error("[MainDate] Error formatting date:", e);
      displayDate = "Date Error";
    }
  }
  sendStatusUpdate(webContents, 'last-updated-date', displayDate);
}

// --- Scraping Orchestration ---
/**
 * Performs a full data scrape from Windrun.io for heroes, abilities, and pairs.
 * @param {Electron.WebContents} statusCallbackWebContents - WebContents to send progress updates to.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
async function performFullScrape(statusCallbackWebContents) {
  const sendStatus = (msg) => sendStatusUpdate(statusCallbackWebContents, 'scrape-status', msg);
  try {
    sendStatus('Starting all Windrun.io data updates...');
    await delay(100); // Brief delay for UI update

    sendStatus('Phase 1/2: Updating heroes and abilities data...');
    await scrapeAndStoreAbilitiesAndHeroes(activeDbPath, ABILITIES_URL, ABILITIES_HIGH_SKILL_URL, sendStatus);
    await delay(100);

    sendStatus('Phase 2/2: Updating ability pair data...');
    await scrapeAndStoreAbilityPairs(activeDbPath, ABILITY_PAIRS_URL, sendStatus);
    await delay(100);

    const newDate = await updateLastSuccessfulScrapeDate(activeDbPath);
    sendLastUpdatedDateToRenderer(statusCallbackWebContents, newDate);
    sendStatus('All Windrun.io data updates finished successfully!');
    return true;
  } catch (error) {
    console.error('[MainScrape] Consolidated scraping failed:', error.message);
    sendStatus(`Error during data update. Operation halted. Check logs. (${error.message})`);
    const currentDate = await getLastSuccessfulScrapeDate(activeDbPath);
    sendLastUpdatedDateToRenderer(statusCallbackWebContents, currentDate);
    return false;
  }
}

// --- Main Window Creation ---
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });
  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('did-finish-load', async () => {
    const lastDate = await getLastSuccessfulScrapeDate(activeDbPath);
    sendLastUpdatedDateToRenderer(mainWindow.webContents, lastDate);
    if (isFirstAppRun) {
      sendStatusUpdate(mainWindow.webContents, 'scrape-status', 'Using bundled data. Update data via "Update Windrun Data" if needed.');
    }
    // Send initial system theme state to the renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('initial-system-theme', {
        shouldUseDarkColors: nativeTheme.shouldUseDarkColors
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Listen for system theme updates and forward them to the renderer
nativeTheme.on('updated', () => {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('system-theme-updated', {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors
    });
  }
});

// --- Overlay Window Creation & Management ---
/**
 * Creates or recreates the overlay window.
 * @param {string} resolutionKey - The target screen resolution key.
 * @param {object} allCoordinatesConfig - The full layout coordinates configuration object.
 * @param {number} scaleFactorToUse - The display scale factor.
 */
function createOverlayWindow(resolutionKey, allCoordinatesConfig, scaleFactorToUse) {
  if (overlayWindow) {
    overlayWindow.close();
  }
  isScanInProgress = false;
  lastRawScanResults = null;
  lastScanTargetResolution = null;
  identifiedHeroModelsCache = null;
  mySelectedModelDbHeroId = null;
  mySelectedModelScreenOrder = null;
  // mySelectedHeroDbIdForDrafting and mySelectedHeroOriginalOrder persist across overlay reactivations.

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight, x, y } = primaryDisplay.bounds;

  overlayWindow = new BrowserWindow({
    width: screenWidth,
    height: screenHeight,
    x, y,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  overlayWindow.webContents.on('did-finish-load', () => {
    sendStatusUpdate(overlayWindow.webContents, 'overlay-data', {
      scanData: null,
      coordinatesConfig: allCoordinatesConfig,
      targetResolution: resolutionKey,
      opCombinations: [],
      heroModels: [],
      heroesForMyHeroUI: [],
      initialSetup: true, // Flag for overlayRenderer to do initial UI setup
      scaleFactor: scaleFactorToUse,
      selectedHeroForDraftingDbId: mySelectedHeroDbIdForDrafting,
      selectedModelHeroOrder: mySelectedModelScreenOrder
    });
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    isScanInProgress = false;
    lastRawScanResults = null;
    lastScanTargetResolution = null;
    identifiedHeroModelsCache = null;
    // State for "My Model" and "My Hero" is not reset here to persist choices if overlay is reopened.

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      sendStatusUpdate(mainWindow.webContents, 'overlay-closed-reset-ui', null);
    }
  });
}

// --- Application Lifecycle ---
app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  activeDbPath = path.join(userDataPath, DB_FILENAME);
  layoutCoordinatesPath = path.join(BASE_RESOURCES_PATH, 'config', LAYOUT_COORDS_FILENAME);
  const bundledDbPathInApp = path.join(BASE_RESOURCES_PATH, DB_FILENAME);

  try {
    const modelBasePath = path.join(BASE_RESOURCES_PATH, 'model', MODEL_DIR_NAME);
    const modelJsonPath = path.join(modelBasePath, MODEL_FILENAME);
    const modelFileUrl = 'file://' + modelJsonPath.replace(/\\/g, '/'); // TFJS needs file URI
    const classNamesJsonPath = path.join(modelBasePath, CLASS_NAMES_FILENAME);
    initializeImageProcessor(modelFileUrl, classNamesJsonPath);
  } catch (initError) {
    console.error('[MainInit] Failed to initialize image processor:', initError);
    dialog.showErrorBox('Fatal Initialization Error', `Failed to initialize the ML model: ${initError.message}. App will close.`);
    app.quit();
    return;
  }

  try {
    await fs.access(activeDbPath);
  } catch (e) {
    isFirstAppRun = true;
    console.log('[MainInit] Database not found in userData. Copying bundled database.');
    try {
      await fs.mkdir(userDataPath, { recursive: true });
      await fs.copyFile(bundledDbPathInApp, activeDbPath);
      console.log('[MainInit] Bundled database copied successfully.');
    } catch (copyError) {
      isFirstAppRun = false;
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

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  isScanInProgress = false;
});

// --- IPC Handlers ---

ipcMain.handle('get-system-display-info', async () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  const scaleFactor = primaryDisplay.scaleFactor;
  return {
    width,
    height,
    scaleFactor,
    resolutionString: `${width}x${height}`
  };
});

ipcMain.on('upload-failed-samples', async (event) => {
  const sendStatus = (message, error = false, inProgress = true) => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('upload-failed-samples-status', { message, error, inProgress });
    }
  };

  const userDataPath = app.getPath('userData');
  const failedSamplesDir = path.join(userDataPath, 'failed-samples');

  sendStatus('Starting failed samples upload process...', false, true);
  console.log('[Main] Received request to upload failed samples.');

  try {
    await fs.access(failedSamplesDir);
    const imageFiles = (await fs.readdir(failedSamplesDir)).filter(f => f.toLowerCase().endsWith('.png'));

    if (imageFiles.length === 0) {
      sendStatus('No image files found in failed-samples directory to upload.', false, false);
      return;
    }

    sendStatus(`Found ${imageFiles.length} samples. Zipping...`, false, true);

    const archive = archiver('zip', { zlib: { level: 9 } });
    const buffers = [];

    // Create a promise to handle the archiver stream completion
    const archivePromise = new Promise((resolve, reject) => {
      archive.on('data', (buffer) => buffers.push(buffer));
      archive.on('end', () => resolve(Buffer.concat(buffers)));
      archive.on('error', (err) => reject(err));
    });

    for (const fileName of imageFiles) {
      const filePath = path.join(failedSamplesDir, fileName);
      archive.file(filePath, { name: fileName });
    }
    archive.finalize();

    const zipBuffer = await archivePromise;
    console.log(`[Main] Zipping complete. Zip size: ${zipBuffer.length} bytes.`);
    sendStatus('Zip complete. Preparing to upload...', false, true);

    const timestamp = new Date().toISOString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const httpMethod = 'POST';
    const requestPath = '/failed-samples-upload';

    const signature = generateHmacSignature(
      CLIENT_SHARED_SECRET,
      httpMethod,
      requestPath,
      timestamp,
      nonce,
      CLIENT_API_KEY
    );

    const headers = {
      'Content-Type': 'application/zip',
      'x-api-key': CLIENT_API_KEY,
      'x-request-timestamp': timestamp,
      'x-nonce': nonce,
      'x-signature': signature,
    };

    console.log(`[Main] Uploading failed samples to ${API_ENDPOINT_URL}/failed-samples-upload`);
    console.log(`[Main] Headers for failed samples:`, JSON.stringify(headers, null, 2));


    const response = await axios.post(API_ENDPOINT_URL + '/failed-samples-upload', zipBuffer, {
      headers: headers,
      responseType: 'json',
    });

    console.log('[Main] Failed Samples API Response:', response.data);
    if (response.status === 200 && response.data.message) {
      sendStatus(response.data.message, false, false);
    } else {
      throw new Error(response.data.error || `API returned status ${response.status}`);
    }

  } catch (error) {
    let errorMessage = 'Failed to upload failed samples.';
    if (error.code === 'ENOENT' && error.path === failedSamplesDir) {
      errorMessage = 'Failed samples directory not found. No samples to upload.';
    } else if (error.response && error.response.data && (error.response.data.error || error.response.data.message)) {
      errorMessage = `API Error: ${error.response.data.error || error.response.data.message}`;
    } else if (error.message) {
      errorMessage = error.message;
    }
    console.error('[Main] Error uploading failed samples:', error);
    sendStatus(errorMessage, true, false);
  }
});

ipcMain.handle('is-app-packaged', () => {
  return app.isPackaged;
});

ipcMain.handle('get-current-system-theme', async () => {
  return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors };
});

ipcMain.on('scrape-all-windrun-data', async (event) => {
  await performFullScrape(event.sender);
});

ipcMain.on('get-available-resolutions', async (event) => {
  try {
    const configData = await fs.readFile(layoutCoordinatesPath, 'utf-8');
    const layoutConfig = JSON.parse(configData);
    const resolutions = layoutConfig?.resolutions ? Object.keys(layoutConfig.resolutions) : [];
    event.sender.send('available-resolutions', resolutions);
  } catch (error) {
    console.error('[MainIPC] Error loading resolutions from layout_coordinates.json:', error);
    event.sender.send('available-resolutions', []);
    sendStatusUpdate(mainWindow.webContents, 'scrape-status', `Error loading resolutions: ${error.message}`);
  }
});

ipcMain.on('activate-overlay', async (event, selectedResolution) => {
  if (!selectedResolution) {
    sendStatusUpdate(event.sender, 'scrape-status', 'Error: No resolution selected for overlay.');
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }

  initialPoolAbilitiesCache = { ultimates: [], standard: [] };
  identifiedHeroModelsCache = null;

  if (!fullLayoutConfigCache) {
    try {
      const layoutData = await fs.readFile(layoutCoordinatesPath, 'utf-8');
      fullLayoutConfigCache = JSON.parse(layoutData);
    } catch (err) {
      console.error("[MainIPC] Failed to load layout_coordinates.json for activate-overlay:", err);
      sendStatusUpdate(event.sender, 'scan-results', { error: `Layout config error: ${err.message}`, resolution: selectedResolution });
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
      return;
    }
  }

  try {
    await loadClassNamesForMain();
    await initializeImageProcessorIfNeeded();
  } catch (e) {
    console.error("[MainIPC] Failed to initialize for activate-overlay:", e);
    sendStatusUpdate(event.sender, 'scan-results', { error: `Initialization error: ${e.message}`, resolution: selectedResolution });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    return;
  }

  try {
    const layoutConfigToUse = fullLayoutConfigCache;
    if (!layoutConfigToUse) {
      throw new Error("Layout configuration cache is unexpectedly empty.");
    }
    const primaryDisplay = screen.getPrimaryDisplay();
    lastUsedScaleFactor = primaryDisplay.scaleFactor || 1.0;

    createOverlayWindow(selectedResolution, layoutConfigToUse, lastUsedScaleFactor);
    sendStatusUpdate(event.sender, 'scrape-status', `Overlay activated for ${selectedResolution}. Main window hidden.`);
  } catch (error) {
    console.error('[MainIPC] Overlay Activation Error:', error);
    sendStatusUpdate(event.sender, 'scrape-status', `Overlay Activation Error: ${error.message}`);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  }
});

ipcMain.on('close-overlay', () => {
  if (overlayWindow) {
    overlayWindow.close();
  } else if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
    sendStatusUpdate(mainWindow.webContents, 'overlay-closed-reset-ui', null);
  }
});

ipcMain.on('set-overlay-mouse-ignore', (event, ignore) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

ipcMain.on('select-my-model', (event, { heroOrder, dbHeroId }) => {
  if (mySelectedModelScreenOrder === heroOrder && mySelectedModelDbHeroId === dbHeroId) {
    mySelectedModelDbHeroId = null;
    mySelectedModelScreenOrder = null;
    console.log(`[MainState] "My Model" deselected.`);
  } else {
    mySelectedModelDbHeroId = dbHeroId;
    mySelectedModelScreenOrder = heroOrder;
    console.log(`[MainState] "My Model" selected: Screen Order ${heroOrder}, DB ID ${dbHeroId}`);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    sendStatusUpdate(overlayWindow.webContents, 'my-model-selection-changed', {
      selectedModelHeroOrder: mySelectedModelScreenOrder
    });
  }
});

ipcMain.on('select-my-hero-for-drafting', (event, { heroOrder, dbHeroId }) => {
  if (mySelectedHeroOriginalOrder === heroOrder && mySelectedHeroDbIdForDrafting === dbHeroId) {
    mySelectedHeroDbHeroIdForDrafting = null;
    mySelectedHeroOriginalOrder = null;
    console.log(`[MainState] "My Hero" (for drafting) deselected.`);
  } else {
    mySelectedHeroDbIdForDrafting = dbHeroId;
    mySelectedHeroOriginalOrder = heroOrder;
    console.log(`[MainState] "My Hero" (for drafting) selected: Original List Order ${heroOrder}, DB ID ${dbHeroId}`);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    sendStatusUpdate(overlayWindow.webContents, 'my-hero-for-drafting-selection-changed', {
      selectedHeroOrderForDrafting: mySelectedHeroOriginalOrder,
      selectedHeroDbId: mySelectedHeroDbIdForDrafting
    });
  }
});

ipcMain.on('open-external-link', (event, url) => {
  if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
    shell.openExternal(url)
      .catch(err => console.error('[MainIPC] Failed to open external link:', url, err));
  } else {
    console.warn(`[MainIPC] Attempted to open invalid or non-HTTP(S) external link: ${url}`);
  }
});

// --- Scan Execution Logic ---
ipcMain.on('execute-scan-from-overlay', async (event, selectedResolution, selectedHeroOriginalOrderFromOverlay, isInitialScan) => {
  if (isScanInProgress) {
    sendStatusUpdate(overlayWindow.webContents, 'overlay-data', {
      info: 'Scan already in progress. Please wait.',
      targetResolution: lastScanTargetResolution,
      initialSetup: false,
      scaleFactor: lastUsedScaleFactor,
      selectedHeroForDraftingDbId: mySelectedHeroDbIdForDrafting,
      selectedModelHeroOrder: mySelectedModelScreenOrder
    });
    return;
  }
  if (!overlayWindow || overlayWindow.isDestroyed() || !selectedResolution) {
    sendStatusUpdate(overlayWindow.webContents, 'overlay-data', { error: 'Overlay window or resolution not available for scan.', scaleFactor: lastUsedScaleFactor });
    return;
  }

  isScanInProgress = true;
  lastScanTargetResolution = selectedResolution;
  const startTime = performance.now();
  console.log(`[MainScan] Scan triggered. Initial: ${isInitialScan}, Overlay's selectedHeroOriginalOrder: ${selectedHeroOriginalOrderFromOverlay}, Main's current mySelectedHeroOriginalOrder: ${mySelectedHeroOriginalOrder}`);

  try {
    const layoutConfig = fullLayoutConfigCache;
    if (!layoutConfig) throw new Error("Layout configuration not loaded.");
    const coords = layoutConfig.resolutions?.[selectedResolution];
    if (!coords) throw new Error(`Coordinates not found for ${selectedResolution}`);

    const {
      ultimate_slots_coords = [],
      standard_slots_coords = [],
      selected_abilities_coords = [],
      selected_abilities_params,
      models_coords = [],
      heroes_coords = []
    } = coords;
    const currentClassNames = await loadClassNamesForMain();
    const selected_hero_abilities_coords_full = selected_abilities_params ? selected_abilities_coords.map(sac => ({
      ...sac,
      width: selected_abilities_params.width,
      height: selected_abilities_params.height,
    })) : [];
    const hero_defining_slots_coords = standard_slots_coords.filter(slot => slot.ability_order === 2);

    let tempRawResults;
    if (isInitialScan) {
      console.log("[MainScan] Performing Initial Scan.");
      tempRawResults = await performMlScan(layoutCoordinatesPath, selectedResolution, MIN_PREDICTION_CONFIDENCE);
      initialPoolAbilitiesCache.ultimates = tempRawResults.ultimates
        .filter(item => item.name && item.coord)
        .map(res => ({ ...res, type: 'ultimate' }));
      initialPoolAbilitiesCache.standard = tempRawResults.standard
        .filter(item => item.name && item.coord)
        .map(res => ({ ...res, type: 'standard' }));
      console.log(`[MainScan] Initial Cache: ${initialPoolAbilitiesCache.ultimates.length} ults, ${initialPoolAbilitiesCache.standard.length} std cached.`);
      mySelectedModelDbHeroId = null; // Reset model on initial scan
      mySelectedModelScreenOrder = null;
      identifiedHeroModelsCache = await identifyHeroModels(tempRawResults.heroDefiningAbilities, models_coords);
    } else { // Rescan
      console.log("[MainScan] Performing Rescan.");
      if (!initialPoolAbilitiesCache.ultimates.length && !initialPoolAbilitiesCache.standard.length) {
        console.warn("[MainScan] Rescan with empty cache. Performing full scan logic for this rescan.");
        tempRawResults = await performMlScan(layoutCoordinatesPath, selectedResolution, MIN_PREDICTION_CONFIDENCE);
        initialPoolAbilitiesCache.ultimates = tempRawResults.ultimates.filter(item => item.name && item.coord).map(res => ({ ...res, type: 'ultimate' }));
        initialPoolAbilitiesCache.standard = tempRawResults.standard.filter(item => item.name && item.coord).map(res => ({ ...res, type: 'standard' }));
        if (!identifiedHeroModelsCache) {
          identifiedHeroModelsCache = await identifyHeroModels(tempRawResults.heroDefiningAbilities, models_coords);
        }
      } else {
        const screenshotBuffer = await screenshotDesktop({ format: 'png' });
        await initializeImageProcessorIfNeeded();
        const { identifySlots } = require('./src/imageProcessor'); // Re-require to ensure context if needed

        const reconfirmedUltimates = await identifySlotsFromCache(initialPoolAbilitiesCache.ultimates, screenshotBuffer, currentClassNames, MIN_PREDICTION_CONFIDENCE);
        const reconfirmedStandard = await identifySlotsFromCache(initialPoolAbilitiesCache.standard, screenshotBuffer, currentClassNames, MIN_PREDICTION_CONFIDENCE);
        const identifiedSelectedAbilities = await identifySlots(selected_hero_abilities_coords_full, screenshotBuffer, currentClassNames, MIN_PREDICTION_CONFIDENCE, new Set());

        tempRawResults = {
          ultimates: reconfirmedUltimates,
          standard: reconfirmedStandard,
          selectedAbilities: identifiedSelectedAbilities,
          heroDefiningAbilities: reconfirmedStandard.filter(a => hero_defining_slots_coords.some(hc => hc.hero_order === a.hero_order && hc.ability_order === a.ability_order))
        };
      }
    }
    lastRawScanResults = { ...tempRawResults };
    const heroesForMyHeroSelectionUI = prepareHeroesForMyHeroUI(identifiedHeroModelsCache, heroes_coords);
    const { uniqueAbilityNamesInPool, allPickedAbilityNames } = collectAbilityNames(tempRawResults);
    const allCurrentlyRelevantAbilityNames = Array.from(new Set([...uniqueAbilityNamesInPool, ...allPickedAbilityNames]));
    const abilityDetailsMap = getAbilityDetails(activeDbPath, allCurrentlyRelevantAbilityNames);
    const centralDraftPoolArray = Array.from(uniqueAbilityNamesInPool);

    let synergisticPartnersInPoolForMyHero = new Set();
    if (mySelectedHeroDbIdForDrafting !== null && mySelectedHeroOriginalOrder !== null) {
      const myHeroPickedAbilitiesRaw = tempRawResults.selectedAbilities.filter(
        ab => ab.name && ab.hero_order === mySelectedHeroOriginalOrder
      );
      const myHeroPickedAbilityNames = myHeroPickedAbilitiesRaw.map(ab => ab.name);

      if (myHeroPickedAbilityNames.length > 0) {
        console.log(`[MainScanLogic] My Hero (Original Order: ${mySelectedHeroOriginalOrder}) picked: ${myHeroPickedAbilityNames.join(', ')}. Checking synergies with pool of ${centralDraftPoolArray.length} abilities.`);
        for (const pickedAbilityName of myHeroPickedAbilityNames) {
          const combinations = await getHighWinrateCombinations(activeDbPath, pickedAbilityName, centralDraftPoolArray);
          combinations.forEach(combo => {
            if (combo.partnerInternalName) {
              synergisticPartnersInPoolForMyHero.add(combo.partnerInternalName);
            }
          });
        }
        console.log(`[MainScanLogic] Found ${synergisticPartnersInPoolForMyHero.size} synergistic partners in pool for My Hero's abilities: ${Array.from(synergisticPartnersInPoolForMyHero).join(', ')}`);
      }
    }

    for (const abilityName of allCurrentlyRelevantAbilityNames) {
      const details = abilityDetailsMap.get(abilityName);
      if (details) {
        const combinations = await getHighWinrateCombinations(activeDbPath, abilityName, centralDraftPoolArray);
        details.highWinrateCombinations = combinations || [];
        abilityDetailsMap.set(abilityName, details);
      }
    }

    const allDatabaseOPCombs = await getAllOPCombinations(activeDbPath);
    const relevantOPCombinations = allDatabaseOPCombs.filter(combo => {
      const a1InPool = uniqueAbilityNamesInPool.has(combo.ability1InternalName);
      const a2InPool = uniqueAbilityNamesInPool.has(combo.ability2InternalName);
      const a1Picked = allPickedAbilityNames.has(combo.ability1InternalName);
      const a2Picked = allPickedAbilityNames.has(combo.ability2InternalName);
      return (a1InPool && a2InPool) || (a1InPool && a2Picked) || (a1Picked && a2InPool);
    }).map(combo => ({
      ability1DisplayName: combo.ability1DisplayName,
      ability2DisplayName: combo.ability2DisplayName,
      synergyWinrate: combo.synergyWinrate
    }));

    let allEntitiesForScoring = prepareEntitiesForScoring(tempRawResults, abilityDetailsMap, identifiedHeroModelsCache);
    allEntitiesForScoring = calculateConsolidatedScores(allEntitiesForScoring);
    const myHeroHasPickedUltimate = checkMyHeroPickedUltimate(mySelectedHeroDbIdForDrafting, heroesForMyHeroSelectionUI, tempRawResults.selectedAbilities);
    const topTierMarkedEntities = determineTopTierEntities(allEntitiesForScoring, mySelectedModelDbHeroId, myHeroHasPickedUltimate, synergisticPartnersInPoolForMyHero);

    const enrichedHeroModels = enrichHeroModelDataWithFlags(identifiedHeroModelsCache, topTierMarkedEntities, allEntitiesForScoring);
    const formattedUltimates = formatResultsForUiWithFlags(tempRawResults.ultimates, abilityDetailsMap, topTierMarkedEntities, 'ultimates', allEntitiesForScoring);
    const formattedStandard = formatResultsForUiWithFlags(tempRawResults.standard, abilityDetailsMap, topTierMarkedEntities, 'standard', allEntitiesForScoring);
    const formattedSelectedAbilities = formatResultsForUiWithFlags(tempRawResults.selectedAbilities, abilityDetailsMap, [], 'selected', allEntitiesForScoring, true);

    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);
    console.log(`[MainScan] Scan and processing took ${durationMs}ms.`);

    sendStatusUpdate(overlayWindow.webContents, 'overlay-data', {
      scanData: { ultimates: formattedUltimates, standard: formattedStandard, selectedAbilities: formattedSelectedAbilities },
      heroModels: enrichedHeroModels,
      heroesForMyHeroUI: heroesForMyHeroSelectionUI,
      targetResolution: selectedResolution,
      durationMs: durationMs,
      opCombinations: relevantOPCombinations,
      initialSetup: false,
      scaleFactor: lastUsedScaleFactor,
      selectedHeroForDraftingDbId: mySelectedHeroDbIdForDrafting,
      selectedModelHeroOrder: mySelectedModelScreenOrder
    });

  } catch (error) {
    console.error(`[MainScan] Error during scan for ${selectedResolution}:`, error);
    sendStatusUpdate(overlayWindow.webContents, 'overlay-data', { error: error.message || 'Scan execution failed.', scaleFactor: lastUsedScaleFactor });
  } finally {
    isScanInProgress = false;
  }
});

// --- Helper functions for 'execute-scan-from-overlay' ---

async function identifyHeroModels(heroDefiningAbilities, modelCoords) {
  const tempIdentifiedHeroesMap = new Map();
  const validDefiningAbilities = heroDefiningAbilities.filter(r => r.name !== null);

  for (const heroAbility of validDefiningAbilities) {
    const heroIdentity = await getHeroDetailsByAbilityName(activeDbPath, heroAbility.name);
    if (heroIdentity && heroIdentity.hero_id !== null) {
      const fullHeroDetails = await getHeroDetailsById(activeDbPath, heroIdentity.hero_id);
      if (fullHeroDetails) {
        tempIdentifiedHeroesMap.set(heroAbility.hero_order, {
          heroDisplayName: fullHeroDetails.heroDisplayName,
          dbHeroId: fullHeroDetails.dbHeroId,
          heroName: fullHeroDetails.heroName,
          winrate: fullHeroDetails.winrate,
          avg_pick_order: fullHeroDetails.avg_pick_order,
          value_percentage: fullHeroDetails.value_percentage,
          identificationConfidence: heroAbility.confidence
        });
      }
    }
  }

  const heroModelData = [];
  for (const modelCoord of modelCoords) {
    const matchedHero = tempIdentifiedHeroesMap.get(modelCoord.hero_order);
    if (matchedHero) {
      heroModelData.push({ coord: modelCoord, ...matchedHero, heroOrder: modelCoord.hero_order });
    } else {
      heroModelData.push({
        coord: modelCoord, heroDisplayName: "Unknown Hero", heroName: `unknown_model_${modelCoord.hero_order}`,
        dbHeroId: null, winrate: null, avg_pick_order: null, value_percentage: null,
        heroOrder: modelCoord.hero_order, identificationConfidence: 0
      });
    }
  }
  return heroModelData;
}

function prepareHeroesForMyHeroUI(cachedHeroModels, heroScreenCoords) {
  if (!cachedHeroModels || cachedHeroModels.length === 0 || !heroScreenCoords || heroScreenCoords.length === 0) return [];
  const uiData = [];
  for (const heroScreenCoord of heroScreenCoords) { // heroScreenCoord.hero_order is 0-9
    // Assumes model.heroOrder (screen order 0-11) directly maps to hero list order (0-9) for the first 10.
    const matchedModel = cachedHeroModels.find(model => model.heroOrder === heroScreenCoord.hero_order);
    if (matchedModel && matchedModel.dbHeroId) {
      uiData.push({
        heroOrder: heroScreenCoord.hero_order, // This is the 0-9 drafting list order
        heroName: matchedModel.heroDisplayName,
        dbHeroId: matchedModel.dbHeroId,
      });
    } else {
      uiData.push({ heroOrder: heroScreenCoord.hero_order, heroName: "Unknown", dbHeroId: null });
    }
  }
  return uiData;
}

function collectAbilityNames(rawResults) {
  const uniqueAbilityNamesInPool = new Set();
  rawResults.ultimates.forEach(r => r.name && uniqueAbilityNamesInPool.add(r.name));
  rawResults.standard.forEach(r => r.name && uniqueAbilityNamesInPool.add(r.name));

  const allPickedAbilityNames = new Set();
  rawResults.selectedAbilities.forEach(r => r.name && allPickedAbilityNames.add(r.name));
  return { uniqueAbilityNamesInPool, allPickedAbilityNames };
}

function prepareEntitiesForScoring(rawResults, abilityDetailsMap, cachedHeroModels) {
  const entities = [];
  const processPool = (resultsArray, isUltimateSource) => {
    resultsArray.forEach(result => {
      if (result.name) {
        const details = abilityDetailsMap.get(result.name);
        if (details) {
          entities.push({
            ...details,
            is_ultimate_from_coord_source: isUltimateSource,
            entityType: 'ability',
            consolidatedScore: 0,
            hero_order_on_screen: result.hero_order,
            ability_order_on_screen: result.ability_order,
          });
        }
      }
    });
  };
  processPool(rawResults.ultimates, true);
  processPool(rawResults.standard, false);

  const addedHeroModelDbIds = new Set();
  if (cachedHeroModels) {
    for (const heroData of cachedHeroModels) {
      if (heroData.dbHeroId !== null && !addedHeroModelDbIds.has(heroData.dbHeroId)) {
        entities.push({
          internalName: heroData.heroName,
          displayName: heroData.heroDisplayName,
          winrate: heroData.winrate,
          avgPickOrder: heroData.avg_pick_order,
          valuePercentage: heroData.value_percentage,
          entityType: 'hero',
          dbHeroId: heroData.dbHeroId,
          heroOrderScreen: heroData.heroOrder,
          consolidatedScore: 0
        });
        addedHeroModelDbIds.add(heroData.dbHeroId);
      }
    }
  }
  return entities;
}

function calculateConsolidatedScores(entities) {
  return entities.map(entity => {
    let vRaw = entity.valuePercentage;
    let wRaw = entity.winrate;
    let pRaw = entity.avgPickOrder;

    const vScaled = (vRaw !== null && typeof vRaw === 'number') ? vRaw : 0.5;
    const wNormalized = (wRaw !== null && typeof wRaw === 'number') ? wRaw : 0.5;

    let pNormalized = 0.5;
    if (pRaw !== null && typeof pRaw === 'number') {
      const clampedPRaw = Math.max(MIN_PICK_ORDER_FOR_NORMALIZATION, Math.min(MAX_PICK_ORDER_FOR_NORMALIZATION, pRaw));
      const range = MAX_PICK_ORDER_FOR_NORMALIZATION - MIN_PICK_ORDER_FOR_NORMALIZATION;
      if (range > 0) {
        pNormalized = (MAX_PICK_ORDER_FOR_NORMALIZATION - clampedPRaw) / range; // Lower pick order number is better
      }
    }
    entity.consolidatedScore = (WEIGHT_VALUE_PERCENTAGE * vScaled) +
      (WEIGHT_WINRATE * wNormalized) +
      (WEIGHT_PICK_ORDER * pNormalized);
    return entity;
  });
}

function checkMyHeroPickedUltimate(selectedHeroDbId, heroesForUI, pickedAbilities) {
  if (selectedHeroDbId === null) return false;
  const myDraftingHeroUIInfo = heroesForUI.find(h => h.dbHeroId === selectedHeroDbId);
  if (!myDraftingHeroUIInfo) return false;

  const myDraftingHeroSlotOrder = myDraftingHeroUIInfo.heroOrder;
  for (const pickedAbility of pickedAbilities) {
    if (pickedAbility.name && pickedAbility.hero_order === myDraftingHeroSlotOrder && pickedAbility.is_ultimate === true) {
      console.log(`[MainScanLogic] "My Hero" (DB ID: ${selectedHeroDbId}) picked an ultimate: ${pickedAbility.name}`);
      return true;
    }
  }
  return false;
}

function determineTopTierEntities(allScoredEntities, selectedModelId, myHeroHasUlt, synergisticPartnersInPoolForMyHeroSet = new Set()) {
  let entitiesToConsider = [...allScoredEntities];
  const finalTopTierEntities = [];

  if (myHeroHasUlt) {
    console.log('[MainScanLogic] My Hero has an ultimate. Filtering out ultimates from suggestions.');
    entitiesToConsider = entitiesToConsider.filter(entity => {
      if (entity.entityType === 'ability') return entity.is_ultimate_from_coord_source !== true && entity.is_ultimate_from_db !== true;
      return true; // Keep hero models
    });
    synergisticPartnersInPoolForMyHeroSet.forEach(partnerName => {
      const partnerEntity = allScoredEntities.find(e => e.internalName === partnerName);
      if (partnerEntity && (partnerEntity.is_ultimate_from_coord_source === true || partnerEntity.is_ultimate_from_db === true)) {
        synergisticPartnersInPoolForMyHeroSet.delete(partnerName);
      }
    });
  }

  if (selectedModelId !== null) {
    console.log(`[MainScanLogic] "My Model" (ID: ${selectedModelId}) is selected. Filtering general Top Tier to abilities only.`);
  }

  const synergySuggestionsFromPool = [];
  entitiesToConsider = entitiesToConsider.filter(entity => {
    if (entity.entityType === 'ability' && synergisticPartnersInPoolForMyHeroSet.has(entity.internalName)) {
      synergySuggestionsFromPool.push({ ...entity, isSynergySuggestionForMyHero: true, isGeneralTopTier: false });
      return false;
    }
    return true;
  });
  synergySuggestionsFromPool.sort((a, b) => b.consolidatedScore - a.consolidatedScore);
  finalTopTierEntities.push(...synergySuggestionsFromPool);
  console.log(`[MainScanLogic] Added ${synergySuggestionsFromPool.length} synergy suggestions for My Hero.`);

  const remainingSlots = NUM_TOP_TIER_SUGGESTIONS - finalTopTierEntities.length;
  if (remainingSlots > 0) {
    let generalCandidates = [...entitiesToConsider];
    if (selectedModelId !== null) { // If a model is selected, general picks should only be abilities
      generalCandidates = generalCandidates.filter(entity => entity.entityType === 'ability');
    }
    const generalTopPicks = generalCandidates
      .sort((a, b) => b.consolidatedScore - a.consolidatedScore)
      .slice(0, remainingSlots)
      .map(entity => ({ ...entity, isSynergySuggestionForMyHero: false, isGeneralTopTier: true }));
    finalTopTierEntities.push(...generalTopPicks);
    console.log(`[MainScanLogic] Added ${generalTopPicks.length} general top tier picks.`);
  }
  console.log(`[MainScanLogic] Total top tier entities determined: ${finalTopTierEntities.length}`);
  return finalTopTierEntities;
}

function enrichHeroModelDataWithFlags(heroModels, topTierMarkedEntities, allScoredEntities) {
  if (!heroModels) return [];
  return heroModels.map(hModel => {
    const scoredEntity = allScoredEntities.find(e => e.entityType === 'hero' && e.internalName === hModel.heroName);
    const topTierEntry = topTierMarkedEntities.find(tte => tte.entityType === 'hero' && tte.internalName === hModel.heroName && tte.isGeneralTopTier);
    return {
      ...hModel,
      isGeneralTopTier: !!topTierEntry,
      isSynergySuggestionForMyHero: false,
      consolidatedScore: scoredEntity ? scoredEntity.consolidatedScore : 0,
    };
  });
}

function formatResultsForUiWithFlags(
  predictedResultsArray, abilityDetailsMap, topTierMarkedEntitiesArray,
  slotType, allScoredEntities, isForSelectedAbilityList = false
) {
  if (!Array.isArray(predictedResultsArray)) return [];
  return predictedResultsArray.map(result => {
    const internalName = result.name;
    const originalCoord = result.coord;
    const isUltimateFromLayoutSlot = result.is_ultimate;

    if (internalName === null) {
      return {
        internalName: null, displayName: 'Unknown Ability', winrate: null, highSkillWinrate: null,
        avgPickOrder: null, valuePercentage: null, highWinrateCombinations: [],
        isGeneralTopTier: false, isSynergySuggestionForMyHero: false,
        confidence: result.confidence, hero_order: result.hero_order, ability_order: result.ability_order,
        is_ultimate_from_layout: isUltimateFromLayoutSlot, is_ultimate_from_db: null,
        consolidatedScore: 0, coord: originalCoord
      };
    }

    const dbDetails = abilityDetailsMap.get(internalName);
    const topTierEntry = !isForSelectedAbilityList ? topTierMarkedEntitiesArray.find(tte => tte.entityType === 'ability' && tte.internalName === internalName) : null;
    const scoredPoolEntity = !isForSelectedAbilityList ? allScoredEntities.find(e => e.entityType === 'ability' && e.internalName === internalName) : null;

    return {
      internalName: internalName,
      displayName: dbDetails ? (dbDetails.displayName || internalName) : internalName,
      winrate: dbDetails ? dbDetails.winrate : null,
      highSkillWinrate: dbDetails ? dbDetails.highSkillWinrate : null,
      avgPickOrder: dbDetails ? dbDetails.avgPickOrder : null,
      valuePercentage: dbDetails ? dbDetails.valuePercentage : null,
      is_ultimate_from_db: dbDetails ? dbDetails.is_ultimate : null,
      is_ultimate_from_layout: isUltimateFromLayoutSlot,
      ability_order_from_db: dbDetails ? dbDetails.ability_order : null,
      highWinrateCombinations: dbDetails ? (dbDetails.highWinrateCombinations || []) : [],
      isGeneralTopTier: topTierEntry ? (topTierEntry.isGeneralTopTier || false) : false,
      isSynergySuggestionForMyHero: topTierEntry ? (topTierEntry.isSynergySuggestionForMyHero || false) : false,
      confidence: result.confidence,
      hero_order: result.hero_order,
      ability_order: result.ability_order,
      consolidatedScore: scoredPoolEntity ? (scoredPoolEntity.consolidatedScore || 0) : (dbDetails ? 0 : 0), // Fallback score if not in pool
      coord: originalCoord
    };
  });
}

// --- Snapshot and Export IPC Handlers ---

ipcMain.on('take-snapshot', async (event) => {
  if (!lastRawScanResults || !lastScanTargetResolution) {
    sendStatusUpdate(overlayWindow.webContents, 'snapshot-taken-status', { message: 'Error: No scan data available for snapshot.', error: true, allowRetry: true });
    return;
  }

  const userDataPath = app.getPath('userData');
  const failedSamplesDir = path.join(userDataPath, 'failed-samples');

  try {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.webContents && !overlayWindow.webContents.isDestroyed()) {
      overlayWindow.webContents.send('toggle-hotspot-borders', false);
      await delay(150);
    }

    await fs.mkdir(failedSamplesDir, { recursive: true });
    const fullScreenshotBuffer = await screenshotDesktop({ format: 'png' });
    const layoutConfig = JSON.parse(await fs.readFile(layoutCoordinatesPath, 'utf-8'));
    const coordsConfig = layoutConfig.resolutions?.[lastScanTargetResolution];

    if (!coordsConfig) {
      throw new Error(`Snapshot coordinates not found for resolution: ${lastScanTargetResolution}.`);
    }

    const allSlotsForSnapshot = [];
    const addSlots = (slotType, coordsArray, resultsArray) => {
      if (coordsArray && resultsArray) {
        coordsArray.forEach((coord, i) => {
          if (resultsArray[i]) {
            allSlotsForSnapshot.push({
              ...coord,
              predictedName: resultsArray[i].name || `unknown_${slotType}_ho${coord.hero_order || 'X'}_idx${i}`,
              type: slotType
            });
          }
        });
      }
    };

    addSlots('ult', coordsConfig.ultimate_slots_coords, lastRawScanResults.ultimates);
    addSlots('std', coordsConfig.standard_slots_coords, lastRawScanResults.standard);

    if (coordsConfig.selected_abilities_coords && coordsConfig.selected_abilities_params && lastRawScanResults.selectedAbilities) {
      lastRawScanResults.selectedAbilities.forEach((abilityResult, i) => {
        const heroOrderForThisAbility = abilityResult.hero_order;
        const coordsForThisHeroInLayout = coordsConfig.selected_abilities_coords.filter(c => c.hero_order === heroOrderForThisAbility);

        // Determine the 0-based index of this ability among those picked by the same hero,
        // to map to the correct layout coordinate.
        let NthAbilityForThisHero = 0;
        for (let k = 0; k < i; k++) {
          if (lastRawScanResults.selectedAbilities[k].hero_order === heroOrderForThisAbility) {
            NthAbilityForThisHero++;
          }
        }
        const specificCoordIndex = NthAbilityForThisHero;

        if (specificCoordIndex !== -1 && specificCoordIndex < coordsForThisHeroInLayout.length) {
          const specificCoord = coordsForThisHeroInLayout[specificCoordIndex];
          if (specificCoord) {
            allSlotsForSnapshot.push({
              ...specificCoord,
              width: coordsConfig.selected_abilities_params.width,
              height: coordsConfig.selected_abilities_params.height,
              predictedName: abilityResult.name || `unknown_sel_ho${abilityResult.hero_order}_idx${specificCoordIndex}`,
              type: 'sel'
            });
          }
        }
      });
    }

    let savedCount = 0;
    for (const slot of allSlotsForSnapshot) {
      if (typeof slot.x !== 'number' || typeof slot.y !== 'number' ||
        typeof slot.width !== 'number' || typeof slot.height !== 'number' ||
        slot.width <= 0 || slot.height <= 0) {
        console.warn(`[MainSnapshot] Skipping slot with invalid dims:`, slot);
        continue;
      }
      try {
        const randomString = crypto.randomBytes(3).toString('hex');
        const safePredictedName = (slot.predictedName || `unknown_${slot.type}_ho${slot.hero_order || 'X'}_ao${slot.ability_order || 'N'}`).replace(/[^a-z0-9_.-]/gi, '_').substring(0, 50);
        const filename = `${safePredictedName}-${randomString}.png`;
        await sharp(fullScreenshotBuffer)
          .extract({ left: Math.round(slot.x), top: Math.round(slot.y), width: Math.round(slot.width), height: Math.round(slot.height) })
          .toFile(path.join(failedSamplesDir, filename));
        savedCount++;
      } catch (cropError) {
        console.error(`[MainSnapshot] Snapshot crop error for ${slot.predictedName}: ${cropError.message}`);
      }
    }
    sendStatusUpdate(overlayWindow.webContents, 'snapshot-taken-status', { message: `Snapshot: ${savedCount} images saved to app data.`, error: false, allowRetry: true });
  } catch (error) {
    console.error('[MainSnapshot] Error taking snapshot:', error);
    sendStatusUpdate(overlayWindow.webContents, 'snapshot-taken-status', { message: `Snapshot Error: ${error.message}`, error: true, allowRetry: true });
  } finally {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.webContents && !overlayWindow.webContents.isDestroyed()) {
      overlayWindow.webContents.send('toggle-hotspot-borders', true);
    }
  }
});

ipcMain.on('export-failed-samples', async (event) => {
  const sendStatus = (message, error = false, inProgress = true, filePath = null) => {
    sendStatusUpdate(event.sender, 'export-failed-samples-status', { message, error, inProgress, filePath });
  };

  const userDataPath = app.getPath('userData');
  const failedSamplesDir = path.join(userDataPath, 'failed-samples');

  try {
    await fs.access(failedSamplesDir);
    const imageFiles = (await fs.readdir(failedSamplesDir)).filter(f => f.toLowerCase().endsWith('.png'));

    if (imageFiles.length === 0) {
      sendStatus('No image files found in the failed samples directory to export.', false, false);
      return;
    }

    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Failed Samples Zip',
      defaultPath: path.join(app.getPath('downloads'), `adplus-failed-samples-${new Date().toISOString().split('T')[0]}.zip`),
      filters: [{ name: 'Zip Archives', extensions: ['zip'] }]
    });

    if (canceled || !filePath) {
      sendStatus('Export canceled by user.', false, false);
      return;
    }

    sendStatus(`Zipping ${imageFiles.length} samples...`, false, true);
    const output = require('fs').createWriteStream(filePath); // Node's fs for stream
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.on('warning', (warn) => console.warn("[MainExport] Archiver warning:", warn));

      archive.pipe(output);
      for (const fileName of imageFiles) {
        archive.file(path.join(failedSamplesDir, fileName), { name: fileName });
      }
      archive.finalize();
    });

    sendStatus(`Exported ${imageFiles.length} samples to ${filePath}`, false, false, filePath);

  } catch (error) {
    if (error.code === 'ENOENT' && error.path === failedSamplesDir) {
      sendStatus('No failed samples directory found. Take some snapshots first.', false, false);
    } else {
      console.error('[MainExport] Error exporting failed samples:', error);
      sendStatus(`Export Error: ${error.message}`, true, false);
    }
  }
});

ipcMain.on('submit-new-resolution-snapshot', async (event) => {
  const sendStatus = (message, error = false, inProgress = true) => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('submit-new-resolution-status', { message, error, inProgress });
    } else if (!inProgress) {
      console.log(`[Main] submit-new-resolution-status (mainWindow gone): ${message}`);
    }
  };

  console.log('[Main] Received request to submit new resolution snapshot.');
  let wasMainWindowVisible = false;

  try {
    // 1. Determine current primary screen resolution
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;
    const scaleFactor = primaryDisplay.scaleFactor;
    const resolutionString = `${width}x${height}`;
    console.log(`[Main] Current primary display resolution: ${resolutionString}, Scale Factor: ${scaleFactor}`);

    // 2. Hide Control Panel if visible and add delay
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      wasMainWindowVisible = true;
      sendStatus('Hiding control panel for screenshot...', false, true);
      mainWindow.hide();
      await delay(2000); // 2-second delay for the window to hide
    } else {
      await delay(100);
    }

    // 3. Take a full-screen screenshot
    sendStatus('Capturing screen...', false, true);
    const screenshotBuffer = await screenshotDesktop({ format: 'png' }); //
    console.log(`[Main] Screenshot taken, buffer size: ${screenshotBuffer.length} bytes.`);

    // 4. API Call (existing logic)
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const httpMethod = 'POST';
    const requestPath = '/resolution-request';

    const signature = generateHmacSignature(
      CLIENT_SHARED_SECRET,
      httpMethod,
      requestPath,
      timestamp,
      nonce,
      CLIENT_API_KEY
    );

    const headers = {
      'Content-Type': 'image/png',
      'x-resolution-string': resolutionString,
      'x-scale-factor': scaleFactor.toString(),
      'x-api-key': CLIENT_API_KEY,
      'x-request-timestamp': timestamp,
      'x-nonce': nonce,
      'x-signature': signature
    };

    sendStatus('Submitting screenshot to API with security headers...', false, true);
    console.log(`[Main] Sending screenshot for ${resolutionString} with signature.`);
    console.log(`[Main] Headers being sent:`, JSON.stringify(headers, null, 2));


    const response = await axios.post(API_ENDPOINT_URL + '/failed-samples-upload', screenshotBuffer, {
      headers: headers,
      responseType: 'json',
    });

    console.log('[Main] API Response:', response.data);
    if (response.status === 200 && response.data.message) {
      sendStatus(response.data.message, false, false);
    } else {
      throw new Error(response.data.error || `API returned status ${response.status}`);
    }

  } catch (error) {
    console.error('[Main] Error processing new resolution snapshot:', error);
    let errorMessage = 'Failed to process/submit snapshot.';
    if (error.response && error.response.data && (error.response.data.error || error.response.data.message)) {
      errorMessage = `API Error: ${error.response.data.error || error.response.data.message}`;
    } else if (error.message) {
      errorMessage = error.message;
    }
    sendStatus(errorMessage, true, false);
  } finally {
    // 5. Show Control Panel again if it was hidden by this process
    if (wasMainWindowVisible && mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      if (!mainWindow.isFocused()) {
        mainWindow.focus();
      }
      console.log('[Main] Control panel should be visible and focused if it was hidden.');
    }
  }
});