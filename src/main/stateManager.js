/**
 * @module stateManager
 * @description Manages the central application state for the main process.
 * Provides getters and setters for various state properties and a utility
 * to update multiple properties at once.
 */

const state = {
    activeDbPath: '', // Path to the active SQLite database
    layoutCoordinatesPath: '', // Path to the layout coordinates JSON file
    initialPoolAbilitiesCache: { ultimates: [], standard: [] }, // Cache of abilities in the pool at the start of a draft
    fullLayoutConfigCache: null, // Cached layout configuration object
    classNamesCache: null, // Cached class names for the ML model
    isScanInProgress: false, // Flag indicating if a screen scan is currently in progress
    lastRawScanResults: null, // Raw results from the last successful scan
    lastScanTargetResolution: null, // The resolution key (e.g., "1920x1080") used for the last scan
    lastUsedScaleFactor: 1.0, // The scale factor used for the last scan
    isFirstAppRun: false, // Flag indicating if this is the first run of the application
    mySelectedSpotDbIdForDrafting: null, // DB ID of the hero model for the player's drafting spot
    mySelectedSpotOriginalOrder: null, // Original screen order of the player's drafting spot
    mySelectedModelDbHeroId: null, // DB ID of the hero model selected by the player for synergy checks
    mySelectedModelScreenOrder: null, // Screen order of the hero model selected by the player
    identifiedHeroModelsCache: null, // Cache of identified hero models from the initial scan
};

// --- Getters ---
function getActiveDbPath() { return state.activeDbPath; }
function getLayoutCoordinatesPath() { return state.layoutCoordinatesPath; }
function getInitialPoolAbilitiesCache() { return state.initialPoolAbilitiesCache; }
function getFullLayoutConfigCache() { return state.fullLayoutConfigCache; }
function getClassNamesCache() { return state.classNamesCache; }
function getIsScanInProgress() { return state.isScanInProgress; }
function getLastRawScanResults() { return state.lastRawScanResults; }
function getLastScanTargetResolution() { return state.lastScanTargetResolution; }
function getLastUsedScaleFactor() { return state.lastUsedScaleFactor; }
function getIsFirstAppRun() { return state.isFirstAppRun; }
function getMySelectedSpotDbIdForDrafting() { return state.mySelectedSpotDbIdForDrafting; }
function getMySelectedSpotOriginalOrder() { return state.mySelectedSpotOriginalOrder; }
function getMySelectedModelDbHeroId() { return state.mySelectedModelDbHeroId; }
function getMySelectedModelScreenOrder() { return state.mySelectedModelScreenOrder; }
function getIdentifiedHeroModelsCache() { return state.identifiedHeroModelsCache; }

// --- Setters ---
function setActiveDbPath(value) { state.activeDbPath = value; }
function setLayoutCoordinatesPath(value) { state.layoutCoordinatesPath = value; }
function setInitialPoolAbilitiesCache(value) { state.initialPoolAbilitiesCache = value; }
function setFullLayoutConfigCache(value) { state.fullLayoutConfigCache = value; }
function setClassNamesCache(value) { state.classNamesCache = value; }
function setIsScanInProgress(value) { state.isScanInProgress = value; }
function setLastRawScanResults(value) { state.lastRawScanResults = value; }
function setLastScanTargetResolution(value) { state.lastScanTargetResolution = value; }
function setLastUsedScaleFactor(value) { state.lastUsedScaleFactor = value; }
function setIsFirstAppRun(value) { state.isFirstAppRun = value; }
function setMySelectedSpotDbIdForDrafting(value) { state.mySelectedSpotDbIdForDrafting = value; }
function setMySelectedSpotOriginalOrder(value) { state.mySelectedSpotOriginalOrder = value; }
function setMySelectedModelDbHeroId(value) { state.mySelectedModelDbHeroId = value; }
function setMySelectedModelScreenOrder(value) { state.mySelectedModelScreenOrder = value; }
function setIdentifiedHeroModelsCache(value) { state.identifiedHeroModelsCache = value; }

// --- Batch State Update Utility ---

/**
 * Updates multiple state properties from a given object.
 * Only properties that exist in the internal `state` object and are not `undefined`
 * in the `newStateProperties` object will be updated.
 * This allows for partial updates and explicit setting of properties to `null`.
 * @param {object} newStateProperties - An object containing keys and values to update in the state.
 */
function updateStateProperties(newStateProperties) {
    for (const key in newStateProperties) {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
            if (newStateProperties[key] !== undefined) {
                state[key] = newStateProperties[key];
            }
        }
    }
}

module.exports = {
    // Getters
    getActiveDbPath, getLayoutCoordinatesPath, getInitialPoolAbilitiesCache,
    getFullLayoutConfigCache, getClassNamesCache, getIsScanInProgress,
    getLastRawScanResults, getLastScanTargetResolution, getLastUsedScaleFactor,
    getIsFirstAppRun, getMySelectedSpotDbIdForDrafting, getMySelectedSpotOriginalOrder,
    getMySelectedModelDbHeroId, getMySelectedModelScreenOrder,
    getIdentifiedHeroModelsCache,

    // Setters
    setActiveDbPath,
    setLayoutCoordinatesPath,
    setInitialPoolAbilitiesCache,
    setFullLayoutConfigCache,
    setClassNamesCache,
    setIsScanInProgress,
    setLastRawScanResults,
    setLastScanTargetResolution,
    setLastUsedScaleFactor,
    setIsFirstAppRun,
    setMySelectedSpotDbIdForDrafting,
    setMySelectedSpotOriginalOrder,
    setMySelectedModelDbHeroId,
    setMySelectedModelScreenOrder,
    setIdentifiedHeroModelsCache,

    // Batch update utility
    updateStateProperties,
};