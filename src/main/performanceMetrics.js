/**
 * @file Performance metrics tracking and analysis
 * Tracks operation durations, identifies bottlenecks, and provides performance insights
 */

const { createLogger } = require('./logger');
const {
    METRICS_COLLECTION_INTERVAL,
    METRICS_SLOW_SCAN_THRESHOLD,
    METRICS_SLOW_QUERY_THRESHOLD,
    METRICS_SLOW_PREDICTION_THRESHOLD
} = require('../constants');

const logger = createLogger('PerformanceMetrics');

/**
 * Performance metrics storage
 */
const metrics = {
    scans: [],
    predictions: [],
    queries: [],
    ipcCalls: [],
    operations: new Map() // Custom operations
};

/**
 * Metric thresholds for warnings
 */
const thresholds = {
    scan: METRICS_SLOW_SCAN_THRESHOLD,
    prediction: METRICS_SLOW_PREDICTION_THRESHOLD,
    query: METRICS_SLOW_QUERY_THRESHOLD,
    ipcCall: 1000 // 1 second
};

/**
 * Active timers for ongoing operations
 */
const activeTimers = new Map();

/**
 * Performance statistics
 */
let stats = {
    totalScans: 0,
    totalPredictions: 0,
    totalQueries: 0,
    totalIpcCalls: 0,
    slowScans: 0,
    slowPredictions: 0,
    slowQueries: 0,
    slowIpcCalls: 0
};

/**
 * Metric collection state
 */
let isCollecting = true;
let collectionInterval = null;

/**
 * Start timing an operation
 * @param {string} operationType - Type of operation (scan, prediction, query, ipcCall, custom)
 * @param {string} operationId - Unique identifier for this operation
 * @param {object} metadata - Optional metadata about the operation
 * @returns {string} Timer ID
 */
function startTimer(operationType, operationId, metadata = {}) {
    const timerId = `${operationType}:${operationId}:${Date.now()}`;

    activeTimers.set(timerId, {
        type: operationType,
        id: operationId,
        startTime: Date.now(),
        metadata
    });

    logger.debug(`Timer started: ${operationType}/${operationId}`);
    return timerId;
}

/**
 * Stop timing an operation and record metrics
 * @param {string} timerId - Timer ID from startTimer
 * @param {object} additionalMetadata - Additional metadata to merge
 * @returns {object} Recorded metric
 */
function stopTimer(timerId, additionalMetadata = {}) {
    const timer = activeTimers.get(timerId);
    if (!timer) {
        logger.warn(`Timer not found: ${timerId}`);
        return null;
    }

    const duration = Date.now() - timer.startTime;
    const metric = {
        type: timer.type,
        id: timer.id,
        duration,
        timestamp: timer.startTime,
        metadata: { ...timer.metadata, ...additionalMetadata }
    };

    // Store metric if collection is enabled
    if (isCollecting) {
        recordMetric(metric);
    }

    // Check for slow operations
    checkSlowOperation(metric);

    activeTimers.delete(timerId);
    logger.debug(`Timer stopped: ${timer.type}/${timer.id}`, { duration });

    return metric;
}

/**
 * Record a metric
 * @param {object} metric - Metric to record
 */
function recordMetric(metric) {
    switch (metric.type) {
        case 'scan':
            metrics.scans.push(metric);
            stats.totalScans++;
            break;
        case 'prediction':
            metrics.predictions.push(metric);
            stats.totalPredictions++;
            break;
        case 'query':
            metrics.queries.push(metric);
            stats.totalQueries++;
            break;
        case 'ipcCall':
            metrics.ipcCalls.push(metric);
            stats.totalIpcCalls++;
            break;
        default:
            // Custom operation
            if (!metrics.operations.has(metric.type)) {
                metrics.operations.set(metric.type, []);
            }
            metrics.operations.get(metric.type).push(metric);
            break;
    }

    // Limit stored metrics to prevent unbounded growth
    limitMetricsStorage();
}

/**
 * Check if operation is slow and log warning
 * @param {object} metric - Metric to check
 */
