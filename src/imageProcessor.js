const fs = require('fs').promises; // Using synchronous fs.readFileSync for class_names for simplicity at startup
const path = require('path');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const tf = require('@tensorflow/tfjs-node');

// --- Model and Configuration ---
const MODEL_DIR = path.join(__dirname, '..', 'model', 'tfjs_model');
const MODEL_PATH = 'file://' + path.join(MODEL_DIR, 'model.json');
const CLASS_NAMES_PATH = path.join(MODEL_DIR, 'class_names.json');

const IMG_HEIGHT = 96; // <<< MUST MATCH YOUR TRAINING CONFIGURATION
const IMG_WIDTH = 96;  // <<< MUST MATCH YOUR TRAINING CONFIGURATION

// --- Load Class Names (Asynchronously) ---
let CLASS_NAMES = []; // Initialize
const classNamesPromise = fs.readFile(CLASS_NAMES_PATH, 'utf8')
    .then(data => {
        CLASS_NAMES = JSON.parse(data);
        console.log(`Loaded ${CLASS_NAMES.length} class names from ${CLASS_NAMES_PATH}`);
        return CLASS_NAMES;
    })
    .catch(err => {
        console.error(`FATAL: Error loading class names from ${CLASS_NAMES_PATH}: ${err.message}`);
        CLASS_NAMES = []; // Ensure it's an empty array on error
        return CLASS_NAMES; // Or rethrow / handle error appropriately
    });

// --- Load TFJS Model (Asynchronously) ---
console.log(`Attempting to load model from: ${MODEL_PATH}`);
const modelPromise = tf.loadGraphModel(MODEL_PATH)
    .then(model => {
        console.log('TFJS Model loaded successfully.');
        // Optional: Warm up the model once
        try {
            const dummyInput = tf.zeros([1, IMG_HEIGHT, IMG_WIDTH, 3]);
            const warmupResult = model.predict(dummyInput);
            tf.dispose([dummyInput, warmupResult]); // Dispose dummy tensors
            console.log('Model warmed up.');
        } catch (warmupErr) {
            console.error('Error during model warmup:', warmupErr);
        }
        return model; // Return the loaded model
    })
    .catch(err => {
        console.error(`FATAL: Error loading TFJS model from ${MODEL_PATH}: ${err.message}`);
        // Consider how to handle this globally - maybe the app shouldn't start image processing.
        return null; // Return null or re-throw to indicate failure
    });


async function identifySlots(slotCoords, screenBuffer, currentClassNames) { // Pass classNames
    const identified = [];
    const model = await modelPromise;

    if (!model) {
        console.error("Model not available for predictions.");
        return slotCoords.map(() => null);
    }
    if (!currentClassNames || currentClassNames.length === 0) {
        console.error("Class names argument is empty or not provided to identifySlots.");
        return slotCoords.map(() => null);
    }

    for (let i = 0; i < slotCoords.length; i++) {
        const slotData = slotCoords[i];
        const { x, y, width, height } = slotData;
        let predictedAbilityName = null;
        const tensorsToDispose = [];

        try {
            const croppedBuffer = await sharp(screenBuffer)
                .extract({ left: x, top: y, width: width, height: height })
                .png().toBuffer();

            let tensor = tf.node.decodeImage(croppedBuffer, 3); // Output is Int32Tensor, values [0, 255]
            tensorsToDispose.push(tensor);

            // Resize to model's expected input size. Output is Float32Tensor, values [0, 255]
            let resizedTensor = tf.image.resizeBilinear(tensor, [IMG_HEIGHT, IMG_WIDTH]);
            tensorsToDispose.push(resizedTensor);

            // --- REMOVE THIS MANUAL NORMALIZATION ---
            // let normalizedTensor = resizedTensor.div(127.5).sub(1); 
            // tensorsToDispose.push(normalizedTensor);
            // --- END REMOVAL ---

            // Create batch tensor directly from resizedTensor (values 0-255)
            // The model itself has the Rescaling layer to handle normalization to [-1, 1]
            let batchTensor = resizedTensor.expandDims(0);
            tensorsToDispose.push(batchTensor);

            // --- DEBUG: Check the input to model.predict just before it runs ---
            // console.log(`Slot ${i} identifySlots: Input tensor shape: ${batchTensor.shape}`);
            // const minValIdentify = batchTensor.min().dataSync()[0];
            // const maxValIdentify = batchTensor.max().dataSync()[0];
            // console.log(`Slot ${i} identifySlots: Input tensor Min: ${minValIdentify.toFixed(4)}, Max: ${maxValIdentify.toFixed(4)} (SHOULD BE 0-255)`);
            // --- END DEBUG ---

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
async function processDraftScreen(coordinatesPath, targetResolution) {
    console.log(`Starting screen processing with ML Model for ${targetResolution}...`); // Log it

    // Await both promises here to ensure they are resolved before proceeding
    const model = await modelPromise;
    const resolvedClassNames = await classNamesPromise; // <<< Await this!

    if (!model || !resolvedClassNames || resolvedClassNames.length === 0) {
        console.error("Model or Class Names not loaded. Aborting scan.");
        // Construct an empty result or throw an error
        const emptyResults = (coordsArray) => coordsArray ? coordsArray.map(() => null) : [];
        let ultimate_coords_length = 0;
        let standard_coords_length = 0;
        try { // Try to get lengths for empty results, but don't fail if coords also fail to load
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
    const identifiedUltimates = await identifySlots(ultimate_slots_coords, screenshotBuffer, resolvedClassNames); // Pass classNames

    console.log('Identifying standard slots using ML...');
    const identifiedStandard = await identifySlots(standard_slots_coords, screenshotBuffer, resolvedClassNames); // Pass classNames

    console.log('Screen processing function finished. Returning raw predicted names.');
    return {
        ultimates: identifiedUltimates,
        standard: identifiedStandard
    };
}

module.exports = { processDraftScreen };