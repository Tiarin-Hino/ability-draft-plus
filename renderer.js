// Get references to elements
const updateAllDataButton = document.getElementById('update-all-data-btn');
const activateOverlayButton = document.getElementById('activate-overlay-btn');
const resolutionSelect = document.getElementById('resolution-select');
const statusMessage = document.getElementById('status-message');
const scanResultsArea = document.getElementById('scan-results');
const lastUpdatedDateElement = document.getElementById('last-updated-date');
const exportFailedSamplesButton = document.getElementById('export-failed-samples-btn');

let selectedResolution = '';

function setButtonsState(disabled, initiatingButton = null) {
    const buttonsToDisable = [updateAllDataButton, activateOverlayButton, exportFailedSamplesButton];
    buttonsToDisable.forEach(btn => {
        if (btn) btn.disabled = disabled;
    });
    if (resolutionSelect) resolutionSelect.disabled = disabled;

    if (disabled) {
        if (initiatingButton === updateAllDataButton) {
            updateAllDataButton.textContent = 'Updating Data...';
        } else if (initiatingButton === activateOverlayButton) {
            activateOverlayButton.textContent = 'Activating...';
        } else if (initiatingButton === exportFailedSamplesButton) {
            exportFailedSamplesButton.textContent = 'Exporting...';
        }
    } else {
        if (updateAllDataButton) updateAllDataButton.textContent = 'Update Windrun Data';
        if (activateOverlayButton) activateOverlayButton.textContent = 'Activate Overlay';
        if (exportFailedSamplesButton) exportFailedSamplesButton.textContent = 'Export Failed Samples';
    }
}

if (window.electronAPI) {

    window.electronAPI.getAvailableResolutions();

    window.electronAPI.onAvailableResolutions((resolutions) => {
        if (resolutionSelect) {
            resolutionSelect.innerHTML = '';
            if (resolutions && resolutions.length > 0) {
                resolutions.forEach(res => {
                    const option = document.createElement('option');
                    option.value = res;
                    option.textContent = res;
                    resolutionSelect.appendChild(option);
                });
                if (resolutions.length > 0) {
                    resolutionSelect.value = resolutions[0];
                    selectedResolution = resolutions[0];
                }
                if (exportFailedSamplesButton) exportFailedSamplesButton.disabled = false;
            } else {
                const option = document.createElement('option');
                option.value = "";
                option.textContent = "No resolutions found";
                resolutionSelect.appendChild(option);
                if (exportFailedSamplesButton) exportFailedSamplesButton.disabled = true;
            }
        } else {
            if (exportFailedSamplesButton) exportFailedSamplesButton.disabled = true;
        }
    });

    if (resolutionSelect) {
        resolutionSelect.addEventListener('change', (event) => {
            selectedResolution = event.target.value;
            console.log(`Selected resolution: ${selectedResolution}`);
        });
    }

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
            const scanResultsElement = document.getElementById('scan-results');
            if (scanResultsElement) {
                scanResultsElement.textContent = 'Waiting for overlay activation...';
            }
            setButtonsState(true, activateOverlayButton);
            window.electronAPI.activateOverlay(selectedResolution);
        });
    }

    if (exportFailedSamplesButton) {
        exportFailedSamplesButton.addEventListener('click', () => {
            console.log('Export Failed Samples button clicked.');
            statusMessage.textContent = 'Preparing to export failed samples...';
            setButtonsState(true, exportFailedSamplesButton);
            window.electronAPI.exportFailedSamples();
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
            message.toLowerCase().includes('operation halted') ||
            message.toLowerCase().includes('export finished') ||
            message.toLowerCase().includes('export error')
        ) {
            setButtonsState(false);
        }
    });

    if (window.electronAPI.onExportFailedSamplesStatus) {
        window.electronAPI.onExportFailedSamplesStatus((status) => {
            console.log('Export Failed Samples Status:', status);
            statusMessage.textContent = status.message;
            if (status.error || !status.inProgress) {
                setButtonsState(false);
            }
            if (!status.error && !status.inProgress && status.filePath) {
                statusMessage.textContent = `Export successful: ${status.filePath}`;
            }
        });
    }


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
            const scanResultsElement = document.getElementById('scan-results');
            if (scanResultsElement) {
                scanResultsElement.textContent = output;
            }
            statusMessage.textContent = `Overlay operation failed: ${results.error}`;
        }
    });

    window.electronAPI.onOverlayClosedResetUI(() => {
        console.log('Overlay closed signal received. Re-enabling main window UI.');
        setButtonsState(false);
        statusMessage.textContent = 'Ready. Overlay closed.';
        const scanResultsElement = document.getElementById('scan-results');
        if (scanResultsElement) {
            scanResultsElement.textContent = 'Scan results will appear here...';
        }
    });
} else {
    console.error('Electron API not found. Preload script might not be configured correctly.');
    statusMessage.textContent = 'Error: Application setup issue. Cannot communicate with main process.';
    setButtonsState(true);
    if (lastUpdatedDateElement) lastUpdatedDateElement.textContent = 'Error';
}