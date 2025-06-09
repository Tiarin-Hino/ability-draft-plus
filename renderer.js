// --- DOM Element References ---
const updateAllDataButton = document.getElementById('update-all-data-btn');
const activateOverlayButton = document.getElementById('activate-overlay-btn');
const resolutionSelect = document.getElementById('resolution-select');
const statusMessageElement = document.getElementById('status-message');
const lastUpdatedDateElement = document.getElementById('last-updated-date');
const exportFailedSamplesButton = document.getElementById('export-failed-samples-btn');
const uploadFailedSamplesButton = document.getElementById('upload-failed-samples-btn');
const failedSamplesUploadStatusElement = document.getElementById('failed-samples-upload-status');
const shareFeedbackExtButton = document.getElementById('share-feedback-ext-btn');
const shareSamplesExtButton = document.getElementById('share-samples-ext-btn');
const supportDevButton = document.getElementById('support-dev-btn');
const supportWindrunButton = document.getElementById('support-windrun-btn');
const themeToggleButton = document.getElementById('theme-toggle-btn');
const systemThemeCheckbox = document.getElementById('system-theme-checkbox');
const lightDarkToggle = document.getElementById('light-dark-toggle');
const manualThemeControlsDiv = document.querySelector('.manual-theme-controls');
const newResolutionSection = document.getElementById('new-resolution-request-section');
const submitNewResolutionButton = document.getElementById('submit-new-resolution-btn');
const newResolutionStatusElement = document.getElementById('new-resolution-status');
const customResolutionPopup = document.getElementById('custom-resolution-popup');
const customPopupMessage = document.getElementById('custom-popup-message');
const customPopupSubmitLayoutBtn = document.getElementById('custom-popup-submit-layout-btn');
const customPopupChangeResBtn = document.getElementById('custom-popup-change-res-btn');
const screenshotPreviewPopup = document.getElementById('screenshot-preview-popup');
const screenshotPreviewImage = document.getElementById('screenshot-preview-image');
const screenshotSubmitBtn = document.getElementById('screenshot-submit-btn');
const screenshotRetakeBtn = document.getElementById('screenshot-retake-btn');
const languageSelect = document.getElementById('language-select');

// --- Module State ---
let selectedResolution = ''; // Stores the currently selected screen resolution
const THEMES = { SYSTEM: 'system', LIGHT: 'light', DARK: 'dark' };
let currentUserPreference = THEMES.SYSTEM; // User's explicit choice: 'system', 'light', or 'dark'
let currentSystemPrefersDark = false; // Tracks the OS's preference
let systemDisplayInfo = null; // To store system display info
let currentScreenshotDataUrl = null; // To hold screenshot data for submission
let currentTranslations = {}; // To hold the loaded translation object

// --- Translation Functions ---

/**
 * Gets a nested property from an object using a dot-notation string.
 * @param {object} obj - The object to search.
 * @param {string} path - The dot-notation path (e.g., 'a.b.c').
 * @returns {any} The value at the path, or the path itself if not found.
 */
function getNested(obj, path) {
    if (!path) return path;
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

/**
 * Translates a key into a string using the loaded translations.
 * @param {string} key - The translation key (e.g., 'controlPanel.status.ready').
 * @param {object} [params={}] - Optional parameters to replace in the string (e.g., { count: 5 }).
 * @returns {string} The translated and formatted string.
 */
function translate(key, params = {}) {
    let translated = getNested(currentTranslations, key);
    if (typeof translated !== 'string') {
        console.warn(`[i18n] Translation not found for key: ${key}`);
        return key; // Fallback to the key itself
    }
    for (const [paramKey, paramValue] of Object.entries(params)) {
        translated = translated.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), paramValue);
    }
    return translated;
}

/**
 * Applies all translations to the document based on data-i18n attributes.
 */
function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const translation = translate(key);
        if (translation !== key) {
            // Check for date param to avoid overwriting the span
            if (element.hasAttribute('data-i18n-date-param')) {
                const dateSpan = element.querySelector(`#${element.getAttribute('data-i18n-date-param')}`);
                if (dateSpan) {
                    element.firstChild.textContent = translation.replace(/\{date\}/, '');
                }
            } else {
                element.textContent = translation;
            }
        }
    });
}


