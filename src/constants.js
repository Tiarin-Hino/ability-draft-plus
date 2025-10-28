/**
 * @file Application-wide constants
 * Centralizes all magic numbers and configuration values for easier maintenance
 * and consistency across the codebase
 */

// ========================================
// ML & Model Configuration
// ========================================

/**
 * Minimum confidence threshold for ML predictions
 * Predictions below this threshold are considered unreliable
 * @type {number}
 */
const ML_CONFIDENCE_THRESHOLD = 0.9;

/**
 * Timeout for ML model initialization (in milliseconds)
 * @type {number}
 */
const ML_MODEL_INIT_TIMEOUT = 30000; // 30 seconds

/**
 * Timeout for a single ML prediction (in milliseconds)
 * @type {number}
 */
const ML_PREDICTION_TIMEOUT = 10000; // 10 seconds

/**
 * Maximum restart attempts for ML worker
 * @type {number}
 */
const ML_WORKER_MAX_RESTART_ATTEMPTS = 3;

/**
 * Cooldown period before restarting ML worker (in milliseconds)
 * @type {number}
 */
const ML_WORKER_RESTART_COOLDOWN = 5000; // 5 seconds

/**
 * Time to reset restart counter after stable operation (in milliseconds)
 * @type {number}
 */
const ML_WORKER_RESTART_RESET_TIME = 60000; // 1 minute

// ========================================
// Scan Configuration
// ========================================

/**
 * Maximum time for a complete scan operation (in milliseconds)
 * @type {number}
 */
const SCAN_TIMEOUT = 60000; // 60 seconds

/**
 * Maximum retry attempts for failed scans
 * @type {number}
 */
const SCAN_RETRY_ATTEMPTS = 3;

/**
 * Delay between scan retry attempts (in milliseconds)
 * @type {number}
 */
const SCAN_RETRY_DELAY = 2000; // 2 seconds

// ========================================
// Database Configuration
// ========================================

/**
 * Database connection timeout (in milliseconds)
 * @type {number}
 */
const DB_CONNECTION_TIMEOUT = 5000; // 5 seconds

/**
 * Number of database backups to retain
 * @type {number}
 */
const DB_BACKUP_RETENTION = 3;

/**
 * Maximum retry attempts for database operations
 * @type {number}
 */
const DB_MAX_RETRY_ATTEMPTS = 3;

/**
 * Delay between database retry attempts (in milliseconds)
 * @type {number}
 */
const DB_RETRY_DELAY = 1000; // 1 second

// ========================================
// Network Configuration
// ========================================

/**
 * Network request timeout (in milliseconds)
 * @type {number}
 */
const NETWORK_REQUEST_TIMEOUT = 30000; // 30 seconds

/**
 * Maximum retry attempts for network requests
 * @type {number}
 */
const NETWORK_MAX_RETRY_ATTEMPTS = 3;

/**
 * Base delay for network retry exponential backoff (in milliseconds)
 * Actual delay will be: BASE_DELAY * attempt
 * @type {number}
 */
const NETWORK_RETRY_BASE_DELAY = 2000; // 2 seconds

/**
 * Maximum delay for network retry (in milliseconds)
 * @type {number}
 */
const NETWORK_RETRY_MAX_DELAY = 10000; // 10 seconds

// ========================================
// Cache Configuration
// ========================================

/**
 * Maximum number of cached scan results
 * @type {number}
 */
const CACHE_MAX_SCAN_RESULTS = 10;

/**
 * Time-to-live for cached scan results (in milliseconds)
 * @type {number}
 */
const CACHE_SCAN_RESULT_TTL = 300000; // 5 minutes

/**
 * Maximum number of cached database query results
 * @type {number}
 */
const CACHE_MAX_QUERY_RESULTS = 50;

/**
 * Time-to-live for cached query results (in milliseconds)
 * @type {number}
 */
const CACHE_QUERY_RESULT_TTL = 600000; // 10 minutes

/**
 * Maximum cache age before warning user about stale data (in milliseconds)
 * @type {number}
 */
