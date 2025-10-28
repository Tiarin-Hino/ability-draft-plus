/**
 * @file IPC handlers for cache management
 * Provides IPC methods for renderer to access and manage caches
 */

const { ipcMain } = require('electron');
const { cacheManager } = require('../cacheManager');
const { createLogger } = require('../logger');

const logger = createLogger('CacheHandlers');

/**
 * Register all cache-related IPC handlers
 */
function registerCacheHandlers() {
    /**
     * Get statistics for all caches
     * @returns {object} Cache statistics
     */
    ipcMain.handle('get-cache-stats', async () => {
        try {
            logger.debug('Fetching cache statistics');
            return {
                success: true,
                stats: cacheManager.getAllStats()
            };
        } catch (error) {
            logger.error('Failed to get cache stats', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Get cache summary
     * @returns {string} Human-readable summary
     */
    ipcMain.handle('get-cache-summary', async () => {
        try {
            logger.debug('Fetching cache summary');
            return {
                success: true,
                summary: cacheManager.getSummary()
            };
        } catch (error) {
            logger.error('Failed to get cache summary', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Clear a specific cache
     * @param {string} cacheName - Name of cache to clear
     * @returns {boolean} Success status
     */
    ipcMain.handle('clear-cache', async (event, cacheName) => {
        try {
            const cache = cacheManager.getCache(cacheName);
            if (!cache) {
                logger.warn(`Cache not found: ${cacheName}`);
                return {
                    success: false,
                    error: `Cache not found: ${cacheName}`
                };
            }

            cache.clear();
            logger.info(`Cache cleared via IPC: ${cacheName}`);
            return {
                success: true
            };
        } catch (error) {
            logger.error('Failed to clear cache', {
                cacheName,
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Clear all caches
     * @returns {boolean} Success status
     */
    ipcMain.handle('clear-all-caches', async () => {
        try {
            logger.info('Clearing all caches via IPC');
            cacheManager.clearAll();
            return {
                success: true
            };
        } catch (error) {
            logger.error('Failed to clear all caches', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Check cache health
     * @returns {object} Health check results
     */
    ipcMain.handle('check-cache-health', async () => {
        try {
            logger.debug('Checking cache health via IPC');
            cacheManager.checkCacheHealth();
            return {
                success: true,
                message: 'Cache health check completed (see logs)'
            };
        } catch (error) {
            logger.error('Failed to check cache health', {
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    logger.info('Cache IPC handlers registered');
}

module.exports = {
    registerCacheHandlers
};
