const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const Database = require('better-sqlite3');

const { dialog } = require('electron');
const archiver = require('archiver');
const stream = require('stream');
const { promisify } = require('util');

const setupDatabase = require('./src/database/setupDatabase');
const { getAbilityDetails, getHighWinrateCombinations, getOPCombinationsInPool, getHeroDetailsByAbilityName } = require('./src/database/queries');
const { scrapeAndStoreHeroes } = require('./src/scraper/heroScraper');
const { scrapeAndStoreAbilities } = require('./src/scraper/abilityScraper');
const { scrapeAndStoreAbilityPairs } = require('./src/scraper/abilityPairScraper');
const { processDraftScreen, initializeImageProcessor } = require('./src/imageProcessor');
const screenshotDesktop = require('screenshot-desktop');
const sharp = require('sharp');

const heroesUrl = 'https://windrun.io/heroes';
const abilitiesUrl = 'https://windrun.io/abilities';
const abilitiesHighSkillUrl = 'https://windrun.io/ability-high-skill';
const abilityPairsUrl = 'https://windrun.io/ability-pairs';

const MIN_PREDICTION_CONFIDENCE = 0.70;
const isPackaged = app.isPackaged;

const MIN_PICK_ORDER_FOR_NORMALIZATION = 1.0;
const MAX_PICK_ORDER_FOR_NORMALIZATION = 40.0;
const NUM_TOP_TIER_ABILITIES = 10; // Number of abilities to flag as "Top Tier"

const WEIGHT_VALUE = 0.40;        // Weight for 'value_percentage'
const WEIGHT_WINRATE = 0.20;      // Weight for 'winrate'
const WEIGHT_PICK_ORDER = 0.40;   // Weight for 'avg_pick_order'

const appRootPathForDev = app.getAppPath();
const resourcesPath = process.resourcesPath;
const baseResourcesPath = isPackaged ? resourcesPath : appRootPathForDev;

let mainWindow;
let activeDbPath;
let overlayWindow = null;
let isScanInProgress = false;
let lastScanRawResults = null;
let lastScanTargetResolution = null;
let lastScaleFactor = 1;
let isFirstRun = false;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function updateLastSuccessfulScrapeDate(dbPathToUse) {
  const currentDate = new Date();
  const dateString = currentDate.toISOString().split('T')[0];
  let db = null;
  try {
    db = new Database(dbPathToUse);
    const stmt = db.prepare("INSERT OR REPLACE INTO Metadata (key, value) VALUES ('last_successful_scrape_date', ?)");
    stmt.run(dateString);
    return dateString;
  } catch (error) {
    console.error('[Main] Error updating last successful scrape date:', error);
    return null;
  } finally {
    if (db && db.open) {
      db.close();
    }
  }
}

async function getLastSuccessfulScrapeDate(dbPathToUse) {
  let db = null;
  try {
    db = new Database(dbPathToUse, { readonly: true });
    const row = db.prepare("SELECT value FROM Metadata WHERE key = 'last_successful_scrape_date'").get();
    return row ? row.value : null;
  } catch (error) {
    console.error('[Main] Error fetching last successful scrape date:', error);
    return null;
  } finally {
    if (db && db.open) {
      db.close();
    }
  }
}

function sendLastUpdatedDateToRenderer(webContents, dateStringYYYYMMDD) {
  if (webContents && !webContents.isDestroyed()) {
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
        displayDate = "Date Error";
      }
    }
    webContents.send('last-updated-date', displayDate);
  }
}

