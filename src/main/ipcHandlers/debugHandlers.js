/**
 * @file IPC handlers for debug mode
 * Provides IPC methods for controlling and accessing debug features
 */

const { ipcMain } = require('electron');
const debugMode = require('../debugMode');
const { createLogger } = require('../logger');

const logger = createLogger('DebugHandlers');

/**
 * Register all debug-related IPC handlers
 */
function registerDebugHandlers() {
    /**
     * Enable debug mode
     * @param {object} options - Debug options
     * @returns {object} Result
     */
    ipcMain.handle('enable-debug-mode', async (event, options = {}) => {
        try {
            logger.info('Enabling debug mode via IPC', options);
            const result = debugMode.enable(options);
            return {
                success: true,
                ...result
            };
        } catch (error) {
            logger.error('Failed to enable debug mode', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Disable debug mode
     * @returns {object} Debug report
     */
    ipcMain.handle('disable-debug-mode', async () => {
        try {
            logger.info('Disabling debug mode via IPC');
            const report = debugMode.disable();
            return {
                success: true,
                report
            };
        } catch (error) {
            logger.error('Failed to disable debug mode', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Toggle debug mode
     * @param {object} options - Debug options (only used when enabling)
     * @returns {object} New state
     */
    ipcMain.handle('toggle-debug-mode', async (event, options = {}) => {
        try {
            logger.info('Toggling debug mode via IPC', options);
            const enabled = debugMode.toggle(options);
            return {
                success: true,
                enabled,
                state: debugMode.getState()
            };
        } catch (error) {
            logger.error('Failed to toggle debug mode', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Get debug state
     * @returns {object} Debug state
     */
    ipcMain.handle('get-debug-state', async () => {
        try {
            return {
                success: true,
                state: debugMode.getState()
            };
        } catch (error) {
            logger.error('Failed to get debug state', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Get debug report
     * @returns {string} Debug report
     */
    ipcMain.handle('get-debug-report', async () => {
        try {
            logger.debug('Generating debug report via IPC');
            return {
                success: true,
                report: debugMode.getDebugReport(),
                data: debugMode.generateDebugReport()
            };
        } catch (error) {
            logger.error('Failed to generate debug report', {
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Get intercepted operations
     * @param {string} operationType - Filter by type (optional)
     * @param {number} limit - Maximum number to return
     * @returns {Array} Operations
     */
    ipcMain.handle(
        'get-debug-operations',
        async (event, operationType = null, limit = 100) => {
            try {
                logger.debug('Fetching debug operations via IPC', {
                    operationType,
                    limit
                });
                return {
                    success: true,
                    operations: debugMode.getOperations(operationType, limit)
                };
            } catch (error) {
                logger.error('Failed to get debug operations', {
                    error: error.message
                });
                return {
                    success: false,
                    error: error.message
                };
            }
        }
    );

    /**
     * Capture diagnostic snapshot
     * @returns {object} Snapshot data
     */
    ipcMain.handle('capture-diagnostic-snapshot', async () => {
        try {
            logger.info('Capturing diagnostic snapshot via IPC');
            const snapshot = debugMode.captureDiagnosticSnapshot();
            return {
                success: true,
                snapshot
            };
        } catch (error) {
            logger.error('Failed to capture diagnostic snapshot', {
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Log diagnostic snapshot
     * @returns {object} Snapshot data
     */
    ipcMain.handle('log-diagnostic-snapshot', async () => {
        try {
            logger.info('Logging diagnostic snapshot via IPC');
            const snapshot = debugMode.logDiagnosticSnapshot();
            return {
                success: true,
                snapshot
            };
        } catch (error) {
            logger.error('Failed to log diagnostic snapshot', {
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Clear intercepted operations
     * @returns {number} Number of operations cleared
     */
    ipcMain.handle('clear-debug-operations', async () => {
        try {
            logger.info('Clearing debug operations via IPC');
            const count = debugMode.clearOperations();
            return {
                success: true,
                count
            };
        } catch (error) {
            logger.error('Failed to clear debug operations', {
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    logger.info('Debug IPC handlers registered');
}

module.exports = {
    registerDebugHandlers
};
