const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { performance } = require('perf_hooks');
const setupDatabase = require('./src/database/setupDatabase');
const { getAbilityDetails, getHighWinrateCombinations } = require('./src/database/queries');
const { scrapeAndStoreHeroes } = require('./src/scraper/heroScraper');
const { scrapeAndStoreAbilities } = require('./src/scraper/abilityScraper');
const { scrapeAndStoreAbilityPairs } = require('./src/scraper/abilityPairScraper');
const { processDraftScreen, initializeImageProcessor } = require('./src/imageProcessor');

const heroesUrl = 'https://windrun.io/heroes';
const abilitiesUrl = 'https://windrun.io/abilities';
const abilitiesHighSkillUrl = 'https://windrun.io/ability-high-skill';
const abilityPairsUrl = 'https://windrun.io/ability-pairs';

let mainWindow;
let activeDbPath;
let overlayWindow = null;

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
    if (!overlayWindow) {
      app.quit();
    }
  });
}

// --- Overlay Window Creation ---
function createOverlayWindow(scanData, resolutionKey, allCoordinatesConfig) {
  if (overlayWindow) {
    console.log('[Main] Closing existing overlay window before creating new one.');
    overlayWindow.close();
    overlayWindow = null;
  }

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
    // alwaysOnTop: true, // We will set this specifically after creation
    skipTaskbar: true,
    focusable: true, // Ensure it can receive focus for Esc key, even if briefly
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // hardwareAcceleration: false, // Keep this commented unless proven necessary
    },
  });

  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  // overlayWindow.webContents.openDevTools({ mode: 'detach' }); // For debugging

  // Crucial for keeping it visible with games:
  overlayWindow.setAlwaysOnTop(true, 'screen-saver'); // <<< THE FIX!
  overlayWindow.setVisibleOnAllWorkspaces(true); // Good practice for overlays

  // Initially, make it click-through.
  // Hotspots (except close button) won't change this overall state.
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  console.log('[Main] Overlay window created, set to alwaysOnTop("screen-saver") and ignore mouse events.');

  overlayWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Overlay window finished loading. Sending overlay-data.');
    overlayWindow.webContents.send('overlay-data', {
      abilities: scanData,
      coordinatesConfig: allCoordinatesConfig,
      targetResolution: resolutionKey
    });
  });

  overlayWindow.on('blur', () => {
    console.log('[Main] Overlay window BLURRED (lost focus).');
    // Re-asserting alwaysOnTop and moveTop can help if it visually gets lost
    // This was helpful because switching focus to DevTools brought it back.
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      console.log('[Main] Re-asserting alwaysOnTop and moveTop on blur.');
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      overlayWindow.moveTop(); // Ensure it's the topmost non-modal window
    }
  });

  overlayWindow.on('focus', () => {
    console.log('[Main] Overlay window FOCUSED.');
    // When it gains focus (e.g., if user Alt-Tabs to it, or if we programmatically focus for Esc),
    // ensure it's still set to ignore mouse events globally unless a specific element (like close button) overrides it.
    // This might be redundant if mouse enter/leave on close button is robust, but belt-and-suspenders.
    if (overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.webContents.isDevToolsFocused()) {
      // Only if the DevTools itself isn't what's focused
      // Check a flag or if mouse is over close button before re-asserting true
      // For now, this might conflict with close button interaction if not careful.
      // Let's rely on the close button's mouseenter/leave for now.
      // console.log('[Main] Overlay focused, ensuring click-through (unless over interactive element).');
      // overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    console.log('[Main] Overlay window closed.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[Main] Main window exists and is not destroyed. Showing and focusing it.');
      mainWindow.show();
      mainWindow.focus();
    } else if (mainWindow && mainWindow.isDestroyed()) {
      console.log('[Main] Main window was destroyed during overlay.');
      mainWindow = null;
      // app.quit(); // or recreate if desired
    } else if (!mainWindow) {
      console.log('[Main] Main window is null. Attempting to recreate.');
      // createWindow(); // Recreate if it was fully closed
    }
  });
}

