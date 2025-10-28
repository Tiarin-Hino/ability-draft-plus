/**
 * @file IPC handlers for memory monitoring
 * Provides IPC methods for renderer to access memory statistics
 */

const { ipcMain } = require('electron');
const memoryMonitor = require('../memoryMonitor');
const { createLogger } = require('../logger');

const logger = createLogger('MemoryHandlers');

/**
 * Register all memory-related IPC handlers
 */
function registerMemoryHandlers() {
    /**
     * Get current memory statistics
     * @returns {object} Memory stats
     */
    ipcMain.handle('get-memory-stats', async () => {
        try {
            logger.debug('Fetching memory statistics');
            return {
                success: true,
                stats: memoryMonitor.getStats()
            };
        } catch (error) {
            logger.error('Failed to get memory stats', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Get memory usage summary
     * @returns {string} Human-readable summary
     */
    ipcMain.handle('get-memory-summary', async () => {
        try {
            logger.debug('Fetching memory summary');
            return {
                success: true,
                summary: memoryMonitor.getSummary()
            };
        } catch (error) {
            logger.error('Failed to get memory summary', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Force garbage collection (if available)
     * @returns {boolean} Whether GC was triggered
     */
    ipcMain.handle('force-garbage-collection', async () => {
        try {
            logger.info('Forcing garbage collection via IPC');
            const result = memoryMonitor.forceGarbageCollection();
            return {
                success: true,
                triggered: result
            };
        } catch (error) {
            logger.error('Failed to force garbage collection', {
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Get current memory usage snapshot
     * @returns {object} Memory usage
     */
    ipcMain.handle('get-memory-usage', async () => {
        try {
            const usage = memoryMonitor.getMemoryUsage();
            return {
                success: true,
                usage: {
                    heapUsed: memoryMonitor.formatBytes(usage.heapUsed),
                    heapTotal: memoryMonitor.formatBytes(usage.heapTotal),
                    external: memoryMonitor.formatBytes(usage.external),
                    rss: memoryMonitor.formatBytes(usage.rss),
                    timestamp: usage.timestamp
                }
            };
        } catch (error) {
            logger.error('Failed to get memory usage', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Reset memory monitoring statistics
     * @returns {boolean} Success status
     */
    ipcMain.handle('reset-memory-stats', async () => {
        try {
            logger.info('Resetting memory statistics via IPC');
            memoryMonitor.resetStats();
            return {
                success: true
            };
        } catch (error) {
            logger.error('Failed to reset memory stats', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    logger.info('Memory IPC handlers registered');
}

module.exports = {
    registerMemoryHandlers
};
