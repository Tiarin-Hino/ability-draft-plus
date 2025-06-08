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
  getHeroDetailsById,
  getAllHeroes,
  getAbilitiesByHeroId
} = require('./src/database/queries');
const { scrapeAndStoreAbilitiesAndHeroes } = require('./src/scraper/abilityScraper');
const { scrapeAndStoreAbilityPairs } = require('./src/scraper/abilityPairScraper');
const { scrapeAndStoreLiquipediaData } = require('./src/scraper/liquipediaScraper');
const {
  processDraftScreen: performMlScan,
  initializeImageProcessor,
  identifySlotsFromCache,
  initializeImageProcessorIfNeeded,
  identifySlots
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
const MIN_PREDICTION_CONFIDENCE = 0.90;
const NUM_TOP_TIER_SUGGESTIONS = 10;

// Scoring Weights (sum to 1.0)
const WEIGHT_VALUE_PERCENTAGE = 0.40;
const WEIGHT_WINRATE = 0.20;
const WEIGHT_PICK_ORDER = 0.40;

// Pick Order Normalization Range (for scoring)
const MIN_PICK_ORDER_FOR_NORMALIZATION = 1.0;
const MAX_PICK_ORDER_FOR_NORMALIZATION = 40.0;

// --- Global State ---
let mainWindow = null;
let overlayWindow = null;
let activeDbPath = '';
let layoutCoordinatesPath = '';

let initialPoolAbilitiesCache = { ultimates: [], standard: [] };
let fullLayoutConfigCache = null;
let classNamesCache = null;

let isScanInProgress = false;
let lastRawScanResults = null;
let lastScanTargetResolution = null;
let lastUsedScaleFactor = 1.0;
let isFirstAppRun = false;

// State for "My Hero" and "My Model" selections
let mySelectedHeroDbIdForDrafting = null;
let mySelectedHeroOriginalOrder = null;
let mySelectedModelDbHeroId = null;
let mySelectedModelScreenOrder = null;

let identifiedHeroModelsCache = null;

// --- Utility Functions ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let PROD_API_URL, PROD_CLIENT_KEY, PROD_SHARED_SECRET;

if (app.isPackaged) {
  try {
    const appConfig = require('./src/app-config.js');
    PROD_API_URL = appConfig.API_ENDPOINT_URL;
    PROD_CLIENT_KEY = appConfig.CLIENT_API_KEY;
    PROD_SHARED_SECRET = appConfig.CLIENT_SHARED_SECRET;
  } catch (e) {
    console.error('[Main] FATAL: Could not load app-config.js in packaged app!', e);
  }
}

if (!app.isPackaged) {
  try {
    require('dotenv').config();
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

function generateHmacSignature(sharedSecret, httpMethod, requestPath, timestamp, nonce, apiKey) {
  const stringToSign = `${httpMethod}\n${requestPath}\n${timestamp}\n${nonce}\n${apiKey}`;
  return crypto.createHmac('sha256', sharedSecret)
    .update(stringToSign)
    .digest('hex');
}


function sendStatusUpdate(targetWebContents, channel, message) {
  if (targetWebContents && !targetWebContents.isDestroyed()) {
    targetWebContents.send(channel, message);
  }
}

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

async function performFullScrape(statusCallbackWebContents) {
  const sendStatus = (msg) => sendStatusUpdate(statusCallbackWebContents, 'scrape-status', msg);
  try {
    sendStatus('Starting all data updates...');
    await delay(100);

    sendStatus('Phase 1/3: Updating heroes and abilities data from Windrun.io...');
    await scrapeAndStoreAbilitiesAndHeroes(activeDbPath, ABILITIES_URL, ABILITIES_HIGH_SKILL_URL, sendStatus);
    await delay(100);

    sendStatus('Phase 2/3: Updating ability pair data from Windrun.io...');
    await scrapeAndStoreAbilityPairs(activeDbPath, ABILITY_PAIRS_URL, sendStatus);
    await delay(100);

    if (!IS_PACKAGED) {
      sendStatus('Phase 3/3: Enriching ability data with order and ultimate status from Liquipedia (Dev Mode)...');
      await scrapeAndStoreLiquipediaData(activeDbPath, sendStatus, false);
      await delay(100);
    } else {
      sendStatus('Phase 3/3: Skipping Liquipedia data enrichment (Production Mode).');
      await delay(100);
    }

    const newDate = await updateLastSuccessfulScrapeDate(activeDbPath);
    sendLastUpdatedDateToRenderer(statusCallbackWebContents, newDate);
    sendStatus('All data updates finished successfully!');
    return true;
  } catch (error) {
    console.error('[MainScrape] Consolidated scraping failed:', error.message);
    sendStatus(`Error during data update. Operation halted. Check logs. (${error.message})`);
    const currentDate = await getLastSuccessfulScrapeDate(activeDbPath);
    sendLastUpdatedDateToRenderer(statusCallbackWebContents, currentDate);
    return false;
  }
}

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

nativeTheme.on('updated', () => {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('system-theme-updated', {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors
    });
  }
});

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

  // Open DevTools for the overlay window if not in a packaged app
  if (!IS_PACKAGED) {
    overlayWindow.webContents.openDevTools({ mode: 'detach' });
  }

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
      initialSetup: true,
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

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      sendStatusUpdate(mainWindow.webContents, 'overlay-closed-reset-ui', null);
    }
  });
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  activeDbPath = path.join(userDataPath, DB_FILENAME);
  layoutCoordinatesPath = path.join(BASE_RESOURCES_PATH, 'config', LAYOUT_COORDS_FILENAME);
  const bundledDbPathInApp = path.join(BASE_RESOURCES_PATH, DB_FILENAME);

  try {
    const modelBasePath = path.join(BASE_RESOURCES_PATH, 'model', MODEL_DIR_NAME);
    const modelJsonPath = path.join(modelBasePath, MODEL_FILENAME);
    const modelFileUrl = 'file://' + modelJsonPath.replace(/\\/g, '/');
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

    const response = await axios.post(API_ENDPOINT_URL + '/failed-samples-upload', zipBuffer, {
      headers: headers,
      responseType: 'json',
    });

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
  } else {
    mySelectedModelDbHeroId = dbHeroId;
    mySelectedModelScreenOrder = heroOrder;
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    sendStatusUpdate(overlayWindow.webContents, 'my-model-selection-changed', {
      selectedModelHeroOrder: mySelectedModelScreenOrder
    });
  }
});