const CACHE_STALE_WARNING_THRESHOLD = 300000; // 5 minutes

// ========================================
// Logging Configuration
// ========================================

/**
 * Maximum size for each log file (in bytes)
 * @type {number}
 */
const LOG_FILE_MAX_SIZE = 10485760; // 10 MB

/**
 * Maximum number of log files to keep
 * @type {number}
 */
const LOG_FILE_MAX_FILES = 7;

/**
 * Maximum size for error log files (in bytes)
 * @type {number}
 */
const LOG_ERROR_FILE_MAX_SIZE = 5242880; // 5 MB

/**
 * Interval for periodic memory usage logging (in milliseconds)
 * @type {number}
 */
const LOG_MEMORY_INTERVAL = 60000; // 1 minute

// ========================================
// Memory Thresholds
// ========================================

/**
 * Heap memory usage warning threshold (in bytes)
 * @type {number}
 */
const MEMORY_HEAP_WARNING_THRESHOLD = 524288000; // 500 MB

/**
 * Heap memory usage critical threshold (in bytes)
 * @type {number}
 */
const MEMORY_HEAP_CRITICAL_THRESHOLD = 1073741824; // 1 GB

/**
 * External memory usage warning threshold (in bytes)
 * @type {number}
 */
const MEMORY_EXTERNAL_WARNING_THRESHOLD = 209715200; // 200 MB

// ========================================
// Performance Monitoring
// ========================================

/**
 * Interval for performance metrics collection (in milliseconds)
 * @type {number}
 */
const METRICS_COLLECTION_INTERVAL = 60000; // 1 minute

/**
 * Number of performance samples to keep for averaging
 * @type {number}
 */
const METRICS_SAMPLE_SIZE = 100;

/**
 * Warning threshold for slow scan operations (in milliseconds)
 * @type {number}
 */
const METRICS_SLOW_SCAN_THRESHOLD = 30000; // 30 seconds

/**
 * Warning threshold for slow database queries (in milliseconds)
 * @type {number}
 */
const METRICS_SLOW_QUERY_THRESHOLD = 1000; // 1 second

// ========================================
// UI Update Intervals
// ========================================

/**
 * Debounce interval for UI updates (in milliseconds)
 * @type {number}
 */
const UI_UPDATE_DEBOUNCE = 100; // 100 ms

/**
 * Interval for auto-refresh of data displays (in milliseconds)
 * @type {number}
 */
const UI_AUTO_REFRESH_INTERVAL = 60000; // 1 minute

// ========================================
// Screenshot Configuration
// ========================================

/**
 * Maximum retry attempts for screenshot capture
 * @type {number}
 */
const SCREENSHOT_MAX_RETRY_ATTEMPTS = 3;

/**
 * Delay before taking screenshot (allows UI to settle) (in milliseconds)
 * @type {number}
 */
const SCREENSHOT_CAPTURE_DELAY = 100; // 100 ms

/**
 * Maximum screenshot buffer size to keep in memory (in bytes)
 * @type {number}
 */
const SCREENSHOT_MAX_BUFFER_SIZE = 10485760; // 10 MB

// ========================================
// Worker Thread Configuration
// ========================================

/**
 * Timeout for worker thread initialization (in milliseconds)
 * @type {number}
 */
const WORKER_INIT_TIMEOUT = 30000; // 30 seconds

/**
 * Timeout for worker thread message response (in milliseconds)
 * @type {number}
 */
const WORKER_MESSAGE_TIMEOUT = 60000; // 60 seconds

/**
 * Maximum time to wait for worker graceful shutdown (in milliseconds)
 * @type {number}
 */
const WORKER_SHUTDOWN_TIMEOUT = 5000; // 5 seconds

// ========================================
// Application Lifecycle
// ========================================

/**
 * Timeout for application shutdown operations (in milliseconds)
 * @type {number}
 */
const APP_SHUTDOWN_TIMEOUT = 10000; // 10 seconds

/**
 * Delay before quitting app to allow log flushing (in milliseconds)
 * @type {number}
 */
