/**
 * @module translationUtils
 * @description Provides utilities for internationalization (i18n), including
 * fetching translations from a nested object, replacing parameters in
 * translation strings, and applying translations to the DOM.
 */

/**
 * Gets a nested property from an object using a dot-notation string.
 * @param {object} obj - The object to search.
 * @param {string} path - The dot-notation path (e.g., 'a.b.c').
 * @returns {any} The value at the specified path. Returns `undefined` if the path
 *                cannot be fully resolved (e.g., a segment is missing, or an
 *                intermediate value is `null` or not an object). Returns the `path`
 *                argument itself if `path` is initially `null`, `undefined`, or an empty string.
 */
function getNested(obj, path) {
    if (!path) return path; // Handles null, undefined, ''
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

/**
 * Translates a key into a string using the provided translations object.
 * @param {object} translationsObject - The translations object.
 * @param {string} key - The translation key (e.g., 'controlPanel.status.ready').
 * @param {object} [params={}] - Optional parameters to replace in the string (e.g., { count: 5 }).
 *                                Placeholders in the translation string should be like `{paramKey}`.
 * @returns {string} The translated and formatted string. If the key is not found
 *                   in `translationsObject` or the resolved value is not a string,
 *                   the `key` itself is returned as a fallback.
 */
export function translate(translationsObject, key, params = {}) {
    let translatedText = getNested(translationsObject, key);

    if (typeof translatedText !== 'string') {
        console.warn(`[i18n] Translation not found or not a string for key: "${key}". Falling back to key.`);
        return key; // Fallback to the key itself
    }

    for (const [paramKey, paramValue] of Object.entries(params)) {
        // Ensure paramValue is a string or number to avoid 'undefined' or 'null' literal strings in output
        const replacement = (paramValue !== null && paramValue !== undefined) ? String(paramValue) : '';
        translatedText = translatedText.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), replacement);
    }
    return translatedText;
}

/**
 * Applies translations to DOM elements based on `data-i18n` attributes.
 *
 * Elements with a `data-i18n="key"` attribute will have their `textContent`
 * updated with the translation for "key" obtained via `translateFn`.
 *
 * Special handling for `data-i18n-date-param`:
 * If an element has both `data-i18n` and `data-i18n-date-param="dateElementId"`,
 * and an element with `id="dateElementId"` exists as a descendant of the current element,
 * the translation applied to the `data-i18n` element's `firstChild.textContent`
 * will have any `{date}` placeholders removed (e.g., `{date}` becomes an empty string).
 * This is intended for scenarios where the main text is translated but a date component
 * is handled by the separate `dateElementId` element.
 * If the `data-i18n` element has no `firstChild` in this special scenario, a warning is
 * logged, and the modified translation (with `{date}` removed) is applied to the
 * element's `textContent` as a fallback.
 *
 * @param {function(string, object=): string} translateFn - The translation function
 *        to use, which should be pre-configured with the current language's translations.
 *        This function is expected to take a key and optional parameters (for placeholders
 *        other than `{date}`).
 */
export function applyTranslationsToDOM(translateFn) {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        if (!key) {
            console.warn('[i18n] Element found with data-i18n attribute but no key value.', element);
            return; // Skip this element
        }

        const translation = translateFn(key); // Params for translateFn are handled by its definition

        if (translation !== key) { // Only update if translation is different from the key
            const dateParamAttr = element.getAttribute('data-i18n-date-param');
            if (dateParamAttr && element.querySelector(`#${dateParamAttr}`)) {
                const textForDateScenario = translation.replace(/\{date\}/g, ''); // Remove {date} placeholder globally
                if (element.firstChild) {
                    element.firstChild.textContent = textForDateScenario;
                } else {
                    console.warn(`[i18n] Element with key '${key}' and data-i18n-date-param has no firstChild. Applying modified translation to element.textContent.`);
                    element.textContent = textForDateScenario; // Fallback
                }
            } else {
                element.textContent = translation;
            }
        }
    });
}