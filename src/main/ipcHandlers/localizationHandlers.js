/**
 * @file Registers IPC handlers for localization-related requests from the renderer process.
 * This includes changing the application's language and notifying relevant windows
 * of the updated translations.
 */

const { ipcMain } = require('electron');
const { loadTranslations, getTranslations } = require('../localization');
const windowManager = require('../windowManager');

/**
 * Registers all localization-related IPC handlers.
 */
function registerLocalizationHandlers() {
    /**
     * Handles the 'change-language' IPC call from the renderer.
     * Sets the application's current language, loads the corresponding translations,
     * and then sends the updated translations to both the main window and the overlay window.
     * - Updates the application's language preference.
     * - Reloads translation files for the new language.
     * - Sends 'translations-loaded' with new translation data to active windows.
     * @param {Electron.IpcMainEvent} event - The IPC event (not directly used but part of the signature).
     * @param {string} langCode - The language code (e.g., 'en', 'fr') to switch to.
     */
    ipcMain.on('change-language', async (event, langCode) => {
        await loadTranslations(langCode);
        // Notify all relevant windows of the language change
        [windowManager.getMainWindow(), windowManager.getOverlayWindow()].forEach(win => {
            if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
                win.webContents.send('translations-loaded', getTranslations());
            }
        });
    });
}

module.exports = { registerLocalizationHandlers };