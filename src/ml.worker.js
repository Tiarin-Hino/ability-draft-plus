// src/ml.worker.js

const { parentPort } = require('worker_threads');
const {
    initializeImageProcessor,
    initializeImageProcessorIfNeeded,
    performInitialScan,
    performSelectedAbilitiesScan
} = require('./imageProcessor');

let isInitialized = false;

parentPort.on('message', async (message) => {
    try {
        const { type, payload } = message;

        if (type === 'init') {
            console.log('[ML Worker] Initializing...');
            initializeImageProcessor(payload.modelPath, payload.classNamesPath);
            await initializeImageProcessorIfNeeded();
            isInitialized = true;
            parentPort.postMessage({ status: 'ready' });
            return;
        }

        if (!isInitialized) throw new Error('Worker received a task before it was initialized.');

        if (type === 'scan') {
            console.log(`[ML Worker] Received scan task. isInitialScan: ${payload.isInitialScan}`);
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
        }

    } catch (error) {
        console.error('[ML Worker] Error during task execution:', error);
        parentPort.postMessage({
            status: 'error',
            error: { message: error.message, stack: error.stack }
        });
    }
});