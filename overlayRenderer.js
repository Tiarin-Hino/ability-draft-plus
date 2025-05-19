const tooltipElement = document.getElementById('tooltip');
const closeOverlayButton = document.getElementById('close-overlay-btn');
const scanNowButton = document.getElementById('scan-now-btn');
const takeSnapshotButton = document.getElementById('take-snapshot-btn');
const snapshotStatusElement = document.getElementById('snapshot-status');
const controlsContainer = document.getElementById('controls-container'); // Original controls

// New elements for OP Combinations
const opCombinationsContainer = document.getElementById('op-combinations-container'); // Parent for window and show button
const opCombinationsWindow = document.getElementById('op-combinations-window'); // The window itself
const opCombinationsListElement = document.getElementById('op-combinations-list');
const hideOpCombinationsButton = document.getElementById('hide-op-combinations-btn');
const showOpCombinationsButton = document.getElementById('show-op-combinations-btn');


let currentCoordinatesConfig = null;
let currentTargetResolution = null;
let currentScaleFactor = 1; // Store the scale factor
let scanHasBeenPerformed = false;
let isTooltipVisible = false;
let opCombinationsAvailable = false; // Track if there are OP combos to show

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
}

if (window.electronAPI && window.electronAPI.onToggleHotspotBorders) {
    window.electronAPI.onToggleHotspotBorders((visible) => {
        if (visible) {
            if (!isTooltipVisible) {
                toggleTopTierBordersVisibility(true);
            }
        } else {
            toggleTopTierBordersVisibility(false);
        }
    });
}

function updateOPCombinationsDisplay(opCombinations) {
    if (!opCombinationsWindow || !opCombinationsListElement || !showOpCombinationsButton || !opCombinationsContainer) {
        console.error("OP Combinations UI elements not found in DOM.");
        return;
    }

    opCombinationsListElement.innerHTML = ''; // Clear previous list

    if (opCombinations && opCombinations.length > 0) {
        opCombinationsAvailable = true;
        opCombinations.forEach(combo => {
            const comboDiv = document.createElement('div');
            const ability1Display = (combo.ability1DisplayName || 'Ability 1').replace(/_/g, ' ');
            const ability2Display = (combo.ability2DisplayName || 'Ability 2').replace(/_/g, ' ');
            const wrFormatted = combo.synergyWinrate ? `(${(combo.synergyWinrate * 100).toFixed(1)}%)` : '';
            comboDiv.textContent = `${ability1Display} + ${ability2Display} ${wrFormatted} WR`;
            opCombinationsListElement.appendChild(comboDiv);
        });
        // If window is not already visible and button is, "click" the show button to make it visible
        // This handles the case where OP combos arrive after the UI is already in a "shown" state via the button
        if (opCombinationsWindow.style.display === 'none' && showOpCombinationsButton.style.display !== 'none') {
            opCombinationsWindow.style.display = 'block'; // Show the window
            showOpCombinationsButton.style.display = 'none'; // Hide the "Show" button
        } else if (opCombinationsWindow.style.display === 'none' && showOpCombinationsButton.style.display === 'none') {
            // This means it was hidden by the user, or never shown. Default to showing it if combos are available.
            opCombinationsWindow.style.display = 'block';
            showOpCombinationsButton.style.display = 'none';
        }
        console.log(`[OVERLAY RENDERER] Displaying ${opCombinations.length} OP combinations.`);
    } else {
        opCombinationsAvailable = false;
        opCombinationsWindow.style.display = 'none';
        showOpCombinationsButton.style.display = 'none'; // Also hide the show button if no combos
        console.log('[OVERLAY RENDERER] No OP combinations to display.');
    }
}


