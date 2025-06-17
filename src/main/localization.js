const fs = require('fs').promises;
const path = require('path');
const { BASE_RESOURCES_PATH } = require('../../config'); // Import BASE_RESOURCES_PATH

/**
 * @module localization
 * @description Manages loading and accessing internationalization (i18n) translations
 * for the application. It defaults to 'en' (English) and supports falling back to 'en'
 * if a requested language file is not found or is invalid.
 */

let currentLang = 'en'; // Default language
let translations = {}; // Cache for loaded translations

/**
 * Loads the translation file for the given language code and updates the active language.
 * Attempts to load the specified language. If it fails and the language is not 'en' (English),
 * it will attempt to fall back to 'en'. The internal `currentLang` state is updated to
 * reflect the language of the loaded translations (or 'en' if all attempts fail).
 *
 * @param {string} lang - The desired language code (e.g., 'en', 'ru').
 * @returns {Promise<object>} A promise that resolves to the translations object.
 *                            This object will be empty if loading fails for both the
 *                            requested language and the 'en' fallback.
 */
async function loadTranslations(lang) {
    try {
        const filePath = path.join(BASE_RESOURCES_PATH, 'locales', `${lang}.json`);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        translations = JSON.parse(fileContent);
        currentLang = lang;
        console.log(`[Localization] Successfully loaded translations for '${currentLang}'.`);
    } catch (error) {
        console.error(`[Localization] Could not load translations for '${lang}'. Error: ${error.message}`);
        if (lang !== 'en') {
            console.log(`[Localization] Attempting to fall back to 'en'.`);
            try {
                const fallbackFilePath = path.join(BASE_RESOURCES_PATH, 'locales', 'en.json');
                const fallbackFileContent = await fs.readFile(fallbackFilePath, 'utf-8');
                translations = JSON.parse(fallbackFileContent);
                currentLang = 'en';
                console.log(`[Localization] Successfully loaded fallback translations for 'en'.`);
            } catch (fallbackError) {
                console.error(`[Localization] Could not load fallback translations for 'en'. Error: ${fallbackError.message}`);
                translations = {};
                currentLang = 'en'; // Default to 'en' context if fallback 'en' fails
                console.log(`[Localization] No translations loaded. Active language context set to '${currentLang}'.`);
            }
        } else { // Original lang was 'en' and it failed
            translations = {};
            currentLang = 'en'; // 'en' was attempted
            console.log(`[Localization] Failed to load primary 'en' translations. Active language context set to '${currentLang}'.`);
        }
    }
    return translations;
}

/**
 * Gets the language code of the currently active translations.
 * This reflects the language successfully loaded, or the fallback language ('en')
 * if loading the desired language failed.
 * @returns {string} The current language code (e.g., 'en').
 */
function getCurrentLang() {
    return currentLang;
}
/**
 * Gets the cached translations object for the current language.
 * @returns {object} The translations object. Returns an empty object if no translations are loaded.
 */
function getTranslations() {
    return translations;
}

module.exports = {
    loadTranslations,
    getCurrentLang,
    getTranslations,
};
