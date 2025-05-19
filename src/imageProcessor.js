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

/**
 * Initializes the image processor with necessary paths.
 * Must be called once before processDraftScreen.
 * @param {string} modelPath - Absolute path to the model.json (e.g., 'file:///path/to/model.json').
 * @param {string} classNamesPath - Absolute path to the class_names.json.
 */
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
            throw err; // Re-throw to indicate initialization failure
        });

    console.log(`Attempting to load model from: ${ABSOLUTE_MODEL_PATH}`);
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
            throw err; // Re-throw to indicate initialization failure
        });
    initialized = true;
}

async function identifySlots(slotCoords, screenBuffer, currentClassNames, confidenceThreshold) { // Added confidenceThreshold
    if (!initialized || !modelPromise || !classNamesPromise) {
        throw new Error("Image processor not initialized. Call initializeImageProcessor first.");
    }
    const model = await modelPromise;

    if (!model) {
        console.error("Model not available for predictions.");
        return slotCoords.map(() => ({ name: null, confidence: 0 })); // Return object
    }
    if (!currentClassNames || currentClassNames.length === 0) {
        console.error("Class names argument is empty or not provided to identifySlots.");
        return slotCoords.map(() => ({ name: null, confidence: 0 })); // Return object
    }

    const identifiedResults = []; // Store objects { name, confidence }
    for (let i = 0; i < slotCoords.length; i++) {
        const slotData = slotCoords[i];
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

            let predictionTensor = model.predict(batchTensor); // This is a tensor of probabilities
            tensorsToDispose.push(predictionTensor);

            const probabilities = predictionTensor.dataSync(); // Get all probabilities
            const maxProbability = Math.max(...probabilities); // Find the highest probability
            const predictedIndex = probabilities.indexOf(maxProbability); // Find the index of that probability

            predictionConfidence = maxProbability; // Store the confidence

            if (predictionConfidence >= confidenceThreshold) { // Check against threshold
                if (predictedIndex >= 0 && predictedIndex < currentClassNames.length) {
                    predictedAbilityName = currentClassNames[predictedIndex];
                } else {
                    console.warn(`Slot ${i}: Predicted index ${predictedIndex} out of bounds for ${currentClassNames.length} classes, even with confidence ${predictionConfidence.toFixed(2)}.`);
                    predictedAbilityName = null; // Explicitly null if index is bad
                }
            } else {
                // console.log(`Slot ${i}: Prediction confidence ${predictionConfidence.toFixed(2)} below threshold ${confidenceThreshold}. Skipping.`);
                predictedAbilityName = null; // Explicitly null if below threshold
            }
        } catch (err) {
            console.error(`Error processing slot ${i} with ML model: ${err.message}`);
            predictedAbilityName = null;
            predictionConfidence = 0;
        } finally {
            tf.dispose(tensorsToDispose);
        }
        identifiedResults.push({ name: predictedAbilityName, confidence: predictionConfidence });
    }
    return identifiedResults; // Return array of objects
}

/**
 * Takes a screenshot, crops ability slots based on TFJS model predictions.
 * @param {string} coordinatesPath - Path to layout_coordinates.json.
 * @param {string} targetResolution - The resolution key (e.g., "2560x1440").
 * @returns {Promise<{ultimates: (string|null)[], standard: (string|null)[]}>} - Raw predicted ability names.
 */
async function processDraftScreen(coordinatesPath, targetResolution, confidenceThreshold) { // Added confidenceThreshold
    console.log(`Starting screen processing with ML Model for ${targetResolution} (Confidence: ${confidenceThreshold})...`);

    if (!initialized || !modelPromise || !classNamesPromise) {
        console.error("Image processor not initialized. Call initializeImageProcessor first.");
        throw new Error("Image processor not initialized.");
    }

    const model = await modelPromise;
    const resolvedClassNames = await classNamesPromise;

    if (!model || !resolvedClassNames || resolvedClassNames.length === 0) {
        console.error("Model or Class Names not loaded. Aborting scan.");
        const emptyResultsWithConfidence = (coordsArray) => coordsArray ? coordsArray.map(() => ({ name: null, confidence: 0 })) : [];
        let ultimate_coords_length = 0;
        let standard_coords_length = 0;
        try {
            const configData = await fs.readFile(coordinatesPath, 'utf-8');
            const layoutConfig = JSON.parse(configData);
            const coords = layoutConfig.resolutions?.[targetResolution];
            if (coords) {
                ultimate_coords_length = coords.ultimate_slots_coords.length;
                standard_coords_length = coords.standard_slots_coords.length;
            }
        } catch (_) { }

        return {
            ultimates: emptyResultsWithConfidence(layoutConfig?.resolutions?.[targetResolution]?.ultimate_slots_coords),
            standard: emptyResultsWithConfidence(layoutConfig?.resolutions?.[targetResolution]?.standard_slots_coords),
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
    const { ultimate_slots_coords, standard_slots_coords } = coords;
    console.log(`Coordinates loaded. Processing ${ultimate_slots_coords.length} ult slots and ${standard_slots_coords.length} std slots.`);


    let screenshotBuffer;
    try {
        screenshotBuffer = await screenshot({ format: 'png' });
        console.log('Screenshot captured.');
    } catch (err) { throw err; }

    console.log('Identifying ultimate slots using ML...');
    // Pass confidenceThreshold to identifySlots
    const identifiedUltimatesWithConfidence = await identifySlots(ultimate_slots_coords, screenshotBuffer, resolvedClassNames, confidenceThreshold);

    console.log('Identifying standard slots using ML...');
    // Pass confidenceThreshold to identifySlots
    const identifiedStandardWithConfidence = await identifySlots(standard_slots_coords, screenshotBuffer, resolvedClassNames, confidenceThreshold);

    console.log('Screen processing function finished. Returning raw predicted names and confidences.');
    return { // Return structure now includes confidence
        ultimates: identifiedUltimatesWithConfidence, // Array of {name, confidence}
        standard: identifiedStandardWithConfidence  // Array of {name, confidence}
    };
}

module.exports = { initializeImageProcessor, processDraftScreen };