const tooltipElement = document.getElementById('tooltip');
const closeOverlayButton = document.getElementById('close-overlay-btn');
const scanNowButton = document.getElementById('scan-now-btn'); // New button
const controlsContainer = document.getElementById('controls-container');

let currentCoordinatesConfig = null;
let currentTargetResolution = null;
let scanHasBeenPerformed = false;

console.log('overlayRenderer.js loaded');

if (window.electronAPI && window.electronAPI.onOverlayData) {
    console.log('Setting up onOverlayData listener');
    window.electronAPI.onOverlayData((data) => {
        // Log the entire incoming data object for debugging
        console.log('Overlay data received in overlayRenderer (raw):', JSON.stringify(data));

        if (data.error) {
            console.error('Error from main process:', data.error);
            tooltipElement.innerHTML = `<div class="tooltip-title">Error</div><div class="tooltip-winrate">${data.error}</div>`;
            tooltipElement.style.display = 'block';
            if (scanNowButton) {
                scanNowButton.disabled = false;
                scanNowButton.style.display = 'inline-block'; // Ensure it's visible again
            }
            scanHasBeenPerformed = false;
            return;
        }

        // Store resolution and coords on initial setup or if they arrive with scan data
        if (data.coordinatesConfig) currentCoordinatesConfig = data.coordinatesConfig;
        if (data.targetResolution) currentTargetResolution = data.targetResolution;

        if (data.initialSetup) {
            console.log('Initial setup for overlay.');
            document.querySelectorAll('.ability-hotspot').forEach(el => el.remove());
            if (scanNowButton) {
                scanNowButton.disabled = false;
                scanNowButton.style.display = 'inline-block';
            }
            scanHasBeenPerformed = false;
            tooltipElement.style.display = 'none'; // Hide any previous tooltips
        } else if (data.scanData) { // This block handles data after "Scan Now"
            console.log('Scan data received, populating hotspots. Full scanData payload:', JSON.stringify(data.scanData));

            const receivedScanDataObject = data.scanData; // This is the object like { ultimates: [], standard: [] }

            // Corrected Check:
            // Ensure receivedScanDataObject exists and has the expected 'ultimates' and 'standard' properties.
            // Also ensure currentCoordinatesConfig and currentTargetResolution are set.
            if (!receivedScanDataObject || typeof receivedScanDataObject.ultimates === 'undefined' || typeof receivedScanDataObject.standard === 'undefined' ||
                !currentCoordinatesConfig || !currentTargetResolution) {
                console.error('Scan data is incomplete or context is missing. Received data object:', JSON.stringify(data), 'CurrentConfig valid:', !!currentCoordinatesConfig, 'CurrentRes valid:', !!currentTargetResolution);
                tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Incomplete data for overlay. (Check console)</div>';
                tooltipElement.style.display = 'block';
                if (scanNowButton) {
                    scanNowButton.disabled = false;
                    scanNowButton.style.display = 'inline-block';
                }
                scanHasBeenPerformed = false;
                return;
            }

            const resolutionCoords = currentCoordinatesConfig.resolutions[currentTargetResolution];
            if (!resolutionCoords) {
                console.error('Coordinates for target resolution not found:', currentTargetResolution);
                tooltipElement.innerHTML = `<div class="tooltip-title">Error</div><div class="tooltip-winrate">No coordinates for ${currentTargetResolution}.</div>`;
                tooltipElement.style.display = 'block';
                if (scanNowButton) {
                    scanNowButton.disabled = false;
                    scanNowButton.style.display = 'inline-block';
                }
                scanHasBeenPerformed = false;
                return;
            }

            document.querySelectorAll('.ability-hotspot').forEach(el => el.remove());
            console.log('Previous hotspots cleared for new scan data.');

            createHotspotsForType(receivedScanDataObject.ultimates, resolutionCoords.ultimate_slots_coords, 'ultimates');
            createHotspotsForType(receivedScanDataObject.standard, resolutionCoords.standard_slots_coords, 'standard');

            console.log('Hotspot creation loop finished after scan. Duration from main:', data.durationMs, 'ms');
            if (scanNowButton) {
                scanNowButton.style.display = 'none'; // Hide after successful scan
                scanNowButton.disabled = true;      // Also disable
            }
            scanHasBeenPerformed = true;
            tooltipElement.style.display = 'none'; // Hide "Scanning..." tooltip
        } else {
            console.warn('Received overlay data that was not initialSetup and did not contain scanData:', JSON.stringify(data));
        }
    });
} else {
    console.error('electronAPI.onOverlayData is not available. Preload script issue?');
    if (tooltipElement) {
        tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Overlay API not available.</div>';
        tooltipElement.style.display = 'block';
    }
}

