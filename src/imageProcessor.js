const fs = require('fs').promises;
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const tf = require('@tensorflow/tfjs-node');
const mlPerformanceMetrics = require('./mlPerformanceMetrics');
const smartScanning = require('./smartScanning');
const screenshotCache = require('./screenshotCache');

/**
 * @file Manages image processing tasks, including loading a TensorFlow.js model,
 * capturing screenshots, and identifying abilities in screen regions using the model.
 * This module is primarily designed to be used within a worker thread for ML inferences
 * to avoid blocking the main application process.
 * @module imageProcessor
 */

// --- Constants ---
/** Image dimensions the model was trained on. */
const IMG_HEIGHT = 96;
const IMG_WIDTH = 96;

/** TensorFlow.js backend type */
let tfBackend = 'tensorflow'; // Default to tfjs-node backend

/** Performance tracking flag - set to true to enable detailed metrics */
const ENABLE_PERFORMANCE_TRACKING = process.env.TRACK_ML_PERFORMANCE === 'true' || false;

/**
 * Conditionally starts a performance timer
 * @param {string} category - Metric category
 * @returns {object} Timer object with end() method
 */
function conditionalStartTimer(category) {
    if (ENABLE_PERFORMANCE_TRACKING) {
        return mlPerformanceMetrics.startTimer(category);
    }
    // Return a no-op timer that returns elapsed time without tracking
    const start = performance.now();
    return {
        end: () => performance.now() - start
    };
}

// --- Module State ---
/** Absolute path to the TensorFlow.js Graph Model JSON file. Set during initialization. */
let absoluteModelPath;
/** Absolute path to the class names JSON file. Set during initialization. */
let absoluteClassNamesPath;

/** Array of class names (ability internal names) loaded from the JSON file. */
let classNamesCache = [];
/** Promise for loading class names, ensures it's done only once. */
let classNamesPromise;
/** Promise for loading the TFJS model, ensures it's done only once. */
let modelPromise;
/**
 * Flag to indicate if {@link initializeImageProcessor} has been called at least once
 * to set up the model and class name loading promises.
 */
let initialized = false;
/**
 * Flag to indicate if the promises for loading the model and class names have successfully resolved,
 * meaning the image processor is fully ready for inference tasks.
 */
let imageProcessorFullyInitialized = false;

/**
 * @typedef {object} SlotCoordinate
 * @property {number} x - The x-coordinate of the top-left corner of the slot.
 * @property {number} y - The y-coordinate of the top-left corner of the slot.
 * @property {number} width - The width of the slot.
 * @property {number} height - The height of the slot.
 */

/**
 * Initializes the image processor by loading the TFJS model and class names.
 * This function should be called once before any image processing is attempted.
 *
 * @param {string} modelPath - The file path URL (e.g., 'file:///path/to/model.json') for the TFJS graph model.
 * @param {string} classNamesPath - The file path for the JSON file containing class names.
 * @throws {Error} If model or class names fail to load, or if already initialized.
 */