/**
 * Overrides setButtonsState to temporarily also consider other controls for a modal state.
 * This makes the resolution mismatch popup modal.
 * @param {boolean} disabled - True to disable controls, false to enable.
 */
function setGlobalControlsDisabledForModal(disabled) {
    const commonButtons = [
        updateAllDataButton, activateOverlayButton, exportFailedSamplesButton,
        shareFeedbackExtButton, uploadFailedSamplesButton, shareSamplesExtButton
    ];
    const otherControls = [
        resolutionSelect, systemThemeCheckbox, lightDarkToggle,
        supportDevButton, supportWindrunButton,
        submitNewResolutionButton, languageSelect
    ];

    commonButtons.forEach(btn => {
        if (btn) btn.disabled = disabled;
    });
    otherControls.forEach(control => {
        if (control) control.disabled = disabled;
    });

    if (manualThemeControlsDiv) {
        const isSystemTheme = systemThemeCheckbox ? systemThemeCheckbox.checked : true;
        const shouldDisableManualTheme = disabled || isSystemTheme;
        manualThemeControlsDiv.classList.toggle('disabled', shouldDisableManualTheme);
        if (lightDarkToggle) {
            lightDarkToggle.disabled = shouldDisableManualTheme;
        }
    }
}

/**
 * Shows the custom resolution mismatch pop-up.
 * @param {string} systemRes - The user's detected system resolution string.
 * @param {string} defaultSelectedRes - The resolution string that was defaulted to in the dropdown.
 */
function showResolutionMismatchPopup(systemRes, defaultSelectedRes) {
    if (customResolutionPopup && customPopupMessage) {
        customPopupMessage.textContent = translate('controlPanel.popups.resolutionMismatch.message', {
            systemRes,
            defaultRes: defaultSelectedRes
        });
        customResolutionPopup.classList.add('visible');
        setGlobalControlsDisabledForModal(true);
    }
}

/**
 * Hides the custom resolution mismatch pop-up.
 */
function hideResolutionMismatchPopup() {
    if (customResolutionPopup) {
        customResolutionPopup.classList.remove('visible');
        setGlobalControlsDisabledForModal(false);
    }
}

/**
 * Loads the user's theme choice from localStorage.
 */
function loadUserPreference() {
    const storedPreference = localStorage.getItem('themeUserChoice');
    if (storedPreference && Object.values(THEMES).includes(storedPreference)) {
        currentUserPreference = storedPreference;
    } else {
        currentUserPreference = THEMES.SYSTEM; // Default to system if nothing valid is stored
    }
    console.log(`[Theme] Loaded user preference: ${currentUserPreference}`);
}

/**
 * Saves the user's theme choice to localStorage.
 * @param {string} preference - The theme preference to save (THEMES.SYSTEM, THEMES.LIGHT, THEMES.DARK).
 */
function saveUserPreference(preference) {
    currentUserPreference = preference;
    localStorage.setItem('themeUserChoice', preference);
    console.log(`[Theme] Saved user preference: ${currentUserPreference}`);
}

/**
 * Applies the effective theme to the UI based on user choice and system preference.
 * Updates the state of the toggle switches.
 */
function applyEffectiveTheme() {
    let useDarkMode;

    if (currentUserPreference === THEMES.SYSTEM) {
        useDarkMode = currentSystemPrefersDark;
        if (systemThemeCheckbox) systemThemeCheckbox.checked = true;
        if (lightDarkToggle) {
            lightDarkToggle.checked = currentSystemPrefersDark;
            lightDarkToggle.disabled = true;
        }
        if (manualThemeControlsDiv) manualThemeControlsDiv.classList.add('disabled');
    } else { // Manual override (Light or Dark)
        useDarkMode = (currentUserPreference === THEMES.DARK);
        if (systemThemeCheckbox) systemThemeCheckbox.checked = false;
        if (lightDarkToggle) {
            lightDarkToggle.checked = useDarkMode;
            lightDarkToggle.disabled = false;
        }
        if (manualThemeControlsDiv) manualThemeControlsDiv.classList.remove('disabled');
    }

    if (useDarkMode) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    console.log(`[Theme] Effective theme applied: ${useDarkMode ? 'Dark' : 'Light'}. User Pref: ${currentUserPreference}, System Dark: ${currentSystemPrefersDark}`);
}

