// --- DOM Element References ---
const updateAllDataButton = document.getElementById('update-all-data-btn');
const activateOverlayButton = document.getElementById('activate-overlay-btn');
const resolutionSelect = document.getElementById('resolution-select');
const statusMessageElement = document.getElementById('status-message');
const lastUpdatedDateElement = document.getElementById('last-updated-date');
const exportFailedSamplesButton = document.getElementById('export-failed-samples-btn');
const shareFeedbackExtButton = document.getElementById('share-feedback-ext-btn');
const supportDevButton = document.getElementById('support-dev-btn');
const supportWindrunButton = document.getElementById('support-windrun-btn');
const themeToggleButton = document.getElementById('theme-toggle-btn');
const systemThemeCheckbox = document.getElementById('system-theme-checkbox');
const lightDarkToggle = document.getElementById('light-dark-toggle');
const manualThemeControlsDiv = document.querySelector('.manual-theme-controls');
const submitNewResolutionButton = document.getElementById('submit-new-resolution-btn');
const newResolutionSection = document.getElementById('new-resolution-request-section');
const newResolutionStatusElement = document.getElementById('new-resolution-status');


// --- Module State ---
let selectedResolution = ''; // Stores the currently selected screen resolution
const THEMES = { SYSTEM: 'system', LIGHT: 'light', DARK: 'dark' };
let currentUserPreference = THEMES.SYSTEM; // User's explicit choice: 'system', 'light', or 'dark'
let currentSystemPrefersDark = false;    // Tracks the OS's preference

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
    const buttonsToManage = [updateAllDataButton, activateOverlayButton, exportFailedSamplesButton, shareFeedbackExtButton];
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
const configureResolutionRequestUI = async () => {
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
};


// --- Initialization and Electron API Setup ---
if (window.electronAPI) {
    console.log('[Renderer] Electron API available. Setting up listeners.');

    configureResolutionRequestUI();

    loadUserPreference();

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
        resolutionSelect.innerHTML = ''; // Clear existing options

        if (resolutions && resolutions.length > 0) {
            resolutions.forEach(res => {
                const option = document.createElement('option');
                option.value = res;
                option.textContent = res;
                resolutionSelect.appendChild(option);
            });
            // Default to the first resolution if available
            resolutionSelect.value = resolutions[0];
            selectedResolution = resolutions[0];
            console.log(`[Renderer] Resolutions loaded. Defaulted to: ${selectedResolution}`);
            if (activateOverlayButton) activateOverlayButton.disabled = false;
        } else {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "No resolutions found";
            resolutionSelect.appendChild(option);
            console.warn('[Renderer] No resolutions found or provided.');
            if (activateOverlayButton) activateOverlayButton.disabled = true;
        }
        // Enable buttons that don't depend on resolution selection
        if (exportFailedSamplesButton) exportFailedSamplesButton.disabled = false;
        if (shareFeedbackExtButton) shareFeedbackExtButton.disabled = false;
        if (supportDevButton) supportDevButton.disabled = false;
        if (supportWindrunButton) supportWindrunButton.disabled = false;
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

    // --- DOM Event Listeners (User Interactions) ---

    if (resolutionSelect) {
        resolutionSelect.addEventListener('change', (event) => {
            selectedResolution = event.target.value;
            console.log(`[Renderer] Selected resolution: ${selectedResolution}`);
            if (activateOverlayButton) activateOverlayButton.disabled = !selectedResolution;
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
            console.log('[Renderer] "Share Feedback / Samples" button clicked.');
            // The URL is hardcoded here as per the original design, main process handles opening.
            window.electronAPI.openExternalLink('https://forms.gle/9hwyTkMNDubMppW1A');
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
        submitNewResolutionButton.addEventListener('click', () => {
            console.log('[Renderer] "Submit New Resolution Layout" button clicked.');

            const confirmed = confirm(
                "This will take a full-screen snapshot of your primary display to submit your current screen layout for a new resolution.\n\n" +
                "Please ensure:\n" +
                "1. Dota 2 is running.\n" +
                "2. You are in the Ability Draft phase.\n" +
                "3. The game is at the resolution you want to request.\n\n" +
                "In order to get clean screenshot please remove mouse to the side of the screen after pressing OK\n\n" +
                "Proceed with snapshot and submission?"
            );

            if (confirmed) {
                if (newResolutionStatusElement) {
                    newResolutionStatusElement.textContent = 'Capturing screen and preparing submission...';
                    newResolutionStatusElement.style.display = 'block';
                    newResolutionStatusElement.classList.remove('error-message');
                }
                setButtonsState(true, submitNewResolutionButton);
                window.electronAPI.submitNewResolutionSnapshot();
            } else {
                if (newResolutionStatusElement) {
                    newResolutionStatusElement.textContent = 'Resolution submission cancelled.';
                    newResolutionStatusElement.style.display = 'block';
                    newResolutionStatusElement.classList.remove('error-message');
                }
            }
        });
    }

    window.electronAPI.onSubmitNewResolutionStatus((status) => {
        console.log('[Renderer] New Resolution Submission Status:', status);
        if (newResolutionStatusElement) {
            newResolutionStatusElement.textContent = status.message;
            newResolutionStatusElement.style.display = 'block';
            newResolutionStatusElement.classList.toggle('error-message', status.error);
        }
        if (status.error || !status.inProgress) {
            setButtonsState(false);
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
    if (supportDevButton) supportDevButton.disabled = true;
    if (supportWindrunButton) supportWindrunButton.disabled = true;
    document.body.classList.remove('dark-mode'); // Default to light
    if (systemThemeCheckbox) systemThemeCheckbox.disabled = true;
    if (lightDarkToggle) lightDarkToggle.disabled = true;
    if (manualThemeControlsDiv) manualThemeControlsDiv.classList.add('disabled');
}