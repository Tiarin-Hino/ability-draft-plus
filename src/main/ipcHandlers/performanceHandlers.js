/**
 * @file IPC handlers for performance metrics
 * Provides IPC methods for renderer to access performance data
 */

const { ipcMain } = require('electron');
const performanceMetrics = require('../performanceMetrics');
const { createLogger } = require('../logger');

const logger = createLogger('PerformanceHandlers');

/**
 * Register all performance-related IPC handlers
 */
function registerPerformanceHandlers() {
    /**
     * Get performance statistics
     * @returns {object} Performance stats
     */
    ipcMain.handle('get-performance-stats', async () => {
        try {
            logger.debug('Fetching performance statistics');
            return {
                success: true,
                stats: performanceMetrics.getStats()
            };
        } catch (error) {
            logger.error('Failed to get performance stats', {
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Get performance summary
     * @returns {string} Human-readable summary
     */
    ipcMain.handle('get-performance-summary', async () => {
        try {
            logger.debug('Fetching performance summary');
            return {
                success: true,
                summary: performanceMetrics.getSummary()
            };
        } catch (error) {
            logger.error('Failed to get performance summary', {
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Get metrics for specific operation type
     * @param {string} operationType - Type of operation
     * @param {number} limit - Maximum number to return
     * @returns {Array} Metrics
     */
    ipcMain.handle(
        'get-performance-metrics',
        async (event, operationType, limit = 50) => {
            try {
                logger.debug('Fetching performance metrics', {
                    operationType,
                    limit
                });
                return {
                    success: true,
                    metrics: performanceMetrics.getMetrics(operationType, limit)
                };
            } catch (error) {
                logger.error('Failed to get performance metrics', {
                    operationType,
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
     * Get slow operations
     * @param {string} operationType - Type of operation (optional)
     * @param {number} limit - Maximum number to return
     * @returns {Array} Slow operations
     */
    ipcMain.handle(
        'get-slow-operations',
        async (event, operationType = null, limit = 20) => {
            try {
                logger.debug('Fetching slow operations', { operationType, limit });
                return {
                    success: true,
                    operations: performanceMetrics.getSlowOperations(
                        operationType,
                        limit
                    )
                };
            } catch (error) {
                logger.error('Failed to get slow operations', {
                    operationType,
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
     * Reset performance metrics
     * @returns {boolean} Success status
     */
    ipcMain.handle('reset-performance-metrics', async () => {
        try {
            logger.info('Resetting performance metrics via IPC');
            performanceMetrics.reset();
            return {
                success: true
            };
        } catch (error) {
            logger.error('Failed to reset performance metrics', {
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Enable/disable metric collection
     * @param {boolean} enabled - Whether to enable collection
     * @returns {boolean} Success status
     */
    ipcMain.handle('set-metrics-collection', async (event, enabled) => {
        try {
            logger.info('Setting metrics collection via IPC', { enabled });
            performanceMetrics.setCollectionEnabled(enabled);
            return {
                success: true,
                enabled: performanceMetrics.isCollectionEnabled()
            };
        } catch (error) {
            logger.error('Failed to set metrics collection', {
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    });

    logger.info('Performance IPC handlers registered');
}

module.exports = {
    registerPerformanceHandlers
};
