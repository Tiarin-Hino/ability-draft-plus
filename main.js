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
const { scrapeAndStoreHeroAbilities } = require('./src/scraper/heroAbilityScraper');
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

let mySelectedHeroIdForScan = null;

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

    sendStatus('Phase 1/4: Updating hero data...');
    await scrapeAndStoreHeroes(activeDbPath, heroesUrl, sendStatus);
    await delay(100);

    sendStatus('Phase 2/4: Updating general ability data...');
    await scrapeAndStoreAbilities(activeDbPath, abilitiesUrl, abilitiesHighSkillUrl, sendStatus);
    await delay(100);

    sendStatus('Phase 3/4: Updating ability pair data...');
    await scrapeAndStoreAbilityPairs(activeDbPath, abilityPairsUrl, sendStatus);
    await delay(100);

    sendStatus('Phase 4/4: Updating all hero-specific ability data...');

    await scrapeAndStoreHeroAbilities(activeDbPath, sendStatus, false);
    await delay(100);

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

ipcMain.on('scrape-missing-hero-abilities', async (event) => {
  const targetWebContents = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow.webContents : event.sender;
  const sendStatusUpdate = (msg) => {
    if (targetWebContents && !targetWebContents.isDestroyed()) {
      targetWebContents.send('scrape-status', msg);
    }
  };
  try {
    sendStatusUpdate('Starting update for missing hero-specific abilities...');
    await scrapeAndStoreHeroAbilities(activeDbPath, sendStatusUpdate, true);
    sendStatusUpdate('Update for missing hero-specific abilities complete!');
  } catch (error) {
    console.error('Scraping missing hero abilities failed:', error);
    sendStatusUpdate(`Error updating missing hero abilities: ${error.message}`);
  }
});

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
        mainWindow.webContents.send('scrape-status', 'Using bundled data. Update manually if needed.');
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

