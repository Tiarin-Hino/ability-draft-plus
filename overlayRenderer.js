const tooltipElement = document.getElementById('tooltip');
const closeOverlayButton = document.getElementById('close-overlay-btn');
const scanNowButton = document.getElementById('scan-now-btn');
const takeSnapshotButton = document.getElementById('take-snapshot-btn');
const snapshotStatusElement = document.getElementById('snapshot-status');
const controlsContainer = document.getElementById('controls-container');
const opAlertWindow = document.getElementById('op-combinations-alert');
const opCombinationsListElement = document.getElementById('op-combinations-list');


let currentCoordinatesConfig = null;
let currentTargetResolution = null;
let currentScaleFactor = 1; // Store the scale factor
let scanHasBeenPerformed = false;
let isTooltipVisible = false;

console.log('overlayRenderer.js loaded');

function toggleTopTierBordersVisibility(visible) {
    const hotspots = document.querySelectorAll('.ability-hotspot.top-tier-ability');
    hotspots.forEach(hotspot => {
        if (visible) {
            hotspot.classList.remove('snapshot-hidden-border');
        } else {
            hotspot.classList.add('snapshot-hidden-border');
        }
    });
    // console.log(`[OVERLAY RENDERER] Top-tier borders visibility set to: ${visible}`);
}

if (window.electronAPI && window.electronAPI.onToggleHotspotBorders) {
    window.electronAPI.onToggleHotspotBorders((visible) => {
        if (visible) {
            if (!isTooltipVisible) { // Only show borders if tooltip isn't active (original logic)
                toggleTopTierBordersVisibility(true);
            }
        } else {
            toggleTopTierBordersVisibility(false);
        }
    });
}

function updateOPCombinationsAlert(opCombinations) {
    if (!opAlertWindow || !opCombinationsListElement) {
        console.error("OP Alert window elements not found in DOM.");
        return;
    }

    opCombinationsListElement.innerHTML = ''; // Clear previous list

    if (opCombinations && opCombinations.length > 0) {
        opCombinations.forEach(combo => {
            const comboDiv = document.createElement('div');
            const ability1Display = (combo.ability1DisplayName || 'Ability 1').replace(/_/g, ' ');
            const ability2Display = (combo.ability2DisplayName || 'Ability 2').replace(/_/g, ' ');
            const wrFormatted = combo.synergyWinrate ? `(${(combo.synergyWinrate * 100).toFixed(1)}%)` : '';
            comboDiv.textContent = `${ability1Display} + ${ability2Display} ${wrFormatted} WR`;
            opCombinationsListElement.appendChild(comboDiv);
        });
        opAlertWindow.style.display = 'block';
        console.log(`[OVERLAY RENDERER] Displaying ${opCombinations.length} OP combinations.`);
    } else {
        opAlertWindow.style.display = 'none';
        // console.log('[OVERLAY RENDERER] No OP combinations to display.');
    }
}


