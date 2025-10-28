const { app } = require('electron');
const path = require('path');
const { ML_CONFIDENCE_THRESHOLD } = require('./src/constants');

/** @type {boolean} Indicates if the application is running in a packaged state (e.g., asar). */
const IS_PACKAGED = app.isPackaged;

/** @type {string} The root path of the application. In development, this is the project root. In production, this is the root of the app.asar archive. */
const APP_PATH = app.getAppPath();

/** @type {string} The path to the resources directory. In production, this is typically alongside the app.asar. */
const RESOURCES_PATH = process.resourcesPath;

/**
 * @type {string}
 * Base path for loading resources.
 * In development, it points to the application root (`APP_PATH`).
 * In production (packaged app), it points to `RESOURCES_PATH` (e.g., Contents/Resources on macOS),
 * suitable for files included via `extraResources` in electron-builder.
 */
const BASE_RESOURCES_PATH = IS_PACKAGED ? RESOURCES_PATH : APP_PATH;

/** @type {string} Filename for the SQLite database. */
const DB_FILENAME = 'dota_ad_data.db';
/** @type {string} Filename for the layout coordinates configuration. */
const LAYOUT_COORDS_FILENAME = 'layout_coordinates.json';
/** @type {string} Directory name for the TensorFlow.js model files. */
const MODEL_DIR_NAME = 'tfjs_model';
/** @type {string} Main filename for the TensorFlow.js model. */
const MODEL_FILENAME = 'model.json';
/** @type {string} Filename for the class names used by the ML model. */
const CLASS_NAMES_FILENAME = 'class_names.json';

// Scraper URLs
/** @type {string} URL for scraping high-skill ability data from Windrun.io. */
const ABILITIES_URL = 'https://windrun.io/ability-high-skill';
/** @type {string} URL for scraping ability pair data from Windrun.io. */
const ABILITY_PAIRS_URL = 'https://windrun.io/ability-pairs';

// ML & Scoring Configuration
/** @type {number} Minimum confidence threshold for ML predictions to be considered valid. */
const MIN_PREDICTION_CONFIDENCE = ML_CONFIDENCE_THRESHOLD;
/** @type {number} Number of top-tier ability suggestions to provide. */
const NUM_TOP_TIER_SUGGESTIONS = 10;

// Scoring Weights (sum to 1.0)
/** @type {number} Weight for win rate in the ability scoring algorithm. */
const WEIGHT_WINRATE = 0.4;
/** @type {number} Weight for pick order in the ability scoring algorithm. */
const WEIGHT_PICK_ORDER = 0.6;

// Pick Order Normalization Range (for scoring)
/** @type {number} Minimum pick order value used for normalization in scoring. */
const MIN_PICK_ORDER_FOR_NORMALIZATION = 1.0;
/** @type {number} Maximum pick order value used for normalization in scoring. */
const MAX_PICK_ORDER_FOR_NORMALIZATION = 50.0;

// API Configuration
let apiEndpointUrl;
let clientApiKey;
let clientSharedSecret;

if (IS_PACKAGED) {
    try {
        // In a packaged app, app-config.js is expected to be bundled within the app.asar.
        // APP_PATH (app.getAppPath()) points to the root of the app.asar archive.
        const appConfigPath = path.join(APP_PATH, 'src', 'app-config.js');
        const appConfig = require(appConfigPath);
        apiEndpointUrl = appConfig.API_ENDPOINT_URL;
        clientApiKey = appConfig.CLIENT_API_KEY;
        clientSharedSecret = appConfig.CLIENT_SHARED_SECRET;
    } catch (e) {
        console.error(
            '[Config] FATAL: Could not load app-config.js in packaged app. ' +
            'Ensure it is bundled correctly at "src/app-config.js" within the app.asar. Error: ', e
        );
        // API keys will be undefined, and the check below will log a critical error.
    }
} else {
    // Development: Load from .env file at the project root.
    // APP_PATH (app.getAppPath()) points to the project root in development.
    try {
        require('dotenv').config({ path: path.resolve(APP_PATH, '.env') });
    } catch (e) {
        console.warn('[Config] Could not load .env file for development. API keys might be missing or use defaults.', e.message);
    }
    apiEndpointUrl = process.env.API_ENDPOINT_URL;
    clientApiKey = process.env.CLIENT_API_KEY;
    clientSharedSecret = process.env.CLIENT_SHARED_SECRET;
}

// Critical check for API configuration
if (!apiEndpointUrl || !clientApiKey || !clientSharedSecret) {
    console.error(
        "[Config] CRITICAL ERROR: API Configuration is missing. \n" +
        `  API_ENDPOINT_URL: ${apiEndpointUrl ? 'OK' : 'MISSING'}\n` +
        `  CLIENT_API_KEY: ${clientApiKey ? 'OK' : 'MISSING'}\n` +
        `  CLIENT_SHARED_SECRET: ${clientSharedSecret ? 'OK' : 'MISSING'}\n` +
        "  Please check .env for development or app-config.js generation for production."
    );
    // The application will continue but features requiring these keys may fail.
}

module.exports = {
    ABILITIES_URL,
    ABILITY_PAIRS_URL,
    API_ENDPOINT_URL: apiEndpointUrl,
    APP_PATH,
    BASE_RESOURCES_PATH,
    CLASS_NAMES_FILENAME,
    CLIENT_API_KEY: clientApiKey,
    CLIENT_SHARED_SECRET: clientSharedSecret,
    DB_FILENAME,
    IS_PACKAGED,
    LAYOUT_COORDS_FILENAME,
    MAX_PICK_ORDER_FOR_NORMALIZATION,
    MIN_PREDICTION_CONFIDENCE,
    MIN_PICK_ORDER_FOR_NORMALIZATION,
    MODEL_DIR_NAME,
    MODEL_FILENAME,
    NUM_TOP_TIER_SUGGESTIONS,
    RESOURCES_PATH,
    WEIGHT_PICK_ORDER,
    WEIGHT_WINRATE,
};
