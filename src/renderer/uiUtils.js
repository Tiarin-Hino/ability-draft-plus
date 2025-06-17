/**
 * @module uiUtils
 * @description Provides utility functions for managing UI elements, states, and messages
 * in the renderer process. This includes enabling/disabling controls, updating status messages,
 * and managing popups. It relies on DOM element references and a translation function
 * initialized via `initUIUtils`.
 */

// DOM Element References
let dom = {
    // Buttons
    activateOverlayButton: null,
    exportFailedSamplesButton: null,
    shareFeedbackExtButton: null,
    shareSamplesExtButton: null,
    submitNewResolutionButton: null,
    supportDevButton: null,
    supportWindrunButton: null,
    updateAllDataButton: null,
    uploadFailedSamplesButton: null,

    // Input Controls, Selects & Related Containers
    languageSelect: null,
    lightDarkToggle: null,
    manualThemeControlsDiv: null, // Container for manual theme toggles
    resolutionSelect: null,
    systemThemeCheckbox: null,

    // Popups & Associated Content Elements
    customPopupMessage: null, // Message element within a popup
    customResolutionPopup: null, // A specific popup

    // Status Display
    statusMessageElement: null,
};

/** @type {function(string, object=): string} */
let translateFn = (key, params = {}) => key; // Default translate function

/**
 * Initializes the UIUtils module with necessary DOM elements and translate function.
 * @param {object} elements - Object containing DOM element references.
 * Each key in `elements` should correspond to a key in the module's `dom` object.
 * @param {function(string, object=): string} tFunction - The translation function.
 */
export function initUIUtils(elements, tFunction) {
    dom = { ...dom, ...elements };
    if (tFunction) {
        translateFn = tFunction;
    }
}

/**
 * Hides the resolution mismatch popup and re-enables global controls.
 */
export function hideResolutionMismatchPopup() {
    if (dom.customResolutionPopup) {
        dom.customResolutionPopup.classList.remove('visible');
        setGlobalControlsDisabledForModal(false);
    }
}

/**
 * Checks if a status message indicates the end of an operation.
 * @param {string | object} message - The status message (string or {key, params} object).
 * @returns {boolean} True if the message indicates completion, error, or a ready state.
 */
export function isOperationFinishedMessage(message) {
    if (!message) return false;
    const messageKey = (typeof message === 'object' && message.key) ? message.key : String(message).toLowerCase();
    // Keywords indicating a finalized state
    const keywords = ['complete', 'error', 'failed', 'cancelled', 'finished', 'halted', 'activated', 'success', 'updated', 'loaded', 'ready'];
    return keywords.some(keyword => messageKey.includes(keyword));
}

/**
 * Sets the enabled/disabled state of common UI controls.
 * @param {boolean} disabled - True to disable controls, false to enable.
 * @param {HTMLElement | null} [initiatingButton=null] - The button that triggered the state change.
 * used to update its text content to a "processing" state.
 */
export function setButtonsState(disabled, initiatingButton = null) {
    const actionButtons = [
        dom.updateAllDataButton, dom.activateOverlayButton,
        dom.exportFailedSamplesButton, dom.uploadFailedSamplesButton,
        dom.shareFeedbackExtButton, dom.shareSamplesExtButton,
        dom.supportDevButton, dom.supportWindrunButton,
        dom.submitNewResolutionButton
    ];

    actionButtons.forEach(btn => {
        if (btn) btn.disabled = disabled;
    });

    if (dom.resolutionSelect) dom.resolutionSelect.disabled = disabled;
    if (dom.languageSelect) dom.languageSelect.disabled = disabled;

    // Update text content for specific buttons based on state
    if (dom.updateAllDataButton) {
        dom.updateAllDataButton.textContent = (disabled && initiatingButton === dom.updateAllDataButton) ?
            translateFn('controlPanel.data.buttonUpdating') : translateFn('controlPanel.data.button');
    }
    if (dom.activateOverlayButton) {
        dom.activateOverlayButton.textContent = (disabled && initiatingButton === dom.activateOverlayButton) ?
            translateFn('controlPanel.activation.activating') : translateFn('controlPanel.activation.button');
    }
    if (dom.exportFailedSamplesButton) {
        dom.exportFailedSamplesButton.textContent = (disabled && initiatingButton === dom.exportFailedSamplesButton) ?
            translateFn('controlPanel.feedback.exportButtonExporting') : translateFn('controlPanel.feedback.exportButton');
    }
}


