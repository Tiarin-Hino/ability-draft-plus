/**
 * @file Hot reload for development
 * Watches for file changes and automatically reloads the application
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { createLogger } = require('./logger');

const logger = createLogger('HotReload');

/**
 * Hot reload state
 */
let hotReloadState = {
    enabled: false,
    watchers: [],
    watchedPaths: [],
    debounceTimeout: null,
    debounceDelay: 500, // ms
    reloadCount: 0,
    lastReloadTime: null
};

/**
 * Check if hot reload is enabled
 * @returns {boolean} Whether hot reload is enabled
 */
function isEnabled() {
    return hotReloadState.enabled;
}

/**
 * Reload renderer windows
 */
function reloadRenderers() {
    const windows = BrowserWindow.getAllWindows();

    logger.info('Reloading renderer windows', { count: windows.length });

    windows.forEach((window) => {
        if (!window.isDestroyed()) {
            window.webContents.reloadIgnoringCache();
        }
    });
}

/**
 * Restart the main process
 */
function restartMainProcess() {
    logger.info('Restarting main process');

    // Cleanup
    stopWatching();

    // Relaunch the app
    app.relaunch();
    app.exit(0);
}

/**
 * Handle file change
 * @param {string} filePath - Path to changed file
 * @param {string} event - Event type (change, rename)
 */
function handleFileChange(filePath, event) {
    // Debounce rapid changes
    clearTimeout(hotReloadState.debounceTimeout);

    hotReloadState.debounceTimeout = setTimeout(() => {
        const now = Date.now();
        const timeSinceLastReload = hotReloadState.lastReloadTime
            ? now - hotReloadState.lastReloadTime
            : Infinity;

        // Prevent reloading too frequently
        if (timeSinceLastReload < 1000) {
            logger.debug('Skipping reload (too soon after last reload)');
            return;
        }

        hotReloadState.reloadCount++;
        hotReloadState.lastReloadTime = now;

        logger.info(`File changed: ${filePath} (${event})`, {
            reloadCount: hotReloadState.reloadCount
        });

        // Determine if this is a main process file or renderer file
        const isMainProcessFile =
            filePath.includes(path.join('src', 'main')) ||
            filePath.includes('main.js') ||
            filePath.includes(path.join('src', 'database'));

        const isRendererFile =
            filePath.includes('renderer.js') ||
            filePath.includes('overlay-renderer.js') ||
            filePath.includes('preload.js') ||
            filePath.endsWith('.html') ||
            filePath.endsWith('.css');

        if (isMainProcessFile) {
            logger.warn(
                'Main process file changed - full restart required',
                { file: path.basename(filePath) }
            );
            restartMainProcess();
        } else if (isRendererFile) {
            logger.info('Renderer file changed - reloading windows', {
                file: path.basename(filePath)
            });
            reloadRenderers();
        } else {
            logger.info('File changed - reloading renderers as fallback', {
                file: path.basename(filePath)
            });
            reloadRenderers();
        }
    }, hotReloadState.debounceDelay);
}

/**
 * Watch a directory for changes
 * @param {string} dirPath - Directory to watch
 * @param {object} options - Watch options
 * @param {boolean} options.recursive - Watch subdirectories
 * @param {Array<string>} options.exclude - Patterns to exclude
 */
function watchDirectory(dirPath, options = {}) {
    const { recursive = true, exclude = [] } = options;

    try {
        // Check if directory exists
        if (!fs.existsSync(dirPath)) {
            logger.warn(`Directory does not exist: ${dirPath}`);
            return;
        }

        logger.info('Watching directory', { dirPath, recursive });

        const watcher = fs.watch(
            dirPath,
            { recursive },
            (eventType, filename) => {
                if (!filename) return;

                const fullPath = path.join(dirPath, filename);

                // Check exclusions
                const isExcluded = exclude.some((pattern) => {
                    if (pattern instanceof RegExp) {
                        return pattern.test(fullPath);
                    }
                    return fullPath.includes(pattern);
                });

                if (isExcluded) {
                    return;
                }

                // Ignore temporary files and common non-code files
                if (
                    filename.endsWith('~') ||
                    filename.startsWith('.') ||
                    filename.includes('.swp') ||
                    filename.includes('.tmp')
                ) {
                    return;
                }

                handleFileChange(fullPath, eventType);
            }
        );

        hotReloadState.watchers.push(watcher);
        hotReloadState.watchedPaths.push(dirPath);
    } catch (error) {
        logger.error('Failed to watch directory', {
            dirPath,
            error: error.message
        });
    }
}

