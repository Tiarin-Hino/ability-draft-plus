/**
 * @file Registers IPC handlers for overlay window interactions and operations.
 * This includes activating/deactivating the overlay, handling selections within the overlay,
 * initiating screen scans for game data, and managing overlay-specific settings.
 */

const { ipcMain, screen } = require('electron');
const fs = require('fs').promises;
const screenshotDesktop = require('screenshot-desktop');

const stateManager = require('../stateManager');
const windowManager = require('../windowManager');
const mlManager = require('../mlManager');
const { sendStatusUpdate } = require('../utils');
const { MIN_PREDICTION_CONFIDENCE } = require('../../../config');
const {
    validateResolution,
    validateNumber,
    validateBoolean,
    ValidationError
} = require('../ipcValidation');

// Import performance optimization modules
const { screenshotCache } = require('../../imageProcessor');

/**
 * Registers all IPC handlers related to the overlay window.
 */
function registerOverlayHandlers() {
  /**
   * Handles the 'activate-overlay' IPC call from the renderer.
   * Hides the main window, loads necessary layout configurations,
   * resets relevant scan state, and initializes/shows the overlay window.
   * Now includes validation to ensure resolution format is valid.
   * Sends status updates via 'scrape-status' or 'scan-results' channels to the main window.
   * @param {Electron.IpcMainEvent} event - The IPC event.
   * @param {string} selectedResolution - The resolution string (e.g., '1920x1080') for which the overlay should be configured.
   */
  ipcMain.on('activate-overlay', async (event, selectedResolution) => {
    try {
      validateResolution(selectedResolution, 'selectedResolution');
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(`[OverlayHandlers] ${error.message}`);
        sendStatusUpdate(event.sender, 'scrape-status', {
          key: 'overlayActivationError',
          params: { error: error.message }
        });
        return;
      }
      throw error;
    }
    windowManager.hideMainWindow();

    stateManager.setInitialPoolAbilitiesCache({ ultimates: [], standard: [] });
    stateManager.setIdentifiedHeroModelsCache(null);

    if (!stateManager.getFullLayoutConfigCache()) {
      try {
        const layoutData = await fs.readFile(stateManager.getLayoutCoordinatesPath(), 'utf-8');
        stateManager.setFullLayoutConfigCache(JSON.parse(layoutData));
      } catch (err) {
        console.error("[OverlayHandlers] Failed to load layout_coordinates.json for activate-overlay:", err);
        sendStatusUpdate(event.sender, 'scan-results', { error: `Layout config error: ${err.message}`, resolution: selectedResolution });
        windowManager.showMainWindow();
        return;
      }
    }

    try {
      const layoutConfigToUse = stateManager.getFullLayoutConfigCache();
      if (!layoutConfigToUse) {
        throw new Error("Layout configuration cache is unexpectedly empty.");
      }
      const primaryDisplay = screen.getPrimaryDisplay();
      stateManager.setLastUsedScaleFactor(primaryDisplay.scaleFactor || 1.0);

      const resetScanStateForOverlay = () => {
        stateManager.setIsScanInProgress(false);
        stateManager.setLastRawScanResults(null);
        stateManager.setLastScanTargetResolution(null);
        stateManager.setIdentifiedHeroModelsCache(null);
        stateManager.setMySelectedModelDbHeroId(null);
        stateManager.setMySelectedModelScreenOrder(null);
      };

      windowManager.initOverlayWindow(
        selectedResolution,
        layoutConfigToUse,
        stateManager.getLastUsedScaleFactor(),
        stateManager.getMySelectedSpotDbIdForDrafting(),
        stateManager.getMySelectedModelScreenOrder(),
        resetScanStateForOverlay
      );

      // Start screenshot prefetching for faster scans
      console.log('[OverlayHandlers] Starting screenshot prefetch');
      screenshotCache.startPrefetch();

      sendStatusUpdate(event.sender, 'scrape-status', { key: 'ipcMessages.overlayActivated', params: { res: selectedResolution } });
    } catch (error) {
      console.error('[OverlayHandlers] Overlay Activation Error:', error);
      sendStatusUpdate(event.sender, 'scrape-status', { key: 'ipcMessages.overlayActivationError', params: { error: error.message } });
      windowManager.showMainWindow();
    }
  });

  /**
   * Handles the 'select-my-model' IPC call, typically from the overlay window.
   * Toggles the selection of the player's own hero model based on its screen order and database ID.
   * Notifies the overlay window of the change via 'my-model-selection-changed'.
   * @param {Electron.IpcMainEvent} event - The IPC event (sender is overlay).
   * @param {object} payload - The selection payload.
   * @param {number} payload.heroOrder - The screen order of the hero model.
   * @param {string|number} payload.dbHeroId - The database ID of the hero.
   */
  ipcMain.on('select-my-model', (event, { heroOrder, dbHeroId }) => {
    if (stateManager.getMySelectedModelScreenOrder() === heroOrder && stateManager.getMySelectedModelDbHeroId() === dbHeroId) {
      stateManager.setMySelectedModelDbHeroId(null);
      stateManager.setMySelectedModelScreenOrder(null);
    } else {
      stateManager.setMySelectedModelDbHeroId(dbHeroId);
      stateManager.setMySelectedModelScreenOrder(heroOrder);
    }
    const currentOverlayWindow = windowManager.getOverlayWindow();
    if (currentOverlayWindow && !currentOverlayWindow.isDestroyed()) {
      sendStatusUpdate(currentOverlayWindow.webContents, 'my-model-selection-changed', {
        selectedModelHeroOrder: stateManager.getMySelectedModelScreenOrder()
      });
    }
  });

  /**
   * Handles the 'select-my-spot-for-drafting' IPC call, typically from the overlay window.
   * Toggles the selection of the player's drafting spot (which hero slot they are drafting for).
   * Notifies the overlay window of the change via 'my-spot-for-drafting-selection-changed'.
   * @param {Electron.IpcMainEvent} event - The IPC event (sender is overlay).
   * @param {object} payload - The selection payload.
   * @param {number} payload.heroOrder - The original screen order of the hero spot.
   * @param {string|number} payload.dbHeroId - The database ID of the hero associated with the spot.
   */
  ipcMain.on('select-my-spot-for-drafting', (event, { heroOrder, dbHeroId }) => {
    if (stateManager.getMySelectedSpotOriginalOrder() === heroOrder && stateManager.getMySelectedSpotDbIdForDrafting() === dbHeroId) {
      stateManager.setMySelectedSpotDbIdForDrafting(null);
      stateManager.setMySelectedSpotOriginalOrder(null);
    } else {
      stateManager.setMySelectedSpotDbIdForDrafting(dbHeroId);
      stateManager.setMySelectedSpotOriginalOrder(heroOrder);
    }

    const currentOverlayWindow = windowManager.getOverlayWindow();
    if (currentOverlayWindow && !currentOverlayWindow.isDestroyed()) {
      sendStatusUpdate(currentOverlayWindow.webContents, 'my-spot-for-drafting-selection-changed', {
        selectedHeroOrderForDrafting: stateManager.getMySelectedSpotOriginalOrder(),
        selectedHeroDbId: stateManager.getMySelectedSpotDbIdForDrafting()
      });
    }
  });

  /**
   * Handles the 'execute-scan-from-overlay' IPC call from the overlay window.
   * Initiates a screen scan if one is not already in progress.
   * Takes a screenshot and sends it to the ML manager for processing.
   * Scan results or errors are communicated back to the overlay via the 'overlay-data' channel.
   * @param {Electron.IpcMainEvent} event - The IPC event (sender is overlay).
   * @param {string} selectedResolution - The target resolution for the scan.
   * @param {number} selectedHeroOriginalOrderFromOverlay - The original screen order of the hero spot the player has selected for drafting.
   * @param {boolean} isInitialScan - Flag indicating if this is the first scan after overlay activation.
   */
  ipcMain.on('execute-scan-from-overlay', async (event, selectedResolution, selectedHeroOriginalOrderFromOverlay, isInitialScan) => {
    if (stateManager.getIsScanInProgress()) return;

    const currentOverlayWindow = windowManager.getOverlayWindow();
    if (!currentOverlayWindow || currentOverlayWindow.isDestroyed() || !selectedResolution) return;

    stateManager.setIsScanInProgress(true);
    stateManager.setLastScanTargetResolution(selectedResolution);
    stateManager.setMySelectedSpotOriginalOrder(selectedHeroOriginalOrderFromOverlay);

    try {
      // Use cached screenshot for faster scan initiation
      const screenshotBuffer = await screenshotCache.getScreenshot();
      mlManager.postMessage({
        type: 'scan',
        payload: {
          isInitialScan,
          screenshotBuffer,
          layoutConfig: stateManager.getFullLayoutConfigCache(),
          targetResolution: selectedResolution,
          confidenceThreshold: MIN_PREDICTION_CONFIDENCE
        }
      });
    } catch (error) {
      console.error(`[OverlayHandlers] Error preparing scan for ${selectedResolution}:`, error);
      stateManager.setIsScanInProgress(false);
      sendStatusUpdate(currentOverlayWindow.webContents, 'overlay-data', { error: error.message || 'Scan preparation failed.', scaleFactor: stateManager.getLastUsedScaleFactor() });
    }
  });

  /**
   * Handles the 'close-overlay' IPC call.
   * Closes the overlay window.
   */
  ipcMain.on('close-overlay', () => {
    // Stop screenshot prefetching to save resources
    console.log('[OverlayHandlers] Stopping screenshot prefetch');
    screenshotCache.stopPrefetch();
    screenshotCache.clearCache();

    windowManager.closeOverlay();
  });

  /**
   * Handles the 'set-overlay-mouse-ignore' IPC call.
   * Sets whether the overlay window should ignore mouse events (click-through).
   * @param {Electron.IpcMainEvent} event - The IPC event.
   * @param {boolean} ignore - True to ignore mouse events, false to capture them.
   * @param {object} [options] - Optional parameters.
   * @param {boolean} [options.forward=true] - If true, ignored mouse events are forwarded to the window below.
   */
  ipcMain.on('set-overlay-mouse-ignore', (event, ignore, options) => windowManager.setOverlayMouseEvents(ignore, options ? options.forward : true));
}

module.exports = { registerOverlayHandlers };