function initializeImageProcessor(modelPath, classNamesPath) {
    if (initialized) {
        console.warn("[ImageProcessor] Image processor is already initialized.");
        return;
    }
    absoluteModelPath = modelPath;
    absoluteClassNamesPath = classNamesPath;

    console.log(`[ImageProcessor] Initializing with Model: ${absoluteModelPath}, Classes: ${absoluteClassNamesPath}`);

    classNamesPromise = fs.readFile(absoluteClassNamesPath, 'utf8')
        .then(data => {
            classNamesCache = JSON.parse(data);
            if (!classNamesCache || classNamesCache.length === 0) {
                throw new Error('Class names array is empty or invalid after parsing.');
            }
            console.log(`[ImageProcessor] Loaded ${classNamesCache.length} class names from ${absoluteClassNamesPath}`);
            return classNamesCache;
        })
        .catch(err => {
            console.error(`[ImageProcessor] FATAL: Error loading or parsing class names from ${absoluteClassNamesPath}: ${err.message}`);
            classNamesCache = []; // Ensure it's an empty array on failure
            throw err; // Re-throw to prevent application from proceeding in an invalid state
        });

    modelPromise = tf.loadGraphModel(absoluteModelPath)
        .then(model => {
            console.log('[ImageProcessor] TFJS Graph Model loaded successfully.');
            tfBackend = tf.getBackend();
            console.log(`[ImageProcessor] Using TensorFlow.js backend: ${tfBackend}`);

            // Warm up the model with a dummy input to potentially speed up the first real prediction.
            try {
                const warmupStart = performance.now();
                const dummyInput = tf.zeros([1, IMG_HEIGHT, IMG_WIDTH, 3]); // Batch size 1
                const warmupResult = model.predict(dummyInput);
                tf.dispose([dummyInput, warmupResult]); // Dispose tensors to free memory
                const warmupTime = performance.now() - warmupStart;
                console.log(`[ImageProcessor] Model warmed up successfully in ${warmupTime.toFixed(2)}ms`);
            } catch (warmupErr) {
                console.error('[ImageProcessor] Error during model warmup:', warmupErr);
                // Non-fatal, but log it.
            }
            return model;
        })
        .catch(err => {
            console.error(`[ImageProcessor] FATAL: Error loading TFJS model from ${absoluteModelPath}: ${err.message}`);
            throw err; // Re-throw for critical failure
        });

    initialized = true;
}

/**
 * Ensures that the model and class names promises have resolved.
 * Should be called before operations that directly use the model or class names
 * if there's a possibility they haven't been awaited yet.
 * Throws an error if {@link initializeImageProcessor} was not called first.
 * @async
 * @throws {Error} If core promises for model and class names are not available.
 */
async function initializeImageProcessorIfNeeded() {
    if (imageProcessorFullyInitialized) {
        return; // Already fully initialized and ready
    }

    // Check if initializeImageProcessor was called and set up the promises
    if (!imageProcessorFullyInitialized) {
        if (!modelPromise || !classNamesPromise) {
            console.error("[ImageProcessor] Critical: initializeImageProcessorIfNeeded called before promises were set up by initializeImageProcessor.");
            throw new Error("Image processor core promises not available. Ensure initializeImageProcessor is called first.");
        }
        await modelPromise;
        await classNamesPromise;
        imageProcessorFullyInitialized = true; // Mark as ready for direct calls
        console.log("[ImageProcessor] Image processor is now fully initialized and ready for operations.");
    }
}

/**
 * @typedef {object} SlotData
 * @property {number} x - The x-coordinate of the slot.
 * @property {number} y - The y-coordinate of the slot.
 * @property {number} width - The width of the slot.
 * @property {number} height - The height of the slot.
 * @property {number} hero_order - The hero order index associated with the slot.
 * @property {number} ability_order - The ability order index associated with the slot.
 * @property {boolean} is_ultimate - Whether the slot is for an ultimate ability.
 */

/**
 * Identifies abilities in specified screen slots using the loaded ML model via batch processing.
 *
 * @param {SlotData[]} slotDataArray - Array of objects, each defining a slot's properties.
 * @param {Buffer} screenBuffer - Buffer containing the PNG image of the screen.
 * @param {Array<string>} currentClassNames - The array of class names (ability internal names) to use for prediction.
 * @param {number} confidenceThreshold - The minimum prediction confidence required to identify an ability.
 * @param {Set<string>} [previouslyPickedNames=new Set()] - A set of ability names already picked, to filter them out.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of identification results,
 * each with name, confidence, and original slot data.
 * @throws {Error} If the image processor is not initialized.
 */
/**
 * @typedef {object} IdentifiedSlotResult
 * @property {string|null} name - The identified ability name, or null if not identified or below threshold.
 * @property {number} confidence - The prediction confidence score.
 * @property {number} hero_order - The hero order index from the input slot data.
 * @property {number} ability_order - The ability order index from the input slot data.
 * @property {boolean} is_ultimate - Whether the slot was for an ultimate ability, from input slot data.
 * @property {SlotCoordinate} coord - The coordinates of the processed slot.
 */
