/**
 * @file Debug mode utilities
 * Provides enhanced debugging capabilities, verbose logging, and diagnostic tools
 */

const { createLogger } = require('./logger');
const memoryMonitor = require('./memoryMonitor');
const { cacheManager } = require('./cacheManager');
const performanceMetrics = require('./performanceMetrics');

const logger = createLogger('DebugMode');

/**
 * Debug mode state
 */
let debugState = {
    enabled: false,
    startTime: null,
    features: {
        verboseLogging: false,
        performanceTracking: true,
        memoryTracking: true,
        cacheTracking: true,
        operationLogging: false
    },
    interceptedOperations: []
};

/**
 * Check if debug mode is enabled
 * @returns {boolean} Whether debug mode is enabled
 */
function isEnabled() {
    return debugState.enabled;
}

/**
 * Enable debug mode
 * @param {object} options - Debug options
 * @param {boolean} options.verboseLogging - Enable verbose logging
 * @param {boolean} options.performanceTracking - Track performance metrics
 * @param {boolean} options.memoryTracking - Track memory usage
 * @param {boolean} options.cacheTracking - Track cache operations
 * @param {boolean} options.operationLogging - Log all operations
 */
function enable(options = {}) {
    if (debugState.enabled) {
        logger.warn('Debug mode already enabled');
        return;
    }

    debugState.enabled = true;
    debugState.startTime = Date.now();
    debugState.features = {
        verboseLogging: options.verboseLogging !== false,
        performanceTracking: options.performanceTracking !== false,
        memoryTracking: options.memoryTracking !== false,
        cacheTracking: options.cacheTracking !== false,
        operationLogging: options.operationLogging === true
    };

    logger.info('Debug mode ENABLED', { features: debugState.features });

    // Enable verbose logging if requested
    if (debugState.features.verboseLogging) {
        process.env.LOG_LEVEL = 'debug';
        logger.debug('Verbose logging enabled');
    }

    // Enable performance tracking
    if (debugState.features.performanceTracking) {
        performanceMetrics.setCollectionEnabled(true);
        logger.debug('Performance tracking enabled');
    }

    return {
        enabled: true,
        features: debugState.features
    };
}

/**
 * Disable debug mode
 */
function disable() {
    if (!debugState.enabled) {
        logger.warn('Debug mode not enabled');
        return;
    }

    const duration = Date.now() - debugState.startTime;

    logger.info('Debug mode DISABLED', {
        duration,
        operationsIntercepted: debugState.interceptedOperations.length
    });

    // Reset verbose logging
    if (debugState.features.verboseLogging) {
        delete process.env.LOG_LEVEL;
    }

    // Generate debug session report
    const report = generateDebugReport();
    logger.info('Debug session report', report);

    // Reset state
    debugState.enabled = false;
    debugState.startTime = null;
    debugState.interceptedOperations = [];

    return report;
}

/**
 * Toggle debug mode
 * @param {object} options - Debug options (only used when enabling)
 * @returns {boolean} New debug mode state
 */
function toggle(options = {}) {
    if (debugState.enabled) {
        disable();
        return false;
    } else {
        enable(options);
        return true;
    }
}

/**
 * Log operation for debugging
 * @param {string} operationType - Type of operation
 * @param {string} operationName - Name of operation
 * @param {object} data - Operation data
 */
function logOperation(operationType, operationName, data = {}) {
    if (!debugState.enabled || !debugState.features.operationLogging) {
        return;
    }

    const operation = {
        type: operationType,
        name: operationName,
        timestamp: Date.now(),
        data
    };

    debugState.interceptedOperations.push(operation);

    // Limit stored operations
    if (debugState.interceptedOperations.length > 1000) {
        debugState.interceptedOperations = debugState.interceptedOperations.slice(
            -1000
        );
    }

    logger.debug(`Operation: ${operationType}/${operationName}`, data);
}

/**
 * Get current debug state
 * @returns {object} Debug state
 */
function getState() {
    return {
        enabled: debugState.enabled,
        uptime: debugState.startTime ? Date.now() - debugState.startTime : 0,
        features: debugState.features,
        operationsLogged: debugState.interceptedOperations.length
    };
}

/**
 * Get intercepted operations
 * @param {string} operationType - Filter by operation type (optional)
 * @param {number} limit - Maximum number to return
 * @returns {Array} Intercepted operations
 */
function getOperations(operationType = null, limit = 100) {
    let operations = debugState.interceptedOperations;

    if (operationType) {
        operations = operations.filter((op) => op.type === operationType);
    }

    return operations.slice(-limit);
}

