/**
 * @file Registers IPC handlers for data-related requests from the renderer process.
 * This includes fetching initial application data like translations and last update timestamps,
 * triggering data scraping operations, and providing available screen resolution configurations.
 */

const { ipcMain } = require('electron');
const fs = require('fs').promises;

const stateManager = require('../stateManager');
const { performFullScrape } = require('../scraper');
const { getLastSuccessfulScrapeDate, formatLastUpdatedDateForDisplay } = require('../dbUtils');
const { getTranslations } = require('../localization');
const { sendStatusUpdate } = require('../utils');

/**
 * Registers all data-related IPC handlers.
 */
function registerDataHandlers() {
  /**
   * Handles the 'get-initial-data' IPC call from the renderer.
   * Sends the current translations and the last successful data scrape date
   * to the requesting renderer window.
   * - Sends 'translations-loaded' with translation data.
   * - Sends 'last-updated-date' with the formatted date string.
   * @param {Electron.IpcMainEvent} event - The IPC event.
   */
  ipcMain.on('get-initial-data', async (event) => {
    const sender = event.sender;
    if (sender && !sender.isDestroyed()) {
      sender.send('translations-loaded', getTranslations());
      const lastDate = await getLastSuccessfulScrapeDate(stateManager.getActiveDbPath());
      const displayDate = formatLastUpdatedDateForDisplay(lastDate);
      // Check again after await, as sender might have been destroyed
      if (sender && !sender.isDestroyed()) {
        sender.send('last-updated-date', displayDate);
      }
    }
  });

  /**
   * Handles the 'scrape-all-windrun-data' IPC call from the renderer.
   * Initiates a full data scrape from Windrun.io.
   * Status updates during the scrape are sent back to the renderer via the 'scrape-status' channel
   * by the `performFullScrape` function.
   * @param {Electron.IpcMainEvent} event - The IPC event.
   */
  ipcMain.on('scrape-all-windrun-data', async (event) => {
    const sender = event.sender;
    if (sender && !sender.isDestroyed()) {
      await performFullScrape(stateManager.getActiveDbPath(), event.sender);
    }
  });

  /**
   * Handles the 'get-available-resolutions' IPC call from the renderer.
   * Reads the layout_coordinates.json file to get a list of supported screen resolutions.
   * Sends the list back to the renderer via the 'available-resolutions' channel.
   * If an error occurs, it sends an empty array via 'available-resolutions' and
   * an error message via the 'scrape-status' channel.
   * @param {Electron.IpcMainEvent} event - The IPC event.
   */
  ipcMain.on('get-available-resolutions', async (event) => {
    const sender = event.sender;
    if (sender && !sender.isDestroyed()) {
      try {
        const configData = await fs.readFile(stateManager.getLayoutCoordinatesPath(), 'utf-8');
        const layoutConfig = JSON.parse(configData);
        const resolutions = layoutConfig?.resolutions ? Object.keys(layoutConfig.resolutions) : [];
        sender.send('available-resolutions', resolutions);
      } catch (error) {
        console.error('[DataHandlers] Error loading resolutions from layout_coordinates.json:', error);
        sender.send('available-resolutions', []);
        // Send error status back to the renderer, which will handle translation if needed.
        sendStatusUpdate(event.sender, 'scrape-status', {
          key: 'controlPanel.status.errorLoadingResolutions', // Translation key
          params: { error: error.message }
        });
      }
    }
  });
}

module.exports = { registerDataHandlers };