async function performFullScrape(statusCallbackWebContents) {
  const sendStatus = (msg) => {
    if (statusCallbackWebContents && !statusCallbackWebContents.isDestroyed()) {
      statusCallbackWebContents.send('scrape-status', msg);
    }
  };
  try {
    sendStatus('Starting all Windrun.io data updates...');
    await delay(100);
    sendStatus('Phase 1/3: Updating hero data...');
    await scrapeAndStoreHeroes(activeDbPath, heroesUrl, sendStatus);
    await delay(100);
    sendStatus('Phase 2/3: Updating ability data...');
    await scrapeAndStoreAbilities(activeDbPath, abilitiesUrl, abilitiesHighSkillUrl, sendStatus);
    await delay(100);
    sendStatus('Phase 3/3: Updating ability pair data...');
    await scrapeAndStoreAbilityPairs(activeDbPath, abilityPairsUrl, sendStatus);
    const newDate = await updateLastSuccessfulScrapeDate(activeDbPath);
    sendLastUpdatedDateToRenderer(statusCallbackWebContents, newDate);
    sendStatus('All Windrun.io data updates finished successfully!');
    return true;
  } catch (error) {
    console.error('Consolidated scraping failed:', error.message);
    sendStatus(`Error during data update. Operation halted. Check logs.`);
    const currentDate = await getLastSuccessfulScrapeDate(activeDbPath);
    sendLastUpdatedDateToRenderer(statusCallbackWebContents, currentDate);
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
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
    if (isFirstRun) {
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('set-ui-disabled-state', true);
      }
      await performFullScrape(mainWindow.webContents);
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('set-ui-disabled-state', false);
      }
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  global.coordinatesPath = path.join(baseResourcesPath, 'config', 'layout_coordinates.json');
  activeDbPath = path.join(userDataPath, 'dota_ad_data.db');
  const bundledDbPathInApp = path.join(baseResourcesPath, 'dota_ad_data.db');

  try {
    const modelBasePath = path.join(baseResourcesPath, 'model', 'tfjs_model');
    const modelPathTfjs = 'file://' + path.join(modelBasePath, 'model.json').replace(/\\/g, '/');
    const classNamesPath = path.join(modelBasePath, 'class_names.json');
    initializeImageProcessor(modelPathTfjs, classNamesPath);
  } catch (initError) {
    dialog.showErrorBox('Initialization Error', `Failed to initialize the image processor: ${initError.message}.`);
    app.quit(); return;
  }
  try {
    await fs.access(activeDbPath);
  } catch (e) {
    isFirstRun = true;
    try {
      await fs.mkdir(userDataPath, { recursive: true });
      await fs.copyFile(bundledDbPathInApp, activeDbPath);
    } catch (copyError) {
      isFirstRun = false; // Prevent scrape if DB can't be set up
      dialog.showErrorBox('Database Error', `Failed to copy database: ${copyError.message}.`);
    }
  }
  try {
    setupDatabase();
  } catch (dbSetupError) {
    dialog.showErrorBox('Database Setup Error', `Failed to set up database: ${dbSetupError.message}.`);
    app.quit(); return;
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { isScanInProgress = false; });

ipcMain.on('scrape-all-windrun-data', async (event) => { await performFullScrape(event.sender); });

ipcMain.on('activate-overlay', async (event, selectedResolution) => {
  if (!selectedResolution) {
    if (event.sender && !event.sender.isDestroyed()) event.sender.send('scrape-status', 'Error: No resolution for overlay.');
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('scrape-status', `Overlay activated for ${selectedResolution}. Main window hidden.`);
    }
  }
  try {
    const configData = await fs.readFile(global.coordinatesPath, 'utf-8');
    const layoutConfig = JSON.parse(configData);
    const primaryDisplay = screen.getPrimaryDisplay();
    lastScaleFactor = primaryDisplay.scaleFactor || 1;
    createOverlayWindow(selectedResolution, layoutConfig, lastScaleFactor);
  } catch (error) {
    if (event.sender && !event.sender.isDestroyed()) event.sender.send('scrape-status', `Overlay Activation Error: ${error.message}`);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  }
});

