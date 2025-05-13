// Get references to elements
const updateHeroesButton = document.getElementById('update-heroes-btn');
const updateAbilitiesButton = document.getElementById('update-abilities-btn');
const updatePairsButton = document.getElementById('update-pairs-btn');
const scanDraftButton = document.getElementById('scan-draft-btn');
const resolutionSelect = document.getElementById('resolution-select'); // New
const statusMessage = document.getElementById('status-message');
const scanResultsArea = document.getElementById('scan-results');

let selectedResolution = ''; // Variable to store the selected resolution

// Helper function to set button states
function setButtonsState(disabled, message = null) {
    const buttons = [updateHeroesButton, updateAbilitiesButton, updatePairsButton, scanDraftButton];
    buttons.forEach(btn => {
        if (btn) btn.disabled = disabled; // Check if button exists
    });
    if (resolutionSelect) resolutionSelect.disabled = disabled; // Disable dropdown too

    if (message) {
        buttons.forEach(btn => {
            if (btn && btn.id !== 'scan-draft-btn') btn.textContent = message; // Avoid changing scan button text here
        });
        if (scanDraftButton) scanDraftButton.textContent = disabled ? 'Scanning...' : 'Scan Draft Screen';

    } else {
        // Reset text individually
        if (updateHeroesButton) updateHeroesButton.textContent = 'Update Hero Winrates';
        if (updateAbilitiesButton) updateAbilitiesButton.textContent = 'Update Ability Winrates';
        if (updatePairsButton) updatePairsButton.textContent = 'Update Ability Pairs';
        if (scanDraftButton) scanDraftButton.textContent = 'Scan Draft Screen';
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

    // --- Handle Scan Button Click ---
    scanDraftButton.addEventListener('click', () => {
        if (!selectedResolution) {
            statusMessage.textContent = 'Please select a resolution first.';
            scanResultsArea.textContent = 'Error: No resolution selected.';
            return;
        }
        console.log(`Scan Draft button clicked for resolution: ${selectedResolution}`);
        statusMessage.textContent = `Starting screen scan for ${selectedResolution}...`;
        scanResultsArea.textContent = 'Processing...';
        setButtonsState(true, 'Scanning...');
        window.electronAPI.scanDraftScreen(selectedResolution); // Pass selected resolution
    });

    // --- Handle Status Updates from Main Process ---
    window.electronAPI.onUpdateStatus((message) => {
        console.log('Status from main:', message);
        statusMessage.textContent = message;
        if (message.includes('complete') || message.includes('Error') || message.includes('failed')) {
            setButtonsState(false);
        }
    });

    // --- Handle Scan Results from Main Process ---
    window.electronAPI.onScanResults((results) => {
        console.log('Scan results received:', results);
        let output = '';
        if (results && results.error) {
            output = `Error during scan: ${results.error}`;
            if (statusMessage) statusMessage.textContent = `Scan failed.`;
        } else if (results) {
            const ultimates = Array.isArray(results.ultimates) ? results.ultimates : [];
            const standard = Array.isArray(results.standard) ? results.standard : [];
            const durationMs = typeof results.durationMs === 'number' ? results.durationMs : 'N/A';

            const formatWinrate = (rate) => {
                if (rate === null || typeof rate !== 'number') {
                    return '(WR: N/A)';
                }
                return `(${(rate * 100).toFixed(1)}%)`;
            };

            output += `Scan completed for ${results.resolution || selectedResolution} in ${durationMs} ms.\n\n`; // Include resolution
            output += `Identified Ultimates (${ultimates.length}):\n`;
            output += ultimates.map(item => `${item.name} ${formatWinrate(item.winrate)}`).join('\n') + '\n\n';

            output += `Identified Standard Abilities (${standard.length}):\n`;
            output += standard.map(item => `${item.name} ${formatWinrate(item.winrate)}`).join('\n');

            if (statusMessage) statusMessage.textContent = `Scan complete.`;
        } else {
            output = 'Received empty or invalid results.';
            if (statusMessage) statusMessage.textContent = 'Scan Error.';
        }
        if (scanResultsArea) scanResultsArea.textContent = output;
        setButtonsState(false);
    });

} else {
    console.error('Electron API not found. Preload script might not be configured correctly.');
    statusMessage.textContent = 'Error: Application setup issue. Cannot communicate with main process.';
    setButtonsState(true);
}