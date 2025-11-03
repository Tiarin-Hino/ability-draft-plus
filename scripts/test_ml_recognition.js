/**
 * Test ML Recognition - Run TensorFlow.js model against screenshot using new coordinates
 *
 * This script simulates the actual image recognition process that happens in the app.
 * Uses Node.js and TensorFlow.js to process the screenshot.
 *
 * Usage:
 *   node test_ml_recognition.js <screenshot> <coords_json> <resolution>
 */

const fs = require('fs').promises;
const sharp = require('sharp');
const tf = require('@tensorflow/tfjs-node');
const path = require('path');

// Model configuration (from imageProcessor.js)
const IMG_HEIGHT = 96;
const IMG_WIDTH = 96;
const CONFIDENCE_THRESHOLD = 0.7;

async function loadCoordinates(coordsPath, resolution) {
    const data = JSON.parse(await fs.readFile(coordsPath, 'utf8'));

    if (data[resolution]) {
        return data[resolution];
    } else if (data.resolutions && data.resolutions[resolution]) {
        return data.resolutions[resolution];
    } else {
        throw new Error(`Resolution ${resolution} not found in coordinates file`);
    }
}

async function loadClassNames(classNamesPath) {
    const data = await fs.readFile(classNamesPath, 'utf8');
    return JSON.parse(data);
}

async function loadModel(modelPath) {
    console.log(`Loading model from: ${modelPath}`);
    const model = await tf.loadGraphModel(`file://${modelPath}`);
    console.log('Model loaded successfully');
    return model;
}

function cropSlot(screenBuffer, coord, params) {
    const x = coord.x;
    const y = coord.y;
    const w = coord.width !== undefined ? coord.width : params.width;
    const h = coord.height !== undefined ? coord.height : params.height;

    return sharp(screenBuffer)
        .extract({ left: x, top: y, width: w, height: h })
        .png()
        .toBuffer();
}

