/**
 * @file Structured logging system for ability-draft-plus
 * Provides centralized logging with file rotation, log levels, and contextual information
 */

const winston = require('winston');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

/**
 * Custom format for console output (development)
 */
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
        const moduleStr = module ? `[${module}]` : '';
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
        return `${timestamp} ${level} ${moduleStr} ${message} ${metaStr}`;
    })
);

/**
 * Custom format for file output (production)
 */
const fileFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

/**
 * Get the log directory path
 * Creates the directory if it doesn't exist
 */
function getLogDirectory() {
    const logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    return logDir;
}

/**
 * Determine log level based on environment and packaged status
 */
function getLogLevel() {
    if (process.env.DEBUG === 'true') {
        return 'debug';
    }
    if (!app.isPackaged) {
        return 'debug'; // Development: show everything
    }
    return 'info'; // Production: info and above
}

/**
 * Create the Winston logger instance
 */
const logger = winston.createLogger({
    level: getLogLevel(),
    format: fileFormat,
    defaultMeta: { process: 'main' },
    transports: [
        // Error log file: errors only
        new winston.transports.File({
            filename: path.join(getLogDirectory(), 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true
        }),

        // Combined log file: all logs
        new winston.transports.File({
            filename: path.join(getLogDirectory(), 'combined.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 7, // Keep last 7 files (roughly 7 days)
            tailable: true
        })
    ],
    // Handle exceptions and rejections
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(getLogDirectory(), 'exceptions.log'),
            maxsize: 5242880,
            maxFiles: 3
        })
    ],
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(getLogDirectory(), 'rejections.log'),
            maxsize: 5242880,
            maxFiles: 3
        })
    ]
});

// Add console transport in development or when DEBUG is enabled
if (!app.isPackaged || process.env.DEBUG === 'true') {
    logger.add(
        new winston.transports.Console({
            format: consoleFormat
        })
    );
}

/**
 * Create a child logger with module context
 * @param {string} moduleName - Name of the module using this logger
 * @returns {winston.Logger} Child logger with module context
 *
 * @example
 * const logger = createLogger('DatabaseQueries');
 * logger.info('Query executed successfully');
 */
function createLogger(moduleName) {
    return logger.child({ module: moduleName });
}

/**
 * Log application startup information
 */
function logStartup() {
    logger.info('Application starting', {
        version: app.getVersion(),
        isPackaged: app.isPackaged,
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        logLevel: getLogLevel(),
        logsDir: getLogDirectory()
    });
}

/**
 * Log application shutdown information
 */
function logShutdown(reason = 'normal') {
    logger.info('Application shutting down', { reason });
}

/**
 * Flush all log transports (useful before app quit)
 */
async function flushLogs() {
    return new Promise((resolve) => {
        logger.on('finish', resolve);
        logger.end();
    });
}

// Log any winston errors
logger.on('error', (error) => {
    console.error('Logger error:', error);
});

module.exports = {
    logger,
    createLogger,
    logStartup,
    logShutdown,
    flushLogs,
    getLogDirectory
};
