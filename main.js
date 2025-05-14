const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs').promises; // Use promise version of fs
const crypto = require('crypto'); // For random string
const { performance } = require('perf_hooks');
const setupDatabase = require('./src/database/setupDatabase');
const { getAbilityDetails, getHighWinrateCombinations } = require('./src/database/queries');
const { scrapeAndStoreHeroes } = require('./src/scraper/heroScraper');
const { scrapeAndStoreAbilities } = require('./src/scraper/abilityScraper');
const { scrapeAndStoreAbilityPairs } = require('./src/scraper/abilityPairScraper');
const { processDraftScreen, initializeImageProcessor } = require('./src/imageProcessor');
const screenshotDesktop = require('screenshot-desktop'); // Correct import
const sharp = require('sharp'); // For cropping

const heroesUrl = 'https://windrun.io/heroes';
const abilitiesUrl = 'https://windrun.io/abilities';
const abilitiesHighSkillUrl = 'https://windrun.io/ability-high-skill';
const abilityPairsUrl = 'https://windrun.io/ability-pairs';

let mainWindow;
let activeDbPath;
let overlayWindow = null;
let isScanInProgress = false;

// --- Store last scan results for snapshot ---
let lastScanRawResults = null;
let lastScanTargetResolution = null;


// --- Main Window Creation ---
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

  mainWindow.on('closed', () => {
    console.log('[Main] Main window closed event fired.');
    mainWindow = null;
    if (!overlayWindow) { // Only quit if overlay is also closed
      app.quit();
    }
  });
}

// --- Overlay Window Creation ---
function createOverlayWindow(resolutionKey, allCoordinatesConfig) {
  if (overlayWindow) {
    console.log('[Main] Closing existing overlay window before creating new one.');
    overlayWindow.close(); // This will trigger its 'closed' event
    // overlayWindow = null; // Let the 'closed' event handle this
  }

  isScanInProgress = false;
  console.log('[Main] isScanInProgress reset to false due to new overlay creation.');
  lastScanRawResults = null; // Reset last scan results for new overlay
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

  // --- ADD THIS LINE FOR DEBUGGING ---
  if (overlayWindow && overlayWindow.webContents) { // Check if webContents exists
    console.log('[Main Debug] Opening DevTools for overlay window.');
    overlayWindow.webContents.openDevTools({ mode: 'detach' }); // 'detach' opens it in a separate window
  }
  // --- END OF ADDED LINE ---

  console.log('[Main] Overlay window created and configured.');

  overlayWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Overlay window finished loading. Sending overlay-data (initial).');
    overlayWindow.webContents.send('overlay-data', {
      scanData: null,
      coordinatesConfig: allCoordinatesConfig,
      targetResolution: resolutionKey,
      initialSetup: true
    });
  });

  overlayWindow.on('closed', () => {
    console.log('[Main] Overlay window closed. Resetting relevant state.');
    overlayWindow = null;
    isScanInProgress = false;
    lastScanRawResults = null; // Clear on close
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

// --- App Ready ---
app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  const appDbPathInUserData = path.join(userDataPath, 'dota_ad_data.db');
  const bundledDbPathInApp = path.join(__dirname, 'dota_ad_data.db');
  const appRootPath = app.getAppPath();
  global.coordinatesPath = path.join(appRootPath, 'config', 'layout_coordinates.json');
  activeDbPath = appDbPathInUserData;
  console.log(`[Main] Active database path: ${activeDbPath}`);
  console.log(`[Main] User data path: ${userDataPath}`);


  try {
    const modelPath = 'file://' + path.join(app.getAppPath(), 'model', 'tfjs_model', 'model.json');
    const classNamesPath = path.join(app.getAppPath(), 'model', 'tfjs_model', 'class_names.json');
    initializeImageProcessor(modelPath, classNamesPath);
    console.log('[Main] Image processor initialized.');
  } catch (initError) {
    console.error('[Main] CRITICAL: Image processor init failed:', initError);
    app.quit(); return;
  }

  try {
    await fs.access(activeDbPath);
    console.log(`[Main] Database found at ${activeDbPath}.`);
  } catch (e) {
    console.log(`[Main] DB not found at ${activeDbPath}. Copying from ${bundledDbPathInApp}...`);
    try {
      await fs.mkdir(userDataPath, { recursive: true });
      await fs.copyFile(bundledDbPathInApp, activeDbPath);
      console.log(`[Main] Bundled DB copied to ${activeDbPath}.`);
    } catch (copyError) {
      console.error(`[Main] CRITICAL: Failed to copy DB:`, copyError);
      // Potentially alert user and quit
    }
  }

  try {
    console.log(`[Main] Setting up database schema at ${activeDbPath}...`);
    setupDatabase(); // Uses dbPath from its own scope, which should be userDataPath
    console.log(`[Main] DB schema setup complete for: ${activeDbPath}`);
  } catch (dbSetupError) {
    console.error("[Main] CRITICAL: DB schema setup failed:", dbSetupError);
    app.quit(); return;
  }

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});