// --- "Scan Now" Button Logic ---
if (scanNowButton && window.electronAPI && window.electronAPI.executeScanFromOverlay) {
    scanNowButton.addEventListener('click', () => {
        // Check if a scan has already been performed OR if the button is already disabled
        if (scanHasBeenPerformed || scanNowButton.disabled) {
            console.log('Scan attempt ignored: scan already performed or button is disabled.');
            return;
        }

        // Immediately disable the button to prevent multiple rapid clicks
        scanNowButton.disabled = true;

        if (!currentTargetResolution) {
            console.error('Cannot scan, target resolution not set.');
            tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Resolution not set for scan.</div>';
            tooltipElement.style.display = 'block';
            scanNowButton.disabled = false; // Re-enable button if this specific error occurs
            return;
        }

        console.log('Scan Now button clicked. Requesting scan from main process for resolution:', currentTargetResolution);
        tooltipElement.innerHTML = `<div class="tooltip-title">Scanning...</div><div class="tooltip-winrate">Identifying abilities for ${currentTargetResolution}. Please wait.</div>`;
        tooltipElement.style.display = 'block';

        // --- MODIFIED POSITIONING for "Scanning..." tooltip ---
        if (controlsContainer) {
            const controlsRect = controlsContainer.getBoundingClientRect();
            tooltipElement.style.top = `${controlsRect.bottom + 5}px`; // 5px below the controls
            tooltipElement.style.right = `10px`; // Align with the right edge of controls (which is 10px from viewport edge)
            tooltipElement.style.left = 'auto'; // Reset left if previously set
            tooltipElement.style.transform = 'none'; // Reset transform if previously set for centering
        } else {
            // Fallback if controlsContainer is not found (should not happen)
            tooltipElement.style.top = `10px`;
            tooltipElement.style.right = `10px`;
            tooltipElement.style.left = 'auto';
            tooltipElement.style.transform = 'none';
        }
        // --- END MODIFIED POSITIONING ---

        window.electronAPI.executeScanFromOverlay(currentTargetResolution);
    });
}

// --- Mouse event handling for controls (Scan Now, Close) ---
function makeControlsInteractive(interactive) {
    if (window.electronAPI && window.electronAPI.setOverlayMouseEvents) {
        window.electronAPI.setOverlayMouseEvents(!interactive); // Pass true to IGNORE mouse if not interactive
        console.log(`Overlay mouse events ignore set to: ${!interactive} due to controls hover state change`);
    }
}

function createHotspotsForType(abilityArray, coordArray, type) {
    if (abilityArray && Array.isArray(abilityArray) && coordArray && Array.isArray(coordArray)) {
        console.log(`Creating hotspots for ${type}, count: ${abilityArray.length}`);
        abilityArray.forEach((abilityInfo, index) => {
            if (abilityInfo && abilityInfo.displayName && abilityInfo.displayName !== 'Unknown Ability' && coordArray[index]) {
                createHotspot(coordArray[index], abilityInfo, index, type);
            } else if (abilityInfo && abilityInfo.internalName && coordArray[index]) {
                createHotspot(coordArray[index], {
                    ...abilityInfo,
                    displayName: abilityInfo.internalName
                }, index, type);
            }
        });
    } else {
        console.warn(`Cannot create hotspots for ${type}: abilityArray or coordArray is invalid. Abilities: ${!!abilityArray}, Coords: ${!!coordArray}`);
    }
};