if (window.electronAPI && window.electronAPI.onOverlayData) {
    console.log('[OVERLAY RENDERER] Setting up onOverlayData listener');
    window.electronAPI.onOverlayData((data) => {
        console.log('[OVERLAY RENDERER] === New Overlay Data Received ===');
        // Always update scale factor if provided
        if (typeof data.scaleFactor === 'number' && data.scaleFactor > 0) {
            currentScaleFactor = data.scaleFactor;
            console.log(`[OVERLAY RENDERER] Updated currentScaleFactor: ${currentScaleFactor}`);
        } else if (data.initialSetup && (!data.scaleFactor || data.scaleFactor <= 0)) {
            // Fallback if not provided during initial setup, though main.js should always send it.
            currentScaleFactor = 1;
            console.warn(`[OVERLAY RENDERER] scaleFactor not provided or invalid in initialSetup, defaulting to 1.`);
        }


        if (data && data.error) {
            console.error('[OVERLAY RENDERER] Error message received from main process:', data.error);
            tooltipElement.innerHTML = `<div class="tooltip-title">Error</div><div class="tooltip-winrate">${data.error}</div>`;
            tooltipElement.style.display = 'block';
            isTooltipVisible = true;
            toggleTopTierBordersVisibility(false);

            if (scanNowButton) {
                scanNowButton.disabled = false;
                scanNowButton.style.display = 'inline-block';
            }
            if (takeSnapshotButton) takeSnapshotButton.style.display = 'none';
            scanHasBeenPerformed = false;
            updateOPCombinationsAlert([]); // Clear OP combos on error
            return;
        }

        // Update OP Combinations if present, regardless of initialSetup or scanData
        // (This allows OP combos to be updated even if scanData isn't present in a specific message)
        if (data && typeof data.opCombinations !== 'undefined') { // Check if opCombinations key exists
            updateOPCombinationsAlert(data.opCombinations);
        }


        if (data && data.initialSetup) {
            console.log('[OVERLAY RENDERER] Initial setup data received.');
            document.querySelectorAll('.ability-hotspot').forEach(el => el.remove()); // Clear old hotspots
            if (scanNowButton) {
                scanNowButton.disabled = false;
                scanNowButton.style.display = 'inline-block';
            }
            if (takeSnapshotButton) {
                takeSnapshotButton.style.display = 'none';
                takeSnapshotButton.disabled = true; // Disabled until a scan is done
            }
            scanHasBeenPerformed = false;
            tooltipElement.style.display = 'none'; // Hide tooltip
            isTooltipVisible = false;
            toggleTopTierBordersVisibility(true); // Show borders if any top-tier abilities were to be marked (none yet)

            if (snapshotStatusElement) snapshotStatusElement.style.display = 'none'; // Hide snapshot status

            // Store config and resolution
            if (data.coordinatesConfig) currentCoordinatesConfig = data.coordinatesConfig;
            if (data.targetResolution) currentTargetResolution = data.targetResolution;
            console.log('[OVERLAY RENDERER] currentCoordinatesConfig set. currentTargetResolution set:', currentTargetResolution);
            // currentScaleFactor is already set at the beginning of this handler

            // updateOPCombinationsAlert was already called if data.opCombinations existed.
            // If it was an initial setup without opCombinations, it defaults to hidden.

        } else if (data && data.scanData) {
            console.log('[OVERLAY RENDERER] Scan data received. Attempting to process and create hotspots.');
            // console.log('[OVERLAY RENDERER] Full scanData payload:', JSON.stringify(data.scanData, null, 2));
            // console.log('[OVERLAY RENDERER] Using currentCoordinatesConfig for hotspot creation.');
            // console.log('[OVERLAY RENDERER] Using currentTargetResolution:', currentTargetResolution);
            // console.log('[OVERLAY RENDERER] Using currentScaleFactor for positioning:', currentScaleFactor);

            const receivedScanDataObject = data.scanData;

            if (!receivedScanDataObject || typeof receivedScanDataObject.ultimates === 'undefined' || typeof receivedScanDataObject.standard === 'undefined') {
                console.error('[OVERLAY RENDERER] CRITICAL: receivedScanDataObject is invalid or missing ultimates/standard arrays.', receivedScanDataObject);
                tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Invalid scan data structure from main.</div>';
                tooltipElement.style.display = 'block';
                isTooltipVisible = true;
                toggleTopTierBordersVisibility(false);
                if (scanNowButton) { scanNowButton.disabled = false; scanNowButton.style.display = 'inline-block'; }
                if (takeSnapshotButton) takeSnapshotButton.style.display = 'none';
                scanHasBeenPerformed = false;
                // updateOPCombinationsAlert(data.opCombinations || []); // Already handled
                return;
            }
            if (!currentCoordinatesConfig || !currentTargetResolution) {
                console.error('[OVERLAY RENDERER] CRITICAL: Context (coordinatesConfig or targetResolution) is missing for scan data.');
                tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Overlay context missing for scan data.</div>';
                tooltipElement.style.display = 'block';
                isTooltipVisible = true;
                toggleTopTierBordersVisibility(false);
                if (scanNowButton) { scanNowButton.disabled = false; scanNowButton.style.display = 'inline-block'; }
                if (takeSnapshotButton) takeSnapshotButton.style.display = 'none';
                scanHasBeenPerformed = false;
                // updateOPCombinationsAlert(data.opCombinations || []); // Already handled
                return;
            }

            const resolutionCoords = currentCoordinatesConfig.resolutions[currentTargetResolution];
            if (!resolutionCoords) {
                console.error(`[OVERLAY RENDERER] CRITICAL: Coordinates for target resolution '${currentTargetResolution}' not found in config.`);
                tooltipElement.innerHTML = `<div class="tooltip-title">Error</div><div class="tooltip-winrate">No coordinates for ${currentTargetResolution}.</div>`;
                tooltipElement.style.display = 'block';
                isTooltipVisible = true;
                toggleTopTierBordersVisibility(false);
                if (scanNowButton) { scanNowButton.disabled = false; scanNowButton.style.display = 'inline-block'; }
                if (takeSnapshotButton) takeSnapshotButton.style.display = 'none';
                scanHasBeenPerformed = false;
                // updateOPCombinationsAlert(data.opCombinations || []); // Already handled
                return;
            }

            try {
                document.querySelectorAll('.ability-hotspot').forEach(el => el.remove());
                // console.log('[OVERLAY RENDERER] Previous hotspots cleared.');

                // console.log('[OVERLAY RENDERER] Creating ultimate hotspots. Number of ultimates in data:', receivedScanDataObject.ultimates ? receivedScanDataObject.ultimates.length : 'N/A', 'Number of ult coords:', resolutionCoords.ultimate_slots_coords ? resolutionCoords.ultimate_slots_coords.length : 'N/A');
                createHotspotsForType(receivedScanDataObject.ultimates, resolutionCoords.ultimate_slots_coords, 'ultimates');

                // console.log('[OVERLAY RENDERER] Creating standard hotspots. Number of standard in data:', receivedScanDataObject.standard ? receivedScanDataObject.standard.length : 'N/A', 'Number of std coords:', resolutionCoords.standard_slots_coords ? resolutionCoords.standard_slots_coords.length : 'N/A');
                createHotspotsForType(receivedScanDataObject.standard, resolutionCoords.standard_slots_coords, 'standard');

                console.log('[OVERLAY RENDERER] Hotspot creation process finished. Scan duration from main:', data.durationMs, 'ms');

                if (scanNowButton) {
                    scanNowButton.style.display = 'none'; // Hide scan button after successful scan
                    scanNowButton.disabled = true;
                }
                if (takeSnapshotButton) {
                    takeSnapshotButton.style.display = 'block'; // Show snapshot button
                    takeSnapshotButton.disabled = false;
                }
                scanHasBeenPerformed = true;
                tooltipElement.style.display = 'none'; // Ensure tooltip is hidden initially
                isTooltipVisible = false;
                toggleTopTierBordersVisibility(true); // Show borders for any top-tier abilities identified

                // console.log('[OVERLAY RENDERER] UI updated successfully, "Scanning..." tooltip hidden.');
                if (snapshotStatusElement) snapshotStatusElement.style.display = 'none'; // Clear any old snapshot status
                // updateOPCombinationsAlert was already handled.

            } catch (hotspotError) {
                console.error('[OVERLAY RENDERER] === ERROR DURING HOTSPOT CREATION OR UI UPDATE ===');
                console.error(hotspotError.stack || hotspotError);
                tooltipElement.innerHTML = `<div class="tooltip-title">Display Error</div><div class="tooltip-winrate" style="font-size: 10px; max-height: 50px; overflow-y: auto;">Failed to display abilities: ${hotspotError.message}</div>`;
                tooltipElement.style.display = 'block';
                isTooltipVisible = true;
                toggleTopTierBordersVisibility(false);
                if (scanNowButton) { scanNowButton.disabled = false; scanNowButton.style.display = 'inline-block'; }
                if (takeSnapshotButton) takeSnapshotButton.style.display = 'none';
                scanHasBeenPerformed = false;
                // updateOPCombinationsAlert(data.opCombinations || []); // Already handled
            }
        } else if (!data.initialSetup) { // Data that isn't initial and isn't scanData
            console.warn('[OVERLAY RENDERER] Received overlay data that was not initialSetup and had no scanData or error field.', JSON.stringify(data, null, 2));
            // updateOPCombinationsAlert already handled if opCombinations was present.
        }
    });
} else {
    console.error('[OVERLAY RENDERER] electronAPI.onOverlayData is not available. Preload script might have issues.');
    if (tooltipElement) {
        tooltipElement.innerHTML = '<div class="tooltip-title">API Error</div><div class="tooltip-winrate">Overlay API not available.</div>';
        tooltipElement.style.display = 'block';
        isTooltipVisible = true;
        toggleTopTierBordersVisibility(false);
    }
    if (opAlertWindow) opAlertWindow.style.display = 'none';
}

