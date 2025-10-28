/**
 * @file Error recovery suggestions and user-friendly error messages
 * Provides helpful guidance for common errors
 */

const { createLogger } = require('./logger');

const logger = createLogger('ErrorRecovery');

/**
 * Error categories for classification
 */
const ERROR_CATEGORIES = {
    DATABASE: 'database',
    NETWORK: 'network',
    MODEL: 'model',
    SCREENSHOT: 'screenshot',
    WORKER: 'worker',
    FILE_SYSTEM: 'filesystem',
    PERMISSION: 'permission',
    UNKNOWN: 'unknown'
};

/**
 * Error recovery database with user-friendly messages and solutions
 */
const ERROR_RECOVERY_DB = {
    // Database Errors
    'database-locked': {
        category: ERROR_CATEGORIES.DATABASE,
        title: 'Database is Busy',
        message:
            'The database is currently being used by another operation.',
        suggestions: [
            'Wait a few seconds and try again',
            'Close any other instances of the application',
            'Restart the application if the problem persists'
        ],
        severity: 'warning',
        canRetry: true
    },

    'database-corrupt': {
        category: ERROR_CATEGORIES.DATABASE,
        title: 'Database Error',
        message: 'The database file appears to be corrupted.',
        suggestions: [
            'Restore from a recent backup (Settings > Backup & Restore)',
            'Update Windrun data to refresh the database',
            'Reinstall the application as a last resort'
        ],
        severity: 'error',
        canRetry: false
    },

    'database-not-found': {
        category: ERROR_CATEGORIES.DATABASE,
        title: 'Database Missing',
        message: 'The database file could not be found.',
        suggestions: [
            'Restart the application to recreate the database',
            'Restore from backup if available',
            'Reinstall the application'
        ],
        severity: 'error',
        canRetry: false
    },

    // Network Errors
    'network-timeout': {
        category: ERROR_CATEGORIES.NETWORK,
        title: 'Connection Timeout',
        message: 'The request took too long to complete.',
        suggestions: [
            'Check your internet connection',
            'Try again in a few moments',
            'Check if your firewall is blocking the application',
            'The remote server may be experiencing issues'
        ],
        severity: 'warning',
        canRetry: true
    },

    'network-offline': {
        category: ERROR_CATEGORIES.NETWORK,
        title: 'No Internet Connection',
        message: 'Unable to connect to the internet.',
        suggestions: [
            'Check your network connection',
            'Verify Wi-Fi or Ethernet is connected',
            'Restart your router if needed',
            'The application will work in offline mode with cached data'
        ],
        severity: 'warning',
        canRetry: true
    },

    'network-server-error': {
        category: ERROR_CATEGORIES.NETWORK,
        title: 'Server Error',
        message: 'The server encountered an error processing your request.',
        suggestions: [
            'The service may be temporarily unavailable',
            'Try again in a few minutes',
            'Check the application status page',
            'If the problem persists, it will be resolved by the service provider'
        ],
        severity: 'warning',
        canRetry: true
    },

    // ML Model Errors
    'model-not-found': {
        category: ERROR_CATEGORIES.MODEL,
        title: 'ML Model Missing',
        message: 'The ability recognition model files are missing.',
        suggestions: [
            'Verify the application was installed correctly',
            'Reinstall the application to restore model files',
            'Check that model files were not deleted by antivirus',
            'You can continue using manual ability input'
        ],
        severity: 'error',
        canRetry: false
    },

    'model-load-failed': {
        category: ERROR_CATEGORIES.MODEL,
        title: 'Model Load Failed',
        message: 'The ML model could not be loaded.',
        suggestions: [
            'Restart the application',
            'Ensure you have enough available RAM (model needs ~500MB)',
            'Check that TensorFlow files are not corrupted',
            'Manual ability input is available as fallback'
        ],
        severity: 'error',
        canRetry: true
    },

    // Screenshot Errors
    'screenshot-permission': {
        category: ERROR_CATEGORIES.SCREENSHOT,
        title: 'Screenshot Permission Denied',
        message: 'The application does not have permission to capture screenshots.',
        suggestions: [
            'Grant screen recording permission in Windows Settings',
            'Go to Settings > Privacy > Screen Recording',
            'Add this application to allowed apps',
            'Restart the application after granting permission'
        ],
        severity: 'error',
        canRetry: true
    },

    'screenshot-failed': {
        category: ERROR_CATEGORIES.SCREENSHOT,
        title: 'Screenshot Failed',
        message: 'Could not capture the game screen.',
        suggestions: [
            'Ensure Dota 2 is running on your primary monitor',
            'Make sure the game is not minimized',
            'Try activating the overlay again',
            'Check that Dota 2 is in fullscreen or borderless window mode'
        ],
        severity: 'warning',
        canRetry: true
    },

    // Worker Errors
    'worker-crashed': {
        category: ERROR_CATEGORIES.WORKER,
        title: 'Processing Error',
        message: 'The background processor stopped unexpectedly.',
        suggestions: [
            'The application is attempting to restart it automatically',
            'If scanning fails, restart the application',
            'Ensure you have enough available RAM',
            'Check system resources in Task Manager'
        ],
        severity: 'warning',
        canRetry: true
    },

    // File System Errors
    'file-access-denied': {
        category: ERROR_CATEGORIES.FILE_SYSTEM,
        title: 'Access Denied',
        message: 'Cannot access required files.',
        suggestions: [
            'Run the application as administrator',
            'Check file permissions in the installation folder',
            'Ensure files are not locked by antivirus',
            'Verify the installation directory is not read-only'
        ],
        severity: 'error',
        canRetry: true
    },

    'disk-full': {
        category: ERROR_CATEGORIES.FILE_SYSTEM,
        title: 'Disk Full',
        message: 'Not enough disk space to complete the operation.',
        suggestions: [
            'Free up disk space on your system drive',
            'Delete unnecessary files or programs',
            'Empty the Recycle Bin',
            'Consider moving large files to another drive'
        ],
        severity: 'error',
        canRetry: false
    }
};