ipcMain.on('select-my-hero-for-drafting', (event, { heroOrder, dbHeroId }) => {
  if (mySelectedHeroOriginalOrder === heroOrder && mySelectedHeroDbIdForDrafting === dbHeroId) {
    mySelectedHeroDbIdForDrafting = null;
    mySelectedHeroOriginalOrder = null;
  } else {
    mySelectedHeroDbIdForDrafting = dbHeroId;
    mySelectedHeroOriginalOrder = heroOrder;
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

ipcMain.on('execute-scan-from-overlay', async (event, selectedResolution, selectedHeroOriginalOrderFromOverlay, isInitialScan) => {
  const overallScanStart = performance.now();

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

  try {
    let stepStartTime = performance.now();
    const layoutConfig = fullLayoutConfigCache;
    if (!layoutConfig) {
      const layoutData = await fs.readFile(layoutCoordinatesPath, 'utf-8');
      fullLayoutConfigCache = JSON.parse(layoutData);
    }
    console.log(`[MainScan] Layout config check/load in ${performance.now() - stepStartTime}ms.`);

    stepStartTime = performance.now();
    await loadClassNamesForMain();
    await initializeImageProcessorIfNeeded();
    console.log(`[MainScan] ML initialization check in ${performance.now() - stepStartTime}ms.`);

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

    let tempRawResults;
    let screenshotBuffer;

    if (isInitialScan) {
      stepStartTime = performance.now();
      let initialScanRawResults = await performMlScan(layoutCoordinatesPath, selectedResolution, MIN_PREDICTION_CONFIDENCE);
      screenshotBuffer = await screenshotDesktop({ format: 'png' });
      console.log(`[MainScan] Initial ML scan (focused) and screenshot in ${performance.now() - stepStartTime}ms.`);

      initialPoolAbilitiesCache.ultimates = [];
      initialPoolAbilitiesCache.standard = initialScanRawResults.standard
        .filter(item => item.name && item.coord)
        .map(res => ({ ...res, type: 'standard' }));
      mySelectedModelDbHeroId = null;
      mySelectedModelScreenOrder = null;

      stepStartTime = performance.now();
      identifiedHeroModelsCache = await identifyHeroModels(initialScanRawResults.heroDefiningAbilities, models_coords);
      console.log(`[MainScan] Hero model identification from 2nd abilities in ${performance.now() - stepStartTime}ms.`);

      const abilitiesToDisplayMap = new Map();
      const slotsForAdditionalScan = [];

      initialScanRawResults.standard.forEach(ab => {
        if (ab.name && ab.hero_order !== undefined && ab.ability_order !== undefined) {
          const key = `${ab.hero_order}-${ab.ability_order}`;
          abilitiesToDisplayMap.set(key, ab);
        }
      });

      for (const heroModel of identifiedHeroModelsCache) {
        if (heroModel.dbHeroId !== null && heroModel.heroOrder !== undefined) {
          const heroAbilitiesFromDb = await getAbilitiesByHeroId(activeDbPath, heroModel.dbHeroId);
          const firstSlotCoord = standard_slots_coords.find(s => s.hero_order === heroModel.heroOrder && s.ability_order === 1);
          const thirdSlotCoord = standard_slots_coords.find(s => s.hero_order === heroModel.heroOrder && s.ability_order === 3);
          const ultimateSlotCoord = ultimate_slots_coords.find(s => s.hero_order === heroModel.heroOrder);
          const abilitiesFor1stSlot = heroAbilitiesFromDb.filter(ab => ab.ability_order === 1 && !ab.is_ultimate);
          const abilitiesFor3rdSlot = heroAbilitiesFromDb.filter(ab => ab.ability_order === 3 && !ab.is_ultimate);
          const abilitiesForUltimateSlot = heroAbilitiesFromDb.filter(ab => ab.is_ultimate);

          if (abilitiesFor1stSlot.length === 1 && firstSlotCoord) {
            const ab = abilitiesFor1stSlot[0];
            const key = `${heroModel.heroOrder}-1`;
            abilitiesToDisplayMap.set(key, { name: ab.name, displayName: ab.display_name, confidence: 1.0, hero_order: firstSlotCoord.hero_order, ability_order: firstSlotCoord.ability_order, is_ultimate: false, coord: { x: firstSlotCoord.x, y: firstSlotCoord.y, width: firstSlotCoord.width, height: firstSlotCoord.height } });
          } else if (firstSlotCoord) {
            slotsForAdditionalScan.push({ ...firstSlotCoord, is_ultimate: false });
          }

          if (abilitiesFor3rdSlot.length === 1 && thirdSlotCoord) {
            const ab = abilitiesFor3rdSlot[0];
            const key = `${heroModel.heroOrder}-3`;
            abilitiesToDisplayMap.set(key, { name: ab.name, displayName: ab.display_name, confidence: 1.0, hero_order: thirdSlotCoord.hero_order, ability_order: thirdSlotCoord.ability_order, is_ultimate: false, coord: { x: thirdSlotCoord.x, y: thirdSlotCoord.y, width: thirdSlotCoord.width, height: thirdSlotCoord.height } });
          } else if (thirdSlotCoord) {
            slotsForAdditionalScan.push({ ...thirdSlotCoord, is_ultimate: false });
          }

          if (abilitiesForUltimateSlot.length === 1 && ultimateSlotCoord) {
            const ab = abilitiesForUltimateSlot[0];
            const key = `${heroModel.heroOrder}-ultimate`;
            abilitiesToDisplayMap.set(key, { name: ab.name, displayName: ab.display_name, confidence: 1.0, hero_order: ultimateSlotCoord.hero_order, ability_order: ab.ability_order, is_ultimate: true, coord: { x: ultimateSlotCoord.x, y: ultimateSlotCoord.y, width: ultimateSlotCoord.width, height: ultimateSlotCoord.height } });
          } else if (ultimateSlotCoord) {
            slotsForAdditionalScan.push({ ...ultimateSlotCoord, is_ultimate: true });
          }
        }
      }

      if (slotsForAdditionalScan.length > 0) {
        const currentClassNames = await loadClassNamesForMain();
        const additionalScanResults = await identifySlots(slotsForAdditionalScan, screenshotBuffer, currentClassNames, MIN_PREDICTION_CONFIDENCE);
        additionalScanResults.forEach(ab => {
          if (ab.name && ab.hero_order !== undefined) {
            const key = ab.is_ultimate ? `${ab.hero_order}-ultimate` : `${ab.hero_order}-${ab.ability_order}`;
            const existing = abilitiesToDisplayMap.get(key);
            if (!existing || existing.name === null || ab.confidence > existing.confidence) {
              abilitiesToDisplayMap.set(key, ab);
            }
          }
        });
      }

      const finalUltimates = ultimate_slots_coords.map(coord => {
        const key = `${coord.hero_order}-ultimate`;
        return abilitiesToDisplayMap.get(key) || { name: null, confidence: 0, hero_order: coord.hero_order, is_ultimate: true, coord };
      });

      const finalStandard = standard_slots_coords.map(coord => {
        const key = `${coord.hero_order}-${coord.ability_order}`;
        return abilitiesToDisplayMap.get(key) || { name: null, confidence: 0, hero_order: coord.hero_order, ability_order: coord.ability_order, is_ultimate: false, coord };
      });

      initialPoolAbilitiesCache.ultimates = finalUltimates.filter(item => item.name && item.coord).map(res => ({ ...res, type: 'ultimate' }));
      initialPoolAbilitiesCache.standard = finalStandard.filter(item => item.name && item.coord).map(res => ({ ...res, type: 'standard' }));

      tempRawResults = {
        ultimates: finalUltimates,
        standard: finalStandard,
        selectedAbilities: initialScanRawResults.selectedAbilities,
        heroDefiningAbilities: initialScanRawResults.heroDefiningAbilities
      };

    } else { // Rescan
      screenshotBuffer = await screenshotDesktop({ format: 'png' });
      console.log(`[MainScan] Screenshot captured for rescan in ${performance.now() - stepStartTime}ms.`);

      if (!selected_abilities_params || selected_abilities_coords.length === 0) {
        throw new Error('Selected abilities coordinates are not defined for this resolution.');
      }

      const selectedAbilitySlotsToScan = selected_abilities_coords.map(coord => ({
        ...coord,
        width: selected_abilities_params.width,
        height: selected_abilities_params.height,
      }));

      const currentClassNames = await loadClassNamesForMain();
      stepStartTime = performance.now();
      const identifiedPickedAbilities = await identifySlots(selectedAbilitySlotsToScan, screenshotBuffer, currentClassNames, MIN_PREDICTION_CONFIDENCE);
      console.log(`[MainScan] Identified ${identifiedPickedAbilities.filter(a => a.name).length} picked abilities in ${performance.now() - stepStartTime}ms.`);

      const pickedAbilityNames = new Set(identifiedPickedAbilities.map(a => a.name).filter(Boolean));

      initialPoolAbilitiesCache.standard = initialPoolAbilitiesCache.standard.filter(ability => !pickedAbilityNames.has(ability.name));
      initialPoolAbilitiesCache.ultimates = initialPoolAbilitiesCache.ultimates.filter(ability => !pickedAbilityNames.has(ability.name));

      tempRawResults = {
        ultimates: initialPoolAbilitiesCache.ultimates,
        standard: initialPoolAbilitiesCache.standard,
        selectedAbilities: identifiedPickedAbilities,
        heroDefiningAbilities: []
      };
    }
    lastRawScanResults = { ...tempRawResults };

    let heroesForMyHeroSelectionUI = prepareHeroesForMyHeroUI(identifiedHeroModelsCache, heroes_coords);

    let currentIdentifiedHeroId = null;
    let currentIdentifiedHeroScreenOrder = null;
    if (mySelectedModelScreenOrder !== null && identifiedHeroModelsCache) {
      const selectedModelEntry = identifiedHeroModelsCache.find(model => model.heroOrder === mySelectedModelScreenOrder);
      if (selectedModelEntry && selectedModelEntry.dbHeroId) {
        currentIdentifiedHeroId = selectedModelEntry.dbHeroId;
        currentIdentifiedHeroScreenOrder = selectedModelEntry.heroOrder;
      }
    } else if (mySelectedHeroOriginalOrder !== null && heroesForMyHeroSelectionUI) {
      const selectedHeroEntry = heroesForMyHeroSelectionUI.find(hero => hero.heroOrder === mySelectedHeroOriginalOrder);
      if (selectedHeroEntry && selectedHeroEntry.dbHeroId) {
        currentIdentifiedHeroId = selectedHeroEntry.dbHeroId;
        currentIdentifiedHeroScreenOrder = selectedHeroEntry.heroOrder;
      }
    }
    mySelectedHeroDbIdForDrafting = currentIdentifiedHeroId;
    mySelectedHeroOriginalOrder = currentIdentifiedHeroScreenOrder;


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
        for (const pickedAbilityName of myHeroPickedAbilityNames) {
          const combinations = await getHighWinrateCombinations(activeDbPath, pickedAbilityName, centralDraftPoolArray);
          combinations.forEach(combo => {
            if (combo.partnerInternalName) {
              synergisticPartnersInPoolForMyHero.add(combo.partnerInternalName);
            }
          });
        }
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

    const overallScanEnd = performance.now();
    const durationMs = Math.round(overallScanEnd - overallScanStart);
    console.log(`[MainScan] Overall scan and processing took ${durationMs}ms.`);

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
  for (const heroScreenCoord of heroScreenCoords) {
    const matchedModel = cachedHeroModels.find(model => model.heroOrder === heroScreenCoord.hero_order);
    if (matchedModel && matchedModel.dbHeroId) {
      uiData.push({
        heroOrder: heroScreenCoord.hero_order,
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
        pNormalized = (MAX_PICK_ORDER_FOR_NORMALIZATION - clampedPRaw) / range;
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
      return true;
    }
  }
  return false;
}

function determineTopTierEntities(allScoredEntities, selectedModelId, myHeroHasUlt, synergisticPartnersInPoolForMyHeroSet = new Set()) {
  let entitiesToConsider = [...allScoredEntities];
  const finalTopTierEntities = [];

  if (myHeroHasUlt) {
    entitiesToConsider = entitiesToConsider.filter(entity => {
      if (entity.entityType === 'ability') return entity.is_ultimate_from_coord_source !== true && entity.is_ultimate_from_db !== true;
      return true;
    });
    synergisticPartnersInPoolForMyHeroSet.forEach(partnerName => {
      const partnerEntity = allScoredEntities.find(e => e.internalName === partnerName);
      if (partnerEntity && (partnerEntity.is_ultimate_from_coord_source === true || partnerEntity.is_ultimate_from_db === true)) {
        synergisticPartnersInPoolForMyHeroSet.delete(partnerName);
      }
    });
  }

  if (selectedModelId !== null) {
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

  const remainingSlots = NUM_TOP_TIER_SUGGESTIONS - finalTopTierEntities.length;
  if (remainingSlots > 0) {
    let generalCandidates = [...entitiesToConsider];
    if (selectedModelId !== null) {
      generalCandidates = generalCandidates.filter(entity => entity.entityType === 'ability');
    }
    const generalTopPicks = generalCandidates
      .sort((a, b) => b.consolidatedScore - a.consolidatedScore)
      .slice(0, remainingSlots)
      .map(entity => ({ ...entity, isSynergySuggestionForMyHero: false, isGeneralTopTier: true }));
    finalTopTierEntities.push(...generalTopPicks);
  }
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
      consolidatedScore: scoredPoolEntity ? (scoredPoolEntity.consolidatedScore || 0) : (dbDetails ? 0 : 0),
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
    const output = require('fs').createWriteStream(filePath);
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
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;
    const scaleFactor = primaryDisplay.scaleFactor;
    const resolutionString = `${width}x${height}`;

    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      wasMainWindowVisible = true;
      sendStatus('Hiding control panel for screenshot...', false, true);
      await delay(2000);
    } else {
      await delay(100);
    }

    sendStatus('Capturing screen...', false, true);
    const screenshotBuffer = await screenshotDesktop({ format: 'png' });

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

    const response = await axios.post(API_ENDPOINT_URL + '/failed-samples-upload', screenshotBuffer, {
      headers: headers,
      responseType: 'json',
    });

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
    if (wasMainWindowVisible && mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      if (!mainWindow.isFocused()) {
        mainWindow.focus();
      }
    }
  }
});