app.on('window-all-closed', function () {
  console.log('[Main] All windows closed.');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  isScanInProgress = false; // Ensure this is reset
});


function sendStatusToRenderer(targetWindow, message) {
  if (targetWindow && !targetWindow.isDestroyed() && targetWindow.webContents && !targetWindow.webContents.isDestroyed()) {
    targetWindow.send('scrape-status', message);
  }
}

ipcMain.on('activate-overlay', async (event, selectedResolution) => {
  if (!selectedResolution) {
    console.error('[Main] Activate overlay: no resolution.');
    event.sender.send('scrape-status', 'Error: No resolution for overlay.');
    return;
  }
  console.log(`[Main] Activating overlay for: ${selectedResolution}.`);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
    console.log('[Main] Main window hidden.');
    // Send status to main window if its webContents are available
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      sendStatusToRenderer(mainWindow.webContents, `Overlay activated for ${selectedResolution}. Main window hidden.`);
    }
  }

  try {
    const configData = await fs.readFile(global.coordinatesPath, 'utf-8');
    const layoutConfig = JSON.parse(configData);
    createOverlayWindow(selectedResolution, layoutConfig); // This now returns the overlay window
    console.log(`[Main] Overlay launched for ${selectedResolution}.`);
  } catch (error) {
    console.error(`[Main] Error activating overlay for ${selectedResolution}:`, error);
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('scrape-status', `Overlay Activation Error: ${error.message}`);
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  }
});

ipcMain.on('execute-scan-from-overlay', async (event, selectedResolution) => {
  if (isScanInProgress) {
    console.warn('[Main] Scan already in progress. Ignoring request.');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', { info: 'Scan already in progress.', targetResolution: lastScanTargetResolution, initialSetup: false });
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
      overlayWindow.webContents.send('overlay-data', { error: 'No resolution for scanning.' });
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
        // This case should ideally not happen if the ML model only predicts known abilities
        // and those abilities are in the DB.
        allAbilitiesWithSynergiesAndDetails.push({ internalName, displayName: internalName, winrate: null, highSkillWinrate: null, highWinrateCombinations: [] });
      }
    }

    // --- START: New logic to identify top 10 abilities ---
    let topTierAbilityNames = new Set();
    if (allAbilitiesWithSynergiesAndDetails.length > 0) {
      const sortedByHighSkill = [...allAbilitiesWithSynergiesAndDetails] // Create a mutable copy
        .filter(ability => ability.highSkillWinrate !== null && typeof ability.highSkillWinrate === 'number')
        .sort((a, b) => b.highSkillWinrate - a.highSkillWinrate);

      const top10Abilities = sortedByHighSkill.slice(0, 10);
      topTierAbilityNames = new Set(top10Abilities.map(ability => ability.internalName));
      console.log('[Main] Top 10 abilities by high skill winrate:', top10Abilities.map(a => `${a.displayName} (${(a.highSkillWinrate * 100).toFixed(1)}%)`));
    }
    // --- END: New logic to identify top 10 abilities ---


    const formatResultsForOverlay = (predictedNamesArray) => {
      if (!Array.isArray(predictedNamesArray)) return [];
      return predictedNamesArray.map(internalName => {
        if (internalName === null || internalName === 'Unknown Ability') {
          return { internalName, displayName: 'Unknown Ability', winrate: null, highSkillWinrate: null, highWinrateCombinations: [], isTopTier: false };
        }
        const foundAbility = allAbilitiesWithSynergiesAndDetails.find(a => a.internalName === internalName);
        const isTopTier = topTierAbilityNames.has(internalName); // Check if this ability is in the top tier set
        if (foundAbility) {
          return { ...foundAbility, isTopTier };
        }
        // Fallback for abilities predicted but not found in allAbilitiesWithSynergiesAndDetails (should be rare)
        return { internalName, displayName: internalName, winrate: null, highSkillWinrate: null, highWinrateCombinations: [], isTopTier };
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
        initialSetup: false
      });
      console.log(`[Main] Scan for ${selectedResolution} successful. Data sent. Duration: ${durationMs} ms.`);
    }
  } catch (error) {
    console.error(`[Main] Error during scan for ${selectedResolution}:`, error);
    lastScanRawResults = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', { error: error.message || 'Scan error.' });
    }
  } finally {
    isScanInProgress = false;
    console.log(`[Main] Scan process finished for ${selectedResolution}.`);
  }
});

