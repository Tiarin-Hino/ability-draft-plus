const tooltipElement = document.getElementById('tooltip');
const closeOverlayButton = document.getElementById('close-overlay-btn');
const scanNowButton = document.getElementById('scan-now-btn');
const takeSnapshotButton = document.getElementById('take-snapshot-btn'); // New button
const snapshotStatusElement = document.getElementById('snapshot-status'); // New status element
const controlsContainer = document.getElementById('controls-container');

let currentCoordinatesConfig = null;
let currentTargetResolution = null;
let scanHasBeenPerformed = false;

console.log('overlayRenderer.js loaded');

// --- NEW: Function to toggle top-tier hotspot borders ---
function toggleTopTierBordersVisibility(visible) {
    const hotspots = document.querySelectorAll('.ability-hotspot.top-tier-ability');
    hotspots.forEach(hotspot => {
        if (visible) {
            hotspot.classList.remove('snapshot-hidden-border');
        } else {
            hotspot.classList.add('snapshot-hidden-border');
        }
    });
    console.log(`[OVERLAY RENDERER] Top-tier borders visibility set to: ${visible}`);
}

// --- NEW: Listen for command from main process to toggle borders ---
if (window.electronAPI && window.electronAPI.onToggleHotspotBorders) {
    window.electronAPI.onToggleHotspotBorders((visible) => {
        toggleTopTierBordersVisibility(visible);
    });
}