if (scanNowButton && window.electronAPI && window.electronAPI.executeScanFromOverlay) {
    scanNowButton.addEventListener('click', () => {
        if (scanHasBeenPerformed || scanNowButton.disabled) return; // Prevent re-scan or scan if disabled
        scanNowButton.disabled = true; // Disable button during scan
        if (opAlertWindow) opAlertWindow.style.display = 'none'; // Hide OP alert during scan
        if (!currentTargetResolution) {
            console.error('Cannot scan, target resolution not set.');
            tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Resolution not set.</div>';
            tooltipElement.style.display = 'block';
            isTooltipVisible = true;
            toggleTopTierBordersVisibility(false);
            scanNowButton.disabled = false; // Re-enable if error before sending
            return;
        }
        console.log('Scan Now button clicked. Requesting scan for:', currentTargetResolution);
        tooltipElement.innerHTML = `<div class="tooltip-title">Scanning...</div><div class="tooltip-winrate">Identifying abilities for ${currentTargetResolution}. Please wait.</div>`;
        tooltipElement.style.display = 'block';
        isTooltipVisible = true;
        toggleTopTierBordersVisibility(false); // Hide borders during scan

        if (controlsContainer) { // Position tooltip relative to controls
            const controlsRect = controlsContainer.getBoundingClientRect();
            tooltipElement.style.top = `${controlsRect.bottom + 5}px`; // Below controls
            tooltipElement.style.right = `10px`; // Align with controls right edge
            tooltipElement.style.left = 'auto';
            tooltipElement.style.transform = 'none';
        }
        window.electronAPI.executeScanFromOverlay(currentTargetResolution);
    });
}

