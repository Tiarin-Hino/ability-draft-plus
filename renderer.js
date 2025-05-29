// renderer.js - Manages the main control panel UI and interactions

// --- DOM Element References ---
const updateAllDataButton = document.getElementById('update-all-data-btn');
const activateOverlayButton = document.getElementById('activate-overlay-btn');
const resolutionSelect = document.getElementById('resolution-select');
const statusMessageElement = document.getElementById('status-message'); // Renamed for clarity
const scanResultsArea = document.getElementById('scan-results'); // Note: This element seems to be for errors in this context
const lastUpdatedDateElement = document.getElementById('last-updated-date');
const exportFailedSamplesButton = document.getElementById('export-failed-samples-btn');

// --- Module State ---
let selectedResolution = ''; // Stores the currently selected screen resolution

/**
 * Sets the enabled/disabled state of UI controls and updates button text.
 * @param {boolean} disabled - True to disable controls, false to enable.
 * @param {HTMLElement | null} [initiatingButton=null] - The button that triggered the state change, to update its text.
 */
function setButtonsState(disabled, initiatingButton = null) {
    const buttonsToManage = [updateAllDataButton, activateOverlayButton, exportFailedSamplesButton];
    buttonsToManage.forEach(btn => {
        if (btn) btn.disabled = disabled;
    });
    if (resolutionSelect) resolutionSelect.disabled = disabled;

    // Update text of the initiating button if provided
    if (disabled && initiatingButton) {
        if (initiatingButton === updateAllDataButton) {
            updateAllDataButton.textContent = 'Updating All Data...';
        } else if (initiatingButton === activateOverlayButton) {
            activateOverlayButton.textContent = 'Activating Overlay...';
        } else if (initiatingButton === exportFailedSamplesButton) {
            exportFailedSamplesButton.textContent = 'Exporting Samples...';
        }
    } else { // Reset button texts when enabling
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
        // TODO: Add CSS class for error styling if desired:
        // statusMessageElement.classList.toggle('error-message', isError);
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


// --- Initialization and Electron API Setup ---
if (window.electronAPI) {
    console.log('[Renderer] Electron API available. Setting up listeners.');

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
            // Default to the first resolution in the list
            resolutionSelect.value = resolutions[0];
            selectedResolution = resolutions[0];
            console.log(`[Renderer] Resolutions loaded. Defaulted to: ${selectedResolution}`);
            if (activateOverlayButton) activateOverlayButton.disabled = false; // Enable activate button
        } else {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "No resolutions found";
            resolutionSelect.appendChild(option);
            console.warn('[Renderer] No resolutions found or provided.');
            if (activateOverlayButton) activateOverlayButton.disabled = true; // Disable if no resolutions
        }
        // Enable export button regardless of resolutions, as it doesn't depend on it
        if (exportFailedSamplesButton) exportFailedSamplesButton.disabled = false;
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
        // This primarily handles errors during overlay activation or if main process sends error status for a scan
        // Most detailed scan results are for the overlay window itself.
        console.log('[Renderer] Scan-related message from main:', results);
        if (results && results.error) {
            setButtonsState(false); // Re-enable UI on error
            const errorMessage = `Overlay/Scan Error: ${results.error}\nTarget Resolution: ${results.resolution || selectedResolution || 'N/A'}`;
            updateStatusMessage(errorMessage, true);
            if (scanResultsArea) { // Display in a dedicated area if it exists
                scanResultsArea.textContent = errorMessage;
            }
        }
        // Non-error scan results are typically handled by overlayRenderer.js
    });

    window.electronAPI.onOverlayClosedResetUI(() => {
        console.log('[Renderer] Overlay closed signal received. Re-enabling main window UI.');
        setButtonsState(false);
        updateStatusMessage('Ready. Overlay closed.');
        if (scanResultsArea) {
            scanResultsArea.textContent = 'Scan results (or errors) will appear here...'; // Reset area
        }
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
            if (scanResultsArea) scanResultsArea.textContent = 'Waiting for overlay activation...'; // Reset
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

} else {
    // Critical error: Electron API not exposed
    console.error('[Renderer] FATAL: Electron API not found. Preload script might not be configured or failed.');
    updateStatusMessage('Error: Application setup issue. Cannot communicate with main process.', true);
    setButtonsState(true); // Disable all controls
    if (lastUpdatedDateElement) lastUpdatedDateElement.textContent = 'Error';
    if (activateOverlayButton) activateOverlayButton.disabled = true;
    if (exportFailedSamplesButton) exportFailedSamplesButton.disabled = true;
}