if (window.electronAPI && window.electronAPI.onOverlayData) {
    console.log('[OVERLAY RENDERER] Setting up onOverlayData listener');
    window.electronAPI.onOverlayData((data) => {
        console.log('[OVERLAY RENDERER] === New Overlay Data Received ===');
        if (typeof data.scaleFactor === 'number' && data.scaleFactor > 0) {
            currentScaleFactor = data.scaleFactor;
            console.log(`[OVERLAY RENDERER] Updated currentScaleFactor: ${currentScaleFactor}`);
        } else if (data.initialSetup && (!data.scaleFactor || data.scaleFactor <= 0)) {
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
            updateOPCombinationsDisplay([]); // Clear OP combos on error
            return;
        }

        if (data && typeof data.opCombinations !== 'undefined') {
            updateOPCombinationsDisplay(data.opCombinations);
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
            isTooltipVisible = false;
            toggleTopTierBordersVisibility(true);

            if (snapshotStatusElement) snapshotStatusElement.style.display = 'none';

            if (data.coordinatesConfig) currentCoordinatesConfig = data.coordinatesConfig;
            if (data.targetResolution) currentTargetResolution = data.targetResolution;
            console.log('[OVERLAY RENDERER] currentCoordinatesConfig set. currentTargetResolution set:', currentTargetResolution);

            // If opCombinations were part of initial setup, updateOPCombinationsDisplay already handled it.
            // Otherwise, ensure the OP window is hidden if no combos.
            if (typeof data.opCombinations === 'undefined') {
                updateOPCombinationsDisplay([]);
            }

        } else if (data && data.scanData) {
            console.log('[OVERLAY RENDERER] Scan data received. Attempting to process and create hotspots.');
            const receivedScanDataObject = data.scanData;

            if (!receivedScanDataObject || typeof receivedScanDataObject.ultimates === 'undefined' || typeof receivedScanDataObject.standard === 'undefined') {
                console.error('[OVERLAY RENDERER] CRITICAL: receivedScanDataObject is invalid or missing ultimates/standard arrays.', receivedScanDataObject);
                // ... (error handling as before)
                updateOPCombinationsDisplay(data.opCombinations || []);
                return;
            }
            if (!currentCoordinatesConfig || !currentTargetResolution) {
                console.error('[OVERLAY RENDERER] CRITICAL: Context (coordinatesConfig or targetResolution) is missing for scan data.');
                // ... (error handling as before)
                updateOPCombinationsDisplay(data.opCombinations || []);
                return;
            }

            const resolutionCoords = currentCoordinatesConfig.resolutions[currentTargetResolution];
            if (!resolutionCoords) {
                console.error(`[OVERLAY RENDERER] CRITICAL: Coordinates for target resolution '${currentTargetResolution}' not found in config.`);
                // ... (error handling as before)
                updateOPCombinationsDisplay(data.opCombinations || []);
                return;
            }

            try {
                document.querySelectorAll('.ability-hotspot').forEach(el => el.remove());
                createHotspotsForType(receivedScanDataObject.ultimates, resolutionCoords.ultimate_slots_coords, 'ultimates');
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
                tooltipElement.style.display = 'none';
                isTooltipVisible = false;
                toggleTopTierBordersVisibility(true);
                if (snapshotStatusElement) snapshotStatusElement.style.display = 'none';
                // updateOPCombinationsDisplay was already handled if opCombinations data was present.

            } catch (hotspotError) {
                console.error('[OVERLAY RENDERER] === ERROR DURING HOTSPOT CREATION OR UI UPDATE ===');
                console.error(hotspotError.stack || hotspotError);
                // ... (error handling as before)
                updateOPCombinationsDisplay(data.opCombinations || []);
            }
        } else if (!data.initialSetup) {
            console.warn('[OVERLAY RENDERER] Received overlay data that was not initialSetup and had no scanData or error field.', JSON.stringify(data, null, 2));
            // updateOPCombinationsDisplay already handled if opCombinations was present.
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
    if (opCombinationsWindow) opCombinationsWindow.style.display = 'none';
    if (showOpCombinationsButton) showOpCombinationsButton.style.display = 'none';
}

// Event listener for the new Hide button
if (hideOpCombinationsButton && opCombinationsWindow && showOpCombinationsButton) {
    hideOpCombinationsButton.addEventListener('click', () => {
        opCombinationsWindow.style.display = 'none';
        if (opCombinationsAvailable) { // Only show the "Show" button if there are actually combos
            showOpCombinationsButton.style.display = 'block';
        }
    });
}

// Event listener for the new Show button
if (showOpCombinationsButton && opCombinationsWindow && hideOpCombinationsButton) {
    showOpCombinationsButton.addEventListener('click', () => {
        opCombinationsWindow.style.display = 'block';
        showOpCombinationsButton.style.display = 'none';
    });
}


if (scanNowButton && window.electronAPI && window.electronAPI.executeScanFromOverlay) {
    scanNowButton.addEventListener('click', () => {
        if (scanHasBeenPerformed || scanNowButton.disabled) return;
        scanNowButton.disabled = true;

        // Hide OP window and "Show OP" button during scan
        if (opCombinationsWindow) opCombinationsWindow.style.display = 'none';
        if (showOpCombinationsButton) showOpCombinationsButton.style.display = 'none';

        if (!currentTargetResolution) {
            console.error('Cannot scan, target resolution not set.');
            tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Resolution not set.</div>';
            tooltipElement.style.display = 'block';
            isTooltipVisible = true;
            toggleTopTierBordersVisibility(false);
            scanNowButton.disabled = false;
            return;
        }
        console.log('Scan Now button clicked. Requesting scan for:', currentTargetResolution);
        tooltipElement.innerHTML = `<div class="tooltip-title">Scanning...</div><div class="tooltip-winrate">Identifying abilities for ${currentTargetResolution}. Please wait.</div>`;
        tooltipElement.style.display = 'block';
        isTooltipVisible = true;
        toggleTopTierBordersVisibility(false);

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

// ... (rest of your overlayRenderer.js code for takeSnapshotButton, onSnapshotTaken, makeControlsInteractive, createHotspotsForType, positionTooltip, closeOverlayButton, and Esc key listener remains the same)
// Ensure they are still present from your original file. I'm omitting them here for brevity as they don't directly interact with the new OP combinations display logic.

if (takeSnapshotButton && window.electronAPI && window.electronAPI.takeSnapshot) {
    takeSnapshotButton.addEventListener('click', () => {
        if (!scanHasBeenPerformed || takeSnapshotButton.disabled) {
            console.log('Snapshot attempt ignored: scan not performed or button disabled.');
            return;
        }
        console.log('Take Snapshot button clicked.');
        takeSnapshotButton.disabled = true;
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
            if (!status.error || status.allowRetry) {
                if (takeSnapshotButton) takeSnapshotButton.disabled = false;
            }
            setTimeout(() => {
                snapshotStatusElement.style.display = 'none';
            }, 5000);
        } else {
            if (takeSnapshotButton && (!status.error || status.allowRetry)) takeSnapshotButton.disabled = false;
        }
    });
}


function makeControlsInteractive(interactive) {
    if (window.electronAPI && window.electronAPI.setOverlayMouseEvents) {
        window.electronAPI.setOverlayMouseEvents(!interactive);
    }
}

if (controlsContainer) { // Original controls container
    controlsContainer.addEventListener('mouseenter', () => makeControlsInteractive(true));
    controlsContainer.addEventListener('mouseleave', () => makeControlsInteractive(false));
}
// Make new OP window interactive too
if (opCombinationsWindow) {
    opCombinationsWindow.addEventListener('mouseenter', () => makeControlsInteractive(true));
    opCombinationsWindow.addEventListener('mouseleave', () => makeControlsInteractive(false));
}
// And the "Show OP Combos" button
if (showOpCombinationsButton) {
    showOpCombinationsButton.addEventListener('mouseenter', () => makeControlsInteractive(true));
    showOpCombinationsButton.addEventListener('mouseleave', () => makeControlsInteractive(false));
}


function createHotspotsForType(abilityResultArray, coordArray, type) {
    if (abilityResultArray && Array.isArray(abilityResultArray) && coordArray && Array.isArray(coordArray)) {
        abilityResultArray.forEach((abilityInfo, index) => {
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

function createHotspot(coord, abilityData, index, type) {
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

    hotspot.dataset.abilityName = abilityData.displayName;
    hotspot.dataset.internalName = abilityData.internalName;
    hotspot.dataset.winrate = abilityData.winrate !== null ? abilityData.winrate : 'N/A';
    hotspot.dataset.highSkillWinrate = abilityData.highSkillWinrate !== null ? abilityData.highSkillWinrate : 'N/A';
    hotspot.dataset.combinations = JSON.stringify(abilityData.highWinrateCombinations || []);
    hotspot.dataset.isTopTier = String(abilityData.isTopTier === true);
    hotspot.dataset.confidence = abilityData.confidence !== null ? abilityData.confidence.toFixed(2) : 'N/A';


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
    const hotspotRect = hotspotElement.getBoundingClientRect();
    const tooltipWidth = tooltipElement.offsetWidth;
    const tooltipHeight = tooltipElement.offsetHeight;

    if (isNaN(tooltipWidth) || isNaN(tooltipHeight) || tooltipWidth === 0 || tooltipHeight === 0) {
        tooltipElement.style.left = `${hotspotRect.left}px`;
        tooltipElement.style.top = `${hotspotRect.bottom}px`;
        return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 10;

    let calculatedX = hotspotRect.left - tooltipWidth - margin;
    let calculatedY = hotspotRect.top;

    if (calculatedX < margin) {
        calculatedX = hotspotRect.right + margin;
    }

    if (calculatedX + tooltipWidth > viewportWidth - margin) {
        calculatedX = viewportWidth - tooltipWidth - margin;
    }
    if (calculatedX < margin) {
        calculatedX = margin;
    }

    if (calculatedY + tooltipHeight > viewportHeight - margin) {
        calculatedY = viewportHeight - tooltipHeight - margin;
    }
    if (calculatedY < margin) {
        calculatedY = margin;
    }

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