if (window.electronAPI && window.electronAPI.onOverlayData) {
    console.log('[OVERLAY RENDERER] Setting up onOverlayData listener');
    window.electronAPI.onOverlayData((data) => {
        // Robust logging of received data
        console.log('[OVERLAY RENDERER] === New Overlay Data Received ===');
        if (data && data.error) {
            console.error('[OVERLAY RENDERER] Error message received from main process:', data.error);
            tooltipElement.innerHTML = `<div class="tooltip-title">Error</div><div class="tooltip-winrate">${data.error}</div>`;
            tooltipElement.style.display = 'block';
            if (scanNowButton) {
                scanNowButton.disabled = false;
                scanNowButton.style.display = 'inline-block';
            }
            if (takeSnapshotButton) takeSnapshotButton.style.display = 'none';
            scanHasBeenPerformed = false;
            return;
        }

        if (data && data.initialSetup) {
            console.log('[OVERLAY RENDERER] Initial setup data received.');
            document.querySelectorAll('.ability-hotspot').forEach(el => el.remove());
            if (scanNowButton) {
                scanNowButton.disabled = false;
                scanNowButton.style.display = 'inline-block';
            }
            if (takeSnapshotButton) {
                takeSnapshotButton.style.display = 'none';
                takeSnapshotButton.disabled = true;
            }
            scanHasBeenPerformed = false;
            tooltipElement.style.display = 'none';
            if (snapshotStatusElement) snapshotStatusElement.style.display = 'none';
            // Log context for initial setup
            console.log('[OVERLAY RENDERER] currentCoordinatesConfig set:', JSON.stringify(data.coordinatesConfig, null, 2));
            console.log('[OVERLAY RENDERER] currentTargetResolution set:', data.targetResolution);
            if (data.coordinatesConfig) currentCoordinatesConfig = data.coordinatesConfig;
            if (data.targetResolution) currentTargetResolution = data.targetResolution;

        } else if (data && data.scanData) {
            console.log('[OVERLAY RENDERER] Scan data received. Attempting to process and create hotspots.');
            // Detailed logging of the actual scan data and context
            console.log('[OVERLAY RENDERER] Full scanData payload:', JSON.stringify(data.scanData, null, 2));
            console.log('[OVERLAY RENDERER] Using currentCoordinatesConfig:', JSON.stringify(currentCoordinatesConfig, null, 2));
            console.log('[OVERLAY RENDERER] Using currentTargetResolution:', currentTargetResolution);

            const receivedScanDataObject = data.scanData;

            if (!receivedScanDataObject || typeof receivedScanDataObject.ultimates === 'undefined' || typeof receivedScanDataObject.standard === 'undefined') {
                console.error('[OVERLAY RENDERER] CRITICAL: receivedScanDataObject is invalid or missing ultimates/standard arrays.', receivedScanDataObject);
                tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Invalid scan data structure from main.</div>';
                tooltipElement.style.display = 'block';
                if (scanNowButton) { scanNowButton.disabled = false; scanNowButton.style.display = 'inline-block'; }
                if (takeSnapshotButton) takeSnapshotButton.style.display = 'none';
                scanHasBeenPerformed = false;
                return;
            }
            if (!currentCoordinatesConfig || !currentTargetResolution) {
                console.error('[OVERLAY RENDERER] CRITICAL: Context (coordinatesConfig or targetResolution) is missing.');
                tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Overlay context missing for scan data.</div>';
                tooltipElement.style.display = 'block';
                if (scanNowButton) { scanNowButton.disabled = false; scanNowButton.style.display = 'inline-block'; }
                if (takeSnapshotButton) takeSnapshotButton.style.display = 'none';
                scanHasBeenPerformed = false;
                return;
            }


            const resolutionCoords = currentCoordinatesConfig.resolutions[currentTargetResolution];
            if (!resolutionCoords) {
                console.error(`[OVERLAY RENDERER] CRITICAL: Coordinates for target resolution '${currentTargetResolution}' not found in config.`);
                tooltipElement.innerHTML = `<div class="tooltip-title">Error</div><div class="tooltip-winrate">No coordinates for ${currentTargetResolution}.</div>`;
                tooltipElement.style.display = 'block';
                if (scanNowButton) {
                    scanNowButton.disabled = false;
                    scanNowButton.style.display = 'inline-block';
                }
                if (takeSnapshotButton) takeSnapshotButton.style.display = 'none';
                scanHasBeenPerformed = false;
                return;
            }

            try {
                document.querySelectorAll('.ability-hotspot').forEach(el => el.remove());
                console.log('[OVERLAY RENDERER] Previous hotspots cleared.');

                console.log('[OVERLAY RENDERER] Creating ultimate hotspots. Number of ultimates in data:', receivedScanDataObject.ultimates ? receivedScanDataObject.ultimates.length : 'N/A', 'Number of ult coords:', resolutionCoords.ultimate_slots_coords ? resolutionCoords.ultimate_slots_coords.length : 'N/A');
                createHotspotsForType(receivedScanDataObject.ultimates, resolutionCoords.ultimate_slots_coords, 'ultimates');

                console.log('[OVERLAY RENDERER] Creating standard hotspots. Number of standard in data:', receivedScanDataObject.standard ? receivedScanDataObject.standard.length : 'N/A', 'Number of std coords:', resolutionCoords.standard_slots_coords ? resolutionCoords.standard_slots_coords.length : 'N/A');
                createHotspotsForType(receivedScanDataObject.standard, resolutionCoords.standard_slots_coords, 'standard');

                console.log('[OVERLAY RENDERER] Hotspot creation process finished. Scan duration from main:', data.durationMs, 'ms');

                if (scanNowButton) {
                    scanNowButton.style.display = 'none';
                    scanNowButton.disabled = true;
                }
                if (takeSnapshotButton) {
                    takeSnapshotButton.style.display = 'block';
                    takeSnapshotButton.disabled = false;
                }
                scanHasBeenPerformed = true;
                tooltipElement.style.display = 'none'; // Hide "Scanning..." tooltip
                console.log('[OVERLAY RENDERER] UI updated successfully, "Scanning..." tooltip hidden.');
                if (snapshotStatusElement) snapshotStatusElement.style.display = 'none';

            } catch (hotspotError) {
                console.error('[OVERLAY RENDERER] === ERROR DURING HOTSPOT CREATION OR UI UPDATE ===');
                console.error(hotspotError.stack || hotspotError);
                tooltipElement.innerHTML = `<div class="tooltip-title">Display Error</div><div class="tooltip-winrate" style="font-size: 10px; max-height: 50px; overflow-y: auto;">Failed to display abilities: ${hotspotError.message}</div>`;
                tooltipElement.style.display = 'block';
                if (scanNowButton) {
                    scanNowButton.disabled = false;
                    scanNowButton.style.display = 'inline-block';
                }
                if (takeSnapshotButton) takeSnapshotButton.style.display = 'none';
                scanHasBeenPerformed = false;
            }
        } else {
            console.warn('[OVERLAY RENDERER] Received overlay data that was not initialSetup and had no scanData or error field.', JSON.stringify(data, null, 2));
        }
    });
} else {
    console.error('[OVERLAY RENDERER] electronAPI.onOverlayData is not available. Preload script might have issues.');
    if (tooltipElement) {
        tooltipElement.innerHTML = '<div class="tooltip-title">API Error</div><div class="tooltip-winrate">Overlay API not available.</div>';
        tooltipElement.style.display = 'block';
    }
}

