const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const Database = require('better-sqlite3');

const { dialog } = require('electron');
const archiver = require('archiver');
const fsPromises = require('fs').promises;
const stream = require('stream');
const { promisify } = require('util');

const setupDatabase = require('./src/database/setupDatabase');
const { getAbilityDetails, getHighWinrateCombinations, getOPCombinationsInPool } = require('./src/database/queries');
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

const isPackaged = app.isPackaged;

const appRootPathForDev = app.getAppPath(); // In dev, this is project root. In prod, app.asar.
const resourcesPath = process.resourcesPath; // In prod, this is the 'resources' dir. In dev, it might be similar to appRootPath or electron/dist/resources.
const baseResourcesPath = isPackaged ? resourcesPath : appRootPathForDev;

let mainWindow;
let activeDbPath;
let overlayWindow = null;
let isScanInProgress = false;
let lastScanRawResults = null;
let lastScanTargetResolution = null;
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
    console.log(`[Main] Last successful scrape date updated to: ${dateString}`);
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
        console.error("Error formatting date string for display:", e);
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
  console.log('[Main] Main window created.');

  mainWindow.webContents.on('did-finish-load', async () => {
    const lastDate = await getLastSuccessfulScrapeDate(activeDbPath);
    sendLastUpdatedDateToRenderer(mainWindow.webContents, lastDate);

    if (isFirstRun) {
      console.log("[Main] First run detected, performing initial data scrape.");
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('set-ui-disabled-state', true);
      }

      const success = await performFullScrape(mainWindow.webContents);

      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('set-ui-disabled-state', false);
      }
    }
  });

  mainWindow.on('closed', () => {
    console.log('[Main] Main window closed event fired.');
    mainWindow = null;
    if (!overlayWindow) {
      app.quit();
    }
  });
}

