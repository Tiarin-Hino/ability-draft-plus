/**
 * @file IPC handlers for hot reload
 * Provides IPC methods for controlling hot reload in development
 */

const { ipcMain } = require('electron');
const hotReload = require('../hotReload');
const { createLogger } = require('../logger');

const logger = createLogger('HotReloadHandlers');

/**
 * Register all hot reload related IPC handlers
 */
function registerHotReloadHandlers() {
    /**
     * Enable hot reload
     * @param {object} options - Hot reload options
     * @returns {object} Result
     */
    ipcMain.handle('enable-hot-reload', async (event, options = {}) => {
        try {
            logger.info('Enabling hot reload via IPC', options);
            hotReload.enable(options);
            return {
                success: true,
                stats: hotReload.getStats()
            };
        } catch (error) {
            logger.error('Failed to enable hot reload', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Disable hot reload
     * @returns {object} Result
     */
    ipcMain.handle('disable-hot-reload', async () => {
        try {
            logger.info('Disabling hot reload via IPC');
            hotReload.disable();
            return {
                success: true
            };
        } catch (error) {
            logger.error('Failed to disable hot reload', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Get hot reload stats
     * @returns {object} Stats
     */
    ipcMain.handle('get-hot-reload-stats', async () => {
        try {
            return {
                success: true,
                stats: hotReload.getStats()
            };
        } catch (error) {
            logger.error('Failed to get hot reload stats', {
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Get watched paths
     * @returns {Array<string>} Watched paths
     */
    ipcMain.handle('get-watched-paths', async () => {
        try {
            return {
                success: true,
                paths: hotReload.getWatchedPaths()
            };
        } catch (error) {
            logger.error('Failed to get watched paths', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Set debounce delay
     * @param {number} delay - Delay in milliseconds
     * @returns {object} Result
     */
    ipcMain.handle('set-hot-reload-debounce', async (event, delay) => {
        try {
            logger.info('Setting hot reload debounce delay via IPC', { delay });
            hotReload.setDebounceDelay(delay);
            return {
                success: true,
                delay
            };
        } catch (error) {
            logger.error('Failed to set debounce delay', {
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Manually reload renderers
     * @returns {object} Result
     */
    ipcMain.handle('reload-renderers', async () => {
        try {
            logger.info('Manually reloading renderers via IPC');
            hotReload.reloadRenderers();
            return {
                success: true
            };
        } catch (error) {
            logger.error('Failed to reload renderers', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Manually restart main process
     * @returns {object} Result
     */
    ipcMain.handle('restart-main-process', async () => {
        try {
            logger.info('Manually restarting main process via IPC');
            // Give time for response to be sent
            setTimeout(() => {
                hotReload.restartMainProcess();
            }, 100);
            return {
                success: true
            };
        } catch (error) {
            logger.error('Failed to restart main process', {
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    logger.info('Hot reload IPC handlers registered');
}

module.exports = {
    registerHotReloadHandlers
};