async function identifySlots(slotDataArray, screenBuffer, currentClassNames, confidenceThreshold, previouslyPickedNames = new Set()) {
    const totalTimer = conditionalStartTimer('totalScan');
    // Assumes initializeImageProcessorIfNeeded has been called or promises are awaited by caller context

    const model = await modelPromise;

    const defaultSlotResult = (slot) => ({
        name: null,
        confidence: 0,
        hero_order: slot.hero_order,
        ability_order: slot.ability_order,
        is_ultimate: slot.is_ultimate,
        coord: { x: slot.x, y: slot.y, width: slot.width, height: slot.height }
    });

    if (!model) {
        console.error("[ImageProcessor] Model not available for predictions. Returning empty results for slots.");
        return slotDataArray.map(defaultSlotResult);
    }
    if (!currentClassNames || currentClassNames.length === 0) {
        console.error("[ImageProcessor] Class names are empty or not provided to identifySlots. Returning empty results for slots.");
        return slotDataArray.map(defaultSlotResult);
    }

    if (slotDataArray.length === 0) {
        console.log("[ImageProcessor] No slots to process in identifySlots.");
        return [];
    }

    const croppedBuffers = [];
    const validSlotIndexes = [];

    for (let i = 0; i < slotDataArray.length; i++) {
        const slotData = slotDataArray[i];
        if (typeof slotData.x !== 'number' || typeof slotData.y !== 'number' ||
            typeof slotData.width !== 'number' || typeof slotData.height !== 'number' ||
            slotData.width <= 0 || slotData.height <= 0) {
            console.warn(`[ImageProcessor] Skipping slot ${i} due to invalid/missing coordinate or dimension data:`, slotData);
            continue;
        }

        try {
            const croppedBuffer = await sharp(screenBuffer)
                .extract({ left: slotData.x, top: slotData.y, width: slotData.width, height: slotData.height })
                .png()
                .toBuffer();
            croppedBuffers.push(croppedBuffer);
            validSlotIndexes.push(i);
        } catch (err) {
            console.error(`[ImageProcessor] Error cropping image for slot ${i}: ${err.message}`);
        }
    }

    if (croppedBuffers.length === 0) {
        console.log("[ImageProcessor] No valid images to process after cropping.");
        return slotDataArray.map(defaultSlotResult);
    }

    // Optimize: Use tf.tidy to automatically dispose intermediate tensors
    const preprocessTimer = conditionalStartTimer('preprocessing');
    const batchTensor = tf.tidy(() => {
        const imageTensors = croppedBuffers.map(buffer => {
            const tensor = tf.node.decodeImage(buffer, 3);
            const resizedTensor = tf.image.resizeBilinear(tensor, [IMG_HEIGHT, IMG_WIDTH]);
            return resizedTensor;
        });
        return tf.stack(imageTensors);
    });
    preprocessTimer.end({ slotCount: croppedBuffers.length });

    const inferenceTimer = conditionalStartTimer('inference');
    let predictionTensor;
    try {
        predictionTensor = model.predict(batchTensor);
    } catch (err) {
        console.error(`[ImageProcessor] Error during batch prediction: ${err.message}`);
        tf.dispose(batchTensor);
        totalTimer.end({ success: false });
        return slotDataArray.map(defaultSlotResult);
    }
    const probabilities = await predictionTensor.array();
    tf.dispose([batchTensor, predictionTensor]);
    inferenceTimer.end({ slotCount: croppedBuffers.length });

    const identifiedResults = Array(slotDataArray.length).fill(null);

    for (let i = 0; i < probabilities.length; i++) {
        const originalSlotIndex = validSlotIndexes[i];
        const slotData = slotDataArray[originalSlotIndex];
        const slotProbabilities = probabilities[i];

        const maxProbability = Math.max(...slotProbabilities);
        const predictedIndex = slotProbabilities.indexOf(maxProbability);
        const predictionConfidence = maxProbability;

        let predictedAbilityName = null;
        if (predictionConfidence >= confidenceThreshold) {
            if (predictedIndex >= 0 && predictedIndex < currentClassNames.length) {
                const tempPredictedName = currentClassNames[predictedIndex];
                if (previouslyPickedNames.has(tempPredictedName)) {
                    predictedAbilityName = null;
                } else {
                    predictedAbilityName = tempPredictedName;
                }
            } else {
                console.warn(`[ImageProcessor] Slot ${originalSlotIndex} (HO:${slotData.hero_order}): Predicted index ${predictedIndex} out of bounds for ${currentClassNames.length} classes. Confidence: ${predictionConfidence.toFixed(2)}.`);
            }
        }

        identifiedResults[originalSlotIndex] = {
            name: predictedAbilityName,
            confidence: predictionConfidence,
            hero_order: slotData.hero_order,
            ability_order: slotData.ability_order,
            is_ultimate: slotData.is_ultimate,
            coord: { x: slotData.x, y: slotData.y, width: slotData.width, height: slotData.height }
        };
    }

    for (let i = 0; i < identifiedResults.length; i++) {
        if (identifiedResults[i] === null) {
            identifiedResults[i] = defaultSlotResult(slotDataArray[i]);
        }
    }

    const totalDuration = totalTimer.end({
        success: true,
        slotCount: slotDataArray.length,
        identifiedCount: identifiedResults.filter(r => r.name !== null).length
    });
    console.log(`[ImageProcessor] identifySlots completed in ${totalDuration.toFixed(2)}ms.`);
    return identifiedResults;
}