async function runRecognition(screenshotPath, coords, modelPath, classNamesPath) {
    console.log('\\n' + '='.repeat(70));
    console.log('ML RECOGNITION TEST');
    console.log('='.repeat(70));
    console.log(`Screenshot: ${screenshotPath}`);
    console.log(`Model: ${modelPath}`);
    console.log(`Class names: ${classNamesPath}`);
    console.log('='.repeat(70) + '\\n');

    // Load resources
    const screenBuffer = await fs.readFile(screenshotPath);
    const classNames = await loadClassNames(classNamesPath);
    const model = await loadModel(modelPath);

    console.log(`Loaded ${classNames.length} class names`);

    // Categories to test
    const categoriesToTest = [
        { key: 'ultimate_slots_coords', title: 'Ultimate Slots', hasDims: true, paramsKey: null },
        { key: 'standard_slots_coords', title: 'Standard Ability Slots', hasDims: true, paramsKey: null }
    ];

    const allResults = [];

    for (const category of categoriesToTest) {
        if (!coords[category.key]) {
            console.log(`Warning: ${category.key} not found in coordinates`);
            continue;
        }

        console.log('\\n' + '='.repeat(70));
        console.log(`Processing ${category.title}`);
        console.log('='.repeat(70));

        const items = coords[category.key];
        const params = category.paramsKey ? coords[category.paramsKey] : null;

        // Prepare batch
        const crops = [];
        const validIndices = [];

        for (let i = 0; i < items.length; i++) {
            const coord = items[i];
            try {
                const cropBuffer = await cropSlot(screenBuffer, coord, params);
                crops.push(cropBuffer);
                validIndices.push(i);
            } catch (err) {
                console.error(`Error cropping slot ${i}: ${err.message}`);
            }
        }

        if (crops.length === 0) {
            console.log(`No valid crops for ${category.key}`);
            continue;
        }

        console.log(`Processing ${crops.length} slots...`);

        // Preprocess batch
        const imageTensors = [];
        for (const cropBuffer of crops) {
            const tensor = tf.node.decodeImage(cropBuffer, 3);
            const resizedTensor = tf.image.resizeBilinear(tensor, [IMG_HEIGHT, IMG_WIDTH]);
            imageTensors.push(resizedTensor);
        }
        const batchTensor = tf.stack(imageTensors);

        // Run inference
        console.log('Running model inference...');
        const predictions = model.predict(batchTensor);
        const probabilities = await predictions.array();

        // Cleanup tensors
        tf.dispose([batchTensor, predictions, ...imageTensors]);

        // Process results
        const results = [];

        for (let i = 0; i < probabilities.length; i++) {
            const originalIdx = validIndices[i];
            const coord = items[originalIdx];
            const slotProbabilities = probabilities[i];

            const maxProbability = Math.max(...slotProbabilities);
            const predictedIndex = slotProbabilities.indexOf(maxProbability);

            const result = {
                category: category.key,
                index: originalIdx,
                hero_order: coord.hero_order !== undefined ? coord.hero_order : '?',
                is_ultimate: coord.is_ultimate || false,
                confidence: maxProbability,
                predicted_class_idx: predictedIndex,
                predicted_ability: null
            };

            if (maxProbability >= CONFIDENCE_THRESHOLD && predictedIndex < classNames.length) {
                result.predicted_ability = classNames[predictedIndex];
            }

            results.push(result);
            allResults.push(result);
        }

        // Print results
        console.log(`\\n${category.title}:`);
        console.log(`${'Idx'.padEnd(4)} ${'Hero'.padEnd(5)} ${'Ult'.padEnd(4)} ${'Confidence'.padEnd(12)} ${'Predicted Ability'.padEnd(30)}`);
        console.log('-'.repeat(70));

        for (const r of results) {
            const ultMarker = r.is_ultimate ? '*' : '';
            const ability = r.predicted_ability || '(below threshold)';
            console.log(`${String(r.index).padEnd(4)} ${String(r.hero_order).padEnd(5)} ${ultMarker.padEnd(4)} ${r.confidence.toFixed(4).padEnd(12)} ${ability.padEnd(30)}`);
        }

        // Stats
        const highConf = results.filter(r => r.confidence >= CONFIDENCE_THRESHOLD).length;
        const identified = results.filter(r => r.predicted_ability !== null).length;

        console.log(`\\nStats:`);
        console.log(`  Total slots: ${results.length}`);
        console.log(`  High confidence (>=${CONFIDENCE_THRESHOLD}): ${highConf} (${(highConf/results.length*100).toFixed(1)}%)`);
        console.log(`  Identified abilities: ${identified} (${(identified/results.length*100).toFixed(1)}%)`);
    }

    // Save results
    const outputDir = path.join(__dirname, 'output', 'ml_recognition');
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, 'ml_recognition_results.json');
    await fs.writeFile(outputPath, JSON.stringify(allResults, null, 2));
    console.log(`\\nResults saved to: ${outputPath}`);

    // Overall summary
    console.log('\\n' + '='.repeat(70));
    console.log('OVERALL SUMMARY');
    console.log('='.repeat(70));

    const total = allResults.length;
    const highConf = allResults.filter(r => r.confidence >= CONFIDENCE_THRESHOLD).length;
    const identified = allResults.filter(r => r.predicted_ability !== null).length;

    console.log(`Total slots tested: ${total}`);
    console.log(`High confidence predictions: ${highConf} (${(highConf/total*100).toFixed(1)}%)`);
    console.log(`Successfully identified: ${identified} (${(identified/total*100).toFixed(1)}%)`);

    const avgConfidence = allResults.reduce((sum, r) => sum + r.confidence, 0) / total;
    console.log(`Average confidence: ${avgConfidence.toFixed(4)}`);

    console.log('='.repeat(70));
}

// Main
async function main() {
    const args = process.argv.slice(2);

    if (args.length < 3) {
        console.error('Usage: node test_ml_recognition.js <screenshot> <coords_json> <resolution>');
        console.error('Example: node test_ml_recognition.js screenshot.png coords.json 1920x1200');
        process.exit(1);
    }

    const [screenshotPath, coordsPath, resolution] = args;
    const modelPath = path.join(__dirname, '..', 'model', 'tfjs_model', 'model.json');
    const classNamesPath = path.join(__dirname, '..', 'model', 'tfjs_model', 'class_names.json');

    try {
        const coords = await loadCoordinates(coordsPath, resolution);
        await runRecognition(screenshotPath, coords, modelPath, classNamesPath);
    } catch (err) {
        console.error('Error:', err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

main();
