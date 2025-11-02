/**
 * @file ML Performance Metrics
 * Tracks detailed performance metrics for ML operations
 * @module mlPerformanceMetrics
 */

/**
 * Performance metrics storage
 */
const metrics = {
    preprocessing: [],
    inference: [],
    totalScan: [],
    screenshotCapture: [],
    imageComparison: []
};

/** Maximum number of metrics to keep for each category */
const MAX_METRICS_PER_CATEGORY = 100;

/**
 * Records a performance metric
 * @param {string} category - Metric category (preprocessing, inference, etc.)
 * @param {number} duration - Duration in milliseconds
 * @param {object} metadata - Additional metadata
 */
function recordMetric(category, duration, metadata = {}) {
    if (!metrics[category]) {
        metrics[category] = [];
    }

    metrics[category].push({
        timestamp: Date.now(),
        duration,
        ...metadata
    });

    // Keep only the last MAX_METRICS_PER_CATEGORY entries
    if (metrics[category].length > MAX_METRICS_PER_CATEGORY) {
        metrics[category].shift();
    }
}

/**
 * Gets statistics for a metric category
 * @param {string} category - Metric category
 * @returns {object} Statistics object
 */
function getStats(category) {
    const categoryMetrics = metrics[category];

    if (!categoryMetrics || categoryMetrics.length === 0) {
        return null;
    }

    const durations = categoryMetrics.map(m => m.duration);
    const sum = durations.reduce((a, b) => a + b, 0);
    const avg = sum / durations.length;
    const sorted = [...durations].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median = sorted[Math.floor(sorted.length / 2)];

    // Calculate 95th percentile
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95 = sorted[p95Index];

    return {
        count: categoryMetrics.length,
        average: avg,
        median,
        min,
        max,
        p95,
        total: sum
    };
}

/**
 * Gets all statistics
 * @returns {object} All category statistics
 */
function getAllStats() {
    const stats = {};
    for (const category in metrics) {
        stats[category] = getStats(category);
    }
    return stats;
}

/**
 * Prints a performance report
 */
function printReport() {
    console.log('\n=== ML Performance Report ===');

    const categories = [
        { key: 'screenshotCapture', label: 'Screenshot Capture' },
        { key: 'preprocessing', label: 'Image Preprocessing' },
        { key: 'inference', label: 'Model Inference' },
        { key: 'imageComparison', label: 'Image Comparison (Smart Scan)' },
        { key: 'totalScan', label: 'Total Scan Time' }
    ];

    categories.forEach(({ key, label }) => {
        const stats = getStats(key);
        if (stats) {
            console.log(`\n${label}:`);
            console.log(`  Count: ${stats.count}`);
            console.log(`  Average: ${stats.average.toFixed(2)}ms`);
            console.log(`  Median: ${stats.median.toFixed(2)}ms`);
            console.log(`  Min: ${stats.min.toFixed(2)}ms`);
            console.log(`  Max: ${stats.max.toFixed(2)}ms`);
            console.log(`  95th percentile: ${stats.p95.toFixed(2)}ms`);
        }
    });

    // Calculate potential speedup from smart scanning
    const totalStats = getStats('totalScan');
    const comparisonStats = getStats('imageComparison');

    if (totalStats && comparisonStats && comparisonStats.count > 0) {
        console.log('\n=== Smart Scanning Impact ===');
        const avgScan = totalStats.average;
        const avgComparison = comparisonStats.average;
        const speedup = ((avgScan - avgComparison) / avgScan * 100);

        if (speedup > 0) {
            console.log(`  Average speedup: ${speedup.toFixed(1)}%`);
            console.log(`  Time saved per scan: ${(avgScan - avgComparison).toFixed(2)}ms`);
        }
    }

    console.log('\n=============================\n');
}

/**
 * Resets all metrics
 */
function reset() {
    for (const category in metrics) {
        metrics[category] = [];
    }
    console.log('[MLPerformanceMetrics] All metrics reset');
}

/**
 * Creates a timer for measuring operation duration
 * @param {string} category - Metric category
 * @returns {object} Timer object with end() method
 */
function startTimer(category) {
    const startTime = performance.now();

    return {
        end: (metadata = {}) => {
            const duration = performance.now() - startTime;
            recordMetric(category, duration, metadata);
            return duration;
        }
    };
}

module.exports = {
    recordMetric,
    getStats,
    getAllStats,
    printReport,
    reset,
    startTimer
};