if (takeSnapshotButton && window.electronAPI && window.electronAPI.takeSnapshot) {
    takeSnapshotButton.addEventListener('click', () => {
        if (!scanHasBeenPerformed || takeSnapshotButton.disabled) {
            console.log('Snapshot attempt ignored: scan not performed or button disabled.');
            return;
        }
        console.log('Take Snapshot button clicked.');
        takeSnapshotButton.disabled = true; // Disable during snapshot process
        if (snapshotStatusElement) {
            snapshotStatusElement.textContent = 'Taking snapshot...';
            snapshotStatusElement.style.display = 'block';
        }
        window.electronAPI.takeSnapshot();
    });
}

if (window.electronAPI && window.electronAPI.onSnapshotTaken) {
    window.electronAPI.onSnapshotTaken((status) => {
        console.log('Snapshot status from main:', status);
        if (snapshotStatusElement) {
            snapshotStatusElement.textContent = status.message;
            snapshotStatusElement.style.display = 'block';
            if (!status.error || status.allowRetry) { // Re-enable button if not a fatal error or retry is allowed
                if (takeSnapshotButton) takeSnapshotButton.disabled = false;
            }
            setTimeout(() => { // Hide status after a delay
                snapshotStatusElement.style.display = 'none';
            }, 5000);
        } else { // Fallback if status element not found
            if (takeSnapshotButton && (!status.error || status.allowRetry)) takeSnapshotButton.disabled = false;
        }
    });
}


