const { BrowserWindow, screen, nativeTheme } = require('electron');
const path = require('path');
const { IS_PACKAGED } = require('../../config');
const { getTranslations } = require('./localization');
const { sendStatusUpdate } = require('./utils');
const { getLastSuccessfulScrapeDate, formatLastUpdatedDateForDisplay } = require('./dbUtils');

/**
 * @module windowManager
 * @description Manages the creation, lifecycle, and interactions of the main application window
 * and the overlay window. It also handles native theme updates.
 * This module requires the Electron `app` instance to be set via `setAppInstance`
 * for path resolutions.
 */

let mainWindow = null;
let overlayWindow = null;
let app; // Electron App instance, set by setAppInstance

// --- Main Window ---

/**
 * Creates and configures the main application window.
 * Sets up 'did-finish-load' and 'closed' event handlers.
 *
 * @param {boolean} isFirstAppRun - Flag indicating if this is the first run of the application.
 * @param {string} activeDbPath - Path to the active SQLite database, used to fetch initial data.
 * @returns {import('electron').BrowserWindow} The created main window instance.
 */
function createMainWindow(isFirstAppRun, activeDbPath) {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 1000,
        webPreferences: {
            preload: path.join(app.getAppPath(), 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        }
    });
    mainWindow.loadFile(path.join(app.getAppPath(), 'index.html'));

    mainWindow.webContents.on('did-finish-load', async () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('translations-loaded', getTranslations());
            const lastDate = await getLastSuccessfulScrapeDate(activeDbPath);
            const displayDate = formatLastUpdatedDateForDisplay(lastDate);
            if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send('last-updated-date', displayDate);
            }

            if (isFirstAppRun) {
                sendStatusUpdate(mainWindow.webContents, 'scrape-status', 'Using bundled data. Update data via "Update Windrun Data" if needed.');
            }
            mainWindow.webContents.send('initial-system-theme', {
                shouldUseDarkColors: nativeTheme.shouldUseDarkColors
            });
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    return mainWindow;
}

/**
 * Retrieves the current main window instance.
 * @returns {import('electron').BrowserWindow | null} The main window instance, or null if it doesn't exist.
 */
function getMainWindow() {
    return mainWindow;
}

/**
 * Shows and focuses the main window if it exists and is not destroyed.
 */
function showMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
    }
}

/**
 * Hides the main window if it exists and is not destroyed.
 */
function hideMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
    }
}

/**
 * Checks if the main window is currently visible.
 * @returns {boolean} True if the main window exists, is not destroyed, and is visible; false otherwise.
 */
function isMainWindowVisible() {
    return mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
}


// --- Overlay Window ---
/**
 * Creates and configures the overlay window.
 * If an overlay window already exists, it is closed before creating a new one.
 * The overlay is set to be transparent, frameless, always on top, and ignore mouse events initially.
 * It calls a `resetScanStateCallback` on creation and closure to manage related state in the main process.
 *
 * @param {string} resolutionKey - The key representing the target display resolution (e.g., "1920x1080").
 * @param {object} allCoordinatesConfig - The full coordinates configuration object for UI elements.
 * @param {number} scaleFactorToUse - The DPI scale factor to apply to the overlay.
 * @param {number | null} mySelectedSpotDbIdForDrafting - DB ID of the hero model for the player's drafting spot (for initial data).
 * @param {number | null} mySelectedModelScreenOrder - Screen order of the hero model selected by the player (for initial data).
 * @param {function} resetScanStateCallback - A callback function to reset scan-related state in the main process
 *                                            when the overlay is created or closed.
 * @returns {import('electron').BrowserWindow} The created overlay window instance.
 */
