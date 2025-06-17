const { ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { sendStatusUpdate } = require('./utils');

/**
 * Sets up the auto-updater functionality for the Electron application.
 * Configures auto-updater behavior, and registers IPC listeners for renderer-initiated
 * update checks, downloads, and installations. Also, listens for auto-updater events
 * to send status updates back to the main window's renderer process.
 *
 * @param {function(): import('electron').BrowserWindow | null} getMainWindow A function that returns the main BrowserWindow instance, or null if it doesn't exist.
 */
function setupAutoUpdater(getMainWindow) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    ipcMain.on('check-for-updates', () => {
        console.log('[Updater] Received request to check for updates from renderer.');
        autoUpdater.checkForUpdates().catch(err => {
            // This catch is a safety net. The 'error' event should also be emitted by autoUpdater.
            // We log it here for main process visibility, but the primary error reporting to renderer
            // is handled by the 'autoUpdater.on('error', ...)' event listener.
            console.error('[Updater] Error during checkForUpdates() promise (caught to prevent UnhandledPromiseRejectionWarning):', err.message);
        });
    });

    ipcMain.on('start-download-update', () => {
        console.log('[Updater] Received request to start downloading update.');
        autoUpdater.downloadUpdate();
    });

    ipcMain.on('quit-and-install-update', () => {
        console.log('[Updater] Received request to quit and install update.');
        autoUpdater.quitAndInstall();
    });

    autoUpdater.on('update-not-available', (info) => {
        sendStatusUpdate(getMainWindow(), 'app-update-notification', {
            status: 'not-available',
            message: 'controlPanel.update.latestVersion', // Send the translation key
            info: info
        });
    });

    autoUpdater.on('update-available', (info) => {
        sendStatusUpdate(getMainWindow(), 'app-update-notification', {
            status: 'available',
            // This message is mostly for context; the popup handles detailed translation.
            message: 'controlPanel.update.popup.updateAvailable', // Sending a key for consistency
            info: info
        });
    });

    autoUpdater.on('download-progress', (progressInfo) => {
        // The renderer primarily uses its own translation for progress messages,
        // this key acts as a fallback if progressInfo is somehow missing from the renderer's perspective.
        sendStatusUpdate(getMainWindow(), 'app-update-notification', {
            status: 'downloading',
            message: 'controlPanel.update.downloadingNoProgress', // Send translation key
            progress: {
                percent: progressInfo.percent,
                transferred: progressInfo.transferred,
                total: progressInfo.total
            }
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        sendStatusUpdate(getMainWindow(), 'app-update-notification', {
            status: 'downloaded',
            // This message is mostly for context; the popup handles detailed translation.
            message: 'controlPanel.update.popup.readyToInstall', // Sending a key for consistency
            info: info
        });
    });

    autoUpdater.on('error', (err) => {
        sendStatusUpdate(getMainWindow(), 'app-update-notification', {
            status: 'error',
            // The renderer uses translate('controlPanel.update.errorOccurred') and err.message for detailed error.
            message: 'controlPanel.update.errorOccurred', // General key for context
            error: err.message
        });
    });
}

module.exports = {
    setupAutoUpdater,
};
