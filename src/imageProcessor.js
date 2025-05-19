const fs = require('fs').promises;
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const tf = require('@tensorflow/tfjs-node');

let ABSOLUTE_MODEL_PATH;
let ABSOLUTE_CLASS_NAMES_PATH;

const IMG_HEIGHT = 96;
const IMG_WIDTH = 96;

let CLASS_NAMES = [];
let classNamesPromise;
let modelPromise;
let initialized = false;

function initializeImageProcessor(modelPath, classNamesPath) {
    if (initialized) {
        console.warn("Image processor already initialized.");
        return;
    }
    ABSOLUTE_MODEL_PATH = modelPath;
    ABSOLUTE_CLASS_NAMES_PATH = classNamesPath;

    console.log(`Initializing ImageProcessor with Model: ${ABSOLUTE_MODEL_PATH}, Classes: ${ABSOLUTE_CLASS_NAMES_PATH}`);

    classNamesPromise = fs.readFile(ABSOLUTE_CLASS_NAMES_PATH, 'utf8')
        .then(data => {
            CLASS_NAMES = JSON.parse(data);
            console.log(`Loaded ${CLASS_NAMES.length} class names from ${ABSOLUTE_CLASS_NAMES_PATH}`);
            return CLASS_NAMES;
        })
        .catch(err => {
            console.error(`FATAL: Error loading class names from ${ABSOLUTE_CLASS_NAMES_PATH}: ${err.message}`);
            CLASS_NAMES = [];
            throw err;
        });

    modelPromise = tf.loadGraphModel(ABSOLUTE_MODEL_PATH)
        .then(model => {
            console.log('TFJS Model loaded successfully.');
            try {
                const dummyInput = tf.zeros([1, IMG_HEIGHT, IMG_WIDTH, 3]);
                const warmupResult = model.predict(dummyInput);
                tf.dispose([dummyInput, warmupResult]);
                console.log('Model warmed up.');
            } catch (warmupErr) {
                console.error('Error during model warmup:', warmupErr);
            }
            return model;
        })
        .catch(err => {
            console.error(`FATAL: Error loading TFJS model from ${ABSOLUTE_MODEL_PATH}: ${err.message}`);
            throw err;
        });
    initialized = true;
}

