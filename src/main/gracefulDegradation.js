/**
 * @file Graceful degradation handlers for various failure scenarios
 * Provides fallback mechanisms when critical components fail
 */

const { createLogger } = require('./logger');
const { dialog } = require('electron');

const logger = createLogger('GracefulDegradation');

/**
 * Cache for last successful query results
 * Used as fallback when database is unavailable
 */
const queryCache = {
    heroes: null,
    abilities: null,
    synergies: null,
    lastUpdate: null
};

/**
 * Handle ML model loading failure
 * @param {Error} error - The error that occurred
 * @param {object} windowManager - Window manager instance
 * @returns {object} Recovery options and user message
 */
function handleModelLoadFailure(error, windowManager) {
    logger.error('ML Model failed to load', {
        error: error.message,
        stack: error.stack
    });

    const recoveryMessage = {
        title: 'ML Model Failed to Load',
        message: 'The ability recognition model could not be loaded.',
        suggestions: [
            '1. Restart the application',
            '2. Verify model files exist in the installation directory',
            '3. Reinstall the application if problem persists',
            '',
            'The application will continue in manual mode.',
            'You can manually input ability names instead of scanning.'
        ],
        severity: 'error',
        fallbackMode: 'manual-input'
    };

    // Show error dialog
    if (windowManager && windowManager.getMainWindow && !windowManager.getMainWindow()?.isDestroyed()) {
        dialog.showMessageBox(windowManager.getMainWindow(), {
            type: 'error',
            title: recoveryMessage.title,
            message: recoveryMessage.message,
            detail: recoveryMessage.suggestions.join('\n'),
            buttons: ['OK']
        });
    }

    return recoveryMessage;
}

/**
 * Handle database query failure with caching fallback
 * @param {Error} error - The error that occurred
 * @param {string} queryType - Type of query that failed
 * @param {*} cachedResult - Previously cached result to return as fallback
 * @returns {object} Fallback data and status
 */
function handleDatabaseQueryFailure(error, queryType, cachedResult = null) {
    logger.error('Database query failed', {
        queryType,
        error: error.message,
        hasCachedData: !!cachedResult
    });

    if (cachedResult) {
        logger.warn('Using cached data as fallback', {
            queryType,
            cacheAge: queryCache.lastUpdate
                ? Date.now() - queryCache.lastUpdate
                : 'unknown'
        });

        return {
            success: true,
            data: cachedResult,
            fromCache: true,
            cacheWarning:
                'Data may be stale. Database is temporarily unavailable.',
            error: null
        };
    }

    logger.error('No cached data available for fallback', { queryType });

    return {
        success: false,
        data: null,
        fromCache: false,
        error: error.message,
        suggestion: 'Please restart the application or restore database from backup.'
    };
}

/**
 * Cache successful query results for fallback
 * @param {string} queryType - Type of query
 * @param {*} data - Query result data to cache
 */
function cacheQueryResult(queryType, data) {
    if (!queryCache[queryType]) {
        queryCache[queryType] = {};
    }

    queryCache[queryType] = data;
    queryCache.lastUpdate = Date.now();

    logger.debug('Cached query result', {
        queryType,
        dataSize: JSON.stringify(data).length
    });
}

/**
 * Get cached query result
 * @param {string} queryType - Type of query
 * @returns {*} Cached data or null
 */
function getCachedQueryResult(queryType) {
    return queryCache[queryType] || null;
}

/**
 * Handle network failure during scraping
 * @param {Error} error - The network error
 * @param {number} attempt - Current attempt number
 * @param {number} maxAttempts - Maximum retry attempts
 * @returns {Promise<object>} Retry decision and user message
 */
async function handleNetworkFailure(error, attempt = 1, maxAttempts = 3) {
    logger.warn('Network request failed', {
        error: error.message,
        attempt,
        maxAttempts
    });

    const isTimeout = error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED';
    const isConnectionError =
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ENETUNREACH';

    let userMessage = '';
    let shouldRetry = attempt < maxAttempts;
    let retryDelay = 0;

    if (isTimeout) {
        userMessage = 'Connection timed out. Check your internet connection.';
        retryDelay = Math.min(2000 * attempt, 5000); // Exponential backoff, max 5s
    } else if (isConnectionError) {
        userMessage =
            'Cannot reach server. Check your internet connection and firewall settings.';
        retryDelay = Math.min(3000 * attempt, 10000); // Exponential backoff, max 10s
    } else {
        userMessage = `Network error: ${error.message}`;
        retryDelay = Math.min(1000 * attempt, 3000);
    }

    if (attempt >= maxAttempts) {
        logger.error('Max retry attempts reached for network request', {
            error: error.message,
            attempts: maxAttempts
        });

        userMessage += ' Maximum retry attempts reached. Please try again later.';
        shouldRetry = false;
    }

    if (shouldRetry && retryDelay > 0) {
        logger.info('Retrying network request', {
            attempt: attempt + 1,
            maxAttempts,
            delayMs: retryDelay
        });

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }

    return {
        shouldRetry,
        retryDelay,
        userMessage,
        attempt: attempt + 1
    };
}

/**
 * Handle screenshot capture failure
 * @param {Error} error - The error that occurred
 * @returns {object} Fallback options and user message
 */
function handleScreenshotFailure(error) {
    logger.error('Screenshot capture failed', {
        error: error.message,
        stack: error.stack
    });

    return {
        success: false,
        error: error.message,
        suggestions: [
            'Ensure Dota 2 is running on your primary monitor',
            'Check that the game is not minimized',
            'Verify screen permissions are granted',
            'Try capturing again'
        ],
        fallbackMode: 'manual-retry'
    };
}

/**
 * Handle worker thread crash/exit
 * @param {number} exitCode - Worker exit code
 * @param {Function} restartCallback - Function to call to restart worker
 * @returns {Promise<object>} Recovery result
 */
async function handleWorkerCrash(exitCode, restartCallback) {
    logger.error('Worker thread crashed', { exitCode });

    try {
        logger.info('Attempting to restart worker thread');
        await restartCallback();

        logger.info('Worker thread restarted successfully');

        return {
            success: true,
            message: 'Worker restarted successfully'
        };
    } catch (restartError) {
        logger.error('Failed to restart worker thread', {
            error: restartError.message
        });

        return {
            success: false,
            error: restartError.message,
            suggestion: 'Please restart the application'
        };
    }
}

/**
 * Clear all cached query results
 */
function clearQueryCache() {
    queryCache.heroes = null;
    queryCache.abilities = null;
    queryCache.synergies = null;
    queryCache.lastUpdate = null;

    logger.info('Query cache cleared');
}

/**
 * Get cache statistics
 * @returns {object} Cache stats
 */
function getCacheStats() {
    const stats = {
        hasHeroes: !!queryCache.heroes,
        hasAbilities: !!queryCache.abilities,
        hasSynergies: !!queryCache.synergies,
        lastUpdate: queryCache.lastUpdate,
        age: queryCache.lastUpdate ? Date.now() - queryCache.lastUpdate : null
    };

    return stats;
}

module.exports = {
    handleModelLoadFailure,
    handleDatabaseQueryFailure,
    handleNetworkFailure,
    handleScreenshotFailure,
    handleWorkerCrash,
    cacheQueryResult,
    getCachedQueryResult,
    clearQueryCache,
    getCacheStats
};
