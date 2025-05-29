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
            // This case might occur if main.js tries to call before processDraftScreen ever ran.
            // Assuming initializeImageProcessor in main.js or first call to processDraftScreen handles paths.
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
 * Identifies abilities in specified screen slots using the loaded ML model.
 *
 * @param {Array<object>} slotCoordsArray - Array of objects, each defining a slot with x, y, width, height,
 * hero_order, ability_order, and is_ultimate.
 * @param {Buffer} screenBuffer - Buffer containing the PNG image of the screen.
 * @param {Array<string>} currentClassNames - The array of class names (ability internal names) to use for prediction.
 * @param {number} confidenceThreshold - The minimum prediction confidence required to identify an ability.
 * @param {Set<string>} [previouslyPickedNames=new Set()] - A set of ability names already picked, to filter them out.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of identification results,
 * each with name, confidence, and original slot data.
 * @throws {Error} If the image processor is not initialized.
 */
async function identifySlots(slotCoordsArray, screenBuffer, currentClassNames, confidenceThreshold, previouslyPickedNames = new Set()) {
    if (!initialized || !modelPromise || !classNamesPromise) {
        throw new Error("[ImageProcessor] Not initialized. Call initializeImageProcessor first.");
    }

    const model = await modelPromise; // Ensure model is loaded

    const defaultSlotData = (slot) => ({
        name: null,
        confidence: 0,
        hero_order: slot.hero_order,
        ability_order: slot.ability_order,
        is_ultimate: slot.is_ultimate // Carry over the is_ultimate flag from coordinate data
    });

    if (!model) {
        console.error("[ImageProcessor] Model not available for predictions. Returning empty results for slots.");
        return slotCoordsArray.map(slotData => defaultSlotData(slotData));
    }
    if (!currentClassNames || currentClassNames.length === 0) {
        console.error("[ImageProcessor] Class names are empty or not provided to identifySlots. Returning empty results for slots.");
        return slotCoordsArray.map(slotData => defaultSlotData(slotData));
    }

    const identifiedResults = [];

    for (let i = 0; i < slotCoordsArray.length; i++) {
        const slotData = slotCoordsArray[i];
        if (typeof slotData.x !== 'number' || typeof slotData.y !== 'number' ||
            typeof slotData.width !== 'number' || typeof slotData.height !== 'number' ||
            slotData.width <= 0 || slotData.height <= 0) {
            console.warn(`[ImageProcessor] Skipping slot due to invalid/missing coordinate or dimension data:`, slotData);
            identifiedResults.push(defaultSlotData(slotData));
            continue;
        }

        const { x, y, width, height } = slotData;
        let predictedAbilityName = null;
        let predictionConfidence = 0;
        const tensorsToDispose = []; // Keep track of tensors to dispose for this slot

        try {
            // Crop the specific ability icon from the full screenshot buffer
            const croppedBuffer = await sharp(screenBuffer)
                .extract({ left: x, top: y, width: width, height: height })
                .png() // Ensure PNG format for consistency
                .toBuffer();

            // Preprocess the image for the model
            // 1. Decode image buffer to a tensor
            let tensor = tf.node.decodeImage(croppedBuffer, 3); // 3 channels (RGB)
            tensorsToDispose.push(tensor);

            // 2. Resize to the dimensions the model expects (IMG_HEIGHT x IMG_WIDTH)
            let resizedTensor = tf.image.resizeBilinear(tensor, [IMG_HEIGHT, IMG_WIDTH]);
            tensorsToDispose.push(resizedTensor);

            // 3. Expand dimensions to create a batch of 1 [batch_size, height, width, channels]
            let batchTensor = resizedTensor.expandDims(0);
            tensorsToDispose.push(batchTensor);

            // 4. Perform prediction.
            //    The model (MobileNetV2 based) is expected to have its own internal rescaling layers
            //    (e.g., to normalize pixel values from [0, 255] to [-1, 1] or [0, 1]),
            //    so we feed the raw [0, 255] pixel values from decodeImage.
            let predictionTensor = model.predict(batchTensor);
            tensorsToDispose.push(predictionTensor);

            const probabilities = await predictionTensor.data(); // Use await for async data retrieval
            const maxProbability = Math.max(...probabilities);
            const predictedIndex = probabilities.indexOf(maxProbability);
            predictionConfidence = maxProbability;

            if (predictionConfidence >= confidenceThreshold) {
                if (predictedIndex >= 0 && predictedIndex < currentClassNames.length) {
                    const tempPredictedName = currentClassNames[predictedIndex];
                    // If the ability has already been picked by a hero (from selected_abilities), don't suggest it for the pool.
                    if (previouslyPickedNames.has(tempPredictedName)) {
                        predictedAbilityName = null; // Mark as null if already picked from the pool
                    } else {
                        predictedAbilityName = tempPredictedName;
                    }
                } else {
                    console.warn(`[ImageProcessor] Slot ${i} (hero_order: ${slotData.hero_order}): Predicted index ${predictedIndex} out of bounds for ${currentClassNames.length} classes. Confidence: ${predictionConfidence.toFixed(2)}.`);
                    predictedAbilityName = null;
                }
            } else {
                // Confidence below threshold
                predictedAbilityName = null;
            }
        } catch (err) {
            console.error(`[ImageProcessor] Error processing slot ${i} (hero_order: ${slotData.hero_order}) with ML model: ${err.message}`);
            predictedAbilityName = null;
            predictionConfidence = 0;
        } finally {
            tf.dispose(tensorsToDispose);
        }
        identifiedResults.push({
            name: predictedAbilityName,
            confidence: predictionConfidence,
            hero_order: slotData.hero_order,
            ability_order: slotData.ability_order,
            is_ultimate: slotData.is_ultimate,
            coord: { x: slotData.x, y: slotData.y, width: slotData.width, height: slotData.height }
        });
    }
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
            return []; // Cannot proceed
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
    if (CLASS_NAMES.length === 0) { // Internal check against the module's own cache
        console.warn("[ImageProcessor] identifySlotsFromCache: Internal CLASS_NAMES cache is empty. This is unexpected if initialized.");
    }

    console.log(`[identifySlotsFromCache] Called. Cached abilities: ${cachedPoolAbilities.length}. Confidence Threshold: ${confidenceThreshold}.`);
    const confirmedAbilities = [];
    let processedCount = 0;

    for (const cachedSlot of cachedPoolAbilities) {
        processedCount++;
        const { coord, name: originalNameFromCache, hero_order, ability_order } = cachedSlot;

        if (!coord || typeof coord.x !== 'number' || !originalNameFromCache) {
            console.warn(`[identifySlotsFromCache] Invalid data for cached slot ${processedCount}. Skipping. OriginalName: ${originalNameFromCache}, Coord: ${JSON.stringify(coord)}`);
            continue;
        }

        let currentPredictionName = null;
        let currentConfidence = 0;
        const tensorsToDispose = [];

        try {
            const croppedBuffer = await sharp(screenBuffer)
                .extract({ left: coord.x, top: coord.y, width: coord.width, height: coord.height })
                .png()
                .toBuffer();

            let tensor = tf.node.decodeImage(croppedBuffer, 3);
            tensorsToDispose.push(tensor);
            let resizedTensor = tf.image.resizeBilinear(tensor, [IMG_HEIGHT, IMG_WIDTH]);
            tensorsToDispose.push(resizedTensor);
            let batchTensor = resizedTensor.expandDims(0);
            tensorsToDispose.push(batchTensor);

            let predictionTensor = model.predict(batchTensor);
            tensorsToDispose.push(predictionTensor);

            const probabilities = await predictionTensor.data();
            const maxProbability = Math.max(...probabilities);
            const predictedIndex = probabilities.indexOf(maxProbability);
            currentConfidence = maxProbability;

            if (currentConfidence >= confidenceThreshold) {
                if (predictedIndex >= 0 && predictedIndex < currentClassNamesArray.length) {
                    currentPredictionName = currentClassNamesArray[predictedIndex];
                    if (currentPredictionName === originalNameFromCache) {
                        confirmedAbilities.push({
                            ...cachedSlot, // Spreads original data like coord, type, hero_order, ability_order, is_ultimate
                            name: originalNameFromCache,
                            confidence: currentConfidence, // Update with new confidence
                        });
                    }
                }
            }
        } catch (err) {
            console.error(`[identifySlotsFromCache] Error reconfirming slot for '${originalNameFromCache}' (HO:${hero_order}, AO:${ability_order}): ${err.message}`);
        } finally {
            tf.dispose(tensorsToDispose);
        }
    }
    console.log(`[identifySlotsFromCache] Finished. Reconfirmed ${confirmedAbilities.length} of ${cachedPoolAbilities.length} cached abilities.`);
    return confirmedAbilities;
}