/**
 * @typedef {object} CachedAbilityData
 * @property {SlotCoordinate} coord - Coordinates of the ability.
 * @property {string} name - The original identified name of the ability.
 * @property {number} hero_order - Original hero order.
 * @property {number} ability_order - Original ability order.
 * @property {boolean} is_ultimate - Whether it's an ultimate.
 * @property {string} type - Type classification (e.g., 'ultimate', 'standard').
 */

/**
 * Re-identifies abilities from a cached list of slots against a new screen buffer.
 * Only returns abilities that are re-confirmed with sufficient confidence matching their original identification.
 *
 * @param {CachedAbilityData[]} cachedPoolAbilities - Array of cached ability data.
 * @param {Buffer} screenBuffer - Buffer containing the new PNG image of the screen.
 * @param {Array<string>} currentClassNamesArray - The array of class names (ability internal names).
 * @param {number} confidenceThreshold - The minimum prediction confidence required.
 * @returns {Promise<IdentifiedSlotResult[]>} A promise that resolves to an array of re-confirmed abilities,
 * maintaining original structure but with updated confidence.
 */
async function identifySlotsFromCache(cachedPoolAbilities, screenBuffer, currentClassNamesArray, confidenceThreshold) {
    if (!imageProcessorFullyInitialized) {
        console.warn("[ImageProcessor] identifySlotsFromCache: imageProcessor not fully initialized. Attempting to wait for promises.");
        // Ensure promises are available and awaited. initializeImageProcessorIfNeeded handles this.
        try {
            await modelPromise;
            await classNamesPromise;
            console.log("[ImageProcessor] identifySlotsFromCache: Model and class names awaited successfully.");
        } catch (e) {
            console.error("[ImageProcessor] identifySlotsFromCache: Error awaiting model/class names:", e);
            return [];
        }
    }

    const model = await modelPromise;
    if (!model) {
        console.error("[ImageProcessor] identifySlotsFromCache: Model not available for predictions.");
        return [];
    }
    if (!currentClassNamesArray || currentClassNamesArray.length === 0) {
        console.error("[ImageProcessor] identifySlotsFromCache: Class names array is empty or not provided.");
        return [];
    }
    // Check against the module's cache as a sanity check, though currentClassNamesArray is the primary source.
    if (classNamesCache.length === 0) {
        console.warn("[ImageProcessor] identifySlotsFromCache: Internal classNamesCache is empty. This is unexpected if initialized properly.");
    }

    console.log(`[identifySlotsFromCache] Called. Cached abilities: ${cachedPoolAbilities.length}. Confidence Threshold: ${confidenceThreshold}.`);
    const confirmedAbilities = [];

    if (cachedPoolAbilities.length === 0) {
        console.log("[ImageProcessor] No cached abilities to re-process in identifySlotsFromCache.");
        return [];
    }

    const croppedBuffers = [];
    const validCacheIndexes = [];

    let cropStartTime = performance.now();
    for (let i = 0; i < cachedPoolAbilities.length; i++) {
        const cachedSlot = cachedPoolAbilities[i];
        const { coord, name: originalNameFromCache } = cachedSlot;

        if (!coord || typeof coord.x !== 'number' || !originalNameFromCache || coord.width <= 0 || coord.height <= 0) {
            console.warn(`[identifySlotsFromCache] Invalid data for cached slot ${i}. Skipping. OriginalName: ${originalNameFromCache}, Coord: ${JSON.stringify(coord)}`);
            continue;
        }

        try {
            const croppedBuffer = await sharp(screenBuffer)
                .extract({ left: coord.x, top: coord.y, width: coord.width, height: coord.height })
                .png()
                .toBuffer();
            croppedBuffers.push(croppedBuffer);
            validCacheIndexes.push(i);
        } catch (err) {
            console.error(`[identifySlotsFromCache] Error cropping image for cached slot '${originalNameFromCache}': ${err.message}`);
        }
    }
    console.log(`[identifySlotsFromCache] Cropped ${croppedBuffers.length} images in ${performance.now() - cropStartTime}ms.`);

    if (croppedBuffers.length === 0) {
        console.log("[ImageProcessor] No valid cached images to re-process after cropping.");
        return [];
    }

    // Optimize: Use tf.tidy to automatically dispose intermediate tensors
    const preprocessTimer = conditionalStartTimer('preprocessing');
    const batchTensor = tf.tidy(() => {
        const imageTensors = croppedBuffers.map(buffer => {
            const tensor = tf.node.decodeImage(buffer, 3);
            const resizedTensor = tf.image.resizeBilinear(tensor, [IMG_HEIGHT, IMG_WIDTH]);
            return resizedTensor;
        });
        return tf.stack(imageTensors);
    });
    const preprocessDuration = preprocessTimer.end({ slotCount: croppedBuffers.length });
    console.log(`[identifySlotsFromCache] Preprocessed (decode/resize/stack) ${batchTensor.shape[0]} images in ${preprocessDuration.toFixed(2)}ms.`);

    const inferenceTimer = conditionalStartTimer('inference');
    let predictionTensor;
    try {
        predictionTensor = model.predict(batchTensor);
    } catch (err) {
        console.error(`[identifySlotsFromCache] Error during batch prediction from cache: ${err.message}`);
        tf.dispose(batchTensor);
        return [];
    }
    const probabilities = await predictionTensor.array();
    tf.dispose([batchTensor, predictionTensor]);
    const inferenceDuration = inferenceTimer.end({ slotCount: probabilities.length });
    console.log(`[identifySlotsFromCache] Performed batch prediction from cache for ${probabilities.length} images in ${inferenceDuration.toFixed(2)}ms.`);

    for (let i = 0; i < probabilities.length; i++) {
        const originalCacheIndex = validCacheIndexes[i];
        const cachedSlot = cachedPoolAbilities[originalCacheIndex];
        const originalNameFromCache = cachedSlot.name;
        const slotProbabilities = probabilities[i];

        const maxProbability = Math.max(...slotProbabilities);
        const predictedIndex = slotProbabilities.indexOf(maxProbability);
        const currentConfidence = maxProbability;

        if (currentConfidence >= confidenceThreshold) {
            if (predictedIndex >= 0 && predictedIndex < currentClassNamesArray.length) {
                const currentPredictionName = currentClassNamesArray[predictedIndex];
                if (currentPredictionName === originalNameFromCache) {
                    confirmedAbilities.push({
                        ...cachedSlot,
                        name: originalNameFromCache,
                        confidence: currentConfidence,
                    });
                }
            }
        }
    }
    console.log(`[identifySlotsFromCache] Finished. Reconfirmed ${confirmedAbilities.length} of ${cachedPoolAbilities.length} cached abilities.`);
    return confirmedAbilities;
}

