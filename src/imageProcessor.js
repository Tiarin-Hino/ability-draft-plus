const fs = require('fs').promises;
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const tf = require('@tensorflow/tfjs-node');

// --- Constants ---
/** Image dimensions the model was trained on. */
const IMG_HEIGHT = 96;
const IMG_WIDTH = 96;

// --- Module State ---
/** Absolute path to the TensorFlow.js Graph Model JSON file. Set during initialization. */
let ABSOLUTE_MODEL_PATH;
/** Absolute path to the class names JSON file. Set during initialization. */
let ABSOLUTE_CLASS_NAMES_PATH;

/** Array of class names (ability internal names) loaded from the JSON file. */
let CLASS_NAMES = [];
/** Promise for loading class names, ensures it's done only once. */
let classNamesPromise;
/** Promise for loading the TFJS model, ensures it's done only once. */
let modelPromise;
/** Flag to indicate if the image processor has been initialized. */
let initialized = false;
/** Flag to indicate if promises for model and class names have resolved. */
let imageProcessorFullyInitialized = false;

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
    ABSOLUTE_MODEL_PATH = modelPath;
    ABSOLUTE_CLASS_NAMES_PATH = classNamesPath;

    console.log(`[ImageProcessor] Initializing with Model: ${ABSOLUTE_MODEL_PATH}, Classes: ${ABSOLUTE_CLASS_NAMES_PATH}`);

    classNamesPromise = fs.readFile(ABSOLUTE_CLASS_NAMES_PATH, 'utf8')
        .then(data => {
            CLASS_NAMES = JSON.parse(data);
            if (!CLASS_NAMES || CLASS_NAMES.length === 0) {
                throw new Error('Class names array is empty or invalid after parsing.');
            }
            console.log(`[ImageProcessor] Loaded ${CLASS_NAMES.length} class names from ${ABSOLUTE_CLASS_NAMES_PATH}`);
            return CLASS_NAMES;
        })
        .catch(err => {
            console.error(`[ImageProcessor] FATAL: Error loading or parsing class names from ${ABSOLUTE_CLASS_NAMES_PATH}: ${err.message}`);
            CLASS_NAMES = []; // Ensure it's an empty array on failure
            throw err; // Re-throw to prevent application from proceeding in an invalid state
        });

    modelPromise = tf.loadGraphModel(ABSOLUTE_MODEL_PATH)
        .then(model => {
            console.log('[ImageProcessor] TFJS Graph Model loaded successfully.');
            // Warm up the model with a dummy input to potentially speed up the first real prediction.
            try {
                const dummyInput = tf.zeros([1, IMG_HEIGHT, IMG_WIDTH, 3]); // Batch size 1
                const warmupResult = model.predict(dummyInput);
                tf.dispose([dummyInput, warmupResult]); // Dispose tensors to free memory
                console.log('[ImageProcessor] Model warmed up successfully.');
            } catch (warmupErr) {
                console.error('[ImageProcessor] Error during model warmup:', warmupErr);
                // Non-fatal, but log it.
            }
            return model;
        })
        .catch(err => {
            console.error(`[ImageProcessor] FATAL: Error loading TFJS model from ${ABSOLUTE_MODEL_PATH}: ${err.message}`);
            throw err; // Re-throw for critical failure
        });

    initialized = true;
}

/**
 * Ensures that the model and class names promises have resolved.
 * Should be called before operations that directly use the model or class names
 * if there's a possibility they haven't been awaited yet.
 * @async
 */
async function initializeImageProcessorIfNeeded() {
    if (!imageProcessorFullyInitialized) {
        if (!initialized && ABSOLUTE_MODEL_PATH && ABSOLUTE_CLASS_NAMES_PATH) {
            console.warn("[ImageProcessor] initializeImageProcessorIfNeeded called when core paths not set. Relying on prior initialization call.");
        }
        if (!modelPromise || !classNamesPromise) {
            console.error("[ImageProcessor] Model or ClassNames promise not available in initializeImageProcessorIfNeeded. This indicates a setup issue.");
            throw new Error("Image processor essential promises not found.");
        }
        await modelPromise;
        await classNamesPromise;
        imageProcessorFullyInitialized = true; // Mark as ready for direct calls
        console.log("[ImageProcessor] Confirmed ready for direct slot identification calls.");
    }
}