function makeControlsInteractive(interactive) {
    if (window.electronAPI && window.electronAPI.setOverlayMouseEvents) {
        window.electronAPI.setOverlayMouseEvents(!interactive); // ignore = !interactive
        // console.log(`Overlay mouse events ignore set to: ${!interactive}`);
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

function createHotspotsForType(abilityResultArray, coordArray, type) { // abilityResultArray is now array of {name, confidence, ...} from main.js formatResultsForOverlay
    if (abilityResultArray && Array.isArray(abilityResultArray) && coordArray && Array.isArray(coordArray)) {
        abilityResultArray.forEach((abilityInfo, index) => { // abilityInfo is { internalName, displayName, ..., confidence }
            // Only create a hotspot if the ability name is not null (i.e., it passed the confidence threshold)
            // and is not 'Unknown Ability' explicitly set for low confidence ones
            if (abilityInfo && abilityInfo.internalName && abilityInfo.displayName !== 'Unknown Ability' && coordArray[index]) {
                createHotspot(coordArray[index], abilityInfo, index, type);
            } else {
                // console.log(`Skipping hotspot creation for ${type} index ${index} due to low confidence or unknown ability.`);
            }
        });
    } else {
        console.warn(`Cannot create hotspots for ${type}: invalid data. Abilities: ${!!abilityResultArray}, Coords: ${!!coordArray}`);
    }
}

function createHotspot(coord, abilityData, index, type) { // abilityData already contains confidence
    const hotspot = document.createElement('div');
    hotspot.className = 'ability-hotspot';
    hotspot.id = `hotspot-${type}-${index}`;

    hotspot.style.left = `${coord.x / currentScaleFactor}px`;
    hotspot.style.top = `${coord.y / currentScaleFactor}px`;
    hotspot.style.width = `${coord.width / currentScaleFactor}px`;
    hotspot.style.height = `${coord.height / currentScaleFactor}px`;

    if (abilityData.isTopTier) {
        hotspot.classList.add('top-tier-ability');
    }

    hotspot.dataset.abilityName = abilityData.displayName; // This is already 'Unknown Ability' if confidence was low
    hotspot.dataset.internalName = abilityData.internalName; // This is null if confidence was low
    hotspot.dataset.winrate = abilityData.winrate !== null ? abilityData.winrate : 'N/A';
    hotspot.dataset.highSkillWinrate = abilityData.highSkillWinrate !== null ? abilityData.highSkillWinrate : 'N/A';
    hotspot.dataset.combinations = JSON.stringify(abilityData.highWinrateCombinations || []);
    hotspot.dataset.isTopTier = String(abilityData.isTopTier === true);
    hotspot.dataset.confidence = abilityData.confidence !== null ? abilityData.confidence.toFixed(2) : 'N/A'; // Store confidence


    hotspot.addEventListener('mouseenter', (event) => {
        const nameForDisplay = hotspot.dataset.abilityName.replace(/_/g, ' ');
        let wr = hotspot.dataset.winrate;
        const winrateFormatted = wr !== 'N/A' ? `${(parseFloat(wr) * 100).toFixed(1)}%` : 'N/A';
        let hsWr = hotspot.dataset.highSkillWinrate;
        const highSkillWinrateFormatted = hsWr !== 'N/A' ? `${(parseFloat(hsWr) * 100).toFixed(1)}%` : 'N/A';
        const topTierIndicator = hotspot.dataset.isTopTier === 'true' ? '<span style="color: #66ff66;">&#9733; Top Pick!</span><br>' : '';
        const confidenceIndicator = hotspot.dataset.confidence !== 'N/A' ? `<span style="font-size: 0.8em; color: #aaa;">Confidence: ${hotspot.dataset.confidence}</span><br>` : '';


        let tooltipContent = `
            ${topTierIndicator}
            <div class="tooltip-title">${nameForDisplay}</div>
            <div class="tooltip-winrate">Winrate: ${winrateFormatted}</div>
            <div class="tooltip-winrate">High Skill WR: ${highSkillWinrateFormatted}</div>
            ${confidenceIndicator} 
        `;
        const combinations = JSON.parse(hotspot.dataset.combinations);
        if (combinations && combinations.length > 0) {
            tooltipContent += `<div class="tooltip-section-title">Strong Combinations in Pool:</div>`;
            combinations.slice(0, 5).forEach(combo => {
                const comboPartnerName = (combo.partnerAbilityDisplayName || 'Unknown Partner').replace(/_/g, ' ');
                const comboWrFormatted = combo.synergyWinrate !== null ? `${(parseFloat(combo.synergyWinrate) * 100).toFixed(1)}%` : 'N/A';
                tooltipContent += `<div class="tooltip-combo">- ${comboPartnerName} (${comboWrFormatted} WR)</div>`;
            });
        }

        tooltipElement.innerHTML = tooltipContent;
        tooltipElement.style.display = 'block';
        isTooltipVisible = true;
        toggleTopTierBordersVisibility(false);
        positionTooltip(hotspot);
    });

    hotspot.addEventListener('mouseleave', () => {
        tooltipElement.style.display = 'none';
        isTooltipVisible = false;
        toggleTopTierBordersVisibility(true);
    });
    document.body.appendChild(hotspot);
}

function positionTooltip(hotspotElement) {
    if (!tooltipElement || !hotspotElement) return;
    const hotspotRect = hotspotElement.getBoundingClientRect(); // These are already logical pixels due to scaling
    const tooltipWidth = tooltipElement.offsetWidth;
    const tooltipHeight = tooltipElement.offsetHeight;

    // Check for invalid tooltip dimensions which can happen if content is not yet fully rendered
    if (isNaN(tooltipWidth) || isNaN(tooltipHeight) || tooltipWidth === 0 || tooltipHeight === 0) {
        // console.warn('Tooltip dimensions invalid for positioning, using fallback.');
        // Fallback positioning (e.g., below the hotspot)
        tooltipElement.style.left = `${hotspotRect.left}px`;
        tooltipElement.style.top = `${hotspotRect.bottom}px`; // Position below hotspot
        return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 10; // Margin from viewport edges

    // Default: position tooltip to the left of the hotspot
    let calculatedX = hotspotRect.left - tooltipWidth - margin;
    let calculatedY = hotspotRect.top;

    // If left position is out of bounds, try to position to the right
    if (calculatedX < margin) {
        calculatedX = hotspotRect.right + margin;
    }

    // If right position is also out of bounds (e.g. large tooltip on small screen or hotspot near edge)
    // then try to fit it by adjusting left, ensuring it doesn't go off right edge
    if (calculatedX + tooltipWidth > viewportWidth - margin) {
        calculatedX = viewportWidth - tooltipWidth - margin;
        // If it still doesn't fit (e.g. tooltip wider than screen), it will be clipped by viewport.
        // We could also consider placing it above/below in such scenarios.
    }

    // Ensure X is not less than margin (in case it was adjusted above and still too far left)
    if (calculatedX < margin) {
        calculatedX = margin;
    }


    // Adjust Y position to keep tooltip within viewport vertically
    if (calculatedY + tooltipHeight > viewportHeight - margin) {
        calculatedY = viewportHeight - tooltipHeight - margin; // Align to bottom edge
    }
    if (calculatedY < margin) {
        calculatedY = margin; // Align to top edge
    }

    tooltipElement.style.left = `${calculatedX}px`;
    tooltipElement.style.top = `${calculatedY}px`;
    tooltipElement.style.right = 'auto'; // Clear any previous right/bottom settings
    tooltipElement.style.bottom = 'auto';
    tooltipElement.style.transform = 'none'; // Clear transform if previously used
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