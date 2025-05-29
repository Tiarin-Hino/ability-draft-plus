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
  getHeroDetailsByAbilityName,
  getHeroDetailsById
} = require('./src/database/queries');
const { scrapeAndStoreAbilitiesAndHeroes } = require('./src/scraper/abilityScraper');
const { scrapeAndStoreAbilityPairs } = require('./src/scraper/abilityPairScraper');
const { processDraftScreen: performMlScan, initializeImageProcessor } = require('./src/imageProcessor'); // Renamed for clarity

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

ipcMain.on('activate-overlay', async (event, selectedResolution) => { //
  if (!selectedResolution) {
    sendStatusUpdate(event.sender, 'scrape-status', 'Error: No resolution selected for overlay.');
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  try {
    const configData = await fs.readFile(layoutCoordinatesPath, 'utf-8'); //
    const layoutConfig = JSON.parse(configData);
    const primaryDisplay = screen.getPrimaryDisplay();
    lastUsedScaleFactor = primaryDisplay.scaleFactor || 1.0; // Store for use in overlay
    createOverlayWindow(selectedResolution, layoutConfig, lastUsedScaleFactor);
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
  lastRawScanResults = null; // Clear previous raw results to avoid stale snapshot data
  lastScanTargetResolution = selectedResolution; // Store for snapshotting
  const startTime = performance.now();

  try {
    const rawResults = await performMlScan(layoutCoordinatesPath, selectedResolution, MIN_PREDICTION_CONFIDENCE); //
    lastRawScanResults = rawResults; // Cache raw results for snapshot feature

    const layoutConfig = JSON.parse(await fs.readFile(layoutCoordinatesPath, 'utf-8')); //
    const currentModelsCoords = layoutConfig.resolutions[selectedResolution]?.models_coords || [];
    const currentHeroesCoords = layoutConfig.resolutions[selectedResolution]?.heroes_coords || [];

    // Identify Hero Models (cached after first scan)
    if (isInitialScan || !identifiedHeroModelsCache) {
      console.log("[MainScan] Identifying hero models (initial scan or no cache).");
      // Reset "My Model" selection as models are re-identified
      mySelectedModelDbHeroId = null;
      mySelectedModelScreenOrder = null;
      identifiedHeroModelsCache = await identifyHeroModels(rawResults.heroDefiningAbilities, currentModelsCoords);
    } else {
      console.log("[MainScan] Using cached hero model identification data.");
    }

    // Prepare UI data for "My Hero" selection buttons
    const heroesForMyHeroSelectionUI = prepareHeroesForMyHeroUI(identifiedHeroModelsCache, currentHeroesCoords);

    // Gather all unique abilities from draft pool and picked abilities
    const { uniqueAbilityNamesInPool, allPickedAbilityNames } = collectAbilityNames(rawResults);
    const allNamesToFetchDetailsFor = [...new Set([...uniqueAbilityNamesInPool, ...allPickedAbilityNames])];
    const abilityDetailsMap = getAbilityDetails(activeDbPath, allNamesToFetchDetailsFor); //

    // Prepare entities for scoring
    let allEntitiesForScoring = prepareEntitiesForScoring(rawResults, abilityDetailsMap, identifiedHeroModelsCache);

    // Calculate consolidated scores
    allEntitiesForScoring = calculateConsolidatedScores(allEntitiesForScoring);

    // Determine if "My Hero" (drafting) has picked an ultimate
    const myHeroHasPickedUltimate = checkMyHeroPickedUltimate(
      mySelectedHeroDbIdForDrafting, heroesForMyHeroSelectionUI, rawResults.selectedAbilities
    );

    // Determine top-tier entities based on selections and scores
    const topTierEntities = determineTopTierEntities(
      allEntitiesForScoring, mySelectedModelDbHeroId, myHeroHasPickedUltimate
    );
    const topTierEntityIdentifiers = new Set(
      topTierEntities.map(entity => `${entity.entityType}:${entity.internalName}`)
    );

    // Enrich hero model data with top-tier status and scores
    const enrichedHeroModels = enrichHeroModelData(identifiedHeroModelsCache, topTierEntityIdentifiers, allEntitiesForScoring);

    // Get OP Combinations
    const opCombinationsInPool = await getOPCombinationsInPool(activeDbPath, [...uniqueAbilityNamesInPool]); //

    // Format final results for UI
    const formattedUltimates = formatResultsForUi(rawResults.ultimates, abilityDetailsMap, topTierEntityIdentifiers, mySelectedHeroDbIdForDrafting, heroesForMyHeroSelectionUI, rawResults.selectedAbilities, 'ultimates', allEntitiesForScoring);
    const formattedStandard = formatResultsForUi(rawResults.standard, abilityDetailsMap, topTierEntityIdentifiers, mySelectedHeroDbIdForDrafting, heroesForMyHeroSelectionUI, rawResults.selectedAbilities, 'standard', allEntitiesForScoring);
    const formattedSelectedAbilities = formatResultsForUi(rawResults.selectedAbilities, abilityDetailsMap, new Set(), null, [], [], 'selected', allEntitiesForScoring, true);


    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);
    console.log(`[MainScan] Scan and processing took ${durationMs}ms.`);

    sendStatusUpdate(overlayWindow.webContents, 'overlay-data', {
      scanData: {
        ultimates: formattedUltimates,
        standard: formattedStandard,
        selectedAbilities: formattedSelectedAbilities
      },
      heroModels: enrichedHeroModels,
      heroesForMyHeroUI: heroesForMyHeroSelectionUI,
      coordinatesConfig: layoutConfig, // Send full config for overlay to use
      targetResolution: selectedResolution,
      durationMs: durationMs,
      opCombinations: opCombinationsInPool,
      initialSetup: false, // This is a scan result, not initial setup
      scaleFactor: lastUsedScaleFactor,
      selectedHeroForDraftingDbId: mySelectedHeroDbIdForDrafting,
      selectedModelHeroOrder: mySelectedModelScreenOrder
    });

  } catch (error) {
    console.error(`[MainScan] Error during scan for ${selectedResolution}:`, error);
    lastRawScanResults = null; // Clear on error to prevent stale snapshot
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

/** Determines top-tier entities based on scores and current selections. */
function determineTopTierEntities(allScoredEntities, selectedModelId, myHeroHasUlt) {
  let entitiesToConsider = [...allScoredEntities];

  if (selectedModelId !== null) {
    // If a model is selected, suggestions should only be abilities (not other hero models)
    console.log(`[MainScanLogic] "My Model" (ID: ${selectedModelId}) is selected. Filtering Top Tier to abilities only.`);
    entitiesToConsider = entitiesToConsider.filter(entity => entity.entityType === 'ability');
  }

  if (myHeroHasUlt) {
    // If "My Hero" has picked an ultimate, don't suggest more ultimates
    console.log('[MainScanLogic] "My Hero" has an ultimate. Filtering Top Tier to exclude ultimate abilities.');
    entitiesToConsider = entitiesToConsider.filter(entity => {
      if (entity.entityType === 'ability') {
        // is_ultimate_from_coord_source is true if it came from an ultimate_slot_coord
        return entity.is_ultimate_from_coord_source !== true;
      }
      return true; // Keep heroes if they are still being considered
    });
  }

  return entitiesToConsider
    .sort((a, b) => b.consolidatedScore - a.consolidatedScore)
    .slice(0, NUM_TOP_TIER_SUGGESTIONS);
}

/** Enriches hero model data with top-tier status and scores. */
function enrichHeroModelData(heroModels, topTierIdentifiers, allScoredEntities) {
  if (!heroModels) return [];
  return heroModels.map(hModel => {
    const identifier = `hero:${hModel.heroName}`;
    const scoredEntity = allScoredEntities.find(e => e.entityType === 'hero' && e.internalName === hModel.heroName);
    return {
      ...hModel,
      isTopTier: topTierIdentifiers.has(identifier),
      consolidatedScore: scoredEntity ? scoredEntity.consolidatedScore : 0,
    };
  });
}

/** Formats raw scan results for the UI, enriching with DB data and scores. */
function formatResultsForUi(
  predictedResultsArray,
  abilityDetailsMap,
  topTierEntityIdentifiers,
  mySelectedHeroDbIdForDrafting, // Used to determine if an ability is "my hero's selected ability"
  heroesForMyHeroSelectionUI,   // Used to map mySelectedHeroDbIdForDrafting to a screen hero_order
  rawSelectedAbilities,         // Full list of abilities selected by heroes on screen
  slotType, // 'ultimates', 'standard', 'selected'
  allScoredEntities, // Array of all entities with their scores
  isForSelectedAbilityList = false // Flag if formatting the "selectedAbilities" list
) {
  if (!Array.isArray(predictedResultsArray)) return [];

  return predictedResultsArray.map(result => {
    const internalName = result.name;
    // is_ultimate from layout_coordinates.json for this specific slot
    const isUltimateFromLayout = result.is_ultimate;

    if (internalName === null) {
      return {
        internalName: null, displayName: 'Unknown Ability', winrate: null, highSkillWinrate: null,
        avgPickOrder: null, valuePercentage: null, highWinrateCombinations: [], isTopTier: false,
        confidence: result.confidence, hero_order: result.hero_order, // Screen order
        ability_order: result.ability_order, is_ultimate_from_layout: isUltimateFromLayout,
        is_ultimate_from_db: null, is_ultimate_from_coord_source: null, consolidatedScore: 0
      };
    }

    let abilityDataSource;
    let isTopTier = false;
    let isUltimateFromCoordSource = null; // Was this ability from an ultimate slot in the pool?
    let consolidatedScore = 0;
    let highWinrateCombinations = [];

    // For abilities in the draft pool (ultimates, standard)
    if (!isForSelectedAbilityList) {
      abilityDataSource = allScoredEntities.find(e => e.entityType === 'ability' && e.internalName === internalName);
      if (abilityDataSource) {
        isUltimateFromCoordSource = abilityDataSource.is_ultimate_from_coord_source;
        isTopTier = topTierEntityIdentifiers.has(`ability:${internalName}`);
        consolidatedScore = abilityDataSource.consolidatedScore || 0;
        // Synergy combinations are already on abilityDataSource if pre-calculated
        highWinrateCombinations = abilityDataSource.highWinrateCombinations || [];
      }
    } else { // For abilities in the "selectedAbilities" list by heroes
      abilityDataSource = abilityDetailsMap.get(internalName);
      // No top-tier status or combinations needed for already selected abilities list in the same way.
      // Score is also less relevant here as it's already picked.
    }

    if (abilityDataSource) {
      return {
        internalName: abilityDataSource.internalName,
        displayName: abilityDataSource.displayName || abilityDataSource.internalName,
        winrate: abilityDataSource.winrate,
        highSkillWinrate: abilityDataSource.highSkillWinrate,
        avgPickOrder: abilityDataSource.avgPickOrder,
        valuePercentage: abilityDataSource.valuePercentage,
        is_ultimate_from_db: abilityDataSource.is_ultimate, // From Abilities table
        is_ultimate_from_coord_source: isUltimateFromCoordSource, // From the coordinate slot type
        ability_order_from_db: abilityDataSource.ability_order, // From Abilities table
        highWinrateCombinations,
        isTopTier,
        confidence: result.confidence,
        hero_order: result.hero_order, // Screen hero_order (0-9 for selected, 0-11 for pool)
        ability_order: result.ability_order, // Screen ability_order (1-3 for pool)
        is_ultimate_from_layout: isUltimateFromLayout, // From layout_coordinates for this specific slot
        consolidatedScore
      };
    }
    // Fallback if details not found (should be rare if allNamesToFetchDetailsFor is comprehensive)
    return {
      internalName, displayName: internalName, winrate: null, highSkillWinrate: null, avgPickOrder: null,
      valuePercentage: null, highWinrateCombinations: [], isTopTier: false, confidence: result.confidence,
      hero_order: result.hero_order, ability_order: result.ability_order,
      is_ultimate_from_layout: isUltimateFromLayout, is_ultimate_from_db: null,
      is_ultimate_from_coord_source: null, consolidatedScore: 0
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