// Get references to elements
const updateHeroesButton = document.getElementById('update-heroes-btn');
const updateAbilitiesButton = document.getElementById('update-abilities-btn');
const updatePairsButton = document.getElementById('update-pairs-btn');
const activateOverlayButton = document.getElementById('activate-overlay-btn');
const resolutionSelect = document.getElementById('resolution-select');
const statusMessage = document.getElementById('status-message');
const scanResultsArea = document.getElementById('scan-results');

let selectedResolution = ''; // Variable to store the selected resolution

// Helper function to set button states
function setButtonsState(disabled, message = null) {
    const buttons = [updateHeroesButton, updateAbilitiesButton, updatePairsButton, activateOverlayButton];
    buttons.forEach(btn => {
        if (btn) btn.disabled = disabled;
    });
    if (resolutionSelect) resolutionSelect.disabled = disabled;

    if (message && disabled) { // Only set specific "in progress" messages if disabled is true
        if (updateHeroesButton && activateOverlayButton !== updateHeroesButton) updateHeroesButton.textContent = message;
        if (updateAbilitiesButton && activateOverlayButton !== updateAbilitiesButton) updateAbilitiesButton.textContent = message;
        if (updatePairsButton && activateOverlayButton !== updatePairsButton) updatePairsButton.textContent = message;
        if (activateOverlayButton) activateOverlayButton.textContent = 'Activating...'; // Specific message for this one
    } else {
        // Reset to default text when enabling (disabled = false) or no specific message
        if (updateHeroesButton) updateHeroesButton.textContent = 'Update Hero Winrates';
        if (updateAbilitiesButton) updateAbilitiesButton.textContent = 'Update Ability Winrates';
        if (updatePairsButton) updatePairsButton.textContent = 'Update Ability Pairs';
        if (activateOverlayButton) activateOverlayButton.textContent = 'Activate Overlay';
    }
}

// Check if the Electron API is available
if (window.electronAPI) {
    // --- Populate Resolution Dropdown on Load ---
    window.electronAPI.getAvailableResolutions(); // Request resolutions on load

    window.electronAPI.onAvailableResolutions((resolutions) => {
        if (resolutionSelect) {
            resolutionSelect.innerHTML = ''; // Clear existing options
            if (resolutions && resolutions.length > 0) {
                resolutions.forEach(res => {
                    const option = document.createElement('option');
                    option.value = res;
                    option.textContent = res;
                    resolutionSelect.appendChild(option);
                });
                // Set the first resolution as default and store it
                if (resolutions.length > 0) {
                    resolutionSelect.value = resolutions[0];
                    selectedResolution = resolutions[0];
                }
            } else {
                const option = document.createElement('option');
                option.value = "";
                option.textContent = "No resolutions found";
                resolutionSelect.appendChild(option);
            }
        }
    });

    // --- Handle Resolution Change ---
    if (resolutionSelect) {
        resolutionSelect.addEventListener('change', (event) => {
            selectedResolution = event.target.value;
            console.log(`Selected resolution: ${selectedResolution}`);
        });
    }

    // --- Handle Hero Button Click ---
    updateHeroesButton.addEventListener('click', () => {
        console.log('Update Heroes button clicked.');
        statusMessage.textContent = 'Requesting hero data update...';
        setButtonsState(true, 'Updating...');
        window.electronAPI.scrapeHeroes();
    });

    // --- Handle Ability Button Click ---
    updateAbilitiesButton.addEventListener('click', () => {
        console.log('Update Abilities button clicked.');
        statusMessage.textContent = 'Requesting ability data update...';
        setButtonsState(true, 'Updating...');
        window.electronAPI.scrapeAbilities();
    });

    // --- Handle Pairs Button Click ---
    updatePairsButton.addEventListener('click', () => {
        console.log('Update Pairs button clicked.');
        statusMessage.textContent = 'Requesting ability pairs update...';
        setButtonsState(true, 'Updating...');
        window.electronAPI.scrapeAbilityPairs();
    });

    // --- Handle Activate Overlay Button Click ---
    if (activateOverlayButton) {
        activateOverlayButton.addEventListener('click', () => {
            if (!selectedResolution) {
                statusMessage.textContent = 'Please select a resolution first.';
                return;
            }
            console.log(`Activate Overlay button clicked for resolution: ${selectedResolution}`);
            statusMessage.textContent = `Activating overlay for ${selectedResolution}...`;
            if (document.getElementById('scan-results')) { // Check if the element exists
                document.getElementById('scan-results').textContent = 'Waiting for overlay activation...'; // Set this when activating
            }
            setButtonsState(true); // Disable buttons, text will be set by setButtonsState
            activateOverlayButton.textContent = 'Activating...'; // Explicitly set this one's text
            window.electronAPI.activateOverlay(selectedResolution);
        });
    }

    // --- Handle Status Updates from Main Process ---
    window.electronAPI.onUpdateStatus((message) => {
        console.log('Status from main:', message);
        statusMessage.textContent = message;
        if (message.includes('complete!') || message.includes('Error updating') || message.includes('failed:')) {
            // This is for scraper updates
            setButtonsState(false);
        }
        // No need to handle 'Overlay activated' here for button states,
        // as the new 'onOverlayClosedResetUI' will handle re-enabling.
    });

    // --- Handle Scan Results from Main Process (for main window) ---
    // This will likely not receive detailed scan results anymore,
    // but can receive status messages about the overlay or errors.
    window.electronAPI.onScanResults((results) => {
        console.log('Message/Status received in main window renderer (onScanResults):', results);

        if (results && results.error) { // e.g. if activate-overlay itself had an error
            setButtonsState(false); // Re-enable buttons on error
            const output = `Error: ${results.error}\nResolution: ${results.resolution || selectedResolution}`;
            if (document.getElementById('scan-results')) {
                document.getElementById('scan-results').textContent = output;
            }
            statusMessage.textContent = `Overlay operation failed: ${results.error}`;
        } else if (results && results.message) {
            // Could be used for other general messages, but overlay closing handles UI reset now.
            // statusMessage.textContent = results.message;
        }
    });

    // --- Handle Overlay Closed - Reset UI ---
    window.electronAPI.onOverlayClosedResetUI(() => {
        console.log('Overlay closed signal received. Re-enabling main window UI.');
        setButtonsState(false); // Enable all buttons and reset their text
        statusMessage.textContent = 'Ready. Overlay closed.'; // Reset status message
        // scanResultsArea.textContent = 'Scan results will appear here...'; // Reset scan results area
        if (document.getElementById('scan-results')) { // Check if the element exists
            document.getElementById('scan-results').textContent = 'Scan results will appear here...';
        }

    });

} else {
    console.error('Electron API not found. Preload script might not be configured correctly.');
    statusMessage.textContent = 'Error: Application setup issue. Cannot communicate with main process.';
    setButtonsState(true);
}