function createOverlayWindow(
    resolutionKey,
    allCoordinatesConfig,
    scaleFactorToUse,
    mySelectedSpotDbIdForDrafting, // for initial data
    mySelectedModelScreenOrder,    // for initial data
    resetScanStateCallback         // Callback to reset scan-related state in main.js
) {
    if (overlayWindow) {
        overlayWindow.close(); // This will trigger its 'closed' event
    }
    // Call the reset callback provided by main.js
    if (typeof resetScanStateCallback === 'function') {
        resetScanStateCallback();
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight, x, y } = primaryDisplay.bounds;

    overlayWindow = new BrowserWindow({
        width: screenWidth,
        height: screenHeight,
        x, y,
        frame: false,
        transparent: true,
        skipTaskbar: true,
        focusable: false,
        webPreferences: {
            preload: path.join(app.getAppPath(), 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    overlayWindow.loadFile(path.join(app.getAppPath(), 'overlay.html'));

    if (!IS_PACKAGED) {
        overlayWindow.webContents.openDevTools({ mode: 'detach' });
    }

    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setVisibleOnAllWorkspaces(true);
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });

    overlayWindow.webContents.on('did-finish-load', () => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('translations-loaded', getTranslations());
            sendStatusUpdate(overlayWindow.webContents, 'overlay-data', {
                scanData: null,
                coordinatesConfig: allCoordinatesConfig,
                targetResolution: resolutionKey,
                opCombinations: [],
                heroModels: [],
                heroesForMySpotUI: [],
                initialSetup: true,
                scaleFactor: scaleFactorToUse,
                selectedHeroForDraftingDbId: mySelectedSpotDbIdForDrafting,
                selectedModelHeroOrder: mySelectedModelScreenOrder
            });
        }
    });

    overlayWindow.on('closed', () => {
        overlayWindow = null;
        // Call the reset callback again, as some state might be tied to the overlay's existence
        if (typeof resetScanStateCallback === 'function') {
            resetScanStateCallback();
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
            showMainWindow(); // Use the exported function
            sendStatusUpdate(mainWindow.webContents, 'overlay-closed-reset-ui', null);
        }
    });
    return overlayWindow;
}

/**
 * Retrieves the current overlay window instance.
 * @returns {import('electron').BrowserWindow | null} The overlay window instance, or null if it doesn't exist.
 */
function getOverlayWindow() {
    return overlayWindow;
}

/**
 * Closes the overlay window if it exists. If the overlay is already closed or doesn't exist
 * and the main window is hidden, it shows the main window.
 */
function closeOverlay() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.close(); // This will trigger the 'closed' event defined above
    } else if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        // If overlay doesn't exist (or was already closed) and main window is hidden,
        // this implies the user might be trying to "close" the overlay to get back to main.
        showMainWindow();
        if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            sendStatusUpdate(mainWindow.webContents, 'overlay-closed-reset-ui', null);
        }
    }
}

/**
 * Configures whether the overlay window should ignore mouse events.
 * @param {boolean} ignore - If true, mouse events will be ignored.
 * @param {object} [options] - Options object.
 * @param {boolean} [options.forward=true] - If true, ignored mouse events will be forwarded to the window below.
 */
function setOverlayMouseEvents(ignore, forward = true) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setIgnoreMouseEvents(ignore, { forward });
    }
}

// --- Theme ---
/**
 * Sets up a listener for native theme changes (e.g., dark/light mode).
 * When the theme updates, it sends a message to the main window's renderer process.
 */
function setupNativeThemeListener() {
    nativeTheme.on('updated', () => {
        const currentMainWindow = getMainWindow();
        if (currentMainWindow && !currentMainWindow.isDestroyed() && currentMainWindow.webContents && !currentMainWindow.webContents.isDestroyed()) {
            currentMainWindow.webContents.send('system-theme-updated', {
                shouldUseDarkColors: nativeTheme.shouldUseDarkColors
            });
        }
    });
}

/**
 * Sets the Electron application instance.
 * This is necessary for functions that require `app.getAppPath()` to resolve file paths,
 * especially for loading HTML files and preloads. This function should be called early
 * in the main process setup.
 * @param {import('electron').App} electronApp - The Electron App instance.
 */
function setAppInstance(electronApp) {
    app = electronApp;
}

module.exports = {
    setAppInstance,
    initMainWindow: createMainWindow, // Renamed for clarity
    initMainWindow: createMainWindow,
    getMainWindow,
    showMainWindow,
    hideMainWindow,
    isMainWindowVisible,
    initOverlayWindow: createOverlayWindow,
    getOverlayWindow,
    closeOverlay,
    setOverlayMouseEvents,
    setupNativeThemeListener,
};