ipcMain.on('export-failed-samples', async (event) => {
  const sendStatus = (message, error = false, inProgress = true, filePath = null) => {
    if (event.sender && !event.sender.isDestroyed()) event.sender.send('export-failed-samples-status', { message, error, inProgress, filePath });
  };
  const userDataPath = app.getPath('userData');
  const failedSamplesDir = path.join(userDataPath, 'failed-samples');
  try {
    await fs.access(failedSamplesDir);
    const imageFiles = (await fs.readdir(failedSamplesDir)).filter(f => f.toLowerCase().endsWith('.png'));
    if (imageFiles.length === 0) { sendStatus('No image files to export.', false, false); return; }
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('downloads'), `failed-samples-${crypto.randomBytes(5).toString('hex')}.zip`),
      filters: [{ name: 'Zip Archives', extensions: ['zip'] }]
    });
    if (canceled || !filePath) { sendStatus('Export canceled.', false, false); return; }
    const output = require('fs').createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    const closePromise = new Promise((res, rej) => { output.on('close', res); archive.on('error', rej); });
    archive.pipe(output);
    for (const fileName of imageFiles) archive.file(path.join(failedSamplesDir, fileName), { name: fileName });
    await archive.finalize();
    await closePromise;
    sendStatus(`Exported ${imageFiles.length} samples to ${filePath}`, false, false, filePath);
  } catch (error) {
    if (error.code === 'ENOENT' && error.path === failedSamplesDir) sendStatus('No failed samples to export.', false, false);
    else sendStatus(`Export Error: ${error.message}`, true, false);
  }
});

