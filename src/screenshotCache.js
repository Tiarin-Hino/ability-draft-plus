const screenshot = require('screenshot-desktop');

/**
 * @file Screenshot Cache Manager
 * Implements screenshot prefetching and caching to reduce scan initiation time
 * @module screenshotCache
 */

/**
 * Screenshot cache storage
 */
let cachedScreenshot = null;
let cacheTimestamp = null;
let prefetchTimer = null;

/** Cache configuration */
const CACHE_TTL_MS = 2000; // Cache valid for 2 seconds
const PREFETCH_INTERVAL_MS = 1500; // Prefetch every 1.5 seconds when active

/**
 * Captures a screenshot and stores it in cache
 * @returns {Promise<Buffer>} Screenshot buffer
 */
async function captureAndCache() {
    try {
        const screenshotBuffer = await screenshot({ format: 'png' });
        cachedScreenshot = screenshotBuffer;
        cacheTimestamp = Date.now();
        return screenshotBuffer;
    } catch (error) {
        console.error('[ScreenshotCache] Error capturing screenshot:', error.message);
        throw error;
    }
}

/**
 * Gets a screenshot, using cache if valid or capturing a new one
 * @param {boolean} forceCapture - Force a new capture even if cache is valid
 * @returns {Promise<Buffer>} Screenshot buffer
 */
async function getScreenshot(forceCapture = false) {
    const now = Date.now();

    // Check if cached screenshot is still valid
    if (!forceCapture && cachedScreenshot && cacheTimestamp) {
        const cacheAge = now - cacheTimestamp;
        if (cacheAge < CACHE_TTL_MS) {
            console.log(`[ScreenshotCache] Using cached screenshot (age: ${cacheAge}ms)`);
            return cachedScreenshot;
        }
    }

    // Cache is invalid or force capture requested, get new screenshot
    console.log('[ScreenshotCache] Capturing new screenshot');
    return await captureAndCache();
}

/**
 * Starts prefetching screenshots in the background
 * This keeps the cache warm for faster scan initiation
 */
function startPrefetch() {
    if (prefetchTimer) {
        console.log('[ScreenshotCache] Prefetch already active');
        return;
    }

    console.log('[ScreenshotCache] Starting screenshot prefetch');

    // Capture initial screenshot
    captureAndCache().catch(err => {
        console.error('[ScreenshotCache] Initial prefetch failed:', err.message);
    });

    // Set up periodic prefetching
    prefetchTimer = setInterval(async () => {
        try {
            await captureAndCache();
            console.log('[ScreenshotCache] Prefetched screenshot');
        } catch (error) {
            console.error('[ScreenshotCache] Prefetch failed:', error.message);
        }
    }, PREFETCH_INTERVAL_MS);
}

/**
 * Stops prefetching screenshots
 */
function stopPrefetch() {
    if (prefetchTimer) {
        clearInterval(prefetchTimer);
        prefetchTimer = null;
        console.log('[ScreenshotCache] Stopped screenshot prefetch');
    }
}

/**
 * Clears the screenshot cache
 */
function clearCache() {
    cachedScreenshot = null;
    cacheTimestamp = null;
    console.log('[ScreenshotCache] Cache cleared');
}

/**
 * Gets cache statistics
 * @returns {object} Cache statistics
 */
function getCacheStats() {
    const now = Date.now();
    return {
        hasCachedScreenshot: cachedScreenshot !== null,
        cacheAge: cacheTimestamp ? now - cacheTimestamp : null,
        isValid: cacheTimestamp ? (now - cacheTimestamp) < CACHE_TTL_MS : false,
        prefetchActive: prefetchTimer !== null
    };
}

module.exports = {
    getScreenshot,
    captureAndCache,
    startPrefetch,
    stopPrefetch,
    clearCache,
    getCacheStats
};
