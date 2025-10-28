/**
 * @file Memory usage monitoring and alerting
 * Tracks memory consumption and warns when thresholds are exceeded
 */

const { createLogger } = require('./logger');
const {
    MEMORY_HEAP_WARNING_THRESHOLD,
    MEMORY_HEAP_CRITICAL_THRESHOLD,
    MEMORY_EXTERNAL_WARNING_THRESHOLD,
    LOG_MEMORY_INTERVAL
} = require('../constants');

const logger = createLogger('MemoryMonitor');

/**
 * Memory statistics tracking
 */
let memoryStats = {
    heapUsed: 0,
    heapTotal: 0,
    external: 0,
    rss: 0,
    lastCheck: null,
    warningCount: 0,
    criticalCount: 0,
    peakHeapUsed: 0,
    peakExternal: 0,
    peakRss: 0
};

/**
 * Monitoring state
 */
let monitoringInterval = null;
let isMonitoring = false;
let memoryWarningCallbacks = [];

/**
 * Get current memory usage
 * @returns {object} Memory usage statistics
 */
function getMemoryUsage() {
    const usage = process.memoryUsage();

    return {
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external,
        rss: usage.rss,
        timestamp: Date.now()
    };
}

/**
 * Check if memory usage exceeds thresholds
 * @param {object} usage - Current memory usage
 * @returns {object} Threshold status
 */