ipcMain.on('execute-scan-from-overlay', async (event, selectedResolution) => {
  if (isScanInProgress) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', { info: 'Scan in progress.', targetResolution: lastScanTargetResolution, initialSetup: false, opCombinations: [], identifiedHeroes: [], selectedAbilities: [], scaleFactor: lastScaleFactor });
    }
    return;
  }
  if (!overlayWindow || overlayWindow.isDestroyed() || !selectedResolution) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', { error: 'Overlay or resolution missing.', opCombinations: [], identifiedHeroes: [], selectedAbilities: [], scaleFactor: lastScaleFactor });
    }
    return;
  }

  isScanInProgress = true;
  lastScanRawResults = null;
  lastScanTargetResolution = selectedResolution;
  const startTime = performance.now();

  try {
    const rawResults = await processDraftScreen(global.coordinatesPath, selectedResolution, MIN_PREDICTION_CONFIDENCE);
    lastScanRawResults = rawResults;

    const draftPoolAbilityNames = [
      ...new Set([
        ...rawResults.ultimates.map(r => r.name).filter(name => name !== null),
        ...rawResults.standard.map(r => r.name).filter(name => name !== null)
      ])
    ];
    const selectedAbilityNames = rawResults.selectedAbilities.map(r => r.name).filter(name => name !== null);
    const allNamesToFetchDetailsFor = [...new Set([...draftPoolAbilityNames, ...selectedAbilityNames])];

    let abilityDetailsMap = new Map();
    if (allNamesToFetchDetailsFor.length > 0) {
      abilityDetailsMap = getAbilityDetails(activeDbPath, allNamesToFetchDetailsFor);
    }

    const identifiedHeroes = [];
    const heroDefiningAbilities = rawResults.heroDefiningAbilities.filter(r => r.name !== null);
    for (const heroAbility of heroDefiningAbilities) {
      const heroDetails = await getHeroDetailsByAbilityName(activeDbPath, heroAbility.name);
      if (heroDetails) {
        identifiedHeroes.push({
          heroOrder: heroAbility.hero_order,
          heroName: heroDetails.heroDisplayName || heroDetails.heroName,
          originalAbilityName: heroAbility.name,
          confidence: heroAbility.confidence
        });
      }
    }

    // Prepare abilities from the draft pool for scoring and synergy calculation
    const draftPoolAbilitiesForScoring = [];
    for (const internalName of draftPoolAbilityNames) {
      const details = abilityDetailsMap.get(internalName);
      if (details) {
        const combinations = await getHighWinrateCombinations(activeDbPath, internalName, draftPoolAbilityNames);
        draftPoolAbilitiesForScoring.push({
          ...details,
          highWinrateCombinations: combinations || [],
          consolidatedScore: 0
        });
      } else {
        console.warn(`[Main] Details not found for draft pool ability: ${internalName}. It won't be scored for top picks.`);
      }
    }

    // Calculate consolidated score for each ability in the draft pool
    draftPoolAbilitiesForScoring.forEach(ability => {
      let vRaw = ability.valuePercentage; // -1.0 to 1.0 from DB
      let wRaw = ability.winrate;         // 0.0 to 1.0 from DB
      let pRaw = ability.avgPickOrder;    // ~1 to ~40 from DB

      // Normalize Value: -1 to 1  =>  0 to 1
      const vScaled = (vRaw !== null && typeof vRaw === 'number') ? (vRaw + 1.0) / 2.0 : 0.5; // Neutral: 0.5

      // Normalize Winrate: 0 to 1 (already in this range if not null)
      const wNormalized = (wRaw !== null && typeof wRaw === 'number') ? wRaw : 0.5; // Neutral: 0.5 (50% WR)

      // Normalize Pick Order: ~1-40 (lower is better) => 0 to 1 (higher is better)
      let pNormalized = 0.5; // Neutral if null or out of expected range
      if (pRaw !== null && typeof pRaw === 'number') {
        const clampedPRaw = Math.max(MIN_PICK_ORDER_FOR_NORMALIZATION, Math.min(MAX_PICK_ORDER_FOR_NORMALIZATION, pRaw));
        if ((MAX_PICK_ORDER_FOR_NORMALIZATION - MIN_PICK_ORDER_FOR_NORMALIZATION) > 0) {
          pNormalized = (MAX_PICK_ORDER_FOR_NORMALIZATION - clampedPRaw) / (MAX_PICK_ORDER_FOR_NORMALIZATION - MIN_PICK_ORDER_FOR_NORMALIZATION);
        } // Else, if min equals max, pNormalized remains 0.5
      }

      ability.consolidatedScore =
        (WEIGHT_VALUE * vScaled) +
        (WEIGHT_WINRATE * wNormalized) +
        (WEIGHT_PICK_ORDER * pNormalized);
    });

    // Sort abilities by the new consolidated score
    draftPoolAbilitiesForScoring.sort((a, b) => b.consolidatedScore - a.consolidatedScore);

    // Determine top tier abilities based on the new score
    const topTierAbilityNames = new Set(
      draftPoolAbilitiesForScoring.slice(0, NUM_TOP_TIER_ABILITIES).map(ability => ability.internalName)
    );

    // Store the scored draft pool abilities in a map for easy lookup
    const scoredDraftAbilitiesMap = new Map();
    draftPoolAbilitiesForScoring.forEach(ab => scoredDraftAbilitiesMap.set(ab.internalName, ab));


    let opCombinationsInPool = [];
    if (draftPoolAbilityNames.length >= 2) {
      opCombinationsInPool = await getOPCombinationsInPool(activeDbPath, draftPoolAbilityNames);
    }

    const formatResultsForUi = (predictedResultsArray, isSelectedAbilityList = false) => {
      if (!Array.isArray(predictedResultsArray)) return [];
      return predictedResultsArray.map(result => {
        const internalName = result.name;
        if (internalName === null) {
          return { internalName: null, displayName: 'Unknown Ability', winrate: null, highSkillWinrate: null, avgPickOrder: null, valuePercentage: null, highWinrateCombinations: [], isTopTier: false, confidence: result.confidence, hero_order: result.hero_order, consolidatedScore: 0 };
        }

        let abilityDataSource;
        if (isSelectedAbilityList) {
          abilityDataSource = abilityDetailsMap.get(internalName);
        } else {
          abilityDataSource = scoredDraftAbilitiesMap.get(internalName);
        }

        const isTopTier = !isSelectedAbilityList && topTierAbilityNames.has(internalName);

        if (abilityDataSource) {
          return {
            internalName: abilityDataSource.internalName,
            displayName: abilityDataSource.displayName || abilityDataSource.internalName,
            winrate: abilityDataSource.winrate,
            highSkillWinrate: abilityDataSource.highSkillWinrate,
            avgPickOrder: abilityDataSource.avgPickOrder,
            valuePercentage: abilityDataSource.valuePercentage,
            highWinrateCombinations: isSelectedAbilityList ? [] : (abilityDataSource.highWinrateCombinations || []),
            isTopTier,
            confidence: result.confidence,
            hero_order: result.hero_order,
            consolidatedScore: isSelectedAbilityList ? 0 : (abilityDataSource.consolidatedScore || 0)
          };
        }
        return { internalName, displayName: internalName, winrate: null, highSkillWinrate: null, avgPickOrder: null, valuePercentage: null, highWinrateCombinations: [], isTopTier, confidence: result.confidence, hero_order: result.hero_order, consolidatedScore: 0 };
      });
    };

    const formattedUltimates = formatResultsForUi(rawResults.ultimates);
    const formattedStandard = formatResultsForUi(rawResults.standard);
    const formattedSelectedAbilities = formatResultsForUi(rawResults.selectedAbilities, true);

    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);
    const configData = await fs.readFile(global.coordinatesPath, 'utf-8');
    const layoutConfig = JSON.parse(configData);

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', {
        scanData: {
          ultimates: formattedUltimates,
          standard: formattedStandard,
          selectedAbilities: formattedSelectedAbilities
        },
        coordinatesConfig: layoutConfig,
        targetResolution: selectedResolution,
        durationMs: durationMs,
        opCombinations: opCombinationsInPool,
        identifiedHeroes: identifiedHeroes,
        initialSetup: false,
        scaleFactor: lastScaleFactor
      });
    }

  } catch (error) {
    console.error(`[Main] Error during scan for ${selectedResolution}:`, error);
    lastScanRawResults = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', { error: error.message || 'Scan error.', opCombinations: [], identifiedHeroes: [], selectedAbilities: [], scaleFactor: lastScaleFactor });
    }
  } finally {
    isScanInProgress = false;
  }
});


