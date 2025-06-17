/**
 * @module themeManager
 * @description Manages the application's theme (light, dark, or system-based).
 * It handles loading and saving user preferences, detecting system preferences,
 * and applying the effective theme to the DOM.
 *
 * Workflow:
 * 1. `initThemeManager` is called with DOM element references. It loads any saved user preference.
 * 2. The application (e.g., main process via IPC) informs the theme manager of the system's
 *    dark mode preference using `updateSystemPreference()`.
 * 3. `applyEffectiveTheme()` is called to update the UI based on the current user choice and system preference.
 *    This should be called after `initThemeManager`, after `updateSystemPreference`, and whenever
 *    the user changes their theme selection or the system theme preference changes.
 */

export const THEMES = { SYSTEM: 'system', LIGHT: 'light', DARK: 'dark' };

/** @type {string} The user's current theme preference (system, light, or dark). */
let currentUserPreference = THEMES.SYSTEM;
/** @type {boolean} Whether the operating system currently prefers a dark color scheme. */
let currentSystemPrefersDark = false;

/** @type {ThemeDOMReferences} References to DOM elements managed by the theme manager. */
let domElements = {
    systemThemeCheckbox: null,
    lightDarkToggle: null,
    manualThemeControlsDiv: null,
    body: null,
};

/**
 * @typedef {object} ThemeDOMReferences
 * @property {HTMLInputElement | null} systemThemeCheckbox - Checkbox to enable/disable system theme following.
 * @property {HTMLInputElement | null} lightDarkToggle - Toggle for manually selecting light/dark theme.
 * @property {HTMLElement | null} manualThemeControlsDiv - Container for manual theme controls.
 * @property {HTMLElement | null} body - The document body element.
 */

/**
 * Initializes the ThemeManager with necessary DOM elements.
 * It loads the user's theme preference from localStorage.
 *
 * Note: This function only loads the preference. `applyEffectiveTheme()` should be called
 * separately to apply the theme to the UI, typically after the system's dark mode
 * preference is also known via `updateSystemPreference()`.
 *
 * @param {ThemeDOMReferences} elements - Object containing DOM element references.
 */
export function initThemeManager(elements) {
    domElements = { ...domElements, ...elements };
    loadUserPreference();
}

/**
 * Loads the user's theme choice from localStorage.
 * @returns {string} The loaded user preference.
 */
export function loadUserPreference() {
    const storedPreference = localStorage.getItem('themeUserChoice');
    if (storedPreference && Object.values(THEMES).includes(storedPreference)) {
        currentUserPreference = storedPreference;
    } else {
        currentUserPreference = THEMES.SYSTEM; // Default to system
    }
    console.log(`[ThemeManager] Loaded user preference: ${currentUserPreference}`);
    return currentUserPreference;
}

/**
 * Saves the user's theme choice to localStorage.
 * @param {string} preference - The theme preference to save (THEMES.SYSTEM, THEMES.LIGHT, THEMES.DARK).
 */
export function saveUserPreference(preference) {
    if (Object.values(THEMES).includes(preference)) {
        currentUserPreference = preference;
        localStorage.setItem('themeUserChoice', preference);
        console.log(`[ThemeManager] Saved user preference: ${currentUserPreference}`);
    } else {
        console.warn(`[ThemeManager] Attempted to save invalid preference: ${preference}`);
    }
}

/**
 * Updates the system's dark mode preference.
 * @param {boolean} prefersDark - True if the system prefers dark mode.
 */
export function updateSystemPreference(prefersDark) {
    currentSystemPrefersDark = prefersDark;
}

/**
 * Applies the effective theme to the UI based on user choice and system preference.
 */
export function applyEffectiveTheme() {
    const { body, systemThemeCheckbox, lightDarkToggle, manualThemeControlsDiv } = domElements;

    if (!body || !systemThemeCheckbox || !lightDarkToggle || !manualThemeControlsDiv) {
        console.error("[ThemeManager] DOM elements not fully initialized for ThemeManager.");
        return;
    }

    let useDarkMode;
    const isSystemPreference = currentUserPreference === THEMES.SYSTEM;

    systemThemeCheckbox.checked = isSystemPreference;
    lightDarkToggle.disabled = isSystemPreference;
    manualThemeControlsDiv.classList.toggle('disabled', isSystemPreference);

    if (isSystemPreference) {
        useDarkMode = currentSystemPrefersDark;
        lightDarkToggle.checked = currentSystemPrefersDark; // Reflects system
    } else { // Manual override (Light or Dark)
        useDarkMode = (currentUserPreference === THEMES.DARK);
        lightDarkToggle.checked = useDarkMode; // Reflects manual choice
    }

    body.classList.toggle('dark-mode', useDarkMode);
    console.log(`[ThemeManager] Effective theme applied: ${useDarkMode ? 'Dark' : 'Light'}. User Pref: ${currentUserPreference}, System Dark: ${currentSystemPrefersDark}`);
}

/** @returns {string} The current user's theme preference. */
export function getCurrentUserPreference() { return currentUserPreference; }

/** @returns {boolean} True if the system currently prefers a dark theme, false otherwise. */
export function getCurrentSystemPrefersDark() { return currentSystemPrefersDark; }

/** @returns {boolean} True if the user preference is set to follow the system theme. */
export function isUsingSystemTheme() {
    return currentUserPreference === THEMES.SYSTEM;
}