function createOverlayWindow(resolutionKey, allCoordinatesConfig) {
  if (overlayWindow) {
    console.log('[Main] Closing existing overlay window before creating new one.');
    overlayWindow.close();
  }

  isScanInProgress = false;
  console.log('[Main] isScanInProgress reset to false due to new overlay creation.');
  lastScanRawResults = null;
  lastScanTargetResolution = null;

  const primaryDisplay = screen.getPrimaryDisplay();
  const targetScreenWidth = primaryDisplay.bounds.width;
  const targetScreenHeight = primaryDisplay.bounds.height;

  overlayWindow = new BrowserWindow({
    width: targetScreenWidth,
    height: targetScreenHeight,
    x: primaryDisplay.bounds.x,
    y: primaryDisplay.bounds.y,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  console.log('[Main] Overlay window created and configured.');

  overlayWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Overlay window finished loading. Sending overlay-data (initial).');
    overlayWindow.webContents.send('overlay-data', {
      scanData: null,
      coordinatesConfig: allCoordinatesConfig,
      targetResolution: resolutionKey,
      opCombinations: [],
      initialSetup: true
    });
  });

  overlayWindow.on('closed', () => {
    console.log('[Main] Overlay window closed. Resetting relevant state.');
    overlayWindow = null;
    isScanInProgress = false;
    lastScanRawResults = null;
    lastScanTargetResolution = null;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('overlay-closed-reset-ui');
      }
    }
  });
  return overlayWindow;
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  const appDbPathInUserData = path.join(userDataPath, 'dota_ad_data.db');

  // Define appRootPath first
  const appRootPath = app.getAppPath();
  console.log(`[Main] Application Root Path: ${appRootPath}`);

  // Now define paths that depend on appRootPath
  const bundledDbPathInApp = path.join(baseResourcesPath, 'dota_ad_data.db');
  global.coordinatesPath = path.join(baseResourcesPath, 'config', 'layout_coordinates.json');

  activeDbPath = path.join(app.getPath('userData'), 'dota_ad_data.db');
  console.log(`[Main] Active database path: ${activeDbPath}`);
  console.log(`[Main] User data path: ${userDataPath}`);
  console.log(`[Main] Bundled DB path: ${bundledDbPathInApp}`);
  console.log(`[Main] Coordinates config path: ${global.coordinatesPath}`);


  try {
    // Now modelPath and classNamesPath can safely use appRootPath
    const modelBasePath = path.join(baseResourcesPath, 'model', 'tfjs_model');
    const modelPath = 'file://' + path.join(modelBasePath, 'model.json');
    const classNamesPath = path.join(modelBasePath, 'class_names.json');
    console.log(`[Main] Attempting to initialize image processor with Model: ${modelPath}, Classes: ${classNamesPath}`);
    initializeImageProcessor(modelPath, classNamesPath);
    console.log('[Main] Image processor initialized.');
  } catch (initError) {
    console.error('[Main] CRITICAL: Image processor init failed:', initError);
    // Consider more graceful error handling, e.g., showing an error dialog to the user
    // For now, quitting is a safe fallback.
    // dialog.showErrorBox('Initialization Error', 'Failed to initialize the image processor. The application will now close.');
    app.quit();
    return; // Exit the async function
  }

  try {
    await fs.access(activeDbPath);
    console.log(`[Main] Database found at ${activeDbPath}.`);
    isFirstRun = false;
  } catch (e) {
    console.log(`[Main] DB not found at ${activeDbPath}. Attempting to copy from bundled DB: ${bundledDbPathInApp}`);
    isFirstRun = true;
    try {
      await fs.mkdir(userDataPath, { recursive: true });
      await fs.copyFile(bundledDbPathInApp, activeDbPath);
      console.log(`[Main] Bundled DB copied to ${activeDbPath}. This is considered a first run.`);
    } catch (copyError) {
      console.error(`[Main] CRITICAL: Failed to copy DB from ${bundledDbPathInApp} to ${activeDbPath}:`, copyError.message);
      isFirstRun = false;
      // Show error to user if DB copy fails, as app functionality will be severely limited.
      // dialog.showErrorBox('Database Error', `Failed to copy the application database. Please check permissions or try reinstalling.\nError: ${copyError.message}`);
      // app.quit(); // Consider quitting if DB is essential and copy fails.
      // For now, setupDatabase will attempt to run and likely fail, providing another error point.
    }
  }

  try {
    console.log(`[Main] Setting up database schema at ${activeDbPath}...`);
    setupDatabase();
    console.log(`[Main] DB schema setup complete for: ${activeDbPath}`);
  } catch (dbSetupError) {
    console.error("[Main] CRITICAL: DB schema setup failed:", dbSetupError);
    // dialog.showErrorBox('Database Setup Error', `Failed to set up the database. The application will now close.\nError: ${dbSetupError.message}`);
    app.quit();
    return; // Exit the async function
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', function () {
  console.log('[Main] All windows closed.');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  isScanInProgress = false;
});

// IPC Handlers
ipcMain.on('scrape-all-windrun-data', async (event) => {
  await performFullScrape(event.sender); // event.sender is webContents
});


ipcMain.on('activate-overlay', async (event, selectedResolution) => {
  if (!selectedResolution) {
    console.error('[Main] Activate overlay: no resolution.');
    if (event.sender && !event.sender.isDestroyed()) event.sender.send('scrape-status', 'Error: No resolution for overlay.');
    return;
  }
  console.log(`[Main] Activating overlay for: ${selectedResolution}.`);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
    console.log('[Main] Main window hidden.');
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('scrape-status', `Overlay activated for ${selectedResolution}. Main window hidden.`);
    }
  }

  try {
    const configData = await fs.readFile(global.coordinatesPath, 'utf-8');
    const layoutConfig = JSON.parse(configData);
    createOverlayWindow(selectedResolution, layoutConfig);
    console.log(`[Main] Overlay launched for ${selectedResolution}.`);
  } catch (error) {
    console.error(`[Main] Error activating overlay for ${selectedResolution}:`, error);
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('scrape-status', `Overlay Activation Error: ${error.message}`);
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  }
});