if (scanNowButton && window.electronAPI && window.electronAPI.executeScanFromOverlay) {
    scanNowButton.addEventListener('click', () => {
        if (scanHasBeenPerformed || scanNowButton.disabled) return;
        scanNowButton.disabled = true;
        if (!currentTargetResolution) {
            console.error('Cannot scan, target resolution not set.');
            tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Resolution not set.</div>';
            tooltipElement.style.display = 'block';
            scanNowButton.disabled = false;
            return;
        }
        console.log('Scan Now button clicked. Requesting scan for:', currentTargetResolution);
        tooltipElement.innerHTML = `<div class="tooltip-title">Scanning...</div><div class="tooltip-winrate">Identifying abilities for ${currentTargetResolution}. Please wait.</div>`;
        tooltipElement.style.display = 'block';
        if (controlsContainer) {
            const controlsRect = controlsContainer.getBoundingClientRect();
            tooltipElement.style.top = `${controlsRect.bottom + 5}px`;
            tooltipElement.style.right = `10px`;
            tooltipElement.style.left = 'auto';
            tooltipElement.style.transform = 'none';
        }
        window.electronAPI.executeScanFromOverlay(currentTargetResolution);
    });
}

// --- "Take Snapshot" Button Logic ---
if (takeSnapshotButton && window.electronAPI && window.electronAPI.takeSnapshot) {
    takeSnapshotButton.addEventListener('click', () => {
        if (!scanHasBeenPerformed || takeSnapshotButton.disabled) {
            console.log('Snapshot attempt ignored: scan not performed or button disabled.');
            return;
        }
        console.log('Take Snapshot button clicked.');
        takeSnapshotButton.disabled = true; // Prevent multiple clicks
        if (snapshotStatusElement) {
            snapshotStatusElement.textContent = 'Taking snapshot...';
            snapshotStatusElement.style.display = 'block';
        }
        window.electronAPI.takeSnapshot();
    });
}

// --- Listener for Snapshot Status ---
if (window.electronAPI && window.electronAPI.onSnapshotTaken) {
    window.electronAPI.onSnapshotTaken((status) => {
        console.log('Snapshot status from main:', status);
        if (snapshotStatusElement) {
            snapshotStatusElement.textContent = status.message;
            snapshotStatusElement.style.display = 'block';

            // Re-enable button if not a fatal error or allow another attempt
            if (!status.error || status.allowRetry) {
                if (takeSnapshotButton) takeSnapshotButton.disabled = false;
            }

            // Optionally hide the message after a few seconds
            setTimeout(() => {
                snapshotStatusElement.style.display = 'none';
            }, 5000); // Hide after 5 seconds
        } else {
            // Fallback if element not found, though it should be.
            if (takeSnapshotButton && (!status.error || status.allowRetry)) takeSnapshotButton.disabled = false;
        }
    });
}


function makeControlsInteractive(interactive) {
    if (window.electronAPI && window.electronAPI.setOverlayMouseEvents) {
        window.electronAPI.setOverlayMouseEvents(!interactive);
        console.log(`Overlay mouse events ignore set to: ${!interactive}`);
    }
}

if (controlsContainer) {
    controlsContainer.addEventListener('mouseenter', () => {
        makeControlsInteractive(true);
    });
    controlsContainer.addEventListener('mouseleave', () => {
        makeControlsInteractive(false);
    });
}

function createHotspotsForType(abilityArray, coordArray, type) {
    if (abilityArray && Array.isArray(abilityArray) && coordArray && Array.isArray(coordArray)) {
        console.log(`Creating hotspots for ${type}, count: ${abilityArray.length}`);
        abilityArray.forEach((abilityInfo, index) => {
            if (abilityInfo && abilityInfo.displayName && abilityInfo.displayName !== 'Unknown Ability' && coordArray[index]) {
                createHotspot(coordArray[index], abilityInfo, index, type);
            } else if (abilityInfo && abilityInfo.internalName && coordArray[index]) {
                createHotspot(coordArray[index], { ...abilityInfo, displayName: abilityInfo.internalName }, index, type);
            }
        });
    } else {
        console.warn(`Cannot create hotspots for ${type}: invalid data. Abilities: ${!!abilityArray}, Coords: ${!!coordArray}`);
    }
}