if (controlsContainer) {
    controlsContainer.addEventListener('mouseenter', () => {
        console.log('Mouse ENTER over controls container');
        makeControlsInteractive(true);
    });
    controlsContainer.addEventListener('mouseleave', () => {
        console.log('Mouse LEAVE from controls container');
        makeControlsInteractive(false);
    });
}

function createHotspot(coord, abilityData, index, type) {
    const hotspot = document.createElement('div');
    hotspot.className = 'ability-hotspot';
    hotspot.id = `hotspot-${type}-${index}`;

    hotspot.style.left = `${coord.x}px`;
    hotspot.style.top = `${coord.y}px`;
    hotspot.style.width = `${coord.width}px`;
    hotspot.style.height = `${coord.height}px`;

    hotspot.dataset.abilityName = abilityData.displayName; // For display
    hotspot.dataset.internalName = abilityData.internalName; // For potential future use
    hotspot.dataset.winrate = abilityData.winrate !== null ? abilityData.winrate : 'N/A';
    hotspot.dataset.highSkillWinrate = abilityData.highSkillWinrate !== null ? abilityData.highSkillWinrate : 'N/A';
    // Store combinations as a JSON string to be parsed on mouseenter
    hotspot.dataset.combinations = JSON.stringify(abilityData.highWinrateCombinations || []);

    hotspot.addEventListener('mouseenter', (event) => {
        console.log(`Mouse ENTER over ${hotspot.dataset.abilityName}`);

        const nameForDisplay = hotspot.dataset.abilityName.replace(/_/g, ' ');

        let wr = hotspot.dataset.winrate;
        const winrateFormatted = wr !== 'N/A' ? `${(parseFloat(wr) * 100).toFixed(1)}%` : 'N/A';

        let hsWr = hotspot.dataset.highSkillWinrate;
        const highSkillWinrateFormatted = hsWr !== 'N/A' ? `${(parseFloat(hsWr) * 100).toFixed(1)}%` : 'N/A';

        let tooltipContent = `
            <div class="tooltip-title">${nameForDisplay}</div>
            <div class="tooltip-winrate">Winrate: ${winrateFormatted}</div>
            <div class="tooltip-winrate">High Skill WR: ${highSkillWinrateFormatted}</div>
        `;

        const combinations = JSON.parse(hotspot.dataset.combinations);
        if (combinations && combinations.length > 0) {
            tooltipContent += `<div class="tooltip-section-title">Strong Combos in Pool:</div>`;
            combinations.slice(0, 5).forEach(combo => { // Show top 5
                const comboPartnerName = (combo.partnerAbilityDisplayName || 'Unknown Partner').replace(/_/g, ' ');
                const comboWrFormatted = combo.synergyWinrate !== null ? `${(parseFloat(combo.synergyWinrate) * 100).toFixed(1)}%` : 'N/A';
                tooltipContent += `<div class="tooltip-combo">- ${comboPartnerName} (${comboWrFormatted})</div>`;
            });
        }

        tooltipElement.innerHTML = tooltipContent;
        tooltipElement.style.display = 'block';
        positionTooltip(hotspot);
        console.log(`Tooltip displayed for ${nameForDisplay} with extended info.`);
    });

    hotspot.addEventListener('mouseleave', () => {
        console.log(`Mouse LEAVE from ${hotspot.dataset.abilityName}`);
        tooltipElement.style.display = 'none';
        console.log('Tooltip hidden');
    });

    document.body.appendChild(hotspot);
}

// overlayRenderer.js

