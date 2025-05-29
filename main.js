const { app, BrowserWindow, ipcMain, screen, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const Database = require('better-sqlite3');
const archiver = require('archiver');
const screenshotDesktop = require('screenshot-desktop');
const sharp = require('sharp');

// --- Local Modules ---
const setupDatabase = require('./src/database/setupDatabase');
const {
  getAbilityDetails,
  getHighWinrateCombinations,
  getOPCombinationsInPool,
  getAllOPCombinations,
  getHeroDetailsByAbilityName,
  getHeroDetailsById
} = require('./src/database/queries');
const { scrapeAndStoreAbilitiesAndHeroes } = require('./src/scraper/abilityScraper');
const { scrapeAndStoreAbilityPairs } = require('./src/scraper/abilityPairScraper');
const { processDraftScreen: performMlScan, initializeImageProcessor, identifySlotsFromCache, initializeImageProcessorIfNeeded } = require('./src/imageProcessor'); // Renamed for clarity

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
const WEIGHT_VALUE_PERCENTAGE = 0.40; // Weight for ability/hero 'value_percentage'
const WEIGHT_WINRATE = 0.20;          // Weight for ability/hero 'winrate'
const WEIGHT_PICK_ORDER = 0.40;       // Weight for ability/hero 'avg_pick_order'

// Pick Order Normalization Range (for scoring)
const MIN_PICK_ORDER_FOR_NORMALIZATION = 1.0;
const MAX_PICK_ORDER_FOR_NORMALIZATION = 40.0; // Higher pick order is less desirable

// --- Global State ---
let mainWindow = null;
let overlayWindow = null;
let activeDbPath = '';
let layoutCoordinatesPath = '';

let initialPoolAbilitiesCache = { ultimates: [], standard: [] };
let fullLayoutConfigCache = null;
let classNamesCache = null;

let isScanInProgress = false;
let lastRawScanResults = null; // Stores raw results from processDraftScreen for snapshotting
let lastScanTargetResolution = null;
let lastUsedScaleFactor = 1.0;
let isFirstAppRun = false; // Flag to manage initial setup/messaging

// State for "My Hero" and "My Model" selections
let mySelectedHeroDbIdForDrafting = null;       // DB ID of the hero the user is drafting for
let mySelectedHeroOriginalOrder = null;         // Original hero_order (0-9) from the list for "My Hero"
let mySelectedModelDbHeroId = null;             // DB ID of the hero selected as a "model" for suggestions
let mySelectedModelScreenOrder = null;          // hero_order (0-11) on screen for "My Model"

let identifiedHeroModelsCache = null; // Caches identified hero models from the initial scan

// --- Utility Functions ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Sends status updates to a specific webContents target.
 * @param {Electron.WebContents | null} targetWebContents - ThewebContents to send the status to.
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
 * This is used to map ML model output indices to ability internal names.
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
      throw err; // Rethrow to be caught by scan logic
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
      if (year && month && day) { // Basic validation
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
    await scrapeAndStoreAbilitiesAndHeroes(activeDbPath, ABILITIES_URL, ABILITIES_HIGH_SKILL_URL, sendStatus); //
    await delay(100);

    sendStatus('Phase 2/2: Updating ability pair data...');
    await scrapeAndStoreAbilityPairs(activeDbPath, ABILITY_PAIRS_URL, sendStatus); //
    await delay(100);

    const newDate = await updateLastSuccessfulScrapeDate(activeDbPath);
    sendLastUpdatedDateToRenderer(statusCallbackWebContents, newDate);
    sendStatus('All Windrun.io data updates finished successfully!');
    return true;
  } catch (error) {
    console.error('[MainScrape] Consolidated scraping failed:', error.message);
    sendStatus(`Error during data update. Operation halted. Check logs for details. (${error.message})`);
    const currentDate = await getLastSuccessfulScrapeDate(activeDbPath); // Show last known good date
    sendLastUpdatedDateToRenderer(statusCallbackWebContents, currentDate);
    return false;
  }
}