/**
 * Sets the enabled/disabled state of UI controls and updates button text.
 * @param {boolean} disabled - True to disable controls, false to enable.
 * @param {HTMLElement | null} [initiatingButton=null] - The button that triggered the state change, to update its text.
 */
function setButtonsState(disabled, initiatingButton = null) {
    const buttonsToManage = [updateAllDataButton, activateOverlayButton, exportFailedSamplesButton, shareFeedbackExtButton, shareSamplesExtButton];
    buttonsToManage.forEach(btn => {
        if (btn) btn.disabled = disabled;
    });
    if (resolutionSelect) resolutionSelect.disabled = disabled;
    if (languageSelect) languageSelect.disabled = disabled;

    if (disabled && initiatingButton) {
        if (initiatingButton === updateAllDataButton) {
            updateAllDataButton.textContent = translate('controlPanel.data.buttonUpdating');
        } else if (initiatingButton === activateOverlayButton) {
            activateOverlayButton.textContent = translate('controlPanel.activation.activating');
        } else if (initiatingButton === exportFailedSamplesButton) {
            exportFailedSamplesButton.textContent = 'Exporting Samples...'; // TODO: Localize
        }
    } else {
        if (updateAllDataButton) updateAllDataButton.textContent = translate('controlPanel.data.button');
        if (activateOverlayButton) activateOverlayButton.textContent = translate('controlPanel.activation.button');
        if (exportFailedSamplesButton) exportFailedSamplesButton.textContent = translate('controlPanel.feedback.exportButton');
    }
}

/**
 * Updates the main status message displayed to the user.
 * @param {string|object} message - The message string or an object {key, params}.
 * @param {boolean} [isError=false] - If true, indicates an error message (could be used for styling).
 */
function updateStatusMessage(message, isError = false) {
    if (statusMessageElement) {
        let textToShow;
        if (typeof message === 'object' && message.key) {
            textToShow = translate(message.key, message.params);
        } else {
            textToShow = message;
        }

        statusMessageElement.textContent = textToShow;
        statusMessageElement.classList.toggle('error-message', isError);
    }
    console.log(`[RendererStatus] ${isError ? 'Error: ' : ''}${typeof message === 'object' ? JSON.stringify(message) : message}`);
}

/**
 * Checks if a status message indicates the end of an operation.
 * @param {string | object} message - The status message from the main process.
 * @returns {boolean} True if the message indicates completion or failure, false otherwise.
 */
function isOperationFinishedMessage(message) {
    if (!message) return false;

    // Handle both plain strings and new object format
    const messageKey = (typeof message === 'object' && message.key) ? message.key : message.toString().toLowerCase();

    const keywords = [
        'complete', 'error', 'failed', 'cancelled', 'finished', 'halted', 'activated'
    ];
    return keywords.some(keyword => messageKey.includes(keyword));
}

// Function to set visibility of the "New Resolution Request" section
const initConditionalUI = async () => {
    if (newResolutionSection) { // Check if the section element exists
        try {
            const isPackaged = await window.electronAPI.isAppPackaged();
            if (isPackaged) {
                // In a packaged app, the section should be visible
                console.log('[Renderer] App is packaged. "Submit New Resolution Layout" section will be visible.');
                newResolutionSection.style.display = 'block'; // Or remove this line if 'block' is the CSS default
            } else {
                // In development (not packaged), hide the entire section
                console.log('[Renderer] App is not packaged. Hiding "Submit New Resolution Layout" section.');
                newResolutionSection.style.display = 'none';
            }
        } catch (error) {
            console.error('[Renderer] Error determining if app is packaged:', error);
            // Fallback: hide the section if there's an error, to be safe in dev
            newResolutionSection.style.display = 'none';
        }
    } else {
        console.warn('[Renderer] "new-resolution-request-section" element not found.');
    }

    if (uploadFailedSamplesButton) {
        try {
            const isPackaged = await window.electronAPI.isAppPackaged();
            if (isPackaged) {
                uploadFailedSamplesButton.style.display = 'inline-flex';
            } else {
                console.log('[Renderer] App is not packaged. Hiding "Upload Failed Samples" button.');
                uploadFailedSamplesButton.style.display = 'none';
            }
        } catch (error) {
            console.error("[Renderer] Error checking if app is packaged for upload button:", error);
            uploadFailedSamplesButton.style.display = 'none';
        }
    } else {
        console.warn('[Renderer] "upload-failed-samples-btn" element not found.');
    }

    if (exportFailedSamplesButton) {
        try {
            const isPackaged = await window.electronAPI.isAppPackaged();
            if (!isPackaged) {
                exportFailedSamplesButton.style.display = 'inline-flex';
            } else {
                console.log('[Renderer] App is not packaged. Hiding "Export Failed Samples" button.');
                exportFailedSamplesButton.style.display = 'none';
            }
        } catch (error) {
            console.error("[Renderer] Error checking if app is packaged for export button:", error);
            exportFailedSamplesButton.style.display = 'none';
        }
    } else {
        console.warn('[Renderer] "upload-failed-samples-btn" element not found.');
    }

    if (shareSamplesExtButton) {
        try {
            const isPackaged = await window.electronAPI.isAppPackaged();
            if (!isPackaged) {
                shareSamplesExtButton.style.display = 'inline-flex';
            } else {
                console.log('[Renderer] App is not packaged. Hiding "Share Failed Samples" button.');
                shareSamplesExtButton.style.display = 'none';
            }
        } catch (error) {
            console.error("[Renderer] Error checking if app is packaged for share failed samples button:", error);
            shareSamplesExtButton.style.display = 'none';
        }
    } else {
        console.warn('[Renderer] "upload-failed-samples-btn" element not found.');
    }
};