/**
 * Watch a single file for changes
 * @param {string} filePath - File to watch
 */
function watchFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            logger.warn(`File does not exist: ${filePath}`);
            return;
        }

        logger.info('Watching file', { filePath });

        const watcher = fs.watch(filePath, (eventType) => {
            handleFileChange(filePath, eventType);
        });

        hotReloadState.watchers.push(watcher);
        hotReloadState.watchedPaths.push(filePath);
    } catch (error) {
        logger.error('Failed to watch file', {
            filePath,
            error: error.message
        });
    }
}

/**
 * Stop watching all files
 */
function stopWatching() {
    logger.info('Stopping file watchers', {
        count: hotReloadState.watchers.length
    });

    hotReloadState.watchers.forEach((watcher) => {
        try {
            watcher.close();
        } catch (error) {
            logger.error('Error closing watcher', { error: error.message });
        }
    });

    hotReloadState.watchers = [];
    hotReloadState.watchedPaths = [];
}

/**
 * Enable hot reload
 * @param {object} options - Options
 * @param {number} options.debounceDelay - Debounce delay in ms
 * @param {Array<string>} options.watchPaths - Paths to watch (default: src, main.js, renderer.js)
 * @param {Array<string>} options.exclude - Patterns to exclude
 */
function enable(options = {}) {
    if (hotReloadState.enabled) {
        logger.warn('Hot reload already enabled');
        return;
    }

    const {
        debounceDelay = 500,
        watchPaths = null,
        exclude = ['node_modules', '.git', 'dist', 'logs', 'backups', 'mock-data']
    } = options;

    hotReloadState.debounceDelay = debounceDelay;

    logger.info('Enabling hot reload', { debounceDelay, exclude });

    // Determine paths to watch
    const appPath = app.getAppPath();
    const pathsToWatch = watchPaths || [
        path.join(appPath, 'src'),
        path.join(appPath, 'main.js'),
        path.join(appPath, 'renderer.js'),
        path.join(appPath, 'overlay-renderer.js'),
        path.join(appPath, 'preload.js'),
        path.join(appPath, 'overlay-preload.js'),
        path.join(appPath, 'index.html'),
        path.join(appPath, 'overlay.html'),
        path.join(appPath, 'styles')
    ];

    // Watch each path
    pathsToWatch.forEach((watchPath) => {
        const stats = fs.existsSync(watchPath)
            ? fs.statSync(watchPath)
            : null;

        if (!stats) {
            // Path doesn't exist, skip
            return;
        }

        if (stats.isDirectory()) {
            watchDirectory(watchPath, { recursive: true, exclude });
        } else if (stats.isFile()) {
            watchFile(watchPath);
        }
    });

    hotReloadState.enabled = true;

    logger.info('Hot reload enabled', {
        watchedPaths: hotReloadState.watchedPaths.length
    });
}

/**
 * Disable hot reload
 */
function disable() {
    if (!hotReloadState.enabled) {
        logger.warn('Hot reload not enabled');
        return;
    }

    logger.info('Disabling hot reload');

    stopWatching();
    clearTimeout(hotReloadState.debounceTimeout);

    hotReloadState.enabled = false;
    hotReloadState.reloadCount = 0;
    hotReloadState.lastReloadTime = null;

    logger.info('Hot reload disabled');
}

/**
 * Get hot reload statistics
 * @returns {object} Stats
 */
function getStats() {
    return {
        enabled: hotReloadState.enabled,
        watchedPaths: hotReloadState.watchedPaths.length,
        reloadCount: hotReloadState.reloadCount,
        lastReloadTime: hotReloadState.lastReloadTime,
        debounceDelay: hotReloadState.debounceDelay
    };
}

/**
 * Set debounce delay
 * @param {number} delay - Delay in milliseconds
 */
function setDebounceDelay(delay) {
    hotReloadState.debounceDelay = delay;
    logger.info('Debounce delay updated', { delay });
}

/**
 * Get watched paths
 * @returns {Array<string>} Watched paths
 */
function getWatchedPaths() {
    return [...hotReloadState.watchedPaths];
}

module.exports = {
    isEnabled,
    enable,
    disable,
    getStats,
    setDebounceDelay,
    getWatchedPaths,
    reloadRenderers,
    restartMainProcess
};