function checkSlowOperation(metric) {
    const threshold = thresholds[metric.type] || Infinity;

    if (metric.duration > threshold) {
        logger.warn(`Slow ${metric.type} detected`, {
            id: metric.id,
            duration: metric.duration,
            threshold,
            metadata: metric.metadata
        });

        // Update slow operation counters
        switch (metric.type) {
            case 'scan':
                stats.slowScans++;
                break;
            case 'prediction':
                stats.slowPredictions++;
                break;
            case 'query':
                stats.slowQueries++;
                break;
            case 'ipcCall':
                stats.slowIpcCalls++;
                break;
        }
    }
}

/**
 * Limit metrics storage to prevent memory issues
 */
function limitMetricsStorage() {
    const maxMetrics = 100; // Keep last 100 of each type

    if (metrics.scans.length > maxMetrics) {
        metrics.scans = metrics.scans.slice(-maxMetrics);
    }
    if (metrics.predictions.length > maxMetrics) {
        metrics.predictions = metrics.predictions.slice(-maxMetrics);
    }
    if (metrics.queries.length > maxMetrics) {
        metrics.queries = metrics.queries.slice(-maxMetrics);
    }
    if (metrics.ipcCalls.length > maxMetrics) {
        metrics.ipcCalls = metrics.ipcCalls.slice(-maxMetrics);
    }

    // Limit custom operations
    for (const [type, operationMetrics] of metrics.operations.entries()) {
        if (operationMetrics.length > maxMetrics) {
            metrics.operations.set(type, operationMetrics.slice(-maxMetrics));
        }
    }
}

/**
 * Calculate statistics for a metric array
 * @param {Array} metricArray - Array of metrics
 * @returns {object} Statistics
 */
function calculateStats(metricArray) {
    if (metricArray.length === 0) {
        return {
            count: 0,
            min: 0,
            max: 0,
            avg: 0,
            median: 0,
            p95: 0,
            p99: 0
        };
    }

    const durations = metricArray.map((m) => m.duration).sort((a, b) => a - b);
    const sum = durations.reduce((acc, d) => acc + d, 0);

    return {
        count: durations.length,
        min: durations[0],
        max: durations[durations.length - 1],
        avg: sum / durations.length,
        median: durations[Math.floor(durations.length / 2)],
        p95: durations[Math.floor(durations.length * 0.95)],
        p99: durations[Math.floor(durations.length * 0.99)]
    };
}

/**
 * Get performance statistics
 * @returns {object} Performance statistics
 */
function getStats() {
    return {
        summary: {
            totalScans: stats.totalScans,
            totalPredictions: stats.totalPredictions,
            totalQueries: stats.totalQueries,
            totalIpcCalls: stats.totalIpcCalls,
            slowScans: stats.slowScans,
            slowPredictions: stats.slowPredictions,
            slowQueries: stats.slowQueries,
            slowIpcCalls: stats.slowIpcCalls,
            activeTimers: activeTimers.size
        },
        scans: calculateStats(metrics.scans),
        predictions: calculateStats(metrics.predictions),
        queries: calculateStats(metrics.queries),
        ipcCalls: calculateStats(metrics.ipcCalls),
        thresholds
    };
}

/**
 * Get detailed metrics for a specific operation type
 * @param {string} operationType - Type of operation
 * @param {number} limit - Maximum number of metrics to return
 * @returns {Array} Array of metrics
 */
function getMetrics(operationType, limit = 50) {
    let metricArray;

    switch (operationType) {
        case 'scan':
            metricArray = metrics.scans;
            break;
        case 'prediction':
            metricArray = metrics.predictions;
            break;
        case 'query':
            metricArray = metrics.queries;
            break;
        case 'ipcCall':
            metricArray = metrics.ipcCalls;
            break;
        default:
            metricArray = metrics.operations.get(operationType) || [];
            break;
    }

    return metricArray.slice(-limit);
}

/**
 * Get slow operations
 * @param {string} operationType - Type of operation (optional, returns all if omitted)
 * @param {number} limit - Maximum number to return
 * @returns {Array} Array of slow operations
 */