/**
 * Processes the entire draft screen: takes a screenshot, identifies abilities in various slots,
 * and organizes the results.
 *
 * @param {string} coordinatesPath - Path to the JSON file defining slot coordinates for different resolutions.
 * @param {string} targetResolution - The screen resolution key (e.g., "1920x1080") to use from coordinates file.
 * @param {number} confidenceThreshold - Minimum confidence for an ability prediction to be considered valid.
 * @returns {Promise<object>} A promise that resolves to an object containing arrays of identified
 * ultimates, standard abilities, hero-defining abilities, and selected abilities.
 * @throws {Error} If coordinates cannot be loaded, the screenshot fails, or if the processor is not initialized.
 */
async function processDraftScreen(coordinatesPath, targetResolution, confidenceThreshold) {
    console.log(`[ImageProcessor] Starting screen processing with ML Model for ${targetResolution} (Confidence: ${confidenceThreshold}).`);

    if (!initialized || !modelPromise || !classNamesPromise) {
        console.error("[ImageProcessor] Not initialized. Cannot process draft screen.");
        throw new Error("Image processor not initialized.");
    }

    const model = await modelPromise;
    const resolvedClassNames = await classNamesPromise;

    const createEmptyResultsForSlots = (coordsArray = []) => {
        if (!Array.isArray(coordsArray)) return [];
        return coordsArray.map(slotData => ({
            name: null, confidence: 0,
            hero_order: slotData.hero_order,
            ability_order: slotData.ability_order,
            is_ultimate: slotData.is_ultimate
        }));
    };

    if (!model || !resolvedClassNames || resolvedClassNames.length === 0) {
        console.error("[ImageProcessor] Model or Class Names not loaded. Aborting scan and returning empty results structure.");
        let ultimate_coords = [], standard_coords = [], hero_defining_coords = [], selected_hero_abilities_coords_full = [];
        try {
            const configData = await fs.readFile(coordinatesPath, 'utf-8');
            const layoutConfig = JSON.parse(configData);
            const coords = layoutConfig.resolutions?.[targetResolution];
            if (coords) {
                ultimate_coords = coords.ultimate_slots_coords || [];
                standard_coords = coords.standard_slots_coords || [];
                hero_defining_coords = (coords.standard_slots_coords || []).filter(slot => slot.ability_order === 2);
                if (coords.selected_abilities_coords && coords.selected_abilities_params) {
                    selected_hero_abilities_coords_full = coords.selected_abilities_coords.map(sac => ({
                        ...sac,
                        width: coords.selected_abilities_params.width,
                        height: coords.selected_abilities_params.height,
                    }));
                }
            }
        } catch (e) { console.error("[ImageProcessor] Error reading layout for empty results structure:", e); }
        return {
            ultimates: createEmptyResultsForSlots(ultimate_coords),
            standard: createEmptyResultsForSlots(standard_coords),
            heroDefiningAbilities: createEmptyResultsForSlots(hero_defining_coords),
            selectedAbilities: createEmptyResultsForSlots(selected_hero_abilities_coords_full)
        };
    }

    let layoutConfig;
    try {
        const configData = await fs.readFile(coordinatesPath, 'utf-8');
        layoutConfig = JSON.parse(configData);
    } catch (err) {
        console.error(`[ImageProcessor] Error reading coordinates file from ${coordinatesPath}: ${err.message}`);
        throw err;
    }

    const coords = layoutConfig.resolutions?.[targetResolution];
    if (!coords) {
        const errorMsg = `Coordinates not found for resolution: ${targetResolution} in ${coordinatesPath}`;
        console.error(`[ImageProcessor] ${errorMsg}`);
        throw new Error(errorMsg);
    }

    const {
        ultimate_slots_coords = [],
        standard_slots_coords = [],
        selected_abilities_coords = [],
        selected_abilities_params
    } = coords;

    // Hero-defining abilities are typically the 2nd standard ability of a hero model.
    const hero_defining_slots_coords = standard_slots_coords.filter(slot => slot.ability_order === 2);

    // Combine individual selected ability coordinates with their common width/height params
    const selected_hero_abilities_coords_full = selected_abilities_params ? selected_abilities_coords.map(sac => ({
        ...sac, // Spreads x, y, hero_order, and is_ultimate flag from JSON
        width: selected_abilities_params.width,
        height: selected_abilities_params.height,
    })) : [];

    console.log(`[ImageProcessor] Coordinates loaded. Ultimates: ${ultimate_slots_coords.length}, Standard: ${standard_slots_coords.length}, HeroDefining: ${hero_defining_slots_coords.length}, SelectedHeroAbils: ${selected_hero_abilities_coords_full.length}`);

    let screenshotBuffer;
    try {
        screenshotBuffer = await screenshot({ format: 'png' });
    } catch (err) {
        console.error("[ImageProcessor] Screenshot failed:", err);
        throw err;
    }

    // First, identify abilities already picked by heroes (selected_abilities)
    // These will be used to filter out duplicates from the main draft pool.
    const identifiedSelectedAbilities = await identifySlots(selected_hero_abilities_coords_full, screenshotBuffer, resolvedClassNames, confidenceThreshold);

    const pickedAbilityNamesByHeroes = new Set();
    identifiedSelectedAbilities.forEach(result => {
        if (result.name) {
            pickedAbilityNamesByHeroes.add(result.name);
        }
    });
    console.log('[ImageProcessor] Abilities identified as picked by heroes:', Array.from(pickedAbilityNamesByHeroes));

    // Now identify abilities in the draft pool, passing `pickedAbilityNamesByHeroes` to filter them.
    const identifiedUltimates = await identifySlots(ultimate_slots_coords, screenshotBuffer, resolvedClassNames, confidenceThreshold, pickedAbilityNamesByHeroes);
    const identifiedStandard = await identifySlots(standard_slots_coords, screenshotBuffer, resolvedClassNames, confidenceThreshold, pickedAbilityNamesByHeroes);

    // Hero defining abilities are typically not filtered by `pickedAbilityNamesByHeroes` as they are unique to the hero model.
    // If they can appear in the general pool, filtering might be desired. Assuming they are distinct for now.
    const identifiedHeroDefiningAbilities = await identifySlots(hero_defining_slots_coords, screenshotBuffer, resolvedClassNames, confidenceThreshold);

    console.log('[ImageProcessor] Screen processing finished.');
    return {
        ultimates: identifiedUltimates,
        standard: identifiedStandard,
        heroDefiningAbilities: identifiedHeroDefiningAbilities,
        selectedAbilities: identifiedSelectedAbilities // These results already include the is_ultimate flag from coord data
    };
}

module.exports = {
    initializeImageProcessor,
    processDraftScreen,
    identifySlots, // Exported for potential direct use if ever needed, though processDraftScreen is primary
    identifySlotsFromCache,
    initializeImageProcessorIfNeeded
};