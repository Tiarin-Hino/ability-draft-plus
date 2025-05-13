// renderer.js

// Get references to elements
const updateHeroesButton = document.getElementById('update-heroes-btn');
const updateAbilitiesButton = document.getElementById('update-abilities-btn');
const updatePairsButton = document.getElementById('update-pairs-btn');
const scanDraftButton = document.getElementById('scan-draft-btn');
const statusMessage = document.getElementById('status-message');
const scanResultsArea = document.getElementById('scan-results');

// Helper function to set button states
function setButtonsState(disabled, message = null) {
    const buttons = [updateHeroesButton, updateAbilitiesButton, updatePairsButton, scanDraftButton];
    buttons.forEach(btn => {
        if (btn) btn.disabled = disabled; // Check if button exists
    });

    if (message) {
        buttons.forEach(btn => {
            if (btn) btn.textContent = message;
        });
    } else {
        // Reset text individually
        if (updateHeroesButton) updateHeroesButton.textContent = 'Update Hero Winrates';
        if (updateAbilitiesButton) updateAbilitiesButton.textContent = 'Update Ability Winrates';
        if (updatePairsButton) updatePairsButton.textContent = 'Update Ability Pairs';
        if (scanDraftButton) scanDraftButton.textContent = 'Scan Draft Screen'; // Reset scan button text
    }
}

// Check if the Electron API is available
if (window.electronAPI) {
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

    // --- Handle Pairs Button Click (NEW) ---
    updatePairsButton.addEventListener('click', () => {
        console.log('Update Pairs button clicked.');
        statusMessage.textContent = 'Requesting ability pairs update...';
        setButtonsState(true, 'Updating...');
        window.electronAPI.scrapeAbilityPairs(); // Call new function
    });

    // --- Handle Scan Button Click (NEW) ---
    scanDraftButton.addEventListener('click', () => {
        console.log('Scan Draft button clicked.');
        statusMessage.textContent = 'Starting screen scan...';
        scanResultsArea.textContent = 'Processing...'; // Clear previous results
        setButtonsState(true, 'Scanning...'); // Disable all buttons
        window.electronAPI.scanDraftScreen(); // Trigger scan
    });

    // --- Handle Status Updates from Main Process ---
    window.electronAPI.onUpdateStatus((message) => {
        console.log('Status from main:', message);
        statusMessage.textContent = message;
        if (message.includes('complete') || message.includes('Error')) {
            setButtonsState(false); // Enable all buttons
        }
    });

    // --- Handle Scan Results from Main Process (NEW) ---
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

            // Helper to format winrate percentage
            const formatWinrate = (rate) => {
                if (rate === null || typeof rate !== 'number') {
                    return '(WR: N/A)';
                }
                return `(${(rate * 100).toFixed(1)}%)`; // Format as XX.X%
            };

            output += `Scan completed in ${durationMs} ms.\n\n`;
            output += `Identified Ultimates (${ultimates.length}):\n`;
            // Now map over objects { name, winrate }
            output += ultimates.map(item => `${item.name} ${formatWinrate(item.winrate)}`).join('\n') + '\n\n';

            output += `Identified Standard Abilities (${standard.length}):\n`;
            // Now map over objects { name, winrate }
            output += standard.map(item => `${item.name} ${formatWinrate(item.winrate)}`).join('\n');

            if (statusMessage) statusMessage.textContent = `Scan complete.`;
        } else {
            output = 'Received empty or invalid results.';
            if (statusMessage) statusMessage.textContent = 'Scan Error.';
        }
        if (scanResultsArea) scanResultsArea.textContent = output;
        setButtonsState(false); // Re-enable button
    });

} else {
    console.error('Electron API not found. Preload script might not be configured correctly.');
    statusMessage.textContent = 'Error: Application setup issue. Cannot communicate with main process.';
    setButtonsState(true); // Disable buttons if API is missing
}