/**
 * Identifies abilities in specified screen slots using the loaded ML model via batch processing.
 *
 * @param {Array<object>} slotDataArray - Array of objects, each defining a slot with x, y, width, height,
 * hero_order, ability_order, and is_ultimate.
 * @param {Buffer} screenBuffer - Buffer containing the PNG image of the screen.
 * @param {Array<string>} currentClassNames - The array of class names (ability internal names) to use for prediction.
 * @param {number} confidenceThreshold - The minimum prediction confidence required to identify an ability.
 * @param {Set<string>} [previouslyPickedNames=new Set()] - A set of ability names already picked, to filter them out.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of identification results,
 * each with name, confidence, and original slot data.
 * @throws {Error} If the image processor is not initialized.
 */
async function identifySlots(slotDataArray, screenBuffer, currentClassNames, confidenceThreshold, previouslyPickedNames = new Set()) {
    const identifySlotsStart = performance.now();
    if (!initialized || !modelPromise || !classNamesPromise) {
        throw new Error("[ImageProcessor] Not initialized. Call initializeImageProcessor first.");
    }

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
        return slotDataArray.map(slotData => defaultSlotResult(slotData));
    }
    if (!currentClassNames || currentClassNames.length === 0) {
        console.error("[ImageProcessor] Class names are empty or not provided to identifySlots. Returning empty results for slots.");
        return slotDataArray.map(slotData => defaultSlotResult(slotData));
    }

    if (slotDataArray.length === 0) {
        console.log("[ImageProcessor] No slots to process in identifySlots.");
        return [];
    }

    const croppedBuffers = [];
    const validSlotIndexes = [];

    let cropStartTime = performance.now();
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
    console.log(`[ImageProcessor] Cropped ${croppedBuffers.length} images in ${performance.now() - cropStartTime}ms.`);

    if (croppedBuffers.length === 0) {
        console.log("[ImageProcessor] No valid images to process after cropping.");
        return slotDataArray.map(slotData => defaultSlotResult(slotData));
    }

    let preprocessingStartTime = performance.now();
    const imageTensors = [];
    for (const buffer of croppedBuffers) {
        let tensor = tf.node.decodeImage(buffer, 3);
        let resizedTensor = tf.image.resizeBilinear(tensor, [IMG_HEIGHT, IMG_WIDTH]);
        imageTensors.push(resizedTensor);
        tf.dispose(tensor);
    }

    const batchTensor = tf.stack(imageTensors);
    tf.dispose(imageTensors);
    console.log(`[ImageProcessor] Preprocessed (decode/resize/stack) ${batchTensor.shape[0]} images in ${performance.now() - preprocessingStartTime}ms.`);

    let predictionStartTime = performance.now();
    let predictionTensor;
    try {
        predictionTensor = model.predict(batchTensor);
    } catch (err) {
        console.error(`[ImageProcessor] Error during batch prediction: ${err.message}`);
        tf.dispose(batchTensor);
        return slotDataArray.map(slotData => defaultSlotResult(slotData));
    }
    const probabilities = await predictionTensor.array();
    tf.dispose([batchTensor, predictionTensor]);
    console.log(`[ImageProcessor] Performed batch prediction for ${probabilities.length} images in ${performance.now() - predictionStartTime}ms.`);

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
    console.log(`[ImageProcessor] identifySlots completed in ${performance.now() - identifySlotsStart}ms.`);
    return identifiedResults;
}


/**
 * Re-identifies abilities from a cached list of slots against a new screen buffer.
 * Only returns abilities that are re-confirmed with sufficient confidence matching their original identification.
 *
 * @param {Array<object>} cachedPoolAbilities - Array of cached ability data, each must include
 * { coord, name (originalName), hero_order, ability_order, is_ultimate (from layout), type ('ultimate' or 'standard') }.
 * @param {Buffer} screenBuffer - Buffer containing the new PNG image of the screen.
 * @param {Array<string>} currentClassNamesArray - The array of class names (ability internal names).
 * @param {number} confidenceThreshold - The minimum prediction confidence required.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of re-confirmed abilities,
 * maintaining original structure but with updated confidence.
 */