// --- Initialization and Electron API Setup ---
if (window.electronAPI) {
    console.log('[Renderer] Electron API available. Setting up listeners.');

    initConditionalUI();
    loadUserPreference();

    window.electronAPI.getSystemDisplayInfo()
        .then(info => {
            systemDisplayInfo = info;
            console.log('[Renderer] System Display Info received:', systemDisplayInfo);
            window.electronAPI.getAvailableResolutions();
        })
        .catch(error => {
            console.error('[Renderer] Error getting system display info:', error);
            updateStatusMessage('Could not retrieve system display info. Please select resolution manually.', true);
            window.electronAPI.getAvailableResolutions();
        });

    // --- IPC Event Handlers (Listening to Main Process) ---

    window.electronAPI.onTranslationsLoaded((translations) => {
        console.log('[Renderer] Translations loaded/updated.');
        currentTranslations = translations;
        applyTranslations();
    });

    // Listener for status updates from the failed samples upload process
    window.electronAPI.onUploadFailedSamplesStatus((status) => {
        console.log('[Renderer] Failed Samples Upload Status:', status);
        if (failedSamplesUploadStatusElement) {
            failedSamplesUploadStatusElement.textContent = status.message;
            failedSamplesUploadStatusElement.style.display = 'block';
            failedSamplesUploadStatusElement.classList.toggle('error-message', status.error);
        }
        if (status.error || !status.inProgress) {
            setButtonsState(false);
        }
    });

    // Get initial system theme and apply
    window.electronAPI.onInitialSystemTheme(settings => {
        console.log('[Theme] Received initial system theme settings:', settings);
        currentSystemPrefersDark = settings.shouldUseDarkColors;
        applyEffectiveTheme(); // Apply theme based on loaded user pref and initial system pref
    });

    // Listen for live system theme changes from main process
    window.electronAPI.onSystemThemeUpdated(settings => {
        console.log('[Theme] System theme updated by OS:', settings);
        const oldSystemPrefersDark = currentSystemPrefersDark;
        currentSystemPrefersDark = settings.shouldUseDarkColors;
        // Only re-apply if user preference is 'system' and the system preference actually changed
        if (currentUserPreference === THEMES.SYSTEM && oldSystemPrefersDark !== currentSystemPrefersDark) {
            applyEffectiveTheme();
        }
    });

    // Request initial data on load
    window.electronAPI.getInitialData();

    window.electronAPI.onAvailableResolutions((resolutions) => {
        if (!resolutionSelect) return;
        resolutionSelect.innerHTML = '';
        let resolutionEffectivelySelected = false;

        if (resolutions && resolutions.length > 0) {
            resolutions.forEach(res => {
                const option = document.createElement('option');
                option.value = res;
                option.textContent = res;
                resolutionSelect.appendChild(option);
            });

            if (systemDisplayInfo && systemDisplayInfo.resolutionString) {
                const systemResString = systemDisplayInfo.resolutionString;
                if (resolutions.includes(systemResString)) {
                    resolutionSelect.value = systemResString;
                    selectedResolution = systemResString;
                    updateStatusMessage({ key: 'controlPanel.status.resolutionsLoaded', params: { res: systemResString } });
                    resolutionEffectivelySelected = true;
                } else {
                    resolutionSelect.value = resolutions[0];
                    selectedResolution = resolutions[0];
                    showResolutionMismatchPopup(systemResString, selectedResolution);
                }
            } else {
                resolutionSelect.value = resolutions[0];
                selectedResolution = resolutions[0];
                updateStatusMessage(`Defaulted to ${selectedResolution}. Please verify or select your Dota 2 resolution.`);
                resolutionEffectivelySelected = true;
            }
        } else {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = translate('controlPanel.status.resolutionsNone');
            resolutionSelect.appendChild(option);
            selectedResolution = "";

            let errorMsg = "No supported resolutions found. ";
            if (systemDisplayInfo && systemDisplayInfo.resolutionString) {
                errorMsg += `Your system resolution ${systemDisplayInfo.resolutionString} is also not supported. `;
            }
            errorMsg += "Please use 'Submit Current Screen Layout'.";
            updateStatusMessage(errorMsg, true);
            resolutionEffectivelySelected = false;
        }

        if (activateOverlayButton) {
            activateOverlayButton.disabled = !selectedResolution || (customResolutionPopup && customResolutionPopup.classList.contains('visible'));
        }

        if (exportFailedSamplesButton && exportFailedSamplesButton.style.display !== 'none') exportFailedSamplesButton.disabled = false;
        if (uploadFailedSamplesButton && uploadFailedSamplesButton.style.display !== 'none') uploadFailedSamplesButton.disabled = false;
        if (shareFeedbackExtButton) shareFeedbackExtButton.disabled = false;
        if (shareSamplesExtButton) shareSamplesExtButton.disabled = false;
        if (supportDevButton) supportDevButton.disabled = false;
        if (supportWindrunButton) supportWindrunButton.disabled = false;
        if (submitNewResolutionButton && newResolutionSection && newResolutionSection.style.display !== 'none') submitNewResolutionButton.disabled = false;
    });

    window.electronAPI.onUpdateStatus((message) => {
        updateStatusMessage(message);
        if (isOperationFinishedMessage(message)) {
            setButtonsState(false); // Re-enable all buttons
        }
    });

    window.electronAPI.onExportFailedSamplesStatus((status) => {
        console.log('[Renderer] Export Failed Samples Status:', status);
        updateStatusMessage(status.message, status.error);
        if (status.error || !status.inProgress) {
            setButtonsState(false); // Re-enable buttons
        }
        if (!status.error && !status.inProgress && status.filePath) {
            updateStatusMessage({ key: 'ipcMessages.exportSuccess', params: { count: status.count, filePath: status.filePath } });
        }
    });

    window.electronAPI.onLastUpdatedDate((dateStr) => {
        if (lastUpdatedDateElement) {
            lastUpdatedDateElement.textContent = dateStr || 'Never';
        }
    });

    window.electronAPI.onSetUIDisabledState((isDisabled) => {
        setButtonsState(isDisabled, isDisabled ? updateAllDataButton : null);
        if (isDisabled) {
            updateStatusMessage("Performing initial data synchronization with Windrun.io...");
            if (updateAllDataButton) updateAllDataButton.textContent = 'Syncing Data...';
        }
    });

    window.electronAPI.onScanResults((results) => {
        // This primarily handles errors during overlay activation or if main process sends error status for a scan.
        // Most detailed scan results are for the overlay window itself.
        console.log('[Renderer] Scan-related message from main:', results);
        if (results && results.error) {
            setButtonsState(false); // Re-enable UI on error
            const errorMessage = `Overlay/Scan Error: ${results.error}\nTarget Resolution: ${results.resolution || selectedResolution || 'N/A'}`;
            updateStatusMessage(errorMessage, true);
        }
        // Non-error scan results are typically handled by overlayRenderer.js
    });

    window.electronAPI.onOverlayClosedResetUI(() => {
        console.log('[Renderer] Overlay closed signal received. Re-enabling main window UI.');
        setButtonsState(false);
        updateStatusMessage({ key: 'controlPanel.status.ready' });
    });

    window.electronAPI.onNewLayoutScreenshot((dataUrl) => {
        if (dataUrl) {
            currentScreenshotDataUrl = dataUrl;
            if (screenshotPreviewImage) screenshotPreviewImage.src = dataUrl;
            if (screenshotPreviewPopup) screenshotPreviewPopup.classList.add('visible'); // Use the .visible class
            setGlobalControlsDisabledForModal(true); // Disable background controls
            if (newResolutionStatusElement) newResolutionStatusElement.textContent = 'Screenshot captured. Please review.';
        } else {
            updateStatusMessage('Failed to capture screenshot.', true);
            setButtonsState(false);
        }
    });

    // --- DOM Event Listeners (User Interactions) ---

    if (languageSelect) {
        languageSelect.addEventListener('change', (event) => {
            const langCode = event.target.value;
            console.log(`[Renderer] Language changed to: ${langCode}`);
            window.electronAPI.changeLanguage(langCode);
        });
    }

    if (customPopupChangeResBtn) {
        customPopupChangeResBtn.addEventListener('click', () => {
            hideResolutionMismatchPopup();
            if (resolutionSelect) {
                resolutionSelect.focus();
                updateStatusMessage('Please select a supported resolution from the dropdown.');
            }
            if (activateOverlayButton) {
                activateOverlayButton.disabled = !selectedResolution;
            }
        });
    }

    if (uploadFailedSamplesButton) {
        uploadFailedSamplesButton.addEventListener('click', () => {
            console.log('[Renderer] "Upload Failed Samples" button clicked.');
            const confirmed = confirm(
                "This will zip all images in your 'failed-samples' directory and upload them for model improvement analysis.\n\n" +
                "Proceed with zipping and uploading?"
            );

            if (confirmed) {
                if (failedSamplesUploadStatusElement) {
                    failedSamplesUploadStatusElement.textContent = 'Zipping and preparing upload...';
                    failedSamplesUploadStatusElement.style.display = 'block';
                    failedSamplesUploadStatusElement.classList.remove('error-message');
                }
                setButtonsState(true, uploadFailedSamplesButton);
                window.electronAPI.uploadFailedSamples();
            } else {
                if (failedSamplesUploadStatusElement) {
                    failedSamplesUploadStatusElement.textContent = 'Upload cancelled.';
                    failedSamplesUploadStatusElement.style.display = 'block';
                    failedSamplesUploadStatusElement.classList.remove('error-message');
                }
            }
        });
    }

    if (customPopupSubmitLayoutBtn) {
        customPopupSubmitLayoutBtn.addEventListener('click', () => {
            hideResolutionMismatchPopup();

            if (newResolutionSection && newResolutionSection.style.display !== 'none' && submitNewResolutionButton) {
                console.log('[Renderer] Mismatch popup "Submit Resolution" delegating to main submit button.');
                submitNewResolutionButton.click();
            } else {
                console.warn('[Renderer] Mismatch popup "Submit Resolution": Main submit section not visible. User will be prompted directly.');
                const directConfirmMessage = `Your resolution is not supported. ` +
                    `Do you want to submit this resolution - ${systemDisplayInfo?.width || 'auto'}x${systemDisplayInfo?.height || 'auto'}?` +
                    "\n\nPlease ensure Dota 2 is open and all abilities are loaded and not picked at the draft screen. Easiest way is to start empty Ability Draft lobby." +
                    "\n\nMove mouse aside after clicking OK for a clean snapshot.\n\n" +
                    "Proceed with snapshot and submission?";

                const confirmed = confirm(directConfirmMessage);
                if (confirmed) {
                    updateStatusMessage('Capturing screen and preparing submission for new layout...', false);
                    setButtonsState(true, null);
                    // CHANGED: Use the new, correct IPC channel
                    window.electronAPI.requestNewLayoutScreenshot();
                } else {
                    updateStatusMessage('Layout submission cancelled by user.', false);
                }
            }
        });
    }

    if (resolutionSelect) {
        resolutionSelect.addEventListener('change', (event) => {
            selectedResolution = event.target.value;
            console.log(`[Renderer] Selected resolution: ${selectedResolution}`);
            if (activateOverlayButton) {
                activateOverlayButton.disabled = !selectedResolution;
            }
        });
    }

    if (updateAllDataButton) {
        updateAllDataButton.addEventListener('click', () => {
            console.log('[Renderer] "Update Windrun Data" button clicked.');
            updateStatusMessage('Requesting Windrun.io data update...');
            setButtonsState(true, updateAllDataButton);
            window.electronAPI.scrapeAllWindrunData();
        });
    }

    if (activateOverlayButton) {
        activateOverlayButton.addEventListener('click', () => {
            if (!selectedResolution) {
                updateStatusMessage('Please select a game resolution first.', true);
                return;
            }
            console.log(`[Renderer] "Activate Overlay" button clicked for resolution: ${selectedResolution}`);
            updateStatusMessage({ key: 'controlPanel.activation.activating' });
            setButtonsState(true, activateOverlayButton);
            window.electronAPI.activateOverlay(selectedResolution);
        });
    }

    if (exportFailedSamplesButton) {
        exportFailedSamplesButton.addEventListener('click', () => {
            console.log('[Renderer] "Export Failed Samples" button clicked.');
            updateStatusMessage('Preparing to export failed samples...');
            setButtonsState(true, exportFailedSamplesButton);
            window.electronAPI.exportFailedSamples();
        });
    }

    if (shareFeedbackExtButton) {
        shareFeedbackExtButton.addEventListener('click', () => {
            console.log('[Renderer] "Share Feedback" button clicked.');
            window.electronAPI.openExternalLink('https://tiarinhino.com/feedback.html');
        });
    }

    if (shareSamplesExtButton) {
        shareSamplesExtButton.addEventListener('click', () => {
            console.log('[Renderer] "Share Samples" button clicked.');
            window.electronAPI.openExternalLink('https://forms.gle/14Fmz6py7dAMMhKW9');
        });
    }

    if (supportDevButton) {
        supportDevButton.addEventListener('click', () => {
            console.log('[Renderer] "Support Developer" button clicked.');
            window.electronAPI.openExternalLink('https://ko-fi.com/tiarinhino');
        });
    }

    if (supportWindrunButton) {
        supportWindrunButton.addEventListener('click', () => {
            console.log('[Renderer] "Support Windrun.io" button clicked.');
            window.electronAPI.openExternalLink('https://ko-fi.com/datdota');
        });
    }

    if (systemThemeCheckbox) {
        systemThemeCheckbox.addEventListener('change', () => {
            if (systemThemeCheckbox.checked) {
                saveUserPreference(THEMES.SYSTEM);
            } else {
                // When unchecking "Use System", switch to manual mode based on current light/dark toggle state
                saveUserPreference(lightDarkToggle.checked ? THEMES.DARK : THEMES.LIGHT);
            }
            applyEffectiveTheme();
        });
    }

    if (lightDarkToggle) {
        lightDarkToggle.addEventListener('click', () => { // Listen to click for immediate visual feedback before change fires
            if (lightDarkToggle.disabled) return; // Should not happen if UI state is correct but good safeguard

            // If system preference was active, clicking this means user wants manual control
            if (currentUserPreference === THEMES.SYSTEM) {
                if (systemThemeCheckbox) systemThemeCheckbox.checked = false; // Uncheck system pref
            }
            saveUserPreference(lightDarkToggle.checked ? THEMES.DARK : THEMES.LIGHT);
            applyEffectiveTheme();
        });
    }

    if (submitNewResolutionButton) {
        submitNewResolutionButton.addEventListener('click', async () => {
            console.log('[Renderer] Section "Submit Current Screen Layout" button clicked.');

            let currentResInfo = systemDisplayInfo;
            if (!currentResInfo) {
                try { currentResInfo = await window.electronAPI.getSystemDisplayInfo(); systemDisplayInfo = currentResInfo; }
                catch (e) { console.error("Failed to get system info for confirmation", e); }
            }
            const resolutionString = currentResInfo ? `${currentResInfo.width}x${currentResInfo.height}` : "your current resolution";
            const scaleFactorString = currentResInfo ? `(Display Scale: ${Math.round(currentResInfo.scaleFactor * 100)}%)` : "";

            const confirmed = confirm(
                `This will take a full-screen snapshot for ${resolutionString} ${scaleFactorString} to submit your current screen layout.\n\n` +
                "Please ensure:\n" +
                "1. Dota 2 is running in the Ability Draft phase.\n" +
                `2. The game is at the resolution you want to add (${resolutionString}).\n\n` +
                "Move mouse aside after clicking OK for a clean snapshot.\n\n" +
                "Proceed with snapshot and submission?"
            );

            if (confirmed) {
                if (newResolutionStatusElement) {
                    newResolutionStatusElement.textContent = translate('controlPanel.newResolution.statusTakingSnapshot');
                    newResolutionStatusElement.style.display = 'block';
                    newResolutionStatusElement.classList.remove('error-message');
                }
                setButtonsState(true, submitNewResolutionButton);
                // Request the screenshot from the main process
                window.electronAPI.requestNewLayoutScreenshot();
            } else {
                if (newResolutionStatusElement) {
                    newResolutionStatusElement.textContent = translate('controlPanel.newResolution.statusCancelled');
                    newResolutionStatusElement.style.display = 'block';
                    newResolutionStatusElement.classList.remove('error-message');
                }
            }
        });
    }

    if (screenshotRetakeBtn) {
        screenshotRetakeBtn.addEventListener('click', () => {
            if (screenshotPreviewPopup) screenshotPreviewPopup.classList.remove('visible'); // Use the .visible class
            currentScreenshotDataUrl = null; // Clear old data

            if (newResolutionStatusElement) newResolutionStatusElement.textContent = 'Hiding window and taking new snapshot...';
            // The UI is already disabled, just request a new screenshot
            window.electronAPI.requestNewLayoutScreenshot();
        });
    }

    if (screenshotSubmitBtn) {
        screenshotSubmitBtn.addEventListener('click', () => {
            if (currentScreenshotDataUrl) {
                if (screenshotPreviewPopup) screenshotPreviewPopup.classList.remove('visible'); // Use the .visible class
                if (newResolutionStatusElement) newResolutionStatusElement.textContent = translate('controlPanel.newResolution.statusSubmitting');
                // Send the confirmed screenshot data to the main process for API submission
                window.electronAPI.submitConfirmedLayout(currentScreenshotDataUrl);
            }
        });
    }

    window.electronAPI.onSubmitNewResolutionStatus((status) => {
        console.log('[Renderer] New Resolution Submission Status:', status);
        // This status can come from either the modal's submit or the section's submit
        // Update the visible status element. If the section is visible, update its status.
        // Otherwise, update the main status message.
        let statusElemToUse = null;
        if (newResolutionSection && newResolutionSection.style.display !== 'none' && newResolutionStatusElement) {
            statusElemToUse = newResolutionStatusElement;
        } else if (statusMessageElement) { // Fallback to main status if section is hidden
            // Prepend context to main status message
            // statusMessageElement.textContent = `Layout Submission: ${status.message}`;
            // statusMessageElement.classList.toggle('error-message', status.error);
            // updateStatusMessage handles this better.
        }

        if (statusElemToUse) {
            statusElemToUse.textContent = status.message;
            statusElemToUse.style.display = 'block';
            statusElemToUse.classList.toggle('error-message', status.error);
        } else {
            // If no specific status element is visible (e.g. section is hidden and mismatch popup initiated this)
            // use the general updateStatusMessage
            updateStatusMessage(`Layout Submission: ${status.message}`, status.error);
        }

        if (!status.inProgress) { // Operation finished
            setButtonsState(false);
            setGlobalControlsDisabledForModal(false); // Make sure to re-enable everything
        }
    });

} else {
    // Critical error: Electron API not exposed
    console.error('[Renderer] FATAL: Electron API not found. Preload script might not be configured or failed.');
    updateStatusMessage('Error: Application setup issue. Cannot communicate with main process.', true);
    setButtonsState(true); // Disable all controls
    if (lastUpdatedDateElement) lastUpdatedDateElement.textContent = 'Error';
    if (activateOverlayButton) activateOverlayButton.disabled = true;
    if (exportFailedSamplesButton) exportFailedSamplesButton.disabled = true;
    if (shareFeedbackExtButton) shareFeedbackExtButton.disabled = true;
    if (shareSamplesExtButton) shareSamplesExtButton.disabled = true;
    if (supportDevButton) supportDevButton.disabled = true;
    if (supportWindrunButton) supportWindrunButton.disabled = true;
    document.body.classList.remove('dark-mode'); // Default to light
    if (systemThemeCheckbox) systemThemeCheckbox.disabled = true;
    if (lightDarkToggle) lightDarkToggle.disabled = true;
    if (manualThemeControlsDiv) manualThemeControlsDiv.classList.add('disabled');
}