function createHotspot(coord, abilityData, index, type) {
    const hotspot = document.createElement('div');
    hotspot.className = 'ability-hotspot'; // Base class
    hotspot.id = `hotspot-${type}-${index}`;
    hotspot.style.left = `${coord.x}px`;
    hotspot.style.top = `${coord.y}px`;
    hotspot.style.width = `${coord.width}px`;
    hotspot.style.height = `${coord.height}px`;

    // --- NEW: Add class if ability is top tier ---
    if (abilityData.isTopTier) {
        hotspot.classList.add('top-tier-ability');
        console.log(`Hotspot for ${abilityData.displayName} marked as top-tier.`);
    }
    // --- END NEW ---

    hotspot.dataset.abilityName = abilityData.displayName;
    hotspot.dataset.internalName = abilityData.internalName;
    hotspot.dataset.winrate = abilityData.winrate !== null ? abilityData.winrate : 'N/A';
    hotspot.dataset.highSkillWinrate = abilityData.highSkillWinrate !== null ? abilityData.highSkillWinrate : 'N/A';
    hotspot.dataset.combinations = JSON.stringify(abilityData.highWinrateCombinations || []);
    // Store the isTopTier flag in dataset as well, might be useful for debugging or other JS logic
    hotspot.dataset.isTopTier = abilityData.isTopTier;


    hotspot.addEventListener('mouseenter', (event) => {
        const nameForDisplay = hotspot.dataset.abilityName.replace(/_/g, ' ');
        let wr = hotspot.dataset.winrate;
        const winrateFormatted = wr !== 'N/A' ? `${(parseFloat(wr) * 100).toFixed(1)}%` : 'N/A';
        let hsWr = hotspot.dataset.highSkillWinrate;
        const highSkillWinrateFormatted = hsWr !== 'N/A' ? `${(parseFloat(hsWr) * 100).toFixed(1)}%` : 'N/A';

        // Optionally, add a visual cue in the tooltip as well
        const topTierIndicator = hotspot.dataset.isTopTier === 'true' ? '<span style="color: #66ff66;">&#9733; Top Pick!</span><br>' : '';

        let tooltipContent = `
            ${topTierIndicator}
            <div class="tooltip-title">${nameForDisplay}</div>
            <div class="tooltip-winrate">Winrate: ${winrateFormatted}</div>
            <div class="tooltip-winrate">High Skill WR: ${highSkillWinrateFormatted}</div>
        `;
        const combinations = JSON.parse(hotspot.dataset.combinations);
        if (combinations && combinations.length > 0) {
            tooltipContent += `<div class="tooltip-section-title">Strong Combos in Pool:</div>`;
            combinations.slice(0, 5).forEach(combo => {
                const comboPartnerName = (combo.partnerAbilityDisplayName || 'Unknown Partner').replace(/_/g, ' ');
                const comboWrFormatted = combo.synergyWinrate !== null ? `${(parseFloat(combo.synergyWinrate) * 100).toFixed(1)}%` : 'N/A';
                tooltipContent += `<div class="tooltip-combo">- ${comboPartnerName} (${comboWrFormatted})</div>`;
            });
        }
        tooltipElement.innerHTML = tooltipContent;
        tooltipElement.style.display = 'block';
        positionTooltip(hotspot);
    });

    hotspot.addEventListener('mouseleave', () => {
        tooltipElement.style.display = 'none';
    });
    document.body.appendChild(hotspot);
}

function positionTooltip(hotspotElement) {
    if (!tooltipElement || !hotspotElement) return;
    const hotspotRect = hotspotElement.getBoundingClientRect();
    const tooltipWidth = tooltipElement.offsetWidth;
    const tooltipHeight = tooltipElement.offsetHeight;

    if (isNaN(tooltipWidth) || isNaN(tooltipHeight) || tooltipWidth === 0 || tooltipHeight === 0) {
        console.warn('Tooltip dimensions invalid for positioning.');
        tooltipElement.style.left = `${hotspotRect.left}px`;
        tooltipElement.style.top = `${hotspotRect.bottom}px`;
        return;
    }

    let calculatedX = hotspotRect.left - tooltipWidth;
    let calculatedY = hotspotRect.bottom - tooltipHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 5;

    if (calculatedX < margin) calculatedX = margin;
    if (calculatedX + tooltipWidth > viewportWidth - margin) calculatedX = viewportWidth - tooltipWidth - margin;
    if (calculatedY < margin) calculatedY = margin;
    if (calculatedY + tooltipHeight > viewportHeight - margin) calculatedY = viewportHeight - tooltipHeight - margin;

    tooltipElement.style.left = `${calculatedX}px`;
    tooltipElement.style.top = `${calculatedY}px`;
    tooltipElement.style.right = 'auto';
    tooltipElement.style.bottom = 'auto';
    tooltipElement.style.transform = 'none';
}

if (closeOverlayButton && window.electronAPI && window.electronAPI.closeOverlay) {
    closeOverlayButton.addEventListener('click', () => {
        window.electronAPI.closeOverlay();
    });
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        if (window.electronAPI && window.electronAPI.closeOverlay) {
            window.electronAPI.closeOverlay();
        }
    }
});