// --- IPC Listener for Taking Snapshot ---
ipcMain.on('take-snapshot', async (event) => {
  if (!lastScanRawResults || !lastScanTargetResolution) {
    console.warn('[Main Snapshot] No scan data available to take a snapshot.');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('snapshot-taken-status', { message: 'Error: No scan data for snapshot.', error: true, allowRetry: true });
    }
    return;
  }

  const userDataPath = app.getPath('userData');
  const failedSamplesDir = path.join(userDataPath, 'failed-samples');

  try {
    await fs.mkdir(failedSamplesDir, { recursive: true });
    console.log(`[Main Snapshot] Ensured directory exists: ${failedSamplesDir}`);

    const fullScreenshotBuffer = await screenshotDesktop({ format: 'png' });
    console.log('[Main Snapshot] Full screenshot taken.');

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
        console.warn('[Main Snapshot] Skipping slot due to undefined coordinates:', slot);
        continue;
      }
      try {
        const randomString = crypto.randomBytes(4).toString('hex');
        // Use the predicted name, or a placeholder if null/unknown
        const abilityNameForFile = (slot.predictedName && slot.predictedName !== 'Unknown Ability') ? slot.predictedName : `unknown_ability_${slot.hero_order || 's'}_${slot.ability_order || 'u'}`;
        const filename = `${abilityNameForFile}-${randomString}.png`;
        const outputPath = path.join(failedSamplesDir, filename);

        await sharp(fullScreenshotBuffer)
          .extract({ left: slot.x, top: slot.y, width: slot.width, height: slot.height })
          .toFile(outputPath);
        savedCount++;
        console.log(`[Main Snapshot] Saved: ${outputPath}`);
      } catch (cropError) {
        console.error(`[Main Snapshot] Error cropping/saving slot (${slot.predictedName || 'unknown'}): ${cropError.message}`);
      }
    }

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('snapshot-taken-status', { message: `Snapshot: ${savedCount} images saved.`, error: false, allowRetry: true });
    }
    console.log(`[Main Snapshot] Snapshot process complete. Saved ${savedCount} images.`);

  } catch (error) {
    console.error('[Main Snapshot] Error taking snapshot:', error);
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('snapshot-taken-status', { message: `Snapshot Error: ${error.message}`, error: true, allowRetry: true });
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
    console.error('Error reading layout_coordinates.json:', error);
    event.sender.send('available-resolutions', []);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      sendStatusToRenderer(mainWindow.webContents, `Error loading resolutions: ${error.message}`);
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
    // event.sender might be destroyed if main window was hidden for overlay
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      sendStatusToRenderer(mainWindow.webContents, `Error updating hero data: ${error.message}`);
    } else if (event.sender && !event.sender.isDestroyed()) { // Fallback to original sender
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
  console.log('[Main] Received close-overlay IPC.');
  if (overlayWindow) {
    console.log('[Main] Closing overlayWindow from IPC.');
    overlayWindow.close(); // This will trigger its 'closed' event
  } else {
    console.log('[Main] close-overlay IPC: no overlayWindow to close. Ensuring main window visible.');
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
});

ipcMain.on('set-overlay-mouse-ignore', (event, ignore) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
    console.log(`[Main] Overlay mouse events ignore set to: ${ignore}`);
  }
});