// --- App Ready ---
app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  const appDbPathInUserData = path.join(userDataPath, 'dota_ad_data.db');
  const bundledDbPathInApp = path.join(__dirname, 'dota_ad_data.db');

  const appRootPath = app.getAppPath();
  global.coordinatesPath = path.join(appRootPath, 'config', 'layout_coordinates.json');

  activeDbPath = appDbPathInUserData;
  console.log(`[Main] Active database path set to: ${activeDbPath}`);

  try {
    const modelPath = 'file://' + path.join(app.getAppPath(), 'model', 'tfjs_model', 'model.json');
    const classNamesPath = path.join(app.getAppPath(), 'model', 'tfjs_model', 'class_names.json');
    initializeImageProcessor(modelPath, classNamesPath);
    console.log('[Main] Image processor initialized successfully.');
  } catch (initError) {
    console.error('[Main] CRITICAL: Failed to initialize image processor:', initError);
    app.quit();
    return;
  }

  try {
    await fs.access(activeDbPath);
    console.log(`[Main] Database found at ${activeDbPath}.`);
  } catch (e) {
    console.log(`[Main] Database not found at ${activeDbPath}. Attempting to copy from bundled DB at ${bundledDbPathInApp}...`);
    try {
      await fs.mkdir(userDataPath, { recursive: true });
      await fs.copyFile(bundledDbPathInApp, activeDbPath);
      console.log(`[Main] Bundled database successfully copied to ${activeDbPath}.`);
    } catch (copyError) {
      console.error(`[Main] CRITICAL: Failed to copy bundled database from ${bundledDbPathInApp} to ${activeDbPath}:`, copyError);
    }
  }

  try {
    console.log(`[Main] Initializing database schema at ${activeDbPath} via setupDatabase module...`);
    setupDatabase();
    console.log(`[Main] Database schema verified/setup complete for: ${activeDbPath}`);
  } catch (dbSetupError) {
    console.error("[Main] CRITICAL: Failed to initialize database schema. Error:", dbSetupError);
    app.quit();
    return;
  }

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- Helper for IPC Status Updates ---
function sendStatusToRenderer(targetWindow, message) {
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.send('scrape-status', message);
  }
}

// --- IPC Listener to Get Available Resolutions ---
ipcMain.on('get-available-resolutions', async (event) => {
  try {
    const configData = await fs.readFile(global.coordinatesPath, 'utf-8');
    const layoutConfig = JSON.parse(configData);
    const resolutions = layoutConfig?.resolutions ? Object.keys(layoutConfig.resolutions) : [];
    event.sender.send('available-resolutions', resolutions);
  } catch (error) {
    console.error('Error reading layout_coordinates.json:', error);
    event.sender.send('available-resolutions', []);
    if (mainWindow && !mainWindow.isDestroyed()) {
      sendStatusToRenderer(mainWindow.webContents, `Error loading resolutions: ${error.message}`);
    }
  }
});

// --- IPC Listeners for Scraping (Now use activeDbPath) ---
ipcMain.on('scrape-heroes', async (event) => {
  const sendStatus = (msg) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scrape-status', msg); };
  try {
    sendStatus('Starting hero data update...');
    await scrapeAndStoreHeroes(activeDbPath, heroesUrl, sendStatus);
    sendStatus('Hero data update complete!');
  } catch (error) {
    console.error('Hero scraping failed:', error);
    sendStatusToRenderer(event, `Error updating hero data: ${error.message}`);
  }
});

ipcMain.on('scrape-abilities', async (event) => {
  const sendStatus = (msg) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scrape-status', msg); };
  try {
    sendStatus('Starting ability data update...');
    // Use the globally set activeDbPath
    await scrapeAndStoreAbilities(activeDbPath, abilitiesUrl, abilitiesHighSkillUrl, sendStatus);
    sendStatus('Ability data update complete!');
  } catch (error) {
    console.error('Ability scraping failed:', error);
    sendStatus(`Error updating ability data: ${error.message}`);
  }
});

ipcMain.on('scrape-ability-pairs', async (event) => {
  const sendStatus = (msg) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scrape-status', msg); };
  try {
    sendStatus('Starting ability pairs update...');
    await scrapeAndStoreAbilityPairs(activeDbPath, abilityPairsUrl, sendStatus);
    sendStatus('Ability pairs update complete!');
  } catch (error) {
    console.error('Ability pairs scraping failed:', error);
    sendStatus(`Error updating ability pairs: ${error.message}`);
  }
});