ipcMain.on('export-failed-samples', async (event) => {
  const sendStatus = (message, error = false, inProgress = true, filePath = null) => {
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('export-failed-samples-status', { message, error, inProgress, filePath });
    }
  };

  sendStatus('Starting export of failed samples...');

  const userDataPath = app.getPath('userData');
  const failedSamplesDir = path.join(userDataPath, 'failed-samples');
  const downloadsPath = app.getPath('downloads');
  const randomString = crypto.randomBytes(5).toString('hex');
  const defaultZipName = `failed-samples-${randomString}.zip`;
  const defaultZipPath = path.join(downloadsPath, defaultZipName);

  try {

    try {
      await fsPromises.access(failedSamplesDir);
    } catch (e) {
      sendStatus('No failed samples directory found. Nothing to export.', false, false);
      return;
    }

    const filesInDir = await fsPromises.readdir(failedSamplesDir);
    const imageFiles = filesInDir.filter(file => file.toLowerCase().endsWith('.png'));

    if (imageFiles.length === 0) {
      sendStatus('No image files found in the failed samples directory. Nothing to export.', false, false);
      return;
    }

    sendStatus(`Found ${imageFiles.length} samples. Prompting for save location...`);

    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Failed Samples Zip',
      defaultPath: defaultZipPath,
      filters: [
        { name: 'Zip Archives', extensions: ['zip'] }
      ]
    });

    if (canceled || !filePath) {
      sendStatus('Export canceled by user.', false, false);
      return;
    }

    sendStatus(`Exporting ${imageFiles.length} samples to ${filePath}... This may take a moment.`);

    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    const pipeline = promisify(stream.pipeline);

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('[ZIP Warning]', err);
      } else {
        throw err;
      }
    });

    archive.on('error', (err) => {
      throw err;
    });

    await pipeline(archive, output);


    for (const fileName of imageFiles) {
      const fullPath = path.join(failedSamplesDir, fileName);
      archive.file(fullPath, { name: fileName });
    }

    await archive.finalize();

    sendStatus(`Successfully exported ${imageFiles.length} samples to ${filePath}`, false, false, filePath);

  } catch (error) {
    console.error('Error exporting failed samples:', error);
    sendStatus(`Error during export: ${error.message}`, true, false);
  }
});

