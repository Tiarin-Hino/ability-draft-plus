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
let isScanInProgress = false; // Flag to prevent concurrent scans

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
function createOverlayWindow(resolutionKey, allCoordinatesConfig) {
  if (overlayWindow) {
    console.log('[Main] Closing existing overlay window before creating new one.');
    overlayWindow.close();
    overlayWindow = null;
  }

  isScanInProgress = false;
  console.log('[Main] isScanInProgress reset to false due to new overlay creation.');

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
    focusable: false, // Initially not focusable to allow click-through by default
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
      scanData: null, // No scan data initially
      coordinatesConfig: allCoordinatesConfig,
      targetResolution: resolutionKey,
      initialSetup: true // Flag to indicate this is the initial setup
    });
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    isScanInProgress = false;
    console.log('[Main] Overlay window closed. isScanInProgress reset to false.');

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      // Send a message to the main window's renderer to reset its UI
      if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        console.log('[Main] Notifying main window to re-enable UI.');
        mainWindow.webContents.send('overlay-closed-reset-ui'); // New IPC message
      }
    } else if (!mainWindow) {
      // createWindow(); // Or your logic for when main window doesn't exist
    }
  });
  // Return the window object so we can send data to it later
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

// --- IPC Listener for Activating Overlay ---
ipcMain.on('activate-overlay', async (event, selectedResolution) => {
  if (!selectedResolution) {
    console.error('[Main] Activate overlay request received without a resolution.');
    event.sender.send('scrape-status', 'Error: No resolution provided for overlay.');
    return;
  }
  console.log(`[Main] Received activate-overlay request for resolution: ${selectedResolution}.`);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
    console.log('[Main] Main window hidden for overlay activation.');
    sendStatusToRenderer(mainWindow.webContents, `Overlay activated for ${selectedResolution}. Main window hidden.`);
  }

  try {
    const configData = await fs.readFile(global.coordinatesPath, 'utf-8');
    const layoutConfig = JSON.parse(configData);

    // Create overlay without scan data. It will wait for a "scan now" command.
    createOverlayWindow(selectedResolution, layoutConfig);
    console.log(`[Main] Overlay launched for ${selectedResolution}. Waiting for scan command from overlay.`);
    // Optionally send a success message back to the (now hidden) main window's renderer
    // event.sender.send('scan-results', {
    //   success: true,
    //   message: `Overlay activated for ${selectedResolution}.`,
    //   resolution: selectedResolution
    // });

  } catch (error) {
    console.error(`[Main] Error during activate-overlay for ${selectedResolution}:`, error);
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('scrape-status', `Overlay Activation Error: ${error.message}`);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show(); // Show main window again if an error occurred
    }
  }
});

// --- IPC Listener for Screen Scanning (Triggered by Overlay) ---
ipcMain.on('execute-scan-from-overlay', async (event, selectedResolution) => {
  if (isScanInProgress) {
    console.warn('[Main] Scan request received, but a scan is already in progress. Ignoring this request.');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      // Optionally send a status back to the overlay to indicate it's busy
      overlayWindow.webContents.send('overlay-data', {
        info: 'Scan already in progress. Please wait.', // Use a different key like 'info' or 'status'
        targetResolution: selectedResolution,
        initialSetup: false
      });
    }
    return;
  }

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    console.error('[Main] Execute scan request received, but overlay window is not available.');
    isScanInProgress = false; // Should not happen if guard is active, but good for safety
    return;
  }
  if (!selectedResolution) {
    console.error('[Main] Execute scan request received without a resolution.');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', { error: 'No resolution provided for scanning.' });
    }
    isScanInProgress = false; // Reset if error before scan starts
    return;
  }

  isScanInProgress = true; // Set flag
  console.log(`[Main] Starting scan for resolution: ${selectedResolution}. isScanInProgress = true.`);
  const startTime = performance.now();

  try {
    const rawResults = await processDraftScreen(global.coordinatesPath, selectedResolution);
    const { ultimates: predictedUltimatesInternalNames, standard: predictedStandardInternalNames } = rawResults;

    const allDraftPoolInternalNames = [
      ...new Set([
        ...(predictedUltimatesInternalNames || []),
        ...(predictedStandardInternalNames || [])
      ].filter(name => name !== null && name !== 'Unknown Ability'))
    ];

    let abilityDetailsMap = new Map();
    if (allDraftPoolInternalNames.length > 0) {
      abilityDetailsMap = getAbilityDetails(activeDbPath, allDraftPoolInternalNames);
    }

    const allAbilitiesWithSynergies = [];
    for (const internalName of allDraftPoolInternalNames) {
      const details = abilityDetailsMap.get(internalName);
      if (details) {
        const combinations = await getHighWinrateCombinations(activeDbPath, internalName, allDraftPoolInternalNames);
        allAbilitiesWithSynergies.push({
          ...details,
          highWinrateCombinations: combinations || []
        });
      } else {
        allAbilitiesWithSynergies.push({
          internalName: internalName,
          displayName: internalName, winrate: null, highSkillWinrate: null, highWinrateCombinations: []
        });
      }
    }

    const formatResultsForOverlay = (predictedNamesArray) => {
      if (!Array.isArray(predictedNamesArray)) return [];
      return predictedNamesArray.map(internalName => {
        if (internalName === null || internalName === 'Unknown Ability') {
          return { internalName: internalName, displayName: 'Unknown Ability', winrate: null, highSkillWinrate: null, highWinrateCombinations: [] };
        }
        const foundAbility = allAbilitiesWithSynergies.find(a => a.internalName === internalName);
        return foundAbility || { internalName: internalName, displayName: internalName, winrate: null, highSkillWinrate: null, highWinrateCombinations: [] };
      });
    };

    const formattedUltimatesForOverlay = formatResultsForOverlay(predictedUltimatesInternalNames);
    const formattedStandardForOverlay = formatResultsForOverlay(predictedStandardInternalNames);

    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);

    const configData = await fs.readFile(global.coordinatesPath, 'utf-8');
    const layoutConfig = JSON.parse(configData);

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', {
        scanData: {
          ultimates: formattedUltimatesForOverlay,
          standard: formattedStandardForOverlay
        },
        coordinatesConfig: layoutConfig,
        targetResolution: selectedResolution,
        durationMs: durationMs,
        initialSetup: false
      });
      console.log(`[Main] Scan for ${selectedResolution} successful. Data sent to overlay. Duration: ${durationMs} ms.`);
    }
  } catch (error) {
    console.error(`[Main] Error during execute-scan-from-overlay for ${selectedResolution}:`, error);
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', { error: error.message || 'Unknown error during scan.' });
    }
  } finally {
    isScanInProgress = false; // Reset flag in finally block
    console.log(`[Main] Scan process finished for ${selectedResolution}. isScanInProgress = false.`);
  }
});

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

app.on('will-quit', () => {
  isScanInProgress = false;
});