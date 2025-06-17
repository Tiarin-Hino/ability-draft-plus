const path = require('path');
const { Worker } = require('worker_threads');
const { BASE_RESOURCES_PATH, MODEL_DIR_NAME, MODEL_FILENAME, CLASS_NAMES_FILENAME } = require('../../config');

/**
 * @module mlManager
 * @description Manages the Machine Learning (ML) worker thread.
 * This module is responsible for initializing, communicating with, and terminating
 * the ML worker, which handles tasks like model inference.
 */
let mlWorker = null;
let isManagerReady = false; // Tracks if the worker has signaled it's ready
let initializationPromise = null; // Stores the promise for initialization

/**
 * Initializes the ML Worker.
 * @param {function} onMessageCallback - Function to call when the worker sends a message (e.g., {status: 'success', results: ..., isInitialScan: ...} or {status: 'error', error: ...}).
 * @param {function} onErrorCallback - Function to call on unhandled worker errors.
 * @param {function} onExitCallback - Function to call when worker exits.
 * @param {string} mainProcessDirname - The __dirname from the main Electron process (main.js) for correct pathing to the worker script.
 * @returns {Promise<void>} A promise that resolves when the worker is ready, or rejects on initialization error.
 */
function initialize(onMessageCallback, onErrorCallback, onExitCallback, mainProcessDirname) {
    if (mlWorker) {
        console.warn('[MLManager] Worker already initialized. Returning existing initialization promise.');
        return initializationPromise || Promise.resolve(); // Return existing or resolved promise
    }
    isManagerReady = false; // Reset ready state for new initialization

    // The worker script is expected to be in 'src/ml.worker.js' relative to the project root.
    const workerPath = path.join(mainProcessDirname, 'src', 'ml.worker.js');

    initializationPromise = new Promise((resolve, reject) => {
        try {
            mlWorker = new Worker(workerPath);
        } catch (error) {
            console.error(`[MLManager] Failed to create ML Worker at ${workerPath}:`, error);
            if (typeof onErrorCallback === 'function') {
                onErrorCallback(error); // Notify via original callback
            }
            reject(error); // Reject the promise
            return;
        }

        const handleInitialMessage = (message) => {
            if (message && message.status === 'ready') {
                console.log('[MLManager] ML Worker signaled ready.');
                isManagerReady = true;
                mlWorker.off('message', handleInitialMessage); // Stop listening for init message
                mlWorker.off('error', handleInitialError);   // Stop listening for init error
                mlWorker.on('message', onMessageCallback); // Attach the regular message handler
                resolve();
            } else if (message && message.status === 'error' && message.type === 'init-error') {
                console.error('[MLManager] ML Worker signaled initialization error:', message.error);
                isManagerReady = false;
                if (typeof onErrorCallback === 'function') {
                    onErrorCallback(message.error);
                }
                mlWorker.off('message', handleInitialMessage);
                mlWorker.off('error', handleInitialError);
                reject(new Error(message.error.message || 'ML Worker initialization failed'));
            } else {
                // Pass other messages to the main handler if they arrive before 'ready'
                // This path should ideally not be hit if main.js awaits initialization.
                onMessageCallback(message);
            }
        };

        const handleInitialError = (err) => {
            console.error('[MLManager] ML Worker error during initialization phase:', err);
            isManagerReady = false;
            if (typeof onErrorCallback === 'function') {
                onErrorCallback(err);
            }
            mlWorker.off('message', handleInitialMessage);
            mlWorker.off('error', handleInitialError);
            reject(err);
        };

        mlWorker.on('message', handleInitialMessage);
        mlWorker.on('error', handleInitialError);
        mlWorker.on('exit', (code) => {
            onExitCallback(code); // Call original exit callback
            if (!isManagerReady) { // If exited before becoming ready
                const exitError = new Error(`ML Worker exited with code ${code} during initialization.`);
                console.error(`[MLManager] ${exitError.message}`);
                isManagerReady = false;
                reject(exitError);
            }
        });

        // Send the initialization message to the worker
        const modelBasePath = path.join(BASE_RESOURCES_PATH, 'model', MODEL_DIR_NAME);
        const modelJsonPath = path.join(modelBasePath, MODEL_FILENAME);
        const modelFileUrl = 'file://' + modelJsonPath.replace(/\\/g, '/');
        const classNamesJsonPath = path.join(modelBasePath, CLASS_NAMES_FILENAME);

        mlWorker.postMessage({
            type: 'init',
            payload: { modelPath: modelFileUrl, classNamesPath: classNamesJsonPath }
        });
        console.log('[MLManager] ML Worker instance created and init message sent. Waiting for ready signal...');
    });
    return initializationPromise;
}

/**
 * Posts a message to the ML Worker.
 * @param {object} message - The message object to send.
 */
function postMessage(message) {
    if (!isManagerReady) {
        console.error('[MLManager] Worker not ready. Cannot send message:', message);
        // Depending on desired behavior, could throw an error or queue the message.
        // For now, logging and returning to prevent further issues.
        return;
    }
    if (mlWorker && typeof mlWorker.postMessage === 'function') {
        mlWorker.postMessage(message);
    } else {
        console.error('[MLManager] Worker not initialized or postMessage not available. Cannot send message:', message);
    }
}

/**
 * Terminates the ML Worker if it's running.
 * @returns {Promise<number | null>} Exit code of the worker, or null if not running.
 * Note: The exit code might not always be available or relevant depending on how termination occurs.
 */
async function terminate() {
    let exitCodeToReturn = null;
    if (mlWorker) {
        console.log('[MLManager] Terminating ML Worker.');
        try {
            exitCodeToReturn = await mlWorker.terminate();
            console.log(`[MLManager] ML Worker terminated with exit code: ${exitCodeToReturn}.`);
        } catch (error) {
            console.error('[MLManager] Error terminating ML Worker:', error);
            // exitCodeToReturn remains null or its previous value
        } finally {
            mlWorker = null;
            isManagerReady = false;
            initializationPromise = null;
        }
    } else {
        console.log('[MLManager] Terminate called but worker was not running.');
        // Ensure state is reset even if worker was already null
        isManagerReady = false;
        initializationPromise = null;
    }
    return exitCodeToReturn;
}

module.exports = {
    initialize,
    postMessage,
    terminate,
};