async function identifySlots(slotCoordsArray, screenBuffer, currentClassNames, confidenceThreshold, previouslyPickedNames = new Set()) {
    if (!initialized || !modelPromise || !classNamesPromise) {
        throw new Error("Image processor not initialized. Call initializeImageProcessor first.");
    }
    const model = await modelPromise;

    if (!model) {
        console.error("Model not available for predictions.");
        return slotCoordsArray.map(slotData => ({
            name: null,
            confidence: 0,
            hero_order: slotData.hero_order,
            ability_order: slotData.ability_order
        }));
    }
    if (!currentClassNames || currentClassNames.length === 0) {
        console.error("Class names argument is empty or not provided to identifySlots.");
        return slotCoordsArray.map(slotData => ({
            name: null,
            confidence: 0,
            hero_order: slotData.hero_order,
            ability_order: slotData.ability_order
        }));
    }

    const identifiedResults = [];
    for (let i = 0; i < slotCoordsArray.length; i++) {
        const slotData = slotCoordsArray[i];
        if (typeof slotData.x !== 'number' || typeof slotData.y !== 'number' ||
            typeof slotData.width !== 'number' || typeof slotData.height !== 'number') {
            console.warn(`Skipping slot due to missing coordinate/dimension data:`, slotData);
            identifiedResults.push({
                name: null,
                confidence: 0,
                hero_order: slotData.hero_order,
                ability_order: slotData.ability_order
            });
            continue;
        }
        const { x, y, width, height } = slotData;
        let predictedAbilityName = null;
        let predictionConfidence = 0;
        const tensorsToDispose = [];

        try {
            const croppedBuffer = await sharp(screenBuffer)
                .extract({ left: x, top: y, width: width, height: height })
                .png().toBuffer();

            let tensor = tf.node.decodeImage(croppedBuffer, 3);
            tensorsToDispose.push(tensor);
            let resizedTensor = tf.image.resizeBilinear(tensor, [IMG_HEIGHT, IMG_WIDTH]);
            tensorsToDispose.push(resizedTensor);
            let batchTensor = resizedTensor.expandDims(0);
            tensorsToDispose.push(batchTensor);

            let predictionTensor = model.predict(batchTensor);
            tensorsToDispose.push(predictionTensor);

            const probabilities = predictionTensor.dataSync();
            const maxProbability = Math.max(...probabilities);
            const predictedIndex = probabilities.indexOf(maxProbability);
            predictionConfidence = maxProbability;

            if (predictionConfidence >= confidenceThreshold) {
                if (predictedIndex >= 0 && predictedIndex < currentClassNames.length) {
                    const tempPredictedName = currentClassNames[predictedIndex];

                    if (previouslyPickedNames.has(tempPredictedName)) {
                        predictedAbilityName = null;
                    } else {
                        predictedAbilityName = tempPredictedName;
                    }
                } else {
                    console.warn(`Slot ${i} (hero_order: ${slotData.hero_order}): Predicted index ${predictedIndex} out of bounds for ${currentClassNames.length} classes, confidence ${predictionConfidence.toFixed(2)}.`);
                    predictedAbilityName = null;
                }
            } else {
                predictedAbilityName = null;
            }
        } catch (err) {
            console.error(`Error processing slot ${i} (hero_order: ${slotData.hero_order}) with ML model: ${err.message}`);
            predictedAbilityName = null;
            predictionConfidence = 0;
        } finally {
            tf.dispose(tensorsToDispose);
        }
        identifiedResults.push({
            name: predictedAbilityName,
            confidence: predictionConfidence,
            hero_order: slotData.hero_order,
            ability_order: slotData.ability_order
        });
    }
    return identifiedResults;
}

/**
 * Takes a screenshot, crops ability slots based on TFJS model predictions.
 * @param {string} coordinatesPath - Path to layout_coordinates.json.
 * @param {string} targetResolution - The resolution key (e.g., "2560x1440").
 * @param {number} confidenceThreshold - The minimum confidence score for a prediction to be considered valid.
 * @returns {Promise<{ultimates: Array, standard: Array, heroDefiningAbilities: Array, selectedAbilities: Array}>}
 */