ipcMain.on('execute-scan-from-overlay', async (event, selectedResolution) => {
  if (isScanInProgress) {
    console.warn('[Main] Scan already in progress. Ignoring request.');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', { info: 'Scan already in progress.', targetResolution: lastScanTargetResolution, initialSetup: false, opCombinations: [] });
    }
    return;
  }
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    console.error('[Main] Scan request, but overlay window not available.');
    return;
  }
  if (!selectedResolution) {
    console.error('[Main] Scan request without resolution.');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', { error: 'No resolution for scanning.', opCombinations: [] });
    }
    return;
  }

  isScanInProgress = true;
  lastScanRawResults = null;
  lastScanTargetResolution = selectedResolution;
  console.log(`[Main] Starting scan for ${selectedResolution}.`);
  const startTime = performance.now();

  try {
    const rawResults = await processDraftScreen(global.coordinatesPath, selectedResolution);
    lastScanRawResults = rawResults;
    const { ultimates: predictedUltimatesInternalNames, standard: predictedStandardInternalNames } = rawResults;

    const allDraftPoolInternalNames = [...new Set([...(predictedUltimatesInternalNames || []), ...(predictedStandardInternalNames || [])].filter(name => name !== null && name !== 'Unknown Ability'))];
    let abilityDetailsMap = new Map();
    if (allDraftPoolInternalNames.length > 0) {
      abilityDetailsMap = getAbilityDetails(activeDbPath, allDraftPoolInternalNames);
    }

    const allAbilitiesWithSynergiesAndDetails = [];
    for (const internalName of allDraftPoolInternalNames) {
      const details = abilityDetailsMap.get(internalName);
      if (details) {
        const combinations = await getHighWinrateCombinations(activeDbPath, internalName, allDraftPoolInternalNames);
        allAbilitiesWithSynergiesAndDetails.push({ ...details, highWinrateCombinations: combinations || [] });
      } else {
        allAbilitiesWithSynergiesAndDetails.push({ internalName, displayName: internalName, winrate: null, highSkillWinrate: null, pickOrder: null, highWinrateCombinations: [] });
      }
    }

    let topTierAbilityNames = new Set();
    if (allAbilitiesWithSynergiesAndDetails.length > 0) {
      const sortedByPickOrder = [...allAbilitiesWithSynergiesAndDetails]
        .filter(ability => ability.pickOrder !== null && typeof ability.pickOrder === 'number')
        .sort((a, b) => a.pickOrder - b.pickOrder);
      const top10Abilities = sortedByPickOrder.slice(0, 10);
      topTierAbilityNames = new Set(top10Abilities.map(ability => ability.internalName));
    }

    let opCombinationsInPool = [];
    if (allDraftPoolInternalNames.length >= 2) {
      opCombinationsInPool = await getOPCombinationsInPool(activeDbPath, allDraftPoolInternalNames);
    }

    const formatResultsForOverlay = (predictedNamesArray) => {
      if (!Array.isArray(predictedNamesArray)) return [];
      return predictedNamesArray.map(internalName => {
        if (internalName === null || internalName === 'Unknown Ability') {
          return { internalName, displayName: 'Unknown Ability', winrate: null, highSkillWinrate: null, pickOrder: null, highWinrateCombinations: [], isTopTier: false };
        }
        const foundAbility = allAbilitiesWithSynergiesAndDetails.find(a => a.internalName === internalName);
        const isTopTier = topTierAbilityNames.has(internalName);
        if (foundAbility) {
          return { ...foundAbility, isTopTier };
        }
        return { internalName, displayName: internalName, winrate: null, highSkillWinrate: null, pickOrder: null, highWinrateCombinations: [], isTopTier };
      });
    };

    const formattedUltimates = formatResultsForOverlay(predictedUltimatesInternalNames);
    const formattedStandard = formatResultsForOverlay(predictedStandardInternalNames);
    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);
    const configData = await fs.readFile(global.coordinatesPath, 'utf-8');
    const layoutConfig = JSON.parse(configData);

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', {
        scanData: { ultimates: formattedUltimates, standard: formattedStandard },
        coordinatesConfig: layoutConfig,
        targetResolution: selectedResolution,
        durationMs: durationMs,
        opCombinations: opCombinationsInPool,
        initialSetup: false
      });
    }
  } catch (error) {
    console.error(`[Main] Error during scan for ${selectedResolution}:`, error);
    lastScanRawResults = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', { error: error.message || 'Scan error.', opCombinations: [] });
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

    if (!coordsConfig) {
      throw new Error(`Coordinates for resolution ${lastScanTargetResolution} not found.`);
    }

    const allSlots = [
      ...(coordsConfig.ultimate_slots_coords || []).map((coord, i) => ({ ...coord, predictedName: lastScanRawResults.ultimates?.[i] || 'unknown_ultimate' })),
      ...(coordsConfig.standard_slots_coords || []).map((coord, i) => ({ ...coord, predictedName: lastScanRawResults.standard?.[i] || 'unknown_standard' }))
    ];

    let savedCount = 0;
    for (const slot of allSlots) {
      if (slot.x === undefined || slot.y === undefined || slot.width === undefined || slot.height === undefined) {
        continue;
      }
      try {
        const randomString = crypto.randomBytes(4).toString('hex');
        const safePredictedName = (slot.predictedName && slot.predictedName !== 'Unknown Ability') ? slot.predictedName.replace(/[^a-z0-9_]/gi, '_') : `unknown_ability_${slot.hero_order || 's'}_${slot.ability_order || 'u'}`;
        const filename = `${safePredictedName}-${randomString}.png`;
        const outputPath = path.join(failedSamplesDir, filename);

        await sharp(fullScreenshotBuffer)
          .extract({ left: slot.x, top: slot.y, width: slot.width, height: slot.height })
          .toFile(outputPath);
        savedCount++;
      } catch (cropError) {
        console.error(`[Main Snapshot] Error cropping/saving slot (${slot.predictedName || 'unknown'}): ${cropError.message}`);
      }
    }

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('snapshot-taken-status', { message: `Snapshot: ${savedCount} images saved.`, error: false, allowRetry: true });
    }

  } catch (error) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('snapshot-taken-status', { message: `Snapshot Error: ${error.message}`, error: true, allowRetry: true });
    }
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
    const resolutions = layoutConfig?.resolutions ? Object.keys(layoutConfig.resolutions) : [];
    event.sender.send('available-resolutions', resolutions);
  } catch (error) {
    event.sender.send('available-resolutions', []);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('scrape-status', `Error loading resolutions: ${error.message}`);
    }
  }
});