/**
 * Classify error based on error message/code
 * @param {Error} error - The error to classify
 * @returns {string} Error key for recovery database
 */
function classifyError(error) {
    const message = error.message.toLowerCase();
    const code = error.code?.toLowerCase();

    // Database errors
    if (message.includes('database is locked') || code === 'sqlite_busy') {
        return 'database-locked';
    }
    if (
        message.includes('corrupt') ||
        message.includes('malformed') ||
        code === 'sqlite_corrupt'
    ) {
        return 'database-corrupt';
    }
    if (message.includes('no such file') && message.includes('.db')) {
        return 'database-not-found';
    }

    // Network errors
    if (code === 'etimedout' || code === 'econnaborted') {
        return 'network-timeout';
    }
    if (
        code === 'enotfound' ||
        code === 'econnrefused' ||
        code === 'enetunreach'
    ) {
        return 'network-offline';
    }
    if (message.includes('server error') || message.includes('500')) {
        return 'network-server-error';
    }

    // ML Model errors
    if (message.includes('model') && message.includes('not found')) {
        return 'model-not-found';
    }
    if (
        message.includes('model') &&
        (message.includes('load') || message.includes('failed'))
    ) {
        return 'model-load-failed';
    }

    // Screenshot errors
    if (message.includes('permission') && message.includes('screen')) {
        return 'screenshot-permission';
    }
    if (message.includes('screenshot') || message.includes('capture')) {
        return 'screenshot-failed';
    }

    // Worker errors
    if (message.includes('worker') && message.includes('exit')) {
        return 'worker-crashed';
    }

    // File system errors
    if (
        message.includes('eacces') ||
        message.includes('permission denied') ||
        code === 'eacces'
    ) {
        return 'file-access-denied';
    }
    if (message.includes('enospc') || code === 'enospc') {
        return 'disk-full';
    }

    return null; // Unknown error
}

