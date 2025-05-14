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

async function identifySlots(slotCoords, screenBuffer, currentClassNames) {
    if (!initialized || !modelPromise || !classNamesPromise) {
        throw new Error("Image processor not initialized. Call initializeImageProcessor first.");
    }
    const model = await modelPromise; // modelPromise is already defined at the module level

    if (!model) {
        console.error("Model not available for predictions.");
        return slotCoords.map(() => null);
    }
    if (!currentClassNames || currentClassNames.length === 0) {
        console.error("Class names argument is empty or not provided to identifySlots.");
        return slotCoords.map(() => null);
    }

    const identified = [];
    for (let i = 0; i < slotCoords.length; i++) {
        const slotData = slotCoords[i];
        const { x, y, width, height } = slotData;
        let predictedAbilityName = null;
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

            let prediction = model.predict(batchTensor);
            tensorsToDispose.push(prediction);

            const predictedIndex = prediction.argMax(1).dataSync()[0];

            if (predictedIndex >= 0 && predictedIndex < currentClassNames.length) {
                predictedAbilityName = currentClassNames[predictedIndex];
            } else {
                console.warn(`Slot ${i}: Predicted index ${predictedIndex} out of bounds for ${currentClassNames.length} classes.`);
            }
        } catch (err) {
            console.error(`Error processing slot ${i} with ML model: ${err.message}`);
        } finally {
            tf.dispose(tensorsToDispose);
        }
        identified.push(predictedAbilityName);
    }
    return identified;
}

/**
 * Takes a screenshot, crops ability slots based on TFJS model predictions.
 * @param {string} coordinatesPath - Path to layout_coordinates.json.
 * @param {string} targetResolution - The resolution key (e.g., "2560x1440").
 * @returns {Promise<{ultimates: (string|null)[], standard: (string|null)[]}>} - Raw predicted ability names.
 */
async function processDraftScreen(coordinatesPath, targetResolution) { // coordinatesPath is already a parameter
    console.log(`Starting screen processing with ML Model for ${targetResolution}...`);

    if (!initialized || !modelPromise || !classNamesPromise) { // Check initialization
        console.error("Image processor not initialized. Call initializeImageProcessor first.");
        throw new Error("Image processor not initialized.");
    }

    // Await promises here to ensure they are resolved before proceeding
    const model = await modelPromise;
    const resolvedClassNames = await classNamesPromise;

    if (!model || !resolvedClassNames || resolvedClassNames.length === 0) {
        console.error("Model or Class Names not loaded. Aborting scan.");
        const emptyResults = (coordsArray) => coordsArray ? coordsArray.map(() => null) : [];
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
            ultimates: Array(ultimate_coords_length).fill(null),
            standard: Array(standard_coords_length).fill(null),
        };
    }

    let layoutConfig;
    try {
        const configData = await fs.readFile(coordinatesPath, 'utf-8'); // Uses passed coordinatesPath
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
    const identifiedUltimates = await identifySlots(ultimate_slots_coords, screenshotBuffer, resolvedClassNames);

    console.log('Identifying standard slots using ML...');
    const identifiedStandard = await identifySlots(standard_slots_coords, screenshotBuffer, resolvedClassNames);

    console.log('Screen processing function finished. Returning raw predicted names.');
    return {
        ultimates: identifiedUltimates,
        standard: identifiedStandard
    };
}

module.exports = { initializeImageProcessor, processDraftScreen };