ipcMain.on('scrape-heroes', async (event) => {
  const sendStatus = (msg) => { if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('scrape-status', msg); };
  try {
    sendStatus('Starting hero data update...');
    await scrapeAndStoreHeroes(activeDbPath, heroesUrl, sendStatus);
    sendStatus('Hero data update complete!');
  } catch (error) {
    console.error('Hero scraping failed:', error);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      sendStatusToRenderer(mainWindow.webContents, `Error updating hero data: ${error.message}`);
    } else if (event.sender && !event.sender.isDestroyed()) {
      sendStatusToRenderer(event.sender, `Error updating hero data: ${error.message}`);
    }
  }
});

ipcMain.on('scrape-abilities', async (event) => {
  const sendStatus = (msg) => { if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('scrape-status', msg); };
  try {
    sendStatus('Starting ability data update...');
    await scrapeAndStoreAbilities(activeDbPath, abilitiesUrl, abilitiesHighSkillUrl, sendStatus);
    sendStatus('Ability data update complete!');
  } catch (error) {
    console.error('Ability scraping failed:', error);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      sendStatusToRenderer(mainWindow.webContents, `Error updating ability data: ${error.message}`);
    } else if (event.sender && !event.sender.isDestroyed()) {
      sendStatusToRenderer(event.sender, `Error updating ability data: ${error.message}`);
    }
  }
});

ipcMain.on('scrape-ability-pairs', async (event) => {
  const sendStatus = (msg) => { if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('scrape-status', msg); };
  try {
    sendStatus('Starting ability pairs update...');
    await scrapeAndStoreAbilityPairs(activeDbPath, abilityPairsUrl, sendStatus);
    sendStatus('Ability pairs update complete!');
  } catch (error) {
    console.error('Ability pairs scraping failed:', error);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      sendStatusToRenderer(mainWindow.webContents, `Error updating ability pairs: ${error.message}`);
    } else if (event.sender && !event.sender.isDestroyed()) {
      sendStatusToRenderer(event.sender, `Error updating ability pairs: ${error.message}`);
    }
  }
});

ipcMain.on('close-overlay', () => {
  if (overlayWindow) {
    overlayWindow.close();
  } else {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('overlay-closed-reset-ui');
      }
    }
  }
});

ipcMain.on('set-overlay-mouse-ignore', (event, ignore) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

function createOverlayWindow(resolutionKey, allCoordinatesConfig) {
  if (overlayWindow) {
    overlayWindow.close();
  }

  isScanInProgress = false;
  lastScanRawResults = null;
  lastScanTargetResolution = null;

  const primaryDisplay = screen.getPrimaryDisplay();
  const targetScreenWidth = primaryDisplay.bounds.width;
  const targetScreenHeight = primaryDisplay.bounds.height;

  overlayWindow = new BrowserWindow({
    width: targetScreenWidth,
    height: targetScreenHeight,
    x: primaryDisplay.bounds.x,
    y: primaryDisplay.bounds.y,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });


  overlayWindow.webContents.on('did-finish-load', () => {
    overlayWindow.webContents.send('overlay-data', {
      scanData: null,
      coordinatesConfig: allCoordinatesConfig,
      targetResolution: resolutionKey,
      opCombinations: [],
      initialSetup: true
    });
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    isScanInProgress = false;
    lastScanRawResults = null;
    lastScanTargetResolution = null;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('overlay-closed-reset-ui');
      }
    }
  });
  return overlayWindow;
}