// --- IPC Listener for Screen Scanning ---
ipcMain.on('scan-draft-screen', async (event, selectedResolution) => {
  if (!selectedResolution) {
    console.error('Scan request received without a resolution.');
    event.sender.send('scan-results', { error: 'No resolution provided for scanning.', durationMs: 0 });
    return;
  }
  console.log(`[Main] Received scan-draft-screen request for resolution: ${selectedResolution}.`);
  const startTime = performance.now();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scrape-status', `Processing screen with ML model for ${selectedResolution}...`);

  try {
    const rawResults = await processDraftScreen(global.coordinatesPath, selectedResolution);

    const { ultimates: predictedUltimatesInternalNames, standard: predictedStandardInternalNames } = rawResults;

    // Consolidate all unique identified internal names from the draft pool
    const allDraftPoolInternalNames = [
      ...new Set([
        ...(predictedUltimatesInternalNames || []),
        ...(predictedStandardInternalNames || [])
      ].filter(name => name !== null && name !== 'Unknown Ability')) // Ensure not null and not 'Unknown'
    ];

    let abilityDetailsMap = new Map();

    if (allDraftPoolInternalNames.length > 0) {
      try {
        // Fetch basic details (including high_skill_winrate now)
        abilityDetailsMap = getAbilityDetails(activeDbPath, allDraftPoolInternalNames);
        console.log(`[Main] Fetched details for ${abilityDetailsMap.size} identified abilities.`);
      } catch (dbError) {
        console.error(`[Main] Database query for ability details failed: ${dbError.message}`);
      }
    } else {
      console.log('[Main] No abilities identified by ML model to fetch details for.');
    }

    // --- NEW: Fetch High Winrate Combinations ---
    const allAbilitiesWithSynergies = [];
    for (const internalName of allDraftPoolInternalNames) {
      const details = abilityDetailsMap.get(internalName);
      if (details) {
        const combinations = await getHighWinrateCombinations(activeDbPath, internalName, allDraftPoolInternalNames);
        allAbilitiesWithSynergies.push({
          ...details, // includes internalName, displayName, winrate, highSkillWinrate
          highWinrateCombinations: combinations || [] // Ensure it's an array
        });
      } else {
        // If an ability was in allDraftPoolInternalNames but not in abilityDetailsMap (e.g. DB error for that one)
        allAbilitiesWithSynergies.push({
          internalName: internalName,
          displayName: internalName, // Fallback
          winrate: null,
          highSkillWinrate: null,
          highWinrateCombinations: []
        });
      }
    }
    // --- END NEW ---

    // Now, re-structure the data for the overlay based on the original slot order, using allAbilitiesWithSynergies
    const formatResultsForOverlay = (predictedNamesArray) => {
      if (!Array.isArray(predictedNamesArray)) return [];
      return predictedNamesArray.map(internalName => {
        if (internalName === null || internalName === 'Unknown Ability') {
          return {
            internalName: internalName, // Could be null or "Unknown Ability"
            displayName: 'Unknown Ability',
            winrate: null,
            highSkillWinrate: null,
            highWinrateCombinations: []
          };
        }
        const foundAbility = allAbilitiesWithSynergies.find(a => a.internalName === internalName);
        if (foundAbility) {
          return foundAbility;
        }
        // Fallback if ML predicted a name that somehow didn't make it into allAbilitiesWithSynergies
        // (should be rare if allDraftPoolInternalNames was comprehensive)
        return {
          internalName: internalName,
          displayName: internalName, // Fallback display
          winrate: null,
          highSkillWinrate: null,
          highWinrateCombinations: []
        };
      });
    };

    const formattedUltimatesForOverlay = formatResultsForOverlay(predictedUltimatesInternalNames);
    const formattedStandardForOverlay = formatResultsForOverlay(predictedStandardInternalNames);

    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);

    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[Main] Hiding main window for overlay.');
      mainWindow.hide();
    }

    const configData = await fs.readFile(global.coordinatesPath, 'utf-8');
    const layoutConfig = JSON.parse(configData);

    createOverlayWindow(
      {
        ultimates: formattedUltimatesForOverlay, // Use the new structure
        standard: formattedStandardForOverlay   // Use the new structure
      },
      selectedResolution,
      layoutConfig
    );
    console.log(`[Main] Scan for ${selectedResolution} successful. Overlay initiated. Duration: ${durationMs} ms.`);

    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('scan-results', {
        success: true,
        message: `Overlay launched for ${selectedResolution}.`,
        durationMs,
        resolution: selectedResolution
        // No longer sending detailed ability data to main window's renderer for display,
        // as the overlay handles this now.
      });
    }

  } catch (error) {
    console.error(`[Main] Error during scan-draft-screen for ${selectedResolution}:`, error);
    const durationMs = Math.round(performance.now() - startTime);
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('scan-results', { error: error.message || 'Unknown error', durationMs, resolution: selectedResolution });
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('scrape-status', `Scan Error: ${error.message}`);
      }
    }
  }
});

ipcMain.on('close-overlay', () => {
  console.log('[Main] Received close-overlay IPC.');
  if (overlayWindow) {
    console.log('[Main] Closing overlayWindow from IPC.');
    overlayWindow.close();
  } else {
    console.log('[Main] close-overlay IPC received, but no overlayWindow to close. Ensuring main window is visible.');
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
});

ipcMain.on('set-overlay-mouse-ignore', (event, ignore) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(ignore, { forward: true }); // ensure forward:true
    console.log(`[Main] Overlay mouse events ignore set to: ${ignore}`);
  }
});

app.on('window-all-closed', function () {
  console.log('[Main] All windows closed.');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});