/**
 * Performs a comprehensive initial scan of the main ability pool.
 * This scans all 36 standard slots and 12 ultimate slots.
 * @param {Buffer} screenshotBuffer - The PNG buffer of the screen.
 * @param {object} layoutConfig - The full layout configuration object.
 * @param {string} targetResolution - The resolution key.
 * @param {number} confidenceThreshold - Minimum confidence for prediction.
 * @returns {Promise<InitialScanResults>} A promise resolving to the raw scan results for the ability pool.
 * @throws {Error} If model, class names, or coordinates are not ready/found.
 */
/**
 * @typedef {object} InitialScanResults
 * @property {IdentifiedSlotResult[]} ultimates - Identified ultimate abilities.
 * @property {IdentifiedSlotResult[]} standard - Identified standard abilities from all standard slots.
 * @property {IdentifiedSlotResult[]} selectedAbilities - Empty array, as initial scan assumes no selections.
 * @property {IdentifiedSlotResult[]} heroDefiningAbilities - Identified abilities from hero-defining slots (subset of standard).
 */
async function performInitialScan(screenshotBuffer, layoutConfig, targetResolution, confidenceThreshold) {
    console.log('[ImageProcessor/Worker] Performing comprehensive initial scan of all 48 pool abilities...');
    const model = await modelPromise;
    const classNames = await classNamesPromise;
    if (!model || !classNames) throw new Error('Model or ClassNames not ready for initial scan.');

    const coords = layoutConfig.resolutions?.[targetResolution];
    if (!coords) throw new Error(`Coordinates for ${targetResolution} not found.`);

    const {
        ultimate_slots_coords = [],
        standard_slots_coords = []
    } = coords;

    // Run scans for the entire pool in parallel
    const ultimatePromise = identifySlots(ultimate_slots_coords, screenshotBuffer, classNames, confidenceThreshold);
    const standardPromise = identifySlots(standard_slots_coords, screenshotBuffer, classNames, confidenceThreshold);

    const [ultimates, standard] = await Promise.all([ultimatePromise, standardPromise]);

    // Extract the hero-defining abilities from the full standard scan results
    const heroDefiningAbilities = standard.filter(slot => slot.ability_order === 2);

    return {
        ultimates,
        standard,
        selectedAbilities: [], // Initial scan assumes no abilities are selected
        heroDefiningAbilities
    };
}