/**
 * Sets the disabled state for a broader set of controls, typically for modal popups.
 * @param {boolean} disabled - True to disable controls, false to enable.
 */
export function setGlobalControlsDisabledForModal(disabled) {
    const commonButtons = [
        dom.updateAllDataButton, dom.activateOverlayButton,
        dom.exportFailedSamplesButton, dom.uploadFailedSamplesButton,
        dom.shareFeedbackExtButton, dom.shareSamplesExtButton,
        dom.supportDevButton, dom.supportWindrunButton,
        dom.submitNewResolutionButton
    ];
    const otherControls = [
        dom.resolutionSelect, dom.languageSelect,
        dom.systemThemeCheckbox, dom.lightDarkToggle
    ];

    [...commonButtons, ...otherControls].forEach(control => {
        if (control) control.disabled = disabled;
    });

    if (dom.manualThemeControlsDiv && dom.systemThemeCheckbox && dom.lightDarkToggle) {
        const isSystemTheme = dom.systemThemeCheckbox.checked;
        const shouldDisableManualTheme = disabled || isSystemTheme;
        dom.manualThemeControlsDiv.classList.toggle('disabled', shouldDisableManualTheme);
        dom.lightDarkToggle.disabled = shouldDisableManualTheme;
    }
}

/**
 * Shows the resolution mismatch popup with a translated message.
 * Disables global controls while the popup is visible.
 * @param {string} systemRes - The system's current resolution string.
 * @param {string} defaultSelectedRes - The resolution string that was defaulted to in the UI.
 */
export function showResolutionMismatchPopup(systemRes, defaultSelectedRes) {
    if (dom.customResolutionPopup && dom.customPopupMessage) {
        dom.customPopupMessage.textContent = translateFn('controlPanel.popups.resolutionMismatch.message', { systemRes, defaultRes: defaultSelectedRes });
        dom.customResolutionPopup.classList.add('visible');
        setGlobalControlsDisabledForModal(true);
    }
}

/**
 * Updates the main status message displayed to the user.
 * @param {string|object} message - The message string, or an object `{key: string, params?: object}` for translation.
 * @param {boolean} [isError=false] - If true, indicates an error message.
 */
export function updateStatusMessage(message, isError = false) {
    if (dom.statusMessageElement) {
        const textToShow = (typeof message === 'object' && message.key) ? translateFn(message.key, message.params) : String(message);
        dom.statusMessageElement.textContent = textToShow;
        dom.statusMessageElement.classList.toggle('error-message', isError);
    }
    console.log(`[RendererStatus] ${isError ? 'Error: ' : ''}${typeof message === 'object' ? JSON.stringify(message) : String(message)}`);
}

/**
 * Handles application update notifications, primarily managing the "Update Available" popup.
 *
 * @param {object} updateInfo - The update information object from the main process.
 * @param {string} updateInfo.status - The current update status (e.g., 'available', 'downloading', 'downloaded', 'error', 'not-available').
 * @param {string} [updateInfo.message] - A descriptive message for the status.
 * @param {object} [updateInfo.info] - Detailed information about the update (e.g., version, releaseNotes, releaseDate).
 * @param {object} [updateInfo.progress] - Progress information for downloads (e.g., percent).
 * @param {string} [updateInfo.error] - Error message if status is 'error'.
 * @param {HTMLElement | null} popupElement - The main popup container element (e.g., #update-available-popup).
 * @param {object} popupContentElements - Object containing references to elements within the popup.
 * @param {HTMLElement | null} popupContentElements.updatePopupVersion - Element to display the new version.
 * @param {HTMLElement | null} popupContentElements.updatePopupReleaseDate - Element to display the release date.
 * @param {HTMLElement | null} popupContentElements.updatePopupNotes - Element to display release notes.
 * @param {HTMLButtonElement | null} popupContentElements.updatePopupDownloadBtn - The "Download" or "Restart & Install" button.
 * @param {HTMLButtonElement | null} popupContentElements.updatePopupLaterBtn - The "Later" button.
 * @param {function} startDownloadCallback - Callback function to initiate the update download.
 * @param {function} quitAndInstallCallback - Callback function to quit the app and install the update.
 */