/**
 * Generate comprehensive debug report
 * @returns {object} Debug report
 */
function generateDebugReport() {
    const report = {
        debugSession: {
            enabled: debugState.enabled,
            duration: debugState.startTime
                ? Date.now() - debugState.startTime
                : 0,
            features: debugState.features,
            operationsLogged: debugState.interceptedOperations.length
        }
    };

    // Memory stats
    if (debugState.features.memoryTracking) {
        report.memory = memoryMonitor.getStats();
    }

    // Cache stats
    if (debugState.features.cacheTracking) {
        report.cache = cacheManager.getAllStats();
    }

    // Performance stats
    if (debugState.features.performanceTracking) {
        report.performance = performanceMetrics.getStats();
    }

    return report;
}

/**
 * Get debug report as formatted string
 * @returns {string} Formatted report
 */
function getDebugReport() {
    const report = generateDebugReport();

    const lines = [
        '=== DEBUG MODE REPORT ===',
        '',
        'Debug Session:',
        `  Enabled: ${report.debugSession.enabled}`,
        `  Duration: ${(report.debugSession.duration / 1000).toFixed(1)}s`,
        `  Operations Logged: ${report.debugSession.operationsLogged}`,
        ''
    ];

    if (report.memory) {
        lines.push('Memory Usage:');
        lines.push(`  Heap: ${report.memory.current.heapUsed}`);
        lines.push(`  External: ${report.memory.current.external}`);
        lines.push(`  RSS: ${report.memory.current.rss}`);
        lines.push(`  Warnings: ${report.memory.counts.warnings}`);
        lines.push(`  Critical: ${report.memory.counts.criticals}`);
        lines.push('');
    }

    if (report.cache) {
        lines.push('Cache Statistics:');
        for (const [name, stats] of Object.entries(report.cache)) {
            lines.push(
                `  ${name}: ${stats.size}/${stats.maxSize} entries, ${stats.hitRate} hit rate`
            );
        }
        lines.push('');
    }

    if (report.performance) {
        lines.push('Performance Metrics:');
        lines.push(`  Total Operations: ${report.performance.summary.totalScans + report.performance.summary.totalPredictions + report.performance.summary.totalQueries}`);
        lines.push(`  Scans: ${report.performance.summary.totalScans} (${report.performance.summary.slowScans} slow)`);
        lines.push(`  Predictions: ${report.performance.summary.totalPredictions} (${report.performance.summary.slowPredictions} slow)`);
        lines.push(`  Queries: ${report.performance.summary.totalQueries} (${report.performance.summary.slowQueries} slow)`);
        lines.push('');
    }

    lines.push('=== END REPORT ===');

    return lines.join('\n');
}

/**
 * Capture diagnostic snapshot
 * @returns {object} Diagnostic data
 */
function captureDiagnosticSnapshot() {
    logger.info('Capturing diagnostic snapshot');

    const snapshot = {
        timestamp: Date.now(),
        process: {
            pid: process.pid,
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            uptime: process.uptime(),
            cwd: process.cwd()
        },
        memory: memoryMonitor.getMemoryUsage(),
        cache: cacheManager.getAllStats(),
        performance: performanceMetrics.getStats(),
        debugMode: getState()
    };

    return snapshot;
}

/**
 * Log diagnostic snapshot to console and logs
 */
function logDiagnosticSnapshot() {
    const snapshot = captureDiagnosticSnapshot();

    logger.info('=== DIAGNOSTIC SNAPSHOT ===');
    logger.info('Process Info', snapshot.process);
    logger.info('Memory Usage', {
        heapUsed: memoryMonitor.formatBytes(snapshot.memory.heapUsed),
        heapTotal: memoryMonitor.formatBytes(snapshot.memory.heapTotal),
        external: memoryMonitor.formatBytes(snapshot.memory.external),
        rss: memoryMonitor.formatBytes(snapshot.memory.rss)
    });
    logger.info('Cache Stats', snapshot.cache);
    logger.info('Performance Stats', snapshot.performance);
    logger.info('Debug Mode State', snapshot.debugMode);
    logger.info('=== END SNAPSHOT ===');

    return snapshot;
}

/**
 * Clear intercepted operations log
 */
function clearOperations() {
    const count = debugState.interceptedOperations.length;
    debugState.interceptedOperations = [];
    logger.info('Cleared intercepted operations', { count });
    return count;
}

module.exports = {
    isEnabled,
    enable,
    disable,
    toggle,
    logOperation,
    getState,
    getOperations,
    generateDebugReport,
    getDebugReport,
    captureDiagnosticSnapshot,
    logDiagnosticSnapshot,
    clearOperations
};
