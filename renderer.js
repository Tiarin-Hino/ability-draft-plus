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

// --- Module State ---
let selectedResolution = ''; // Stores the currently selected screen resolution
const THEMES = { SYSTEM: 'system', LIGHT: 'light', DARK: 'dark' };
let currentUserPreference = THEMES.SYSTEM; // User's explicit choice: 'system', 'light', or 'dark'
let currentSystemPrefersDark = false; // Tracks the OS's preference
let systemDisplayInfo = null; // To store system display info
let currentScreenshotDataUrl = null; // To hold screenshot data for submission

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
        submitNewResolutionButton
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
        customPopupMessage.textContent = `Your resolution ${systemRes} is not supported yet. Please change resolution to a supported one, or submit your resolution to be added.`;
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

    if (disabled && initiatingButton) {
        if (initiatingButton === updateAllDataButton) {
            updateAllDataButton.textContent = 'Updating All Data...';
        } else if (initiatingButton === activateOverlayButton) {
            activateOverlayButton.textContent = 'Activating Overlay...';
        } else if (initiatingButton === exportFailedSamplesButton) {
            exportFailedSamplesButton.textContent = 'Exporting Samples...';
        }
    } else {
        if (updateAllDataButton) updateAllDataButton.textContent = 'Update Windrun Data (Full)';
        if (activateOverlayButton) activateOverlayButton.textContent = 'Activate Overlay';
        if (exportFailedSamplesButton) exportFailedSamplesButton.textContent = 'Export Failed Samples';
    }
}

/**
 * Updates the main status message displayed to the user.
 * @param {string} message - The message to display.
 * @param {boolean} [isError=false] - If true, indicates an error message (could be used for styling).
 */
function updateStatusMessage(message, isError = false) {
    if (statusMessageElement) {
        statusMessageElement.textContent = message;
        statusMessageElement.classList.toggle('error-message', isError);
    }
    console.log(`[RendererStatus] ${isError ? 'Error: ' : ''}${message}`);
}

/**
 * Checks if a status message indicates the end of an operation.
 * Used to re-enable UI controls.
 * @param {string} message - The status message from the main process.
 * @returns {boolean} True if the message indicates completion or failure, false otherwise.
 */
function isOperationFinishedMessage(message) {
    if (!message) return false;
    const lowerMessage = message.toLowerCase();
    const keywords = [
        'complete!', 'error:', 'failed:', 'cancelled',
        'finished successfully!', 'operation halted',
        'export finished', 'export error', 'nothing to do',
        'overlay activated', // Added this as it's an end state for activation
        'overlay activation error'
    ];
    return keywords.some(keyword => lowerMessage.includes(keyword));
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

    // Request available resolutions on load
    window.electronAPI.getAvailableResolutions();

    // --- IPC Event Handlers (Listening to Main Process) ---

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
                    updateStatusMessage(`System resolution ${systemResString} automatically selected.`);
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
            option.textContent = "No resolutions configured";
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
            updateStatusMessage(`Export successful: ${status.filePath}`);
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
        updateStatusMessage('Ready. Overlay closed.');
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
            updateStatusMessage(`Activating overlay for ${selectedResolution}...`);
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
                    newResolutionStatusElement.textContent = 'Hiding window and taking snapshot...';
                    newResolutionStatusElement.style.display = 'block';
                    newResolutionStatusElement.classList.remove('error-message');
                }
                setButtonsState(true, submitNewResolutionButton);
                // Request the screenshot from the main process
                window.electronAPI.requestNewLayoutScreenshot();
            } else {
                if (newResolutionStatusElement) {
                    newResolutionStatusElement.textContent = 'Resolution submission cancelled.';
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
                if (newResolutionStatusElement) newResolutionStatusElement.textContent = 'Submitting layout...';
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