ipcMain.on('take-snapshot', async (event) => {
  if (!lastScanRawResults || !lastScanTargetResolution) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('snapshot-taken-status', { message: 'Error: No scan data for snapshot.', error: true, allowRetry: true });
    }
    return;
  }
  const userDataPath = app.getPath('userData');
  const failedSamplesDir = path.join(userDataPath, 'failed-samples');
  try {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.webContents && !overlayWindow.webContents.isDestroyed()) {
      overlayWindow.webContents.send('toggle-hotspot-borders', false);
      await delay(100);
    }
    await fs.mkdir(failedSamplesDir, { recursive: true });
    const fullScreenshotBuffer = await screenshotDesktop({ format: 'png' });
    const configData = await fs.readFile(global.coordinatesPath, 'utf-8');
    const layoutConfig = JSON.parse(configData);
    const coordsConfig = layoutConfig.resolutions?.[lastScanTargetResolution];
    if (!coordsConfig) throw new Error(`Snapshot coords not found for ${lastScanTargetResolution}.`);

    const allSlotsForSnapshot = [
      ...(coordsConfig.ultimate_slots_coords || []).map((coord, i) => ({ ...coord, predictedName: lastScanRawResults.ultimates?.[i]?.name || 'unknown_ultimate', type: 'ult' })),
      ...(coordsConfig.standard_slots_coords || []).map((coord, i) => ({ ...coord, predictedName: lastScanRawResults.standard?.[i]?.name || 'unknown_standard', type: 'std' })),
      ...(lastScanRawResults.selectedAbilities || []).map((abilityResult, i) => { // Use actual coords from layout
        const params = coordsConfig.selected_abilities_params;
        const baseCoord = coordsConfig.selected_abilities_coords.find(c => c.hero_order === abilityResult.hero_order && i < 4); // simplistic mapping, needs improvement if more than 4 per hero
        const specificCoord = coordsConfig.selected_abilities_coords.filter(c => c.hero_order === abilityResult.hero_order)[i % 4]; // Get i-th slot for this hero
        return specificCoord ? {
          ...specificCoord,
          width: params.width,
          height: params.height,
          predictedName: abilityResult.name || `unknown_selected_ho${abilityResult.hero_order}`,
          type: 'sel'
        } : null;
      }).filter(s => s !== null)
    ];

    let savedCount = 0;
    for (const slot of allSlotsForSnapshot) {
      if (slot.x === undefined || slot.y === undefined || slot.width === undefined || slot.height === undefined) continue;
      try {
        const randomString = crypto.randomBytes(4).toString('hex');
        const safePredictedName = (slot.predictedName || `unknown_${slot.type}_ho${slot.hero_order || 'X'}`).replace(/[^a-z0-9_]/gi, '_');
        const filename = `${safePredictedName}-${randomString}.png`;
        await sharp(fullScreenshotBuffer)
          .extract({ left: Math.round(slot.x), top: Math.round(slot.y), width: Math.round(slot.width), height: Math.round(slot.height) })
          .toFile(path.join(failedSamplesDir, filename));
        savedCount++;
      } catch (cropError) { console.error(`Snapshot crop error for ${slot.predictedName}: ${cropError.message}`); }
    }
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('snapshot-taken-status', { message: `Snapshot: ${savedCount} images saved.`, error: false, allowRetry: true });
  } catch (error) {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('snapshot-taken-status', { message: `Snapshot Error: ${error.message}`, error: true, allowRetry: true });
  } finally {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.webContents && !overlayWindow.webContents.isDestroyed()) {
      overlayWindow.webContents.send('toggle-hotspot-borders', true);
    }
  }
});


