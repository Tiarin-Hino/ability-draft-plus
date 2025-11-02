const sharp = require('sharp');

/**
 * @file Smart Scanning Module
 * Implements differential scanning to detect changed regions and optimize subsequent scans
 * @module smartScanning
 */

/**
 * Cached screenshot data for comparison
 */
let previousScreenshotBuffer = null;
let previousScreenshotMetadata = null;

/**
 * Compares two image regions to determine if they have changed
 * @param {Buffer} currentBuffer - Current screenshot buffer
 * @param {Buffer} previousBuffer - Previous screenshot buffer
 * @param {number} threshold - Pixel difference threshold (0-255)
 * @returns {Promise<boolean>} True if regions are different
 */
async function hasRegionChanged(currentBuffer, previousBuffer, threshold = 10) {
    if (!previousBuffer) return true;

    try {
        // Get image metadata
        const currentMeta = await sharp(currentBuffer).metadata();
        const previousMeta = await sharp(previousBuffer).metadata();

        // If dimensions differ, regions have changed
        if (currentMeta.width !== previousMeta.width || currentMeta.height !== previousMeta.height) {
            return true;
        }

        // Convert both images to raw pixel data for comparison
        const currentPixels = await sharp(currentBuffer)
            .raw()
            .toBuffer();

        const previousPixels = await sharp(previousBuffer)
            .raw()
            .toBuffer();

        // Quick check: if buffers are exactly the same, no change
        if (currentPixels.equals(previousPixels)) {
            return false;
        }

        // Sample-based comparison for performance (check every 10th pixel)
        // This provides ~10x speedup with minimal accuracy loss
        let diffPixels = 0;
        const sampleRate = 10;
        const totalSamples = Math.floor(currentPixels.length / (sampleRate * 3)); // 3 bytes per pixel (RGB)

        for (let i = 0; i < currentPixels.length; i += sampleRate * 3) {
            const rDiff = Math.abs(currentPixels[i] - previousPixels[i]);
            const gDiff = Math.abs(currentPixels[i + 1] - previousPixels[i + 1]);
            const bDiff = Math.abs(currentPixels[i + 2] - previousPixels[i + 2]);

            // Calculate average difference across RGB channels
            const avgDiff = (rDiff + gDiff + bDiff) / 3;

            if (avgDiff > threshold) {
                diffPixels++;
            }
        }

        // If more than 5% of sampled pixels differ, consider region changed
        const diffPercentage = (diffPixels / totalSamples) * 100;
        return diffPercentage > 5;

    } catch (error) {
        console.error('[SmartScanning] Error comparing regions:', error.message);
        // On error, assume region has changed to be safe
        return true;
    }
}

/**
 * Detects which slots have changed compared to the previous screenshot
 * @param {Buffer} currentScreenBuffer - Current full screenshot
 * @param {Array<object>} slotDataArray - Array of slot coordinates
 * @param {number} threshold - Pixel difference threshold
 * @returns {Promise<Array<object>>} Array of changed slots
 */
async function detectChangedSlots(currentScreenBuffer, slotDataArray, threshold = 10) {
    if (!previousScreenshotBuffer || !currentScreenBuffer) {
        // No previous screenshot, all slots are considered changed
        console.log('[SmartScanning] No previous screenshot, scanning all slots');
        cachePreviousScreenshot(currentScreenBuffer);
        return slotDataArray;
    }

    console.log(`[SmartScanning] Checking ${slotDataArray.length} slots for changes`);
    const changedSlots = [];
    const unchangedCount = { count: 0 };

    // Check each slot for changes
    const changePromises = slotDataArray.map(async (slot) => {
        try {
            // Extract region from current screenshot
            const currentRegion = await sharp(currentScreenBuffer)
                .extract({ left: slot.x, top: slot.y, width: slot.width, height: slot.height })
                .png()
                .toBuffer();

            // Extract same region from previous screenshot
            const previousRegion = await sharp(previousScreenshotBuffer)
                .extract({ left: slot.x, top: slot.y, width: slot.width, height: slot.height })
                .png()
                .toBuffer();

            // Check if region has changed
            const changed = await hasRegionChanged(currentRegion, previousRegion, threshold);

            if (changed) {
                return slot;
            } else {
                unchangedCount.count++;
                return null;
            }
        } catch (error) {
            console.error(`[SmartScanning] Error checking slot change:`, error.message);
            // On error, include slot to be safe
            return slot;
        }
    });

    const results = await Promise.all(changePromises);
    changedSlots.push(...results.filter(slot => slot !== null));

    console.log(`[SmartScanning] Found ${changedSlots.length} changed slots, ${unchangedCount.count} unchanged`);

    // Update cached screenshot
    cachePreviousScreenshot(currentScreenBuffer);

    return changedSlots;
}

/**
 * Caches the current screenshot for future comparison
 * @param {Buffer} screenshotBuffer - Screenshot buffer to cache
 */
function cachePreviousScreenshot(screenshotBuffer) {
    if (screenshotBuffer) {
        previousScreenshotBuffer = Buffer.from(screenshotBuffer);
        previousScreenshotMetadata = { timestamp: Date.now() };
    }
}

/**
 * Clears the cached screenshot (useful when starting a new draft session)
 */
function clearScreenshotCache() {
    previousScreenshotBuffer = null;
    previousScreenshotMetadata = null;
    console.log('[SmartScanning] Screenshot cache cleared');
}

/**
 * Gets information about the cached screenshot
 * @returns {object|null} Cache metadata or null if no cache
 */
function getCacheInfo() {
    if (!previousScreenshotBuffer) {
        return null;
    }
    return {
        hasCachedScreenshot: true,
        ...previousScreenshotMetadata
    };
}

module.exports = {
    detectChangedSlots,
    hasRegionChanged,
    cachePreviousScreenshot,
    clearScreenshotCache,
    getCacheInfo
};