const APP_QUIT_DELAY = 1000; // 1 second

// ========================================
// Validation Limits
// ========================================

/**
 * Minimum screen resolution width (in pixels)
 * @type {number}
 */
const RESOLUTION_MIN_WIDTH = 640;

/**
 * Maximum screen resolution width (in pixels)
 * @type {number}
 */
const RESOLUTION_MAX_WIDTH = 7680;

/**
 * Minimum screen resolution height (in pixels)
 * @type {number}
 */
const RESOLUTION_MIN_HEIGHT = 480;

/**
 * Maximum screen resolution height (in pixels)
 * @type {number}
 */
const RESOLUTION_MAX_HEIGHT = 4320;

// ========================================
// File Size Limits
// ========================================

/**
 * Maximum file size for uploads (in bytes)
 * @type {number}
 */
const FILE_MAX_UPLOAD_SIZE = 10485760; // 10 MB

/**
 * Maximum screenshot file size (in bytes)
 * @type {number}
 */
const FILE_MAX_SCREENSHOT_SIZE = 5242880; // 5 MB

module.exports = {
    // ML & Model
    ML_CONFIDENCE_THRESHOLD,
    ML_MODEL_INIT_TIMEOUT,
    ML_PREDICTION_TIMEOUT,
    ML_WORKER_MAX_RESTART_ATTEMPTS,
    ML_WORKER_RESTART_COOLDOWN,
    ML_WORKER_RESTART_RESET_TIME,

    // Scan
    SCAN_TIMEOUT,
    SCAN_RETRY_ATTEMPTS,
    SCAN_RETRY_DELAY,

    // Database
    DB_CONNECTION_TIMEOUT,
    DB_BACKUP_RETENTION,
    DB_MAX_RETRY_ATTEMPTS,
    DB_RETRY_DELAY,

    // Network
    NETWORK_REQUEST_TIMEOUT,
    NETWORK_MAX_RETRY_ATTEMPTS,
    NETWORK_RETRY_BASE_DELAY,
    NETWORK_RETRY_MAX_DELAY,

    // Cache
    CACHE_MAX_SCAN_RESULTS,
    CACHE_SCAN_RESULT_TTL,
    CACHE_MAX_QUERY_RESULTS,
    CACHE_QUERY_RESULT_TTL,
    CACHE_STALE_WARNING_THRESHOLD,

    // Logging
    LOG_FILE_MAX_SIZE,
    LOG_FILE_MAX_FILES,
    LOG_ERROR_FILE_MAX_SIZE,
    LOG_MEMORY_INTERVAL,

    // Memory
    MEMORY_HEAP_WARNING_THRESHOLD,
    MEMORY_HEAP_CRITICAL_THRESHOLD,
    MEMORY_EXTERNAL_WARNING_THRESHOLD,

    // Performance
    METRICS_COLLECTION_INTERVAL,
    METRICS_SAMPLE_SIZE,
    METRICS_SLOW_SCAN_THRESHOLD,
    METRICS_SLOW_QUERY_THRESHOLD,

    // UI
    UI_UPDATE_DEBOUNCE,
    UI_AUTO_REFRESH_INTERVAL,

    // Screenshot
    SCREENSHOT_MAX_RETRY_ATTEMPTS,
    SCREENSHOT_CAPTURE_DELAY,
    SCREENSHOT_MAX_BUFFER_SIZE,

    // Worker
    WORKER_INIT_TIMEOUT,
    WORKER_MESSAGE_TIMEOUT,
    WORKER_SHUTDOWN_TIMEOUT,

    // Application
    APP_SHUTDOWN_TIMEOUT,
    APP_QUIT_DELAY,

    // Validation
    RESOLUTION_MIN_WIDTH,
    RESOLUTION_MAX_WIDTH,
    RESOLUTION_MIN_HEIGHT,
    RESOLUTION_MAX_HEIGHT,

    // File Sizes
    FILE_MAX_UPLOAD_SIZE,
    FILE_MAX_SCREENSHOT_SIZE
};
