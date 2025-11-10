/**
 * @file Registers IPC handlers for application context-related requests from the renderer process.
 * This includes providing system display information, application packaging status,
 * system theme details, and handling requests to open external links.
 */

const { ipcMain, screen, app, nativeTheme, shell } = require('electron');
const { validateUrl, ValidationError } = require('../ipcValidation');
const stateManager = require('../stateManager');

/**
 * Registers all application context IPC handlers.
 */
function registerAppContextHandlers() {
    /**
     * Handles the 'get-system-display-info' IPC call.
     * Retrieves and returns information about the primary display, including its
     * width, height, scale factor, and a formatted resolution string.
     * @returns {Promise<object>} A promise that resolves to an object containing display information.
     * @property {number} width - The width of the primary display.
     * @property {number} height - The height of the primary display.
     * @property {number} scaleFactor - The scale factor of the primary display.
     * @property {string} resolutionString - The resolution as "widthxheight".
     */
    ipcMain.handle('get-system-display-info', () => {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.size;
        const scaleFactor = primaryDisplay.scaleFactor;
        return {
            width,
            height,
            scaleFactor,
            resolutionString: `${width}x${height}`,
        };
    });

    /**
     * Handles the 'is-app-packaged' IPC call.
     * Checks and returns whether the application is currently running in a packaged state.
     * @returns {Promise<boolean>} A promise that resolves to true if the app is packaged, false otherwise.
     */
    ipcMain.handle('is-app-packaged', () => {
        return app.isPackaged;
    });

    /**
     * Handles the 'get-current-system-theme' IPC call.
     * Retrieves and returns the current system theme preference (dark or light).
     * @returns {Promise<object>} A promise that resolves to an object indicating theme preference.
     * @property {boolean} shouldUseDarkColors - True if the system is set to a dark theme.
     */
    ipcMain.handle('get-current-system-theme', () => {
        return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors };
    });

    /**
     * Handles the 'open-external-link' IPC call.
     * Opens the provided URL in the default system browser if it's a valid HTTP/HTTPS link.
     * Now includes input validation to ensure only valid URLs are processed.
     * @param {Electron.IpcMainEvent} event - The IPC event.
     * @param {string} url - The URL to open.
     */
    ipcMain.on('open-external-link', (event, url) => {
        try {
            validateUrl(url, 'url');
            shell.openExternal(url).catch((err) =>
                console.error('[MainIPC] Failed to open external link:', url, err)
            );
        } catch (error) {
            if (error instanceof ValidationError) {
                console.warn(`[MainIPC] ${error.message}: ${url}`);
            } else {
                throw error;
            }
        }
    });

    /**
     * Handles the 'set-op-threshold' IPC call.
     * Sets the user-configured OP combinations threshold in the state manager.
     * @param {Electron.IpcMainEvent} event - The IPC event.
     * @param {number} threshold - The threshold as a decimal (e.g., 0.13 for 13%).
     */
    ipcMain.on('set-op-threshold', (event, threshold) => {
        try {
            const numThreshold = parseFloat(threshold);
            // Validate threshold is a number and within reasonable range
            if (isNaN(numThreshold) || numThreshold < 0 || numThreshold > 0.3) {
                console.warn(`[MainIPC] Invalid OP threshold value: ${threshold}. Must be between 0 and 0.3.`);
                return;
            }
            stateManager.setOpThresholdPercentage(numThreshold);
            console.log(`[MainIPC] OP threshold set to: ${(numThreshold * 100).toFixed(2)}%`);
        } catch (error) {
            console.error('[MainIPC] Error setting OP threshold:', error);
        }
    });
}

module.exports = { registerAppContextHandlers };