async function identifySlotsFromCache(cachedPoolAbilities, screenBuffer, currentClassNamesArray, confidenceThreshold) {
    if (!imageProcessorFullyInitialized) {
        console.warn("[ImageProcessor] identifySlotsFromCache: imageProcessor not fully initialized. Attempting to wait for promises.");
        if (!modelPromise || !classNamesPromise) {
            throw new Error("[ImageProcessor] Model or ClassNames promise not available in identifySlotsFromCache. Initialization failed or was skipped.");
        }
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
    if (CLASS_NAMES.length === 0) {
        console.warn("[ImageProcessor] identifySlotsFromCache: Internal CLASS_NAMES cache is empty. This is unexpected if initialized.");
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

    let preprocessingStartTime = performance.now();
    const imageTensors = [];
    for (const buffer of croppedBuffers) {
        let tensor = tf.node.decodeImage(buffer, 3);
        let resizedTensor = tf.image.resizeBilinear(tensor, [IMG_HEIGHT, IMG_WIDTH]);
        imageTensors.push(resizedTensor);
        tf.dispose(tensor);
    }
    const batchTensor = tf.stack(imageTensors);
    tf.dispose(imageTensors);
    console.log(`[identifySlotsFromCache] Preprocessed (decode/resize/stack) ${batchTensor.shape[0]} images in ${performance.now() - preprocessingStartTime}ms.`);

    let predictionStartTime = performance.now();
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
    console.log(`[identifySlotsFromCache] Performed batch prediction from cache for ${probabilities.length} images in ${performance.now() - predictionStartTime}ms.`);

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
 * Processes the entire draft screen: takes a screenshot, identifies abilities in various slots,
 * and organizes the results.
 * For this version, it focuses on identifying hero-defining abilities (from 2nd slot).
 *
 * @param {string} coordinatesPath - Path to the JSON file defining slot coordinates for different resolutions.
 * @param {string} targetResolution - The screen resolution key (e.g., "1920x1080") to use from coordinates file.
 * @param {number} confidenceThreshold - Minimum confidence for an ability prediction to be considered valid.
 * @returns {Promise<object>} A promise that resolves to an object containing identified
 * hero-defining abilities in the 'standard' array, and empty arrays for other categories.
 * @throws {Error} If coordinates cannot be loaded, the screenshot fails, or if the processor is not initialized.
 */
async function processDraftScreen(coordinatesPath, targetResolution, confidenceThreshold) {
    const processDraftScreenStart = performance.now(); // Log start of processDraftScreen
    console.log(`[ImageProcessor] Starting focused screen processing (Hero Defining Abilities Only) for ${targetResolution} (Confidence: ${confidenceThreshold}).`);

    if (!initialized || !modelPromise || !classNamesPromise) {
        console.error("[ImageProcessor] Not initialized. Cannot process draft screen.");
        throw new Error("Image processor not initialized.");
    }

    const model = await modelPromise;
    const resolvedClassNames = await classNamesPromise;

    // Helper to create empty results array with original coord data for UI consistency
    const createResultsWithCoords = (coordsArray = []) => {
        return coordsArray.map(slotData => ({
            name: null, confidence: 0, // Name will be null initially, confidence 0
            hero_order: slotData.hero_order,
            ability_order: slotData.ability_order,
            is_ultimate: slotData.is_ultimate,
            coord: { x: slotData.x, y: slotData.y, width: slotData.width, height: slotData.height }
        }));
    };

    if (!model || !resolvedClassNames || resolvedClassNames.length === 0) {
        console.error("[ImageProcessor] Model or Class Names not loaded. Aborting scan and returning empty results structure.");
        let hero_defining_coords = [];
        try { // Attempt to load coords for default empty results, so UI doesn't break
            const configData = await fs.readFile(coordinatesPath, 'utf-8');
            const layoutConfig = JSON.parse(configData);
            const coords = layoutConfig.resolutions?.[targetResolution];
            if (coords) {
                hero_defining_coords = (coords.standard_slots_coords || []).filter(slot => slot.ability_order === 2);
            }
        } catch (e) { console.error("[ImageProcessor] Error reading layout for empty results structure:", e); }

        return {
            ultimates: createResultsWithCoords(coords ? coords.ultimate_slots_coords : []),
            standard: createResultsWithCoords(hero_defining_coords), // Still provide coord data for these
            heroDefiningAbilities: createResultsWithCoords(hero_defining_coords),
            selectedAbilities: createResultsWithCoords(coords ? (coords.selected_abilities_params ? coords.selected_abilities_coords.map(sac => ({ ...sac, width: coords.selected_abilities_params.width, height: coords.selected_abilities_params.height })) : []) : [])
        };
    }

    let layoutConfig;
    let readConfigStartTime = performance.now();
    try {
        const configData = await fs.readFile(coordinatesPath, 'utf-8');
        layoutConfig = JSON.parse(configData);
    } catch (err) {
        console.error(`[ImageProcessor] Error reading coordinates file from ${coordinatesPath}: ${err.message}`);
        throw err;
    }
    console.log(`[ImageProcessor] Coordinates file read in ${performance.now() - readConfigStartTime}ms.`);

    const coords = layoutConfig.resolutions?.[targetResolution];
    if (!coords) {
        const errorMsg = `Coordinates not found for resolution: ${targetResolution} in ${coordinatesPath}`;
        console.error(`[ImageProcessor] ${errorMsg}`);
        throw new Error(errorMsg);
    }

    // Get all coordinate data, but only process hero-defining for now
    const {
        ultimate_slots_coords = [],
        standard_slots_coords = [],
        selected_abilities_coords = [],
        selected_abilities_params
    } = coords;

    // Filter to get only the 2nd slot abilities for hero identification
    const hero_defining_slots_coords = standard_slots_coords.filter(slot => slot.ability_order === 2);

    console.log(`[ImageProcessor] Coordinates loaded. Focusing on HeroDefining Abilities: ${hero_defining_slots_coords.length} slots.`);

    let screenshotBuffer;
    let screenshotStartTime = performance.now();
    try {
        screenshotBuffer = await screenshot({ format: 'png' });
    } catch (err) {
        console.error("[ImageProcessor] Screenshot failed:", err);
        throw err;
    }
    console.log(`[ImageProcessor] Screenshot taken in ${performance.now() - screenshotStartTime}ms.`);

    // Identify hero-defining abilities
    let identifyHeroDefiningStartTime = performance.now();
    const identifiedHeroDefiningAbilities = await identifySlots(hero_defining_slots_coords, screenshotBuffer, resolvedClassNames, confidenceThreshold);
    console.log(`[ImageProcessor] Identified hero defining abilities in ${performance.now() - identifyHeroDefiningStartTime}ms.`);

    const processDraftScreenEnd = performance.now();
    console.log(`[ImageProcessor] Focused processDraftScreen finished in ${processDraftScreenEnd - processDraftScreenStart}ms.`);

    // Return the identified hero-defining abilities in the 'standard' array for hotspot display,
    // and also in 'heroDefiningAbilities' for subsequent main.js processing.
    // Other categories return empty arrays with their coordinate structures maintained.
    return {
        ultimates: createResultsWithCoords(ultimate_slots_coords),
        standard: identifiedHeroDefiningAbilities, // Place identified 2nd slot abilities here for hotspots
        heroDefiningAbilities: identifiedHeroDefiningAbilities, // Also keep for main.js hero model identification
        selectedAbilities: createResultsWithCoords(
            selected_abilities_params ? selected_abilities_coords.map(sac => ({
                ...sac,
                width: selected_abilities_params.width,
                height: selected_abilities_params.height,
            })) : []
        )
    };
}

module.exports = {
    initializeImageProcessor,
    processDraftScreen,
    identifySlots,
    identifySlotsFromCache,
    initializeImageProcessorIfNeeded
};