ipcMain.on('execute-scan-from-overlay', async (event, selectedResolution, selectedHeroOrderFromOverlay) => {
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
  mySelectedHeroIdForScan = null;
  const startTime = performance.now();

  try {
    const rawResults = await processDraftScreen(global.coordinatesPath, selectedResolution, MIN_PREDICTION_CONFIDENCE);
    lastScanRawResults = rawResults;

    if (typeof selectedHeroOrderFromOverlay === 'number' && identifiedHeroesCache && identifiedHeroesCache.length > 0) {
      const myHeroData = identifiedHeroesCache.find(h => h.heroOrder === selectedHeroOrderFromOverlay);
      if (myHeroData) {
        let db;
        try {
          db = new Database(activeDbPath, { readonly: true });
          const heroRow = db.prepare('SELECT hero_id FROM Heroes WHERE display_name = ? OR name = ?').get(myHeroData.heroName, myHeroData.heroName);
          if (heroRow) {
            mySelectedHeroIdForScan = heroRow.hero_id;
            console.log(`[Main] "My Hero" selected: ${myHeroData.heroName} (Order: ${selectedHeroOrderFromOverlay}, DB Hero ID: ${mySelectedHeroIdForScan})`);
          } else {
            console.warn(`[Main] Could not find DB hero_id for selected hero: ${myHeroData.heroName}`);
          }
        } catch (e) {
          console.error('[Main] Error fetching selected hero_id:', e);
        } finally {
          if (db && db.open) db.close();
        }
      }
    }


    const draftPoolAbilityNames = [
      ...new Set([
        ...rawResults.ultimates.map(r => r.name).filter(name => name !== null),
        ...rawResults.standard.map(r => r.name).filter(name => name !== null)
      ])
    ];
    const selectedAbilityNamesByHeroes = rawResults.selectedAbilities.map(r => r.name).filter(name => name !== null);
    const allNamesToFetchDetailsFor = [...new Set([...draftPoolAbilityNames, ...selectedAbilityNamesByHeroes])];

    let abilityDetailsMap = new Map();
    let heroSpecificTableUsed = false;
    if (mySelectedHeroIdForScan) {
      let db;
      try {
        db = new Database(activeDbPath, { readonly: true });
        const heroAbilityTableName = `HeroAbilities_${mySelectedHeroIdForScan}`;
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(heroAbilityTableName);

        if (tableCheck) {
          const rowCount = db.prepare(`SELECT COUNT(*) as count FROM ${heroAbilityTableName}`).get();
          if (rowCount && rowCount.count > 0) {
            if (allNamesToFetchDetailsFor.length > 0) {
              const placeholders = allNamesToFetchDetailsFor.map(() => '?').join(', ');
              const sql = `
                            SELECT name, display_name, winrate, avg_pick_order, value_percentage 
                            FROM ${heroAbilityTableName}
                            WHERE name IN (${placeholders})
                        `;
              const stmt = db.prepare(sql);
              const rows = stmt.all(allNamesToFetchDetailsFor);
              rows.forEach(row => {
                abilityDetailsMap.set(row.name, {
                  internalName: row.name,
                  displayName: row.display_name || row.name,
                  winrate: (typeof row.winrate === 'number') ? row.winrate : null,
                  highSkillWinrate: null,
                  avgPickOrder: (typeof row.avg_pick_order === 'number') ? row.avg_pick_order : null,
                  valuePercentage: (typeof row.value_percentage === 'number') ? row.value_percentage : null
                });
              });
              heroSpecificTableUsed = true;
              console.log(`[Main] Using hero-specific ability data from ${heroAbilityTableName} for scoring.`);
            }
          } else {
            console.warn(`[Main] Hero-specific table ${heroAbilityTableName} is empty. Falling back to general Abilities table.`);
          }
        } else {
          console.warn(`[Main] Hero-specific table ${heroAbilityTableName} not found. Falling back to general Abilities table.`);
        }
      } catch (e) {
        console.error(`[Main] Error accessing hero-specific table: ${e.message}. Falling back.`);
      } finally {
        if (db && db.open) db.close();
      }
    }

    if (!heroSpecificTableUsed && allNamesToFetchDetailsFor.length > 0) {
      console.log('[Main] Using general Abilities table for scoring.');
      abilityDetailsMap = getAbilityDetails(activeDbPath, allNamesToFetchDetailsFor);
    }

    const identifiedHeroes = [];
    const heroDefiningAbilities = rawResults.heroDefiningAbilities.filter(r => r.name !== null);
    for (const heroAbility of heroDefiningAbilities) {
      const heroDetails = await getHeroDetailsByAbilityName(activeDbPath, heroAbility.name); //
      if (heroDetails) {
        identifiedHeroes.push({
          heroOrder: heroAbility.hero_order,
          heroName: heroDetails.heroDisplayName || heroDetails.heroName,
          dbHeroId: heroDetails.hero_id, // Make sure this line is present to store the hero_id
          originalAbilityName: heroAbility.name,
          confidence: heroAbility.confidence
        });
      }
    }
    identifiedHeroesCache = identifiedHeroes;


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
      }
    }

    // Calculate consolidated score for each ability in the draft pool
    draftPoolAbilitiesForScoring.forEach(ability => {
      let vRaw = ability.valuePercentage;
      let wRaw = ability.winrate;
      let pRaw = ability.avgPickOrder;

      const vScaled = (vRaw !== null && typeof vRaw === 'number') ? (vRaw + 1.0) / 2.0 : 0.5;
      const wNormalized = (wRaw !== null && typeof wRaw === 'number') ? wRaw : 0.5;
      let pNormalized = 0.5;
      if (pRaw !== null && typeof pRaw === 'number') {
        const clampedPRaw = Math.max(MIN_PICK_ORDER_FOR_NORMALIZATION, Math.min(MAX_PICK_ORDER_FOR_NORMALIZATION, pRaw));
        if ((MAX_PICK_ORDER_FOR_NORMALIZATION - MIN_PICK_ORDER_FOR_NORMALIZATION) > 0) {
          pNormalized = (MAX_PICK_ORDER_FOR_NORMALIZATION - clampedPRaw) / (MAX_PICK_ORDER_FOR_NORMALIZATION - MIN_PICK_ORDER_FOR_NORMALIZATION);
        }
      }
      ability.consolidatedScore =
        (WEIGHT_VALUE * vScaled) +
        (WEIGHT_WINRATE * wNormalized) +
        (WEIGHT_PICK_ORDER * pNormalized);
    });

    draftPoolAbilitiesForScoring.sort((a, b) => b.consolidatedScore - a.consolidatedScore);
    const topTierAbilityNames = new Set(
      draftPoolAbilitiesForScoring.slice(0, NUM_TOP_TIER_ABILITIES).map(ability => ability.internalName)
    );
    const scoredDraftAbilitiesMap = new Map();
    draftPoolAbilitiesForScoring.forEach(ab => scoredDraftAbilitiesMap.set(ab.internalName, ab));

    let opCombinationsInPool = [];
    if (draftPoolAbilityNames.length >= 2) {
      opCombinationsInPool = await getOPCombinationsInPool(activeDbPath, draftPoolAbilityNames); //
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
        identifiedHeroes: identifiedHeroesCache,
        initialSetup: false,
        scaleFactor: lastScaleFactor,
        myHeroDbIdUsed: mySelectedHeroIdForScan
      });
    }

  } catch (error) {
    console.error(`[Main] Error during scan for ${selectedResolution}:`, error);
    lastScanRawResults = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay-data', { error: error.message || 'Scan error.', opCombinations: [], identifiedHeroes: identifiedHeroesCache, selectedAbilities: [], scaleFactor: lastScaleFactor });
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
  //overlayWindow.webContents.openDevTools({ mode: 'detach' }); // Uncomment for debugging
  return overlayWindow;
}