/**
 * Get error recovery information
 * @param {Error} error - The error that occurred
 * @param {string} context - Optional context about where error occurred
 * @returns {object} Recovery information with user-friendly message and suggestions
 */
function getErrorRecovery(error, context = '') {
    const errorKey = classifyError(error);

    logger.debug('Getting error recovery information', {
        errorKey,
        context,
        errorMessage: error.message
    });

    if (errorKey && ERROR_RECOVERY_DB[errorKey]) {
        const recovery = ERROR_RECOVERY_DB[errorKey];

        logger.info('Error classified and recovery suggestions available', {
            errorKey,
            category: recovery.category,
            canRetry: recovery.canRetry
        });

        return {
            ...recovery,
            originalError: error.message,
            context,
            timestamp: new Date().toISOString()
        };
    }

    // Unknown error - provide generic recovery
    logger.warn('Unknown error type, providing generic recovery', {
        errorMessage: error.message,
        context
    });

    return {
        category: ERROR_CATEGORIES.UNKNOWN,
        title: 'Unexpected Error',
        message: `An unexpected error occurred${context ? ` while ${context}` : ''}.`,
        suggestions: [
            'Restart the application',
            'Check the log files for more details',
            'If the problem persists, please report it',
            `Error: ${error.message}`
        ],
        severity: 'error',
        canRetry: true,
        originalError: error.message,
        context,
        timestamp: new Date().toISOString()
    };
}

/**
 * Format error recovery information for display
 * @param {object} recovery - Recovery information from getErrorRecovery
 * @returns {string} Formatted message for user
 */
function formatErrorMessage(recovery) {
    const lines = [
        `${recovery.title}`,
        '',
        recovery.message,
        '',
        'What to do:',
        ...recovery.suggestions.map((s, i) => `${i + 1}. ${s}`)
    ];

    if (recovery.canRetry) {
        lines.push('', 'You can try the operation again.');
    }

    return lines.join('\n');
}

/**
 * Log error with recovery information
 * @param {Error} error - The error that occurred
 * @param {string} context - Context where error occurred
 */
function logErrorWithRecovery(error, context = '') {
    const recovery = getErrorRecovery(error, context);

    const logLevel = recovery.severity === 'error' ? 'error' : 'warn';

    logger[logLevel]('Error occurred with recovery info', {
        category: recovery.category,
        title: recovery.title,
        context,
        canRetry: recovery.canRetry,
        error: error.message,
        stack: error.stack
    });

    return recovery;
}

/**
 * Get troubleshooting link for error category
 * @param {string} category - Error category
 * @returns {string} URL to troubleshooting documentation
 */
function getTroubleshootingLink(category) {
    const baseUrl = 'https://github.com/Tiarin-Hino/ability-draft-plus/wiki';

    const links = {
        [ERROR_CATEGORIES.DATABASE]: `${baseUrl}/Troubleshooting-Database-Issues`,
        [ERROR_CATEGORIES.NETWORK]: `${baseUrl}/Troubleshooting-Network-Issues`,
        [ERROR_CATEGORIES.MODEL]: `${baseUrl}/Troubleshooting-ML-Model-Issues`,
        [ERROR_CATEGORIES.SCREENSHOT]: `${baseUrl}/Troubleshooting-Screenshot-Issues`,
        [ERROR_CATEGORIES.WORKER]: `${baseUrl}/Troubleshooting-Worker-Issues`,
        [ERROR_CATEGORIES.FILE_SYSTEM]: `${baseUrl}/Troubleshooting-File-Issues`,
        [ERROR_CATEGORIES.PERMISSION]: `${baseUrl}/Troubleshooting-Permission-Issues`
    };

    return links[category] || `${baseUrl}/Troubleshooting`;
}

module.exports = {
    ERROR_CATEGORIES,
    getErrorRecovery,
    formatErrorMessage,
    logErrorWithRecovery,
    getTroubleshootingLink,
    classifyError
};
