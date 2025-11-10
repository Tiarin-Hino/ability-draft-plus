const { parentPort } = require('worker_threads');
const {
    initializeImageProcessor,
    initializeImageProcessorIfNeeded,
    performInitialScan,
    performSelectedAbilitiesScan
} = require('./imageProcessor');

/**
 * @file ML Worker Thread
 * This script runs in a separate thread to handle computationally intensive
 * machine learning tasks, primarily image processing and model inference,
 * without blocking the main Electron process.
 * It communicates with the main thread via `parentPort`.
 */

/**
 * Flag to track if the ML worker has been initialized with model paths
 * and the underlying image processor has successfully loaded its resources.
 * @type {boolean}
 */
let isWorkerReady = false;

/**
 * Handles messages from the main thread.
 *
 * @param {object} message - The message object from the main thread.
 * @param {string} message.type - The type of task to perform. Expected types:
 *   - 'init': Initializes the image processor.
 *             Requires `payload`: { `modelPath`: string, `classNamesPath`: string }
 *             Responds with `{ status: 'ready' }` on success.
 *   - 'scan': Performs an image scan (initial or rescan).
 *             Requires `payload`: { `screenshotBuffer`: Buffer, `layoutConfig`: object, `targetResolution`: string, `confidenceThreshold`: number, `isInitialScan`: boolean }
 *             Responds with `{ status: 'success', results: object, isInitialScan: boolean }` or `{ status: 'error', error: object }`.
 */
parentPort.on('message', async (message) => {
    try {
        const { type, payload } = message;

        if (type === 'init') {
            try {
                console.log('[ML Worker] Initializing...');
                initializeImageProcessor(payload.modelPath, payload.classNamesPath);
                await initializeImageProcessorIfNeeded();
                isWorkerReady = true;
                parentPort.postMessage({ status: 'ready' });
                console.log('[ML Worker] Initialization complete and ready.');
            } catch (initError) {
                console.error('[ML Worker] Error during ML worker initialization process:', initError);
                isWorkerReady = false; // Ensure this is false on failure
                parentPort.postMessage({
                    status: 'error',
                    type: 'init-error', // Specific type for manager to identify initialization failure
                    error: { message: initError.message, stack: initError.stack }
                });
            }
            return; // Crucial to return after handling 'init' or its failure
        }

        if (!isWorkerReady) {
            throw new Error('ML Worker received a task before it was initialized and ready.');
        }

        if (type === 'scan') {
            let results;

            if (payload.isInitialScan) {
                // On initial scan, perform the single comprehensive pool scan
                results = await performInitialScan(
                    payload.screenshotBuffer,
                    payload.layoutConfig,
                    payload.targetResolution,
                    payload.confidenceThreshold
                );
            } else {
                // On rescan, just scan the selected abilities
                results = await performSelectedAbilitiesScan(
                    payload.screenshotBuffer,
                    payload.layoutConfig,
                    payload.targetResolution,
                    payload.confidenceThreshold
                );
            }

            parentPort.postMessage({
                status: 'success',
                results: results,
                isInitialScan: payload.isInitialScan
            });
        } else {
            console.warn(`[ML Worker] Received unknown message type: '${type}'. Ignoring.`);
            // Optionally, notify the main thread about the unknown message type
            // parentPort.postMessage({
            //     status: 'error',
            //     error: { message: `Unknown message type received: ${type}` }
            // });
        }

    } catch (error) {
        console.error('[ML Worker] Error during task execution:', error);
        parentPort.postMessage({
            status: 'error',
            error: { message: error.message, stack: error.stack } // Send serializable error info
        });
    }
});

// Optional: Handle unhandled rejections or exceptions within the worker for robustness
process.on('unhandledRejection', (reason, promise) => {
    console.error('[ML Worker] Unhandled Rejection at:', promise, 'reason:', reason);
    parentPort.postMessage({
        status: 'error',
        error: { message: `Unhandled Rejection: ${reason instanceof Error ? reason.message : String(reason)}`, stack: reason instanceof Error ? reason.stack : undefined }
    });
});

process.on('uncaughtException', (err, origin) => {
    console.error(`[ML Worker] Uncaught Exception: ${err}`, `Origin: ${origin}`);
    parentPort.postMessage({
        status: 'error',
        error: { message: `Uncaught Exception: ${err.message}`, stack: err.stack }
    });
});

console.log('[ML Worker] Worker script started.');