ipcMain.on('get-available-resolutions', async (event) => {
  try {
    const configData = await fs.readFile(global.coordinatesPath, 'utf-8');
    const layoutConfig = JSON.parse(configData);
    event.sender.send('available-resolutions', layoutConfig?.resolutions ? Object.keys(layoutConfig.resolutions) : []);
  } catch (error) {
    event.sender.send('available-resolutions', []);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('scrape-status', `Error loading resolutions: ${error.message}`);
    }
  }
});

const createGenericScrapeHandler = (scrapeFunction, ...args) => async (event) => {
  const targetWebContents = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow.webContents : event.sender;
  const sendStatusUpdate = (msg) => sendStatusToRenderer(targetWebContents, msg);
  try {
    sendStatusUpdate(`Starting ${args[0]} data update...`); // e.g. args[0] = 'hero'
    await scrapeFunction(activeDbPath, ...args.slice(1), sendStatusUpdate); // Pass dbPath, URLs, and callback
    sendStatusUpdate(`${args[0].charAt(0).toUpperCase() + args[0].slice(1)} data update complete!`);
  } catch (error) {
    console.error(`${args[0]} scraping failed:`, error);
    sendStatusUpdate(`Error updating ${args[0]} data: ${error.message}`);
  }
};
ipcMain.on('scrape-heroes', createGenericScrapeHandler(scrapeAndStoreHeroes, 'hero', heroesUrl));
ipcMain.on('scrape-abilities', createGenericScrapeHandler(scrapeAndStoreAbilities, 'ability', abilitiesUrl, abilitiesHighSkillUrl));
ipcMain.on('scrape-ability-pairs', createGenericScrapeHandler(scrapeAndStoreAbilityPairs, 'ability pairs', abilityPairsUrl));


ipcMain.on('close-overlay', () => {
  if (overlayWindow) overlayWindow.close();
  else if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('overlay-closed-reset-ui');
  }
});

ipcMain.on('set-overlay-mouse-ignore', (event, ignore) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

function createOverlayWindow(resolutionKey, allCoordinatesConfig, scaleFactorToUse) {
  if (overlayWindow) overlayWindow.close();
  isScanInProgress = false;
  lastScanRawResults = null;
  lastScanTargetResolution = null;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight, x, y } = primaryDisplay.bounds;
  overlayWindow = new BrowserWindow({
    width: screenWidth, height: screenHeight, x, y, frame: false, transparent: true,
    skipTaskbar: true, focusable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true }
  });
  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  overlayWindow.webContents.on('did-finish-load', () => {
    overlayWindow.webContents.send('overlay-data', {
      scanData: null, coordinatesConfig: allCoordinatesConfig, targetResolution: resolutionKey,
      opCombinations: [], identifiedHeroes: [], selectedAbilities: [], initialSetup: true, scaleFactor: scaleFactorToUse
    });
  });
  overlayWindow.on('closed', () => {
    overlayWindow = null; isScanInProgress = false; lastScanRawResults = null; lastScanTargetResolution = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show(); mainWindow.focus();
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('overlay-closed-reset-ui');
    }
  });
  return overlayWindow;
}