function positionTooltip(hotspotElement) {
    if (!tooltipElement || !hotspotElement) return;

    const hotspotRect = hotspotElement.getBoundingClientRect(); // Position relative to viewport

    // Ensure tooltip is visible to get its dimensions correctly
    // If it was 'display: none', getComputedStyle might not give accurate width/height.
    // Temporarily make it visible but off-screen if needed, then measure, then position.
    // However, it's set to display:block *before* positionTooltip is called, so this should be okay.

    const tooltipStyle = window.getComputedStyle(tooltipElement);
    // Calculate actual rendered width and height including padding and border
    const tooltipWidth = tooltipElement.offsetWidth;
    const tooltipHeight = tooltipElement.offsetHeight;

    if (isNaN(tooltipWidth) || isNaN(tooltipHeight) || tooltipWidth === 0 || tooltipHeight === 0) {
        console.warn('Tooltip dimensions are invalid or zero, cannot position accurately.', `W: ${tooltipWidth}, H: ${tooltipHeight}`);
        // Attempt to give it a default position if dimensions are somehow bad
        tooltipElement.style.left = `${hotspotRect.left}px`;
        tooltipElement.style.top = `${hotspotRect.bottom}px`;
        return;
    }

    // Desired: Tooltip's bottom-right corner at hotspot's bottom-left corner
    let calculatedX = hotspotRect.left - tooltipWidth;
    let calculatedY = hotspotRect.bottom - tooltipHeight;

    // --- Viewport Boundary Adjustments ---
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 5; // Small margin from viewport edges

    // Adjust if tooltip goes off-screen LEFT
    if (calculatedX < margin) {
        calculatedX = margin; // Pin to left edge
        // OPTIONAL: If pinned to left, maybe try to position it to the right of hotspot instead?
        // if (hotspotRect.right + tooltipWidth < viewportWidth - margin) {
        //    calculatedX = hotspotRect.right; // Place to the right
        // }
    }

    // Adjust if tooltip goes off-screen RIGHT
    // (This can happen if pinned to left due to a very wide tooltip, or if hotspot is far right)
    if (calculatedX + tooltipWidth > viewportWidth - margin) {
        calculatedX = viewportWidth - tooltipWidth - margin; // Pin to right edge
    }

    // Adjust if tooltip goes off-screen TOP
    if (calculatedY < margin) {
        calculatedY = margin; // Pin to top edge
        // OPTIONAL: If pinned to top, maybe try to position it below hotspot?
        // if (hotspotRect.bottom + tooltipHeight < viewportHeight - margin) {
        //    calculatedY = hotspotRect.bottom;
        // }
    }

    // Adjust if tooltip goes off-screen BOTTOM
    if (calculatedY + tooltipHeight > viewportHeight - margin) {
        calculatedY = viewportHeight - tooltipHeight - margin; // Pin to bottom edge
    }

    // Ensure X and Y are not negative after all adjustments (covered by pinning to margin)
    // calculatedX = Math.max(margin, calculatedX);
    // calculatedY = Math.max(margin, calculatedY);


    tooltipElement.style.left = `${calculatedX}px`;
    tooltipElement.style.top = `${calculatedY}px`;
    tooltipElement.style.right = 'auto'; // Explicitly set right to auto
    tooltipElement.style.bottom = 'auto';// Explicitly set bottom to auto
    tooltipElement.style.transform = 'none'; // Ensure no transforms are interfering
}


// --- Close Button and Escape Key Logic ---
if (closeOverlayButton && window.electronAPI && window.electronAPI.closeOverlay) {
    // Listener is on controlsContainer now, individual button doesn't need separate
    closeOverlayButton.addEventListener('click', () => {
        console.log('Close button clicked');
        window.electronAPI.closeOverlay();
    });
} else {
    console.warn('Close overlay button or API not found.');
}

console.log('Adding Escape key listener');
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        console.log('Escape key pressed in overlay');
        if (window.electronAPI && window.electronAPI.closeOverlay) {
            window.electronAPI.closeOverlay();
        }
    }
});