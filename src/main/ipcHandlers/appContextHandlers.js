/**
 * @file Registers IPC handlers for application context-related requests from the renderer process.
 * This includes providing system display information, application packaging status,
 * system theme details, and handling requests to open external links.
 */

const { ipcMain, screen, app, nativeTheme, shell } = require('electron');

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
     * @param {Electron.IpcMainEvent} event - The IPC event.
     * @param {string} url - The URL to open.
     */
    ipcMain.on('open-external-link', (event, url) => {
        if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
            shell.openExternal(url).catch((err) => console.error('[MainIPC] Failed to open external link:', url, err));
        } else {
            console.warn(`[MainIPC] Attempted to open invalid or non-HTTP(S) external link: ${url}`);
        }
    });
}

module.exports = { registerAppContextHandlers };