function getSlowOperations(operationType = null, limit = 20) {
    const allMetrics = [];

    if (!operationType || operationType === 'scan') {
        allMetrics.push(
            ...metrics.scans.filter((m) => m.duration > thresholds.scan)
        );
    }
    if (!operationType || operationType === 'prediction') {
        allMetrics.push(
            ...metrics.predictions.filter(
                (m) => m.duration > thresholds.prediction
            )
        );
    }
    if (!operationType || operationType === 'query') {
        allMetrics.push(
            ...metrics.queries.filter((m) => m.duration > thresholds.query)
        );
    }
    if (!operationType || operationType === 'ipcCall') {
        allMetrics.push(
            ...metrics.ipcCalls.filter((m) => m.duration > thresholds.ipcCall)
        );
    }

    // Sort by duration (slowest first)
    allMetrics.sort((a, b) => b.duration - a.duration);

    return allMetrics.slice(0, limit);
}

/**
 * Get performance summary as human-readable string
 * @returns {string} Summary
 */
function getSummary() {
    const stats = getStats();

    const lines = [
        'Performance Metrics Summary:',
        `  Total Operations: ${stats.summary.totalScans + stats.summary.totalPredictions + stats.summary.totalQueries + stats.summary.totalIpcCalls}`,
        `  Scans: ${stats.summary.totalScans} (${stats.summary.slowScans} slow)`,
        `  Predictions: ${stats.summary.totalPredictions} (${stats.summary.slowPredictions} slow)`,
        `  Queries: ${stats.summary.totalQueries} (${stats.summary.slowQueries} slow)`,
        `  IPC Calls: ${stats.summary.totalIpcCalls} (${stats.summary.slowIpcCalls} slow)`,
        `  Active Timers: ${stats.summary.activeTimers}`
    ];

    if (stats.scans.count > 0) {
        lines.push(
            `  Scan Performance: avg=${stats.scans.avg.toFixed(0)}ms, p95=${stats.scans.p95.toFixed(0)}ms, max=${stats.scans.max}ms`
        );
    }

    if (stats.predictions.count > 0) {
        lines.push(
            `  Prediction Performance: avg=${stats.predictions.avg.toFixed(0)}ms, p95=${stats.predictions.p95.toFixed(0)}ms, max=${stats.predictions.max}ms`
        );
    }

    if (stats.queries.count > 0) {
        lines.push(
            `  Query Performance: avg=${stats.queries.avg.toFixed(0)}ms, p95=${stats.queries.p95.toFixed(0)}ms, max=${stats.queries.max}ms`
        );
    }

    return lines.join('\n');
}

/**
 * Reset all metrics and statistics
 */
function reset() {
    metrics.scans = [];
    metrics.predictions = [];
    metrics.queries = [];
    metrics.ipcCalls = [];
    metrics.operations.clear();

    stats = {
        totalScans: 0,
        totalPredictions: 0,
        totalQueries: 0,
        totalIpcCalls: 0,
        slowScans: 0,
        slowPredictions: 0,
        slowQueries: 0,
        slowIpcCalls: 0
    };

    logger.info('Performance metrics reset');
}

/**
 * Start periodic metrics reporting
 * @param {number} interval - Reporting interval in milliseconds
 */
function startPeriodicReporting(interval = METRICS_COLLECTION_INTERVAL) {
    if (collectionInterval) {
        logger.warn('Periodic reporting already running');
        return;
    }

    logger.info('Starting periodic performance reporting', { interval });

    collectionInterval = setInterval(() => {
        const slowOps = getSlowOperations(null, 5);
        if (slowOps.length > 0) {
            logger.info('Recent slow operations detected', {
                count: slowOps.length,
                operations: slowOps.map((op) => ({
                    type: op.type,
                    id: op.id,
                    duration: op.duration
                }))
            });
        }

        logger.debug(getSummary());
    }, interval);
}

/**
 * Stop periodic metrics reporting
 */
function stopPeriodicReporting() {
    if (collectionInterval) {
        clearInterval(collectionInterval);
        collectionInterval = null;
        logger.info('Periodic performance reporting stopped');
    }
}

/**
 * Enable/disable metric collection
 * @param {boolean} enabled - Whether to collect metrics
 */
function setCollectionEnabled(enabled) {
    isCollecting = enabled;
    logger.info(`Metric collection ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Get collection status
 * @returns {boolean} Whether collection is enabled
 */
function isCollectionEnabled() {
    return isCollecting;
}

module.exports = {
    startTimer,
    stopTimer,
    getStats,
    getMetrics,
    getSlowOperations,
    getSummary,
    reset,
    startPeriodicReporting,
    stopPeriodicReporting,
    setCollectionEnabled,
    isCollectionEnabled
};