export function handleAppUpdateNotifications(
    updateInfo,
    popupElement,
    popupContentElements,
    startDownloadCallback,
    quitAndInstallCallback
) {
    const {
        updatePopupVersion,
        updatePopupReleaseDate,
        updatePopupNotes,
        updatePopupDownloadBtn,
        updatePopupLaterBtn
    } = popupContentElements;

    if (!popupElement || !updatePopupVersion || !updatePopupReleaseDate || !updatePopupNotes || !updatePopupDownloadBtn || !updatePopupLaterBtn) {
        console.error('[UIUtils] handleAppUpdateNotifications: One or more popup DOM elements are missing.');
        return;
    }

    // Default: hide popup and ensure download button is standard
    popupElement.classList.remove('visible');
    updatePopupDownloadBtn.style.display = 'inline-flex';

    switch (updateInfo.status) {
        case 'available':
            if (updateInfo.info) {
                updatePopupVersion.textContent = translateFn('controlPanel.update.popup.version', { version: updateInfo.info.version || 'N/A' });
                updatePopupReleaseDate.textContent = updateInfo.info.releaseDate
                    ? translateFn('controlPanel.update.popup.releaseDate', { date: new Date(updateInfo.info.releaseDate).toLocaleDateString() })
                    : '';
                let notesText = translateFn('controlPanel.update.popup.noNotes');
                if (updateInfo.info.releaseNotes) {
                    if (typeof updateInfo.info.releaseNotes === 'string') notesText = updateInfo.info.releaseNotes;
                    else if (Array.isArray(updateInfo.info.releaseNotes)) notesText = updateInfo.info.releaseNotes.map(note => (typeof note === 'object' && note.note) ? note.note : (typeof note === 'string' ? note : '')).filter(Boolean).join('\n');
                }
                updatePopupNotes.innerHTML = notesText.replace(/\n/g, '<br>');
            } else {
                updatePopupVersion.textContent = translateFn('controlPanel.update.popup.updateAvailable');
                updatePopupReleaseDate.textContent = '';
                updatePopupNotes.textContent = translateFn('controlPanel.update.popup.noDetails');
            }
            updatePopupDownloadBtn.textContent = translateFn('controlPanel.update.popup.download');
            updatePopupDownloadBtn.onclick = () => { popupElement.classList.remove('visible'); startDownloadCallback(); };
            updatePopupDownloadBtn.disabled = false;
            updatePopupLaterBtn.textContent = translateFn('controlPanel.update.popup.later');
            updatePopupLaterBtn.onclick = () => { popupElement.classList.remove('visible'); };
            popupElement.classList.add('visible');
            break;

        case 'downloaded':
            updatePopupVersion.textContent = translateFn('controlPanel.update.popup.readyToInstall', { version: updateInfo.info?.version || '' });
            updatePopupReleaseDate.textContent = '';
            updatePopupNotes.textContent = translateFn('controlPanel.update.popup.restartToInstall');
            updatePopupDownloadBtn.textContent = translateFn('controlPanel.update.popup.restartInstall');
            updatePopupDownloadBtn.onclick = quitAndInstallCallback;
            updatePopupDownloadBtn.disabled = false;
            updatePopupLaterBtn.textContent = translateFn('controlPanel.update.popup.later');
            updatePopupLaterBtn.onclick = () => { popupElement.classList.remove('visible'); };
            popupElement.classList.add('visible');
            break;

        default: // For 'downloading', 'error', 'not-available', 'checking', etc.
            popupElement.classList.remove('visible'); // Ensure popup is hidden
            break;
    }
}