/**
 * Scans only the slots where selected abilities appear. Used for rescans.
 * @param {Buffer} screenshotBuffer - The PNG buffer of the screen.
 * @param {object} layoutConfig - The full layout configuration object, containing resolution-specific coordinates.
 * @param {string} targetResolution - The resolution key (e.g., "1920x1080").
 * @param {number} confidenceThreshold - Minimum confidence for prediction.
 * @returns {Promise<IdentifiedSlotResult[]>} A promise resolving to an array of identified selected abilities.
 * @throws {Error} If model, class names, or coordinates are not ready/found.
 */
async function performSelectedAbilitiesScan(screenshotBuffer, layoutConfig, targetResolution, confidenceThreshold) {
    console.log('[ImageProcessor/Worker] Performing selected abilities only scan (rescan)...');
    const model = await modelPromise;
    const classNames = await classNamesPromise;
    if (!model || !classNames) throw new Error('Model or ClassNames not ready for rescan.');

    const coords = layoutConfig.resolutions?.[targetResolution];
    if (!coords) throw new Error(`Coordinates for ${targetResolution} not found.`);

    const { selected_abilities_coords = [], selected_abilities_params } = coords;

    if (selected_abilities_coords.length === 0 || !selected_abilities_params) {
        console.warn(`[ImageProcessor/Worker] No selected ability coordinates defined for ${targetResolution}.`);
        return [];
    }

    const selectedSlotsToScan = selected_abilities_coords.map(c => ({
        ...c,
        width: selected_abilities_params.width,
        height: selected_abilities_params.height,
    }));

    return identifySlots(selectedSlotsToScan, screenshotBuffer, classNames, confidenceThreshold);
}

module.exports = {
    initializeImageProcessor,
    initializeImageProcessorIfNeeded,
    performInitialScan,
    performSelectedAbilitiesScan,
    identifySlots,
    identifySlotsFromCache,
    // Export new performance and optimization modules
    mlPerformanceMetrics,
    smartScanning,
    screenshotCache
};