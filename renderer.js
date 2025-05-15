// Get references to elements
const updateAllDataButton = document.getElementById('update-all-data-btn');
const activateOverlayButton = document.getElementById('activate-overlay-btn');
const resolutionSelect = document.getElementById('resolution-select');
const statusMessage = document.getElementById('status-message');
const scanResultsArea = document.getElementById('scan-results');
const lastUpdatedDateElement = document.getElementById('last-updated-date');

let selectedResolution = '';

function setButtonsState(disabled, initiatingButton = null) {
    const buttonsToDisable = [updateAllDataButton, activateOverlayButton];
    buttonsToDisable.forEach(btn => {
        if (btn) btn.disabled = disabled;
    });
    if (resolutionSelect) resolutionSelect.disabled = disabled;

    if (disabled) {
        if (initiatingButton === updateAllDataButton) {
            updateAllDataButton.textContent = 'Updating Data...';
        } else if (initiatingButton === activateOverlayButton) {
            activateOverlayButton.textContent = 'Activating...';
        }
    } else {
        if (updateAllDataButton) updateAllDataButton.textContent = 'Update Windrun Data';
        if (activateOverlayButton) activateOverlayButton.textContent = 'Activate Overlay';
    }
}

if (window.electronAPI) {

    if (updateAllDataButton) {
        updateAllDataButton.addEventListener('click', () => {
            console.log('Update Windrun Data button clicked.');
            statusMessage.textContent = 'Requesting Windrun.io data update...';
            setButtonsState(true, updateAllDataButton);
            window.electronAPI.scrapeAllWindrunData();
        });
    }

    if (activateOverlayButton) {
        activateOverlayButton.addEventListener('click', () => {
            if (!selectedResolution) {
                statusMessage.textContent = 'Please select a resolution first.';
                return;
            }
            console.log(`Activate Overlay button clicked for resolution: ${selectedResolution}`);
            statusMessage.textContent = `Activating overlay for ${selectedResolution}...`;
            if (document.getElementById('scan-results')) {
                document.getElementById('scan-results').textContent = 'Waiting for overlay activation...';
            }
            setButtonsState(true, activateOverlayButton);
            window.electronAPI.activateOverlay(selectedResolution);
        });
    }

    window.electronAPI.onUpdateStatus((message) => {
        console.log('Status from main:', message);
        statusMessage.textContent = message;
        if (message.toLowerCase().includes('complete!') ||
            message.toLowerCase().includes('error:') ||
            message.toLowerCase().includes('failed:') ||
            message.toLowerCase().includes('cancelled') ||
            message.toLowerCase().includes('finished successfully!') ||
            message.toLowerCase().includes('operation halted')
        ) {
            setButtonsState(false);
        }
    });

    if (window.electronAPI.onLastUpdatedDate) {
        window.electronAPI.onLastUpdatedDate((dateStr) => {
            if (lastUpdatedDateElement) {
                lastUpdatedDateElement.textContent = dateStr || 'Never';
            }
        });
    }

    if (window.electronAPI.onSetUIDisabledState) {
        window.electronAPI.onSetUIDisabledState((isDisabled) => {
            setButtonsState(isDisabled, isDisabled ? updateAllDataButton : null);
            if (isDisabled) {
                statusMessage.textContent = "Performing initial data synchronization with Windrun.io...";
                if (updateAllDataButton) updateAllDataButton.textContent = 'Syncing Data...'; // Specific text for auto-sync
            }
        });
    }

    window.electronAPI.onScanResults((results) => {
        console.log('Message/Status received in main window renderer (onScanResults):', results);

        if (results && results.error) {
            setButtonsState(false);
            const output = `Error: ${results.error}\nResolution: ${results.resolution || selectedResolution}`;
            if (document.getElementById('scan-results')) {
                document.getElementById('scan-results').textContent = output;
            }
            statusMessage.textContent = `Overlay operation failed: ${results.error}`;
        }
    });

    window.electronAPI.onOverlayClosedResetUI(() => {
        console.log('Overlay closed signal received. Re-enabling main window UI.');
        setButtonsState(false);
        statusMessage.textContent = 'Ready. Overlay closed.';
        if (document.getElementById('scan-results')) {
            document.getElementById('scan-results').textContent = 'Scan results will appear here...';
        }

    });
} else {
    console.error('Electron API not found. Preload script might not be configured correctly.');
    statusMessage.textContent = 'Error: Application setup issue. Cannot communicate with main process.';
    setButtonsState(true);
    if (lastUpdatedDateElement) lastUpdatedDateElement.textContent = 'Error';
}