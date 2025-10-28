const path = require('path');
const { Worker } = require('worker_threads');
const { BASE_RESOURCES_PATH, MODEL_DIR_NAME, MODEL_FILENAME, CLASS_NAMES_FILENAME } = require('../../config');
const { createLogger } = require('./logger');

const logger = createLogger('MLManager');

/**
 * @module mlManager
 * @description Manages the Machine Learning (ML) worker thread.
 * This module is responsible for initializing, communicating with, and terminating
 * the ML worker, which handles tasks like model inference.
 * Includes automatic restart capability for improved reliability.
 */
let mlWorker = null;
let isManagerReady = false; // Tracks if the worker has signaled it's ready
let initializationPromise = null; // Stores the promise for initialization

// Auto-restart configuration
let workerRestartCount = 0;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_COOLDOWN_MS = 5000; // Wait 5 seconds before restart
let lastRestartTime = 0;

// Store callbacks for restart functionality
let storedCallbacks = {
    onMessage: null,
    onError: null,
    onExit: null,
    mainProcessDirname: null
};

/**
 * Attempts to restart the ML Worker after a failure
 * @param {Error} error - The error that caused the restart need
 * @returns {Promise<boolean>} True if restart succeeded, false if max attempts reached
 */
async function attemptRestart(error) {
    const now = Date.now();

    // Reset restart count if enough time has passed since last restart
    if (now - lastRestartTime > 60000) { // 1 minute cooldown
        workerRestartCount = 0;
    }

    if (workerRestartCount >= MAX_RESTART_ATTEMPTS) {
        logger.error('ML Worker failed permanently after max restart attempts', {
            attempts: workerRestartCount,
            lastError: error.message
        });
        return false;
    }

    workerRestartCount++;
    lastRestartTime = now;

    logger.warn(`Attempting to restart ML Worker (${workerRestartCount}/${MAX_RESTART_ATTEMPTS})`, {
        reason: error.message
    });

    // Wait for cooldown before restarting
    await new Promise((resolve) => setTimeout(resolve, RESTART_COOLDOWN_MS));

    try {
        // Terminate existing worker if any
        if (mlWorker) {
            await terminate();
        }

        // Reinitialize with stored callbacks
        await initialize(
            storedCallbacks.onMessage,
            storedCallbacks.onError,
            storedCallbacks.onExit,
            storedCallbacks.mainProcessDirname
        );

        logger.info('ML Worker restarted successfully', { attempt: workerRestartCount });
        return true;
    } catch (restartError) {
        logger.error('Failed to restart ML Worker', {
            attempt: workerRestartCount,
            error: restartError.message
        });
        return false;
    }
}

/**
 * Initializes the ML Worker.
 * @param {function} onMessageCallback - Function to call when the worker sends a message (e.g., {status: 'success', results: ..., isInitialScan: ...} or {status: 'error', error: ...}).
 * @param {function} onErrorCallback - Function to call on unhandled worker errors.
 * @param {function} onExitCallback - Function to call when worker exits.
 * @param {string} mainProcessDirname - The __dirname from the main Electron process (main.js) for correct pathing to the worker script.
 * @returns {Promise<void>} A promise that resolves when the worker is ready, or rejects on initialization error.
 */
function initialize(onMessageCallback, onErrorCallback, onExitCallback, mainProcessDirname) {
    // Store callbacks for potential restart
    storedCallbacks = {
        onMessage: onMessageCallback,
        onError: onErrorCallback,
        onExit: onExitCallback,
        mainProcessDirname: mainProcessDirname
    };

    if (mlWorker) {
        logger.warn('Worker already initialized. Returning existing initialization promise');
        return initializationPromise || Promise.resolve(); // Return existing or resolved promise
    }
    isManagerReady = false; // Reset ready state for new initialization

    // The worker script is expected to be in 'src/ml.worker.js' relative to the project root.
    const workerPath = path.join(mainProcessDirname, 'src', 'ml.worker.js');

    initializationPromise = new Promise((resolve, reject) => {
        try {
            mlWorker = new Worker(workerPath);
        } catch (error) {
            logger.error('Failed to create ML Worker', { path: workerPath, error: error.message });
            if (typeof onErrorCallback === 'function') {
                onErrorCallback(error); // Notify via original callback
            }
            reject(error); // Reject the promise
            return;
        }

        const handleInitialMessage = (message) => {
            if (message && message.status === 'ready') {
                logger.info('ML Worker signaled ready');
                isManagerReady = true;
                mlWorker.off('message', handleInitialMessage); // Stop listening for init message
                mlWorker.off('error', handleInitialError);   // Stop listening for init error
                mlWorker.on('message', onMessageCallback); // Attach the regular message handler
                resolve();
            } else if (message && message.status === 'error' && message.type === 'init-error') {
                logger.error('ML Worker signaled initialization error', { error: message.error });
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
            logger.error('ML Worker error during initialization phase', { error: err.message });
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
                logger.error('ML Worker exited during initialization', { exitCode: code });
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
        logger.debug('ML Worker instance created and init message sent. Waiting for ready signal');
    });
    return initializationPromise;
}

/**
 * Posts a message to the ML Worker.
 * @param {object} message - The message object to send.
 */
function postMessage(message) {
    if (!isManagerReady) {
        logger.error('Worker not ready. Cannot send message', { messageType: message?.type });
        // Depending on desired behavior, could throw an error or queue the message.
        // For now, logging and returning to prevent further issues.
        return;
    }
    if (mlWorker && typeof mlWorker.postMessage === 'function') {
        mlWorker.postMessage(message);
    } else {
        logger.error('Worker not initialized or postMessage not available', { messageType: message?.type });
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
        logger.info('Terminating ML Worker');
        try {
            exitCodeToReturn = await mlWorker.terminate();
            logger.info('ML Worker terminated', { exitCode: exitCodeToReturn });
        } catch (error) {
            logger.error('Error terminating ML Worker', { error: error.message });
            // exitCodeToReturn remains null or its previous value
        } finally {
            mlWorker = null;
            isManagerReady = false;
            initializationPromise = null;
        }
    } else {
        logger.debug('Terminate called but worker was not running');
        // Ensure state is reset even if worker was already null
        isManagerReady = false;
        initializationPromise = null;
    }
    return exitCodeToReturn;
}

/**
 * Resets the restart counter (useful after successful operations)
 */
function resetRestartCount() {
    if (workerRestartCount > 0) {
        logger.info('Resetting ML Worker restart counter', { previousCount: workerRestartCount });
    }
    workerRestartCount = 0;
}

/**
 * Gets the current restart attempt count
 * @returns {number} Current restart count
 */
function getRestartCount() {
    return workerRestartCount;
}

module.exports = {
    initialize,
    postMessage,
    terminate,
    attemptRestart,
    resetRestartCount,
    getRestartCount
};