/**
 * @module initUtils
 * @description Manages the conditional visibility of certain UI elements based on
 * whether the application is running in a packaged (production) or
 * development (unpackaged) environment.
 */

/**
 * @type {object}
 * @property {HTMLElement | null} newResolutionSection - Element for submitting new resolution layouts.
 * @property {HTMLElement | null} uploadFailedSamplesButton - Button for uploading failed samples.
 * @property {HTMLElement | null} exportFailedSamplesButton - Button for exporting failed samples.
 * @property {HTMLElement | null} shareSamplesExtButton - Button for sharing samples externally.
 * @description Holds references to DOM elements whose visibility is conditionally managed.
 * Populated by `initConditionalUIManager`.
 */
let dom = {
    newResolutionSection: null,
    uploadFailedSamplesButton: null,
    exportFailedSamplesButton: null,
    shareSamplesExtButton: null,
};

/**
 * @type {object | null}
 * @property {function(): Promise<boolean>} isAppPackaged - Function to check if the app is packaged.
 * @description Reference to the Electron API exposed on the window object,
 * used to determine application packaging status. Populated by `initConditionalUIManager`.
 */
let electronAPI = null;

/**
 * Initializes the InitUtils module with necessary DOM elements and electronAPI.
 * @param {object} elements - DOM element references.
 * @param {HTMLElement} elements.newResolutionSection
 * @param {HTMLElement} elements.uploadFailedSamplesButton
 * @param {HTMLElement} elements.exportFailedSamplesButton
 * @param {HTMLElement} elements.shareSamplesExtButton
 * @param {object} api - The window.electronAPI object.
 */
export function initConditionalUIManager(elements, api) {
    dom = { ...dom, ...elements };
    electronAPI = api;
}

/**
 * Sets visibility of UI elements based on app packaging status.
 */
export async function initConditionalUI() {
    if (!electronAPI || typeof electronAPI.isAppPackaged !== 'function') {
        console.error("[InitUtils] ElectronAPI or isAppPackaged method not available. Cannot apply conditional UI.");
        // As a fallback, ensure conditional elements are hidden if their state is uncertain.
        // This assumes default CSS might show them or they were previously visible.
        Object.values(dom).forEach(element => {
            if (element && element.style) {
                element.style.display = 'none';
            }
        });
        return;
    }

    try {
        const isPackaged = await electronAPI.isAppPackaged();
        if (dom.newResolutionSection) {
            if (isPackaged) {
                console.log('[InitUtils] App is packaged. "Submit New Resolution Layout" section will be visible.');
                dom.newResolutionSection.style.display = 'block';
            } else {
                console.log('[InitUtils] App is not packaged. Hiding "Submit New Resolution Layout" section.');
                dom.newResolutionSection.style.display = 'none';
            }
        }

        if (dom.uploadFailedSamplesButton) {
            if (isPackaged) {
                // Log only if a change from default or specific state is noteworthy
                dom.uploadFailedSamplesButton.style.display = 'inline-flex';
            } else {
                console.log('[InitUtils] App is not packaged. Hiding "Upload Failed Samples" button.');
                dom.uploadFailedSamplesButton.style.display = 'none';
            }
        }

        if (dom.exportFailedSamplesButton) {
            if (!isPackaged) {
                // Log only if a change from default or specific state is noteworthy
                dom.exportFailedSamplesButton.style.display = 'inline-flex';
            } else {
                console.log('[InitUtils] App is packaged. Hiding "Export Failed Samples" button.');
                dom.exportFailedSamplesButton.style.display = 'none';
            }
        }

        if (dom.shareSamplesExtButton) {
            if (!isPackaged) {
                // Log only if a change from default or specific state is noteworthy
                dom.shareSamplesExtButton.style.display = 'inline-flex';
            } else {
                console.log('[InitUtils] App is packaged. Hiding "Share Samples (External)" button.');
                dom.shareSamplesExtButton.style.display = 'none';
            }
        }

    } catch (error) {
        console.error('[Renderer/InitUtils] Error determining if app is packaged for conditional UI:', error);
        if (dom.newResolutionSection) dom.newResolutionSection.style.display = 'none';
        if (dom.uploadFailedSamplesButton) dom.uploadFailedSamplesButton.style.display = 'none';
        if (dom.exportFailedSamplesButton) dom.exportFailedSamplesButton.style.display = 'none';
        if (dom.shareSamplesExtButton) dom.shareSamplesExtButton.style.display = 'none';
    }
}