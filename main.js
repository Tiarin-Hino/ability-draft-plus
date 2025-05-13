const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises; // Use promises for fs
const { performance } = require('perf_hooks');
const setupDatabase = require('./src/database/setupDatabase');
const { getAbilityWinrates } = require('./src/database/queries');
const { scrapeAndStoreHeroes } = require('./src/scraper/heroScraper');
const { scrapeAndStoreAbilities } = require('./src/scraper/abilityScraper');
const { scrapeAndStoreAbilityPairs } = require('./src/scraper/abilityPairScraper');
const { processDraftScreen } = require('./src/imageProcessor');

// --- Paths and URLs ---
const dbPath = path.join(__dirname, 'dota_ad_data.db');
const coordinatesPath = path.join(__dirname, 'config', 'layout_coordinates.json');
// TARGET_RESOLUTION will now come from renderer

const heroesUrl = 'https://windrun.io/heroes';
const abilitiesUrl = 'https://windrun.io/abilities';
const abilitiesHighSkillUrl = 'https://windrun.io/ability-high-skill';
const abilityPairsUrl = 'https://windrun.io/ability-pairs';

let mainWindow; // Define mainWindow in a broader scope

function createWindow() {
  mainWindow = new BrowserWindow({ // Assign to the broader scope variable
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });
  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools(); // Optional for debugging
}

app.whenReady().then(() => {
  try {
    setupDatabase(dbPath);
    console.log("Database check/setup complete.");
  } catch (err) {
    console.error("Failed to initialize database. Exiting.", err);
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
function sendStatusToRenderer(event, message) {
  // Use mainWindow directly if event is not available (e.g., for initial resolution sending)
  const targetWindow = event ? event.sender : mainWindow?.webContents;
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.send('scrape-status', message); // Still use 'scrape-status' for general messages
  }
}

// --- IPC Listener to Get Available Resolutions ---
ipcMain.on('get-available-resolutions', async (event) => {
    try {
        const configData = await fs.readFile(coordinatesPath, 'utf-8');
        const layoutConfig = JSON.parse(configData);
        const resolutions = layoutConfig && layoutConfig.resolutions ? Object.keys(layoutConfig.resolutions) : [];
        event.sender.send('available-resolutions', resolutions);
    } catch (error) {
        console.error('Error reading layout_coordinates.json:', error);
        event.sender.send('available-resolutions', []); // Send empty array on error
        sendStatusToRenderer(event, `Error loading resolutions: ${error.message}`);
    }
});

// --- IPC Listeners for Scraping ---
ipcMain.on('scrape-heroes', async (event) => {
  const sendStatus = (msg) => sendStatusToRenderer(event, msg);
  try {
    sendStatus('Starting hero data update...');
    await scrapeAndStoreHeroes(dbPath, heroesUrl, sendStatus);
    sendStatus('Hero data update complete!');
  } catch (error) {
    console.error('Hero scraping failed:', error);
    sendStatus(`Error updating hero data: ${error.message}`);
  }
});

ipcMain.on('scrape-abilities', async (event) => {
  const sendStatus = (msg) => sendStatusToRenderer(event, msg);
  try {
    sendStatus('Starting ability data update...');
    await scrapeAndStoreAbilities(dbPath, abilitiesUrl, abilitiesHighSkillUrl, sendStatus);
    sendStatus('Ability data update complete!');
  } catch (error) {
    console.error('Ability scraping failed:', error);
    sendStatus(`Error updating ability data: ${error.message}`);
  }
});

ipcMain.on('scrape-ability-pairs', async (event) => {
  const sendStatus = (msg) => sendStatusToRenderer(event, msg);
  try {
    sendStatus('Starting ability pairs update...');
    await scrapeAndStoreAbilityPairs(dbPath, abilityPairsUrl, sendStatus);
    sendStatus('Ability pairs update complete!');
  } catch (error) {
    console.error('Ability pairs scraping failed:', error);
    sendStatus(`Error updating ability pairs: ${error.message}`);
  }
});


// --- IPC Listener for Screen Scanning (MODIFIED) ---
ipcMain.on('scan-draft-screen', async (event, selectedResolution) => { // Receive selectedResolution
  if (!selectedResolution) {
    console.error('Scan request received without a resolution.');
    event.sender.send('scan-results', {
      error: 'No resolution provided for scanning.',
      durationMs: 0
    });
    return;
  }
  console.log(`Received scan-draft-screen request for resolution: ${selectedResolution}.`);
  const startTime = performance.now();
  sendStatusToRenderer(event, `Processing screen with ML model for ${selectedResolution}...`);

  try {
    const rawResults = await processDraftScreen(coordinatesPath, selectedResolution); // Use selectedResolution

    const { ultimates: predictedUltimates, standard: predictedStandard } = rawResults;

    const allIdentifiedNames = [...new Set([...predictedUltimates, ...predictedStandard].filter(name => name !== null))];
    let winrateMap = new Map();

    if (allIdentifiedNames.length > 0) {
      try {
        winrateMap = getAbilityWinrates(dbPath, allIdentifiedNames);
        console.log(`Workspaceed winrates for ${winrateMap.size} identified abilities.`);
      } catch (dbError) {
        console.error(`Database query for winrates failed: ${dbError.message}`);
      }
    } else {
      console.log('No abilities identified by ML model to fetch winrates for.');
    }

    const formatResultsWithWinrates = (namesArray, wrMap) => {
      return namesArray.map(name => ({
        name: name || 'Unknown',
        winrate: name ? (wrMap.get(name) ?? null) : null
      }));
    };

    const formattedUltimates = formatResultsWithWinrates(predictedUltimates, winrateMap);
    const formattedStandard = formatResultsWithWinrates(predictedStandard, winrateMap);

    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);
    console.log(`Screen processing and winrate fetching for ${selectedResolution} finished in ${durationMs} ms.`);

    event.sender.send('scan-results', {
      ultimates: formattedUltimates,
      standard: formattedStandard,
      durationMs,
      resolution: selectedResolution // Send back the resolution used for clarity
    });

  } catch (error) {
    console.error(`Error during scan-draft-screen processing for ${selectedResolution}:`, error);
    const durationMs = Math.round(performance.now() - startTime);
    event.sender.send('scan-results', {
      error: error.message || 'Unknown error during screen scan',
      durationMs,
      resolution: selectedResolution
    });
  }
});