// --- Main Window Creation ---
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800, // Adjusted for potentially more content with better styling
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), //
      nodeIntegration: false, // Best practice
      contextIsolation: true, // Best practice
    }
  });
  mainWindow.loadFile('index.html'); //

  mainWindow.webContents.on('did-finish-load', async () => {
    const lastDate = await getLastSuccessfulScrapeDate(activeDbPath);
    sendLastUpdatedDateToRenderer(mainWindow.webContents, lastDate);
    if (isFirstAppRun) {
      sendStatusUpdate(mainWindow.webContents, 'scrape-status', 'Using bundled data. Update data via "Update Windrun Data" if needed.');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- Overlay Window Creation & Management ---
/**
 * Creates or recreates the overlay window.
 * @param {string} resolutionKey - The target screen resolution key (e.g., "1920x1080").
 * @param {object} allCoordinatesConfig - The full layout coordinates configuration object.
 * @param {number} scaleFactorToUse - The display scale factor.
 */
function createOverlayWindow(resolutionKey, allCoordinatesConfig, scaleFactorToUse) {
  if (overlayWindow) {
    overlayWindow.close(); // Close existing before creating new
  }
  // Reset scan-related state when overlay is (re)created
  isScanInProgress = false;
  lastRawScanResults = null;
  lastScanTargetResolution = null;
  identifiedHeroModelsCache = null;
  mySelectedModelDbHeroId = null;
  mySelectedModelScreenOrder = null;
  // mySelectedHeroDbIdForDrafting and mySelectedHeroOriginalOrder are NOT reset here,
  // as the user might want to keep their hero selection across overlay reactivations within the same draft.

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight, x, y } = primaryDisplay.bounds;

  overlayWindow = new BrowserWindow({
    width: screenWidth,
    height: screenHeight,
    x, y,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    focusable: false, // Important for overlays not to steal focus
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), //
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  overlayWindow.loadFile(path.join(__dirname, 'overlay.html')); //
  overlayWindow.setAlwaysOnTop(true, 'screen-saver'); // Keep on top of other windows
  overlayWindow.setVisibleOnAllWorkspaces(true); // For multi-desktop environments
  overlayWindow.setIgnoreMouseEvents(true, { forward: true }); // Allows clicking through the overlay

  overlayWindow.webContents.on('did-finish-load', () => {
    // Send initial data needed by the overlay
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
    // Do not reset mySelectedModel here, as it might be set from main window later
    // Do not reset mySelectedHero here either for same reason.

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
  layoutCoordinatesPath = path.join(BASE_RESOURCES_PATH, 'config', LAYOUT_COORDS_FILENAME); //
  const bundledDbPathInApp = path.join(BASE_RESOURCES_PATH, DB_FILENAME); //

  // Initialize Image Processor (TFJS Model)
  try {
    const modelBasePath = path.join(BASE_RESOURCES_PATH, 'model', MODEL_DIR_NAME); //
    const modelJsonPath = path.join(modelBasePath, MODEL_FILENAME); //
    const modelFileUrl = 'file://' + modelJsonPath.replace(/\\/g, '/'); // TFJS needs file URI
    const classNamesJsonPath = path.join(modelBasePath, CLASS_NAMES_FILENAME); //
    initializeImageProcessor(modelFileUrl, classNamesJsonPath); //
  } catch (initError) {
    console.error('[MainInit] Failed to initialize image processor:', initError);
    dialog.showErrorBox('Fatal Initialization Error', `Failed to initialize the ML model: ${initError.message}. The application will now close.`);
    app.quit();
    return;
  }

  // Database Setup (Copy if first run, then ensure schema)
  try {
    await fs.access(activeDbPath);
  } catch (e) { // Database doesn't exist in userData, so it's a first run or data was cleared
    isFirstAppRun = true;
    console.log('[MainInit] Database not found in userData. Attempting to copy bundled database.');
    try {
      await fs.mkdir(userDataPath, { recursive: true });
      await fs.copyFile(bundledDbPathInApp, activeDbPath);
      console.log('[MainInit] Bundled database copied successfully.');
    } catch (copyError) {
      isFirstAppRun = false; // Reset flag as setup failed partially
      console.error('[MainInit] Failed to copy bundled database:', copyError);
      dialog.showErrorBox('Database Error', `Failed to copy the local database: ${copyError.message}. The application might not function correctly.`);
      // Continue, but app might be in a bad state. setupDatabase() might still create an empty one.
    }
  }

  try {
    setupDatabase(); //
  } catch (dbSetupError) {
    console.error('[MainInit] Failed to set up database schema:', dbSetupError);
    dialog.showErrorBox('Database Setup Error', `Failed to prepare the database: ${dbSetupError.message}. The application will now close.`);
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
  if (process.platform !== 'darwin') { // macOS apps usually stay active
    app.quit();
  }
});

app.on('will-quit', () => {
  // Clean up resources or state if needed before quitting
  isScanInProgress = false; // Stop any ongoing scans
});


// --- IPC Handlers ---

ipcMain.on('scrape-all-windrun-data', async (event) => {
  await performFullScrape(event.sender);
});

ipcMain.on('get-available-resolutions', async (event) => {
  try {
    const configData = await fs.readFile(layoutCoordinatesPath, 'utf-8'); //
    const layoutConfig = JSON.parse(configData);
    const resolutions = layoutConfig?.resolutions ? Object.keys(layoutConfig.resolutions) : [];
    event.sender.send('available-resolutions', resolutions); //
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

  initialPoolAbilitiesCache = { ultimates: [], standard: [] }; // Reset on new overlay
  identifiedHeroModelsCache = null; // Also reset identified models

  // Load layout config once if not already cached
  if (!fullLayoutConfigCache) {
    try {
      const layoutData = await fs.readFile(layoutCoordinatesPath, 'utf-8'); //
      fullLayoutConfigCache = JSON.parse(layoutData);
    } catch (err) {
      console.error("[MainIPC] Failed to load layout_coordinates.json for activate-overlay:", err);
      sendStatusUpdate(event.sender, 'scan-results', { error: `Failed to load layout configuration: ${err.message}`, resolution: selectedResolution });
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
      return;
    }
  }

  try {
    await loadClassNamesForMain(); // Pre-load class names
    await initializeImageProcessorIfNeeded(); // Ensure imageProcessor is ready
  } catch (e) {
    console.error("[MainIPC] Failed to initialize for activate-overlay:", e);
    sendStatusUpdate(event.sender, 'scan-results', { error: `Failed to initialize for overlay: ${e.message}`, resolution: selectedResolution });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    return;
  }

  try {
    // Use the cached layoutConfig directly
    const layoutConfigToUse = fullLayoutConfigCache;
    if (!layoutConfigToUse) {
      throw new Error("Layout configuration cache is unexpectedly empty.");
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    lastUsedScaleFactor = primaryDisplay.scaleFactor || 1.0; // Store for use in overlay

    createOverlayWindow(selectedResolution, layoutConfigToUse, lastUsedScaleFactor);
    sendStatusUpdate(event.sender, 'scrape-status', `Overlay activated for ${selectedResolution}. Main window hidden.`);
  } catch (error) {
    console.error('[MainIPC] Overlay Activation Error:', error);
    sendStatusUpdate(event.sender, 'scrape-status', `Overlay Activation Error: ${error.message}`);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); // Show main window again on error
  }
});

ipcMain.on('close-overlay', () => { //
  if (overlayWindow) {
    overlayWindow.close(); // This will trigger 'closed' event which shows main window
  } else if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    // Fallback if overlay was somehow closed without event triggering
    mainWindow.show();
    mainWindow.focus();
    sendStatusUpdate(mainWindow.webContents, 'overlay-closed-reset-ui', null);
  }
});

ipcMain.on('set-overlay-mouse-ignore', (event, ignore) => { //
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

ipcMain.on('select-my-model', (event, { heroOrder, dbHeroId }) => { //
  if (mySelectedModelScreenOrder === heroOrder && mySelectedModelDbHeroId === dbHeroId) {
    // Deselect if clicking the same selected model
    mySelectedModelDbHeroId = null;
    mySelectedModelScreenOrder = null;
    console.log(`[MainState] "My Model" deselected.`);
  } else {
    mySelectedModelDbHeroId = dbHeroId;
    mySelectedModelScreenOrder = heroOrder;
    console.log(`[MainState] "My Model" selected: Screen Order ${heroOrder}, DB ID ${dbHeroId}`);
  }
  // Notify overlay of the change
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    sendStatusUpdate(overlayWindow.webContents, 'my-model-selection-changed', {
      selectedModelHeroOrder: mySelectedModelScreenOrder
    });
  }
});

ipcMain.on('select-my-hero-for-drafting', (event, { heroOrder, dbHeroId }) => { //
  // heroOrder here is the original 0-9 index from the hero list on screen sides
  if (mySelectedHeroOriginalOrder === heroOrder && mySelectedHeroDbIdForDrafting === dbHeroId) {
    // Deselect if clicking the same hero
    mySelectedHeroDbIdForDrafting = null;
    mySelectedHeroOriginalOrder = null;
    console.log(`[MainState] "My Hero" (for drafting) deselected.`);
  } else {
    mySelectedHeroDbIdForDrafting = dbHeroId;
    mySelectedHeroOriginalOrder = heroOrder;
    console.log(`[MainState] "My Hero" (for drafting) selected: Original List Order ${heroOrder}, DB ID ${dbHeroId}`);
  }
  // Notify overlay of the change
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    sendStatusUpdate(overlayWindow.webContents, 'my-hero-for-drafting-selection-changed', {
      selectedHeroOrderForDrafting: mySelectedHeroOriginalOrder, // This is what overlayRenderer uses for its button state
      selectedHeroDbId: mySelectedHeroDbIdForDrafting // Send DB ID for potential logic
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
/**
 * Orchestrates the draft screen scan, processes results, and sends data to overlay.
 */
ipcMain.on('execute-scan-from-overlay', async (event, selectedResolution, selectedHeroOriginalOrderFromOverlay, isInitialScan) => { //
  if (isScanInProgress) {
    sendStatusUpdate(overlayWindow.webContents, 'overlay-data', {
      info: 'Scan already in progress. Please wait.',
      targetResolution: lastScanTargetResolution,
      initialSetup: false, // Not an initial setup
      scaleFactor: lastUsedScaleFactor,
      // Send current selections for UI consistency
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
      console.log(`[MainScan] Initial Cache: ${initialPoolAbilitiesCache.ultimates.length} ults, ${initialPoolAbilitiesCache.standard.length} standard abilities cached.`);
      mySelectedModelDbHeroId = null; // Reset model on initial scan
      mySelectedModelScreenOrder = null;
      identifiedHeroModelsCache = await identifyHeroModels(tempRawResults.heroDefiningAbilities, models_coords);
    } else { // This is a Rescan
      console.log("[MainScan] Performing Rescan.");
      if (!initialPoolAbilitiesCache.ultimates.length && !initialPoolAbilitiesCache.standard.length) {
        console.warn("[MainScan] Rescan attempted without cached initial pool. Falling back to full scan logic for this rescan.");
        tempRawResults = await performMlScan(layoutCoordinatesPath, selectedResolution, MIN_PREDICTION_CONFIDENCE);
        initialPoolAbilitiesCache.ultimates = tempRawResults.ultimates
        .filter(item => item.name && item.coord)
        .map(res => ({ ...res, type: 'ultimate' }));
        initialPoolAbilitiesCache.standard = tempRawResults.standard
        .filter(item => item.name && item.coord)
        .map(res => ({ ...res, type: 'standard' }));
        if (!identifiedHeroModelsCache) { // Only identify if not already cached from a previous initial scan
          identifiedHeroModelsCache = await identifyHeroModels(tempRawResults.heroDefiningAbilities, models_coords);
        }
      } else {
        const screenshotBuffer = await screenshotDesktop({ format: 'png' });
        await initializeImageProcessorIfNeeded();
        const { identifySlots } = require('./src/imageProcessor');

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

    // --- NEW: Calculate Synergies for "My Hero" with the current pool ---
    let synergisticPartnersInPoolForMyHero = new Set();
    if (mySelectedHeroDbIdForDrafting !== null && mySelectedHeroOriginalOrder !== null) {
      const myHeroPickedAbilitiesRaw = tempRawResults.selectedAbilities.filter(
        ab => ab.name && ab.hero_order === mySelectedHeroOriginalOrder
      );
      const myHeroPickedAbilityNames = myHeroPickedAbilitiesRaw.map(ab => ab.name);

      if (myHeroPickedAbilityNames.length > 0) {
        console.log(`[MainScanLogic] My Hero (Original Order: ${mySelectedHeroOriginalOrder}) picked: ${myHeroPickedAbilityNames.join(', ')}. Checking synergies with pool of ${centralDraftPoolArray.length} abilities.`);
        for (const pickedAbilityName of myHeroPickedAbilityNames) {
          const combinations = await getHighWinrateCombinations(
            activeDbPath,
            pickedAbilityName,
            centralDraftPoolArray
          );
          combinations.forEach(combo => {
            if (combo.partnerInternalName) { // Ensured by query.js modification
              synergisticPartnersInPoolForMyHero.add(combo.partnerInternalName);
            }
          });
        }
        console.log(`[MainScanLogic] Found ${synergisticPartnersInPoolForMyHero.size} synergistic partners in pool for My Hero's abilities: ${Array.from(synergisticPartnersInPoolForMyHero).join(', ')}`);
      }
    }
    // --- END NEW ---


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
      const a1InCentralPool = uniqueAbilityNamesInPool.has(combo.ability1InternalName);
      const a2InCentralPool = uniqueAbilityNamesInPool.has(combo.ability2InternalName);
      const a1IsPicked = allPickedAbilityNames.has(combo.ability1InternalName);
      const a2IsPicked = allPickedAbilityNames.has(combo.ability2InternalName);
      if (a1InCentralPool && a2InCentralPool) return true;
      if (a1InCentralPool && a2IsPicked) return true;
      if (a1IsPicked && a2InCentralPool) return true;
      return false;
    }).map(combo => ({ ability1DisplayName: combo.ability1DisplayName, ability2DisplayName: combo.ability2DisplayName, synergyWinrate: combo.synergyWinrate }));

    let allEntitiesForScoring = prepareEntitiesForScoring(tempRawResults, abilityDetailsMap, identifiedHeroModelsCache);
    allEntitiesForScoring = calculateConsolidatedScores(allEntitiesForScoring);
    const myHeroHasPickedUltimate = checkMyHeroPickedUltimate(mySelectedHeroDbIdForDrafting, heroesForMyHeroSelectionUI, tempRawResults.selectedAbilities);

    // Pass the new Set of synergistic partners to determineTopTierEntities
    const topTierMarkedEntities = determineTopTierEntities(
      allEntitiesForScoring, mySelectedModelDbHeroId, myHeroHasPickedUltimate, synergisticPartnersInPoolForMyHero
    );

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

/** Identifies hero models based on their defining abilities. */
async function identifyHeroModels(heroDefiningAbilities, modelCoords) {
  const tempIdentifiedHeroesMap = new Map();
  const validDefiningAbilities = heroDefiningAbilities.filter(r => r.name !== null);

  for (const heroAbility of validDefiningAbilities) {
    const heroIdentity = await getHeroDetailsByAbilityName(activeDbPath, heroAbility.name); //
    if (heroIdentity && heroIdentity.hero_id !== null) {
      const fullHeroDetails = await getHeroDetailsById(activeDbPath, heroIdentity.hero_id); //
      if (fullHeroDetails) {
        tempIdentifiedHeroesMap.set(heroAbility.hero_order, { // hero_order from the ability slot
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
  for (const modelCoord of modelCoords) { // modelCoord.hero_order is the screen order of the model box
    const matchedHero = tempIdentifiedHeroesMap.get(modelCoord.hero_order);
    if (matchedHero) {
      heroModelData.push({
        coord: modelCoord, ...matchedHero, heroOrder: modelCoord.hero_order // ensure heroOrder is screen order
      });
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

/** Prepares data for the "My Hero" selection buttons in the overlay. */
function prepareHeroesForMyHeroUI(cachedHeroModels, heroScreenCoords) {
  if (!cachedHeroModels || cachedHeroModels.length === 0 || heroScreenCoords.length === 0) return [];
  const uiData = [];
  for (const heroScreenCoord of heroScreenCoords) { // heroScreenCoord.hero_order is 0-9
    // Find a model whose SCREEN order (model.heroOrder, 0-11) matches the HERO list order (heroScreenCoord.hero_order, 0-9)
    // This assumes a direct mapping or that model slots 0-9 correspond to hero list slots 0-9
    const matchedModel = cachedHeroModels.find(model => model.heroOrder === heroScreenCoord.hero_order);
    if (matchedModel && matchedModel.dbHeroId) {
      uiData.push({
        heroOrder: heroScreenCoord.hero_order, // This is the 0-9 drafting list order
        heroName: matchedModel.heroDisplayName,
        dbHeroId: matchedModel.dbHeroId,
      });
    } else {
      uiData.push({
        heroOrder: heroScreenCoord.hero_order, heroName: "Unknown", dbHeroId: null
      });
    }
  }
  return uiData;
}

/** Collects unique ability names from raw scan results. */
function collectAbilityNames(rawResults) {
  const uniqueAbilityNamesInPool = new Set();
  rawResults.ultimates.forEach(r => r.name && uniqueAbilityNamesInPool.add(r.name));
  rawResults.standard.forEach(r => r.name && uniqueAbilityNamesInPool.add(r.name));

  const allPickedAbilityNames = new Set();
  rawResults.selectedAbilities.forEach(r => r.name && allPickedAbilityNames.add(r.name));
  return { uniqueAbilityNamesInPool, allPickedAbilityNames };
}

/** Prepares abilities and hero models for scoring. */
function prepareEntitiesForScoring(rawResults, abilityDetailsMap, cachedHeroModels) {
  const entities = [];
  // Add abilities from draft pool
  const processPool = (resultsArray, isUltimateSource) => {
    resultsArray.forEach(result => {
      if (result.name) {
        const details = abilityDetailsMap.get(result.name);
        if (details) {
          entities.push({
            ...details,
            is_ultimate_from_coord_source: isUltimateSource, // Based on the slot type in coordinates
            entityType: 'ability',
            consolidatedScore: 0, // Initialize score
            // Keep hero_order and ability_order from rawResults if needed for display mapping
            hero_order_on_screen: result.hero_order,
            ability_order_on_screen: result.ability_order,
          });
        }
      }
    });
  };
  processPool(rawResults.ultimates, true);
  processPool(rawResults.standard, false);

  // Add identified hero models
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
          heroOrderScreen: heroData.heroOrder, // Screen order of the model box
          consolidatedScore: 0 // Initialize score
        });
        addedHeroModelDbIds.add(heroData.dbHeroId);
      }
    }
  }
  return entities;
}

/** Calculates consolidated scores for abilities and heroes. */
function calculateConsolidatedScores(entities) {
  return entities.map(entity => {
    let vRaw = entity.valuePercentage;
    let wRaw = entity.winrate;
    let pRaw = entity.avgPickOrder;

    const vScaled = (vRaw !== null && typeof vRaw === 'number') ? vRaw : 0.5; // Default to neutral if null
    const wNormalized = (wRaw !== null && typeof wRaw === 'number') ? wRaw : 0.5; // Default to neutral

    let pNormalized = 0.5; // Default to neutral
    if (pRaw !== null && typeof pRaw === 'number') {
      const clampedPRaw = Math.max(MIN_PICK_ORDER_FOR_NORMALIZATION, Math.min(MAX_PICK_ORDER_FOR_NORMALIZATION, pRaw));
      const range = MAX_PICK_ORDER_FOR_NORMALIZATION - MIN_PICK_ORDER_FOR_NORMALIZATION;
      if (range > 0) {
        // Lower pick order number is better, so invert
        pNormalized = (MAX_PICK_ORDER_FOR_NORMALIZATION - clampedPRaw) / range;
      }
    }
    entity.consolidatedScore = (WEIGHT_VALUE_PERCENTAGE * vScaled) +
      (WEIGHT_WINRATE * wNormalized) +
      (WEIGHT_PICK_ORDER * pNormalized);
    return entity;
  });
}

/** Checks if the user's selected drafting hero has picked an ultimate. */
function checkMyHeroPickedUltimate(selectedHeroDbId, heroesForUI, pickedAbilities) {
  if (selectedHeroDbId === null) return false;

  const myDraftingHeroUIInfo = heroesForUI.find(h => h.dbHeroId === selectedHeroDbId);
  if (!myDraftingHeroUIInfo) return false;

  const myDraftingHeroSlotOrder = myDraftingHeroUIInfo.heroOrder; // This is the 0-9 list order
  for (const pickedAbility of pickedAbilities) { // pickedAbility.hero_order is also 0-9 list order
    if (pickedAbility.name && pickedAbility.hero_order === myDraftingHeroSlotOrder && pickedAbility.is_ultimate === true) {
      console.log(`[MainScanLogic] "My Hero" (Drafting DB ID: ${selectedHeroDbId}, Slot Order: ${myDraftingHeroSlotOrder}) picked an ultimate: ${pickedAbility.name}`);
      return true;
    }
  }
  return false;
}

/**
 * Determines top-tier entities, prioritizing synergies for "My Hero" if applicable.
 * @param {Array<object>} allScoredEntities - Array of all abilities and hero models, with their scores.
 * @param {string | null} selectedModelId - DB ID of the "My Model" hero, if selected.
 * @param {boolean} myHeroHasUlt - True if "My Hero" has already picked an ultimate.
 * @param {Set<string>} synergisticPartnersInPoolForMyHeroSet - Set of internal names of abilities in pool that synergize with My Hero's picked abilities.
 * @returns {Array<object>} An array of entities marked as top tier, with flags for synergy or general top pick.
 */
function determineTopTierEntities(allScoredEntities, selectedModelId, myHeroHasUlt, synergisticPartnersInPoolForMyHeroSet = new Set()) {
  let entitiesToConsider = [...allScoredEntities];
  const finalTopTierEntities = [];

  // Filter out ultimates if My Hero already has one (applies to both synergy and general picks)
  if (myHeroHasUlt) {
    console.log('[MainScanLogic] My Hero has an ultimate. Filtering out ultimates from all suggestions.');
    entitiesToConsider = entitiesToConsider.filter(entity => {
      if (entity.entityType === 'ability') return entity.is_ultimate_from_coord_source !== true && entity.is_ultimate_from_db !== true;
      return true; // Keep hero models
    });
    // Also filter the synergisticPartners set if it contains ultimates
    synergisticPartnersInPoolForMyHeroSet.forEach(partnerName => {
      const partnerEntity = allScoredEntities.find(e => e.internalName === partnerName);
      if (partnerEntity && (partnerEntity.is_ultimate_from_coord_source === true || partnerEntity.is_ultimate_from_db === true)) {
        synergisticPartnersInPoolForMyHeroSet.delete(partnerName);
        console.log(`[MainScanLogic] Removed ultimate ${partnerName} from synergy suggestions as My Hero has an ult.`);
      }
    });
  }

  // If a model is selected, suggestions should only be abilities (not other hero models) for general picks.
  // Synergy picks are always abilities.
  if (selectedModelId !== null) {
    console.log(`[MainScanLogic] "My Model" (ID: ${selectedModelId}) is selected. Filtering general Top Tier to abilities only.`);
    // This filter will be applied when selecting general candidates
  }


  // 1. Extract and mark synergy suggestions from the (potentially pre-filtered) entitiesToConsider
  const synergySuggestionsFromPool = [];
  entitiesToConsider = entitiesToConsider.filter(entity => {
    if (entity.entityType === 'ability' && synergisticPartnersInPoolForMyHeroSet.has(entity.internalName)) {
      synergySuggestionsFromPool.push({ ...entity, isSynergySuggestionForMyHero: true, isGeneralTopTier: false });
      return false; // Remove from entitiesToConsider so it's not picked again as a general pick
    }
    return true;
  });

  // Sort synergy suggestions by their original score (descending) and add to final list
  synergySuggestionsFromPool.sort((a, b) => b.consolidatedScore - a.consolidatedScore);
  finalTopTierEntities.push(...synergySuggestionsFromPool);
  console.log(`[MainScanLogic] Added ${synergySuggestionsFromPool.length} synergy suggestions for My Hero.`);


  // 2. Fill remaining slots with general top picks
  const remainingSlots = NUM_TOP_TIER_SUGGESTIONS - finalTopTierEntities.length;
  if (remainingSlots > 0) {
    let generalCandidates = [...entitiesToConsider]; // Use the already filtered entitiesToConsider

    // If a model is selected, general picks should only be abilities
    if (selectedModelId !== null) {
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

/**
 * Enriches hero model data with top-tier status and scores, based on flags from determineTopTierEntities.
 */
function enrichHeroModelDataWithFlags(heroModels, topTierMarkedEntities, allScoredEntities) {
  if (!heroModels) return [];
  return heroModels.map(hModel => {
    const scoredEntity = allScoredEntities.find(e => e.entityType === 'hero' && e.internalName === hModel.heroName);
    // For hero models, only "isGeneralTopTier" is relevant from topTierMarkedEntities
    const topTierEntry = topTierMarkedEntities.find(tte => tte.entityType === 'hero' && tte.internalName === hModel.heroName && tte.isGeneralTopTier);

    return {
      ...hModel,
      isGeneralTopTier: !!topTierEntry, // True if found and marked as general top tier
      isSynergySuggestionForMyHero: false, // Heroes are not ability synergies in this context
      consolidatedScore: scoredEntity ? scoredEntity.consolidatedScore : 0,
    };
  });
}

/**
 * Formats raw scan results for the UI, enriching with DB data, scores, and top-tier flags.
 */
function formatResultsForUiWithFlags(
  predictedResultsArray,
  abilityDetailsMap,
  topTierMarkedEntitiesArray, // Direct output from determineTopTierEntities
  // mySelectedHeroDbIdForDrafting, // These might not be needed here if decisions are in determineTopTier
  // heroesForMyHeroSelectionUI,
  // rawSelectedAbilitiesForContext, // For checking if 'my hero' picked it
  slotType, // 'ultimates', 'standard', 'selected'
  allScoredEntities, // For fallback scoring if needed
  isForSelectedAbilityList = false
) {
  if (!Array.isArray(predictedResultsArray)) return [];

  return predictedResultsArray.map(result => {
    const internalName = result.name;
    const originalCoord = result.coord;
    const isUltimateFromLayoutSlot = result.is_ultimate; // is_ultimate flag from the specific slot data in layout.json

    if (internalName === null) {
      return {
        internalName: null, displayName: 'Unknown Ability', winrate: null, highSkillWinrate: null,
        avgPickOrder: null, valuePercentage: null, highWinrateCombinations: [],
        isGeneralTopTier: false, isSynergySuggestionForMyHero: false,
        confidence: result.confidence,
        hero_order: result.hero_order, ability_order: result.ability_order,
        is_ultimate_from_layout: isUltimateFromLayoutSlot,
        is_ultimate_from_db: null,
        consolidatedScore: 0, coord: originalCoord
      };
    }

    const dbDetails = abilityDetailsMap.get(internalName);
    // Find this ability in the topTierMarkedEntitiesArray (if it's a pool ability)
    const topTierEntry = !isForSelectedAbilityList
      ? topTierMarkedEntitiesArray.find(tte => tte.entityType === 'ability' && tte.internalName === internalName)
      : null;

    const scoredPoolEntity = !isForSelectedAbilityList
      ? allScoredEntities.find(e => e.entityType === 'ability' && e.internalName === internalName)
      : null;

    const isSynergySuggestion = topTierEntry ? (topTierEntry.isSynergySuggestionForMyHero || false) : false;
    const isGeneralTopTier = topTierEntry ? (topTierEntry.isGeneralTopTier || false) : false;

    let baseWinrate = null, baseHighSkillWinrate = null, baseAvgPickOrder = null, baseValuePercentage = null;
    let dbIsUltimateFlag = null, dbAbilityOrderVal = null;
    let combinationsForTooltip = [];
    let score = 0;

    if (dbDetails) {
      baseWinrate = dbDetails.winrate;
      baseHighSkillWinrate = dbDetails.highSkillWinrate;
      baseAvgPickOrder = dbDetails.avgPickOrder;
      baseValuePercentage = dbDetails.valuePercentage;
      dbIsUltimateFlag = dbDetails.is_ultimate;
      dbAbilityOrderVal = dbDetails.ability_order;
      combinationsForTooltip = dbDetails.highWinrateCombinations || [];
    }

    if (scoredPoolEntity) {
      score = scoredPoolEntity.consolidatedScore || 0;
    } else if (dbDetails && isForSelectedAbilityList) {
      // For selected abilities, score might not be relevant for "Top Tier Pool" display,
      // but having their base stats is good.
      // If we needed to score them for some reason, we could do it here.
    }

    return {
      internalName: internalName,
      displayName: dbDetails ? (dbDetails.displayName || internalName) : internalName,
      winrate: baseWinrate,
      highSkillWinrate: baseHighSkillWinrate,
      avgPickOrder: baseAvgPickOrder,
      valuePercentage: baseValuePercentage,
      is_ultimate_from_db: dbIsUltimateFlag, // From Abilities table
      is_ultimate_from_layout: isUltimateFromLayoutSlot, // From layout_coordinates.json for the slot
      ability_order_from_db: dbAbilityOrderVal,
      highWinrateCombinations: combinationsForTooltip, // Synergies with current pool
      isGeneralTopTier: isGeneralTopTier,
      isSynergySuggestionForMyHero: isSynergySuggestion,
      confidence: result.confidence,
      hero_order: result.hero_order,
      ability_order: result.ability_order,
      consolidatedScore: score,
      coord: originalCoord
    };
  });
}


// --- Snapshot and Export IPC Handlers ---

ipcMain.on('take-snapshot', async (event) => { //
  if (!lastRawScanResults || !lastScanTargetResolution) {
    sendStatusUpdate(overlayWindow.webContents, 'snapshot-taken-status', { message: 'Error: No scan data available for snapshot.', error: true, allowRetry: true });
    return;
  }

  const userDataPath = app.getPath('userData');
  const failedSamplesDir = path.join(userDataPath, 'failed-samples');

  try {
    // Temporarily hide borders in overlay for cleaner snapshot
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.webContents && !overlayWindow.webContents.isDestroyed()) {
      overlayWindow.webContents.send('toggle-hotspot-borders', false); //
      await delay(150); // Give overlay time to react
    }

    await fs.mkdir(failedSamplesDir, { recursive: true });
    const fullScreenshotBuffer = await screenshotDesktop({ format: 'png' });
    const layoutConfig = JSON.parse(await fs.readFile(layoutCoordinatesPath, 'utf-8')); //
    const coordsConfig = layoutConfig.resolutions?.[lastScanTargetResolution];

    if (!coordsConfig) {
      throw new Error(`Snapshot coordinates not found for resolution: ${lastScanTargetResolution}.`);
    }

    const allSlotsForSnapshot = [];
    // Helper to add slots to the snapshot list
    const addSlots = (slotType, coordsArray, resultsArray) => {
      if (coordsArray && resultsArray) {
        coordsArray.forEach((coord, i) => {
          if (resultsArray[i]) { // Ensure result exists for the coord
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

    // Handle selected abilities (they have combined coords + params)
    if (coordsConfig.selected_abilities_coords && coordsConfig.selected_abilities_params && lastRawScanResults.selectedAbilities) {
      lastRawScanResults.selectedAbilities.forEach((abilityResult, i) => {
        // This logic for finding the correct coord for selected abilities needs to be robust.
        // Assuming selected_abilities_coords from JSON and abilityResult from ML scan are in a compatible order
        // or that hero_order and some implicit ordering within that hero_order match up.
        // The original code had a complex way to find the specific coord; simplifying if possible,
        // but retaining the idea: find the Nth ability for a hero_order.
        const heroOrderForThisAbility = abilityResult.hero_order;
        const abilitiesForThisHeroInRawResults = lastRawScanResults.selectedAbilities.filter(ab => ab.hero_order === heroOrderForThisAbility);
        const coordsForThisHeroInLayout = coordsConfig.selected_abilities_coords.filter(c => c.hero_order === heroOrderForThisAbility);

        let specificCoordIndex = -1;
        let countForThisHero = 0;
        for (let k = 0; k < i; k++) { // Count how many times this hero_order appeared before current index i in raw results
          if (lastRawScanResults.selectedAbilities[k].hero_order === heroOrderForThisAbility) {
            countForThisHero++;
          }
        }
        specificCoordIndex = countForThisHero;


        if (specificCoordIndex !== -1 && specificCoordIndex < coordsForThisHeroInLayout.length) {
          const specificCoord = coordsForThisHeroInLayout[specificCoordIndex];
          if (specificCoord) {
            allSlotsForSnapshot.push({
              ...specificCoord, // x, y from the specific coord entry
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
        const randomString = crypto.randomBytes(3).toString('hex'); // Shorter random string
        const safePredictedName = (slot.predictedName || `unknown_${slot.type}_ho${slot.hero_order || 'X'}_idx${slot.ability_order || 'N'}`).replace(/[^a-z0-9_.-]/gi, '_').substring(0, 50);
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
    // Restore borders in overlay
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.webContents && !overlayWindow.webContents.isDestroyed()) {
      overlayWindow.webContents.send('toggle-hotspot-borders', true); //
    }
  }
});

ipcMain.on('export-failed-samples', async (event) => { //
  const sendStatus = (message, error = false, inProgress = true, filePath = null) => {
    sendStatusUpdate(event.sender, 'export-failed-samples-status', { message, error, inProgress, filePath });
  };

  const userDataPath = app.getPath('userData');
  const failedSamplesDir = path.join(userDataPath, 'failed-samples');

  try {
    await fs.access(failedSamplesDir); // Check if directory exists
    const imageFiles = (await fs.readdir(failedSamplesDir)).filter(f => f.toLowerCase().endsWith('.png'));

    if (imageFiles.length === 0) {
      sendStatus('No image files found in the failed samples directory to export.', false, false);
      return;
    }

    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, { // mainWindow can be null if only overlay is open.
      title: 'Save Failed Samples Zip',
      defaultPath: path.join(app.getPath('downloads'), `adplus-failed-samples-${new Date().toISOString().split('T')[0]}.zip`),
      filters: [{ name: 'Zip Archives', extensions: ['zip'] }]
    });

    if (canceled || !filePath) {
      sendStatus('Export canceled by user.', false, false);
      return;
    }

    sendStatus(`Zipping ${imageFiles.length} samples...`, false, true);
    const output = require('fs').createWriteStream(filePath); // Use Node's fs for stream
    const archive = archiver('zip', { zlib: { level: 9 } }); // High compression

    // Correct way to handle stream events for archiver
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