function checkThresholds(usage) {
    const status = {
        heapWarning: usage.heapUsed >= MEMORY_HEAP_WARNING_THRESHOLD,
        heapCritical: usage.heapUsed >= MEMORY_HEAP_CRITICAL_THRESHOLD,
        externalWarning: usage.external >= MEMORY_EXTERNAL_WARNING_THRESHOLD,
        isHealthy: true,
        level: 'normal'
    };

    if (status.heapCritical) {
        status.isHealthy = false;
        status.level = 'critical';
    } else if (status.heapWarning || status.externalWarning) {
        status.isHealthy = false;
        status.level = 'warning';
    }

    return status;
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Bytes to format
 * @returns {string} Formatted string (e.g., "512 MB")
 */
function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Update memory statistics
 * @param {object} usage - Current memory usage
 */
function updateStats(usage) {
    memoryStats.heapUsed = usage.heapUsed;
    memoryStats.heapTotal = usage.heapTotal;
    memoryStats.external = usage.external;
    memoryStats.rss = usage.rss;
    memoryStats.lastCheck = usage.timestamp;

    // Track peaks
    if (usage.heapUsed > memoryStats.peakHeapUsed) {
        memoryStats.peakHeapUsed = usage.heapUsed;
    }
    if (usage.external > memoryStats.peakExternal) {
        memoryStats.peakExternal = usage.external;
    }
    if (usage.rss > memoryStats.peakRss) {
        memoryStats.peakRss = usage.rss;
    }
}

/**
 * Notify registered callbacks of memory warnings
 * @param {string} level - Warning level ('warning' or 'critical')
 * @param {object} usage - Current memory usage
 * @param {object} status - Threshold status
 */
function notifyCallbacks(level, usage, status) {
    memoryWarningCallbacks.forEach((callback) => {
        try {
            callback(level, usage, status);
        } catch (error) {
            logger.error('Error in memory warning callback', {
                error: error.message
            });
        }
    });
}

/**
 * Perform memory check
 * @returns {object} Check result with usage and status
 */
function performCheck() {
    const usage = getMemoryUsage();
    const status = checkThresholds(usage);

    updateStats(usage);

    // Log based on status
    if (status.level === 'critical') {
        memoryStats.criticalCount++;
        logger.error('CRITICAL: Memory usage exceeded critical threshold', {
            heapUsed: formatBytes(usage.heapUsed),
            heapTotal: formatBytes(usage.heapTotal),
            external: formatBytes(usage.external),
            rss: formatBytes(usage.rss),
            threshold: formatBytes(MEMORY_HEAP_CRITICAL_THRESHOLD)
        });
        notifyCallbacks('critical', usage, status);
    } else if (status.level === 'warning') {
        memoryStats.warningCount++;
        logger.warn('Memory usage approaching threshold', {
            heapUsed: formatBytes(usage.heapUsed),
            heapTotal: formatBytes(usage.heapTotal),
            external: formatBytes(usage.external),
            rss: formatBytes(usage.rss),
            warningThreshold: formatBytes(MEMORY_HEAP_WARNING_THRESHOLD),
            externalThreshold: formatBytes(MEMORY_EXTERNAL_WARNING_THRESHOLD)
        });
        notifyCallbacks('warning', usage, status);
    } else {
        // Log normal checks at debug level
        logger.debug('Memory check completed', {
            heapUsed: formatBytes(usage.heapUsed),
            heapTotal: formatBytes(usage.heapTotal),
            external: formatBytes(usage.external)
        });
    }

    return { usage, status };
}

/**
 * Start memory monitoring
 * @param {number} interval - Check interval in milliseconds (default from constants)
 * @returns {boolean} True if started, false if already running
 */
function startMonitoring(interval = LOG_MEMORY_INTERVAL) {
    if (isMonitoring) {
        logger.warn('Memory monitoring already running');
        return false;
    }

    logger.info('Starting memory monitoring', {
        interval,
        heapWarningThreshold: formatBytes(MEMORY_HEAP_WARNING_THRESHOLD),
        heapCriticalThreshold: formatBytes(MEMORY_HEAP_CRITICAL_THRESHOLD),
        externalWarningThreshold: formatBytes(MEMORY_EXTERNAL_WARNING_THRESHOLD)
    });

    // Perform initial check
    performCheck();

    // Start periodic monitoring
    monitoringInterval = setInterval(() => {
        performCheck();
    }, interval);

    isMonitoring = true;
    return true;
}

/**
 * Stop memory monitoring
 * @returns {boolean} True if stopped, false if not running
 */
function stopMonitoring() {
    if (!isMonitoring) {
        logger.debug('Memory monitoring not running');
        return false;
    }

    logger.info('Stopping memory monitoring', {
        totalWarnings: memoryStats.warningCount,
        totalCriticals: memoryStats.criticalCount
    });

    clearInterval(monitoringInterval);
    monitoringInterval = null;
    isMonitoring = false;

    return true;
}

/**
 * Register a callback for memory warnings
 * @param {Function} callback - Callback function(level, usage, status)
 */
function onMemoryWarning(callback) {
    if (typeof callback !== 'function') {
        throw new Error('Callback must be a function');
    }
    memoryWarningCallbacks.push(callback);
}

/**
 * Unregister a memory warning callback
 * @param {Function} callback - Callback to remove
 * @returns {boolean} True if removed, false if not found
 */
function offMemoryWarning(callback) {
    const index = memoryWarningCallbacks.indexOf(callback);
    if (index !== -1) {
        memoryWarningCallbacks.splice(index, 1);
        return true;
    }
    return false;
}

/**
 * Force garbage collection if available
 * Note: Requires Node.js to be run with --expose-gc flag
 * @returns {boolean} True if GC was triggered, false if not available
 */
function forceGarbageCollection() {
    if (global.gc) {
        logger.info('Forcing garbage collection');
        const beforeUsage = getMemoryUsage();

        global.gc();

        const afterUsage = getMemoryUsage();
        const freed = beforeUsage.heapUsed - afterUsage.heapUsed;

        logger.info('Garbage collection completed', {
            freed: formatBytes(freed),
            beforeHeap: formatBytes(beforeUsage.heapUsed),
            afterHeap: formatBytes(afterUsage.heapUsed)
        });

        return true;
    }

    logger.warn('Garbage collection not available (run with --expose-gc)');
    return false;
}

/**
 * Get current memory statistics
 * @returns {object} Memory statistics with formatted values
 */
function getStats() {
    const current = getMemoryUsage();

    return {
        current: {
            heapUsed: formatBytes(current.heapUsed),
            heapTotal: formatBytes(current.heapTotal),
            external: formatBytes(current.external),
            rss: formatBytes(current.rss)
        },
        peaks: {
            heapUsed: formatBytes(memoryStats.peakHeapUsed),
            external: formatBytes(memoryStats.peakExternal),
            rss: formatBytes(memoryStats.peakRss)
        },
        thresholds: {
            heapWarning: formatBytes(MEMORY_HEAP_WARNING_THRESHOLD),
            heapCritical: formatBytes(MEMORY_HEAP_CRITICAL_THRESHOLD),
            externalWarning: formatBytes(MEMORY_EXTERNAL_WARNING_THRESHOLD)
        },
        counts: {
            warnings: memoryStats.warningCount,
            criticals: memoryStats.criticalCount
        },
        lastCheck: memoryStats.lastCheck,
        isMonitoring
    };
}

/**
 * Reset monitoring statistics
 */
function resetStats() {
    logger.info('Resetting memory monitoring statistics');

    memoryStats = {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0,
        lastCheck: null,
        warningCount: 0,
        criticalCount: 0,
        peakHeapUsed: 0,
        peakExternal: 0,
        peakRss: 0
    };
}

/**
 * Get memory usage summary for logging/reporting
 * @returns {string} Human-readable summary
 */
function getSummary() {
    const stats = getStats();

    return [
        'Memory Usage Summary:',
        `  Current Heap: ${stats.current.heapUsed} / ${stats.current.heapTotal}`,
        `  Peak Heap: ${stats.peaks.heapUsed}`,
        `  External: ${stats.current.external}`,
        `  RSS: ${stats.current.rss}`,
        `  Warnings: ${stats.counts.warnings}`,
        `  Critical: ${stats.counts.criticals}`,
        `  Status: ${isMonitoring ? 'Monitoring' : 'Not monitoring'}`
    ].join('\n');
}

module.exports = {
    startMonitoring,
    stopMonitoring,
    performCheck,
    onMemoryWarning,
    offMemoryWarning,
    forceGarbageCollection,
    getStats,
    resetStats,
    getSummary,
    getMemoryUsage,
    formatBytes
};