async function processDraftScreen(coordinatesPath, targetResolution, confidenceThreshold) {
    console.log(`Starting screen processing with ML Model for ${targetResolution} (Confidence: ${confidenceThreshold})...`);

    if (!initialized || !modelPromise || !classNamesPromise) {
        console.error("Image processor not initialized. Call initializeImageProcessor first.");
        throw new Error("Image processor not initialized.");
    }

    const model = await modelPromise;
    const resolvedClassNames = await classNamesPromise;

    const emptyResultsWithData = (coordsArray) => {
        if (!coordsArray || !Array.isArray(coordsArray)) return [];
        return coordsArray.map(slotData => ({
            name: null, confidence: 0,
            hero_order: slotData.hero_order,
            ability_order: slotData.ability_order
        }));
    };

    if (!model || !resolvedClassNames || resolvedClassNames.length === 0) {
        console.error("Model or Class Names not loaded. Aborting scan.");
        let ultimate_coords = [], standard_coords = [], hero_defining_coords = [], selected_hero_abilities_coords_full = [];
        try {
            const configData = await fs.readFile(coordinatesPath, 'utf-8');
            const layoutConfig = JSON.parse(configData);
            const coords = layoutConfig.resolutions?.[targetResolution];
            if (coords) {
                ultimate_coords = coords.ultimate_slots_coords || [];
                standard_coords = coords.standard_slots_coords || [];
                if (Array.isArray(coords.standard_slots_coords)) {
                    hero_defining_coords = coords.standard_slots_coords.filter(slot =>
                        slot.ability_order === 2 && slot.hero_order !== 10 && slot.hero_order !== 11
                    );
                }
                if (coords.selected_abilities_coords && coords.selected_abilities_params) {
                    selected_hero_abilities_coords_full = coords.selected_abilities_coords.map(sac => ({
                        ...sac,
                        width: coords.selected_abilities_params.width,
                        height: coords.selected_abilities_params.height,
                    }));
                }
            }
        } catch (e) { console.error("Error reading layout for empty results:", e); }
        return {
            ultimates: emptyResultsWithData(ultimate_coords),
            standard: emptyResultsWithData(standard_coords),
            heroDefiningAbilities: emptyResultsWithData(hero_defining_coords),
            selectedAbilities: emptyResultsWithData(selected_hero_abilities_coords_full)
        };
    }

    let layoutConfig;
    try {
        const configData = await fs.readFile(coordinatesPath, 'utf-8');
        layoutConfig = JSON.parse(configData);
    } catch (err) { throw err; }

    const coords = layoutConfig.resolutions?.[targetResolution];
    if (!coords) {
        console.error(`Coordinates not found for resolution: ${targetResolution} in ${coordinatesPath}`);
        throw new Error(`Coordinates not found for resolution: ${targetResolution}`);
    }
    const {
        ultimate_slots_coords = [],
        standard_slots_coords = [],
        selected_abilities_coords = [],
        selected_abilities_params
    } = coords;

    const hero_defining_slots_coords = standard_slots_coords.filter(slot =>
        slot.ability_order === 2 && slot.hero_order !== 10 && slot.hero_order !== 11
    );

    const selected_hero_abilities_coords_full = selected_abilities_params ? selected_abilities_coords.map(sac => ({
        ...sac,
        width: selected_abilities_params.width,
        height: selected_abilities_params.height,
    })) : [];

    console.log(`Coordinates loaded. Ult: ${ultimate_slots_coords.length}, Std: ${standard_slots_coords.length}, HeroDef: ${hero_defining_slots_coords.length}, SelectedHeroAbils: ${selected_hero_abilities_coords_full.length}`);

    let screenshotBuffer;
    try {
        screenshotBuffer = await screenshot({ format: 'png' });
    } catch (err) {
        console.error("[imageProcessor] Screenshot failed:", err);
        throw err;
    }

    // Step 1: Identify selected abilities first
    // For selected abilities, we don't pass any `previouslyPickedNames` because this is the source of truth for picked abilities.
    const identifiedSelectedAbilities = await identifySlots(selected_hero_abilities_coords_full, screenshotBuffer, resolvedClassNames, confidenceThreshold);

    // Step 2: Create a set of confidently picked ability names from the selected slots
    const pickedAbilityNames = new Set();
    identifiedSelectedAbilities.forEach(result => {
        if (result.name) { // If name is not null (i.e., confidently predicted)
            pickedAbilityNames.add(result.name);
        }
    });
    console.log('[imageProcessor] Abilities identified as picked by heroes:', Array.from(pickedAbilityNames));

    // Step 3: Identify draft pool abilities, passing the set of picked names to filter them out
    const identifiedUltimates = await identifySlots(ultimate_slots_coords, screenshotBuffer, resolvedClassNames, confidenceThreshold, pickedAbilityNames);
    const identifiedStandard = await identifySlots(standard_slots_coords, screenshotBuffer, resolvedClassNames, confidenceThreshold, pickedAbilityNames);

    // Hero defining abilities are a subset of standard abilities.
    // The `main.js` process currently uses the `name` from these results to find hero details.
    // These will also be filtered by `pickedAbilityNames`.
    const identifiedHeroDefiningAbilities = await identifySlots(hero_defining_slots_coords, screenshotBuffer, resolvedClassNames, confidenceThreshold, pickedAbilityNames);

    console.log('[imageProcessor] Screen processing finished. Returning all identified categories.');
    return {
        ultimates: identifiedUltimates,
        standard: identifiedStandard,
        heroDefiningAbilities: identifiedHeroDefiningAbilities,
        selectedAbilities: identifiedSelectedAbilities
    };
}

module.exports = { initializeImageProcessor, processDraftScreen };