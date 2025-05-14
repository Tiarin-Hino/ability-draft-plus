const tooltipElement = document.getElementById('tooltip');
const closeOverlayButton = document.getElementById('close-overlay-btn');

let currentCoordinatesConfig = null;
let currentTargetResolution = null;

console.log('overlayRenderer.js loaded');

if (window.electronAPI && window.electronAPI.onOverlayData) {
    console.log('Setting up onOverlayData listener');
    window.electronAPI.onOverlayData((data) => {
        console.log('Overlay data received in overlayRenderer:', JSON.stringify(data).substring(0, 300) + "...");
        const { abilities, coordinatesConfig, targetResolution } = data;

        if (!abilities || !coordinatesConfig || !targetResolution) {
            console.error('Overlay data is incomplete:', data);
            tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Incomplete data for overlay.</div>';
            tooltipElement.style.display = 'block';
            return;
        }

        currentCoordinatesConfig = coordinatesConfig;
        currentTargetResolution = targetResolution;
        const resolutionCoords = currentCoordinatesConfig.resolutions[currentTargetResolution];

        if (!resolutionCoords) {
            console.error('Coordinates for target resolution not found:', targetResolution);
            tooltipElement.innerHTML = `<div class="tooltip-title">Error</div><div class="tooltip-winrate">No coordinates for ${targetResolution}.</div>`;
            tooltipElement.style.display = 'block';
            return;
        }

        document.querySelectorAll('.ability-hotspot').forEach(el => el.remove());
        console.log('Previous hotspots cleared.');

        const createHotspotsForType = (abilityArray, coordArray, type) => {
            if (abilityArray && Array.isArray(abilityArray) && coordArray && Array.isArray(coordArray)) {
                console.log(`Creating hotspots for ${type}, count: ${abilityArray.length}`);
                abilityArray.forEach((abilityInfo, index) => { // abilityInfo is now the richer object
                    if (abilityInfo && abilityInfo.displayName && abilityInfo.displayName !== 'Unknown Ability' && coordArray[index]) {
                        createHotspot(coordArray[index], abilityInfo, index, type);
                    } else if (abilityInfo && abilityInfo.internalName && coordArray[index]) {
                        // This case might occur if displayName was null but internalName exists (e.g. "Unknown Ability" or error recovery)
                        createHotspot(coordArray[index], {
                            ...abilityInfo, // Pass the whole structure
                            displayName: abilityInfo.internalName // Fallback display name
                        }, index, type);
                    }
                });
            } else {
                console.warn(`Cannot create hotspots for ${type}: abilityArray or coordArray is invalid. Abilities: ${!!abilityArray}, Coords: ${!!coordArray}`);
            }
        };

        createHotspotsForType(abilities.ultimates, resolutionCoords.ultimate_slots_coords, 'ultimates');
        createHotspotsForType(abilities.standard, resolutionCoords.standard_slots_coords, 'standard');

        console.log('Hotspot creation loop finished.');
    });
} else {
    console.error('electronAPI.onOverlayData is not available. Preload script issue?');
    if (tooltipElement) {
        tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Overlay API not available.</div>';
        tooltipElement.style.display = 'block';
    }
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

function positionTooltip(hotspotElement) {
    if (!tooltipElement || !hotspotElement) return;

    const hotspotRect = hotspotElement.getBoundingClientRect(); // Position relative to viewport

    const tooltipStyle = window.getComputedStyle(tooltipElement);
    const tooltipWidth = parseFloat(tooltipStyle.width) +
        parseFloat(tooltipStyle.paddingLeft) +
        parseFloat(tooltipStyle.paddingRight) +
        parseFloat(tooltipStyle.borderLeftWidth) +
        parseFloat(tooltipStyle.borderRightWidth);
    const tooltipHeight = parseFloat(tooltipStyle.height) +
        parseFloat(tooltipStyle.paddingTop) +
        parseFloat(tooltipStyle.paddingBottom) +
        parseFloat(tooltipStyle.borderTopWidth) +
        parseFloat(tooltipStyle.borderBottomWidth);

    if (isNaN(tooltipWidth) || isNaN(tooltipHeight) || tooltipWidth === 0 || tooltipHeight === 0) {
        console.warn('Tooltip dimensions are invalid or zero, cannot position accurately.', `W: ${tooltipWidth}, H: ${tooltipHeight}`);
        return;
    }

    let calculatedX = hotspotRect.left - tooltipWidth;
    let calculatedY = hotspotRect.bottom - tooltipHeight;

    // --- Viewport Boundary Adjustments ---
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 5; // Small margin from viewport edges

    // If tooltip goes off-screen left
    if (calculatedX < margin) {
        // Fallback 1: Try to place it to the right of the hotspot, aligning bottoms
        calculatedX = hotspotRect.right + margin;
        // If this fallback also makes it go off-screen right
        if (calculatedX + tooltipWidth > viewportWidth - margin) {
            calculatedX = viewportWidth - tooltipWidth - margin; // Clamp to right edge
        }
    }
    // If tooltip (in its primary or fallback-right position) goes off-screen right
    else if (calculatedX + tooltipWidth > viewportWidth - margin) {
        calculatedX = viewportWidth - tooltipWidth - margin; // Clamp to right edge
    }

    // If tooltip goes off-screen top
    if (calculatedY < margin) {
        // Fallback 1: Try to place it below the hotspot (aligning tops)
        calculatedY = hotspotRect.top + hotspotRect.height + margin; // Place below hotspot
        // If this fallback also makes it go off-screen bottom
        if (calculatedY + tooltipHeight > viewportHeight - margin) {
            calculatedY = viewportHeight - tooltipHeight - margin; // Clamp to bottom edge
        }
    }
    // If tooltip (in its primary or fallback-bottom position) goes off-screen bottom
    else if (calculatedY + tooltipHeight > viewportHeight - margin) {
        calculatedY = viewportHeight - tooltipHeight - margin; // Clamp to bottom edge
    }

    // Final ensure it's not negative after all adjustments
    calculatedX = Math.max(margin, calculatedX);
    calculatedY = Math.max(margin, calculatedY);

    // Ensure it doesn't exceed viewport again after clamping (important for very small viewports)
    if (calculatedX + tooltipWidth > viewportWidth - margin) {
        calculatedX = Math.max(margin, viewportWidth - tooltipWidth - margin);
    }
    if (calculatedY + tooltipHeight > viewportHeight - margin) {
        calculatedY = Math.max(margin, viewportHeight - tooltipHeight - margin);
    }


    tooltipElement.style.left = `${calculatedX}px`;
    tooltipElement.style.top = `${calculatedY}px`;
}


// --- Close Button and Escape Key Logic (Remains the same) ---
if (closeOverlayButton && window.electronAPI && window.electronAPI.closeOverlay) {
    console.log('Adding close button listener');
    closeOverlayButton.addEventListener('click', () => {
        console.log('Close button clicked');
        window.electronAPI.closeOverlay();
    });

    closeOverlayButton.addEventListener('mouseenter', () => {
        console.log('Mouse ENTER over close button');
        if (window.electronAPI) window.electronAPI.setOverlayMouseEvents(false);
    });
    closeOverlayButton.addEventListener('mouseleave', () => {
        console.log('Mouse LEAVE from close button');
        if (window.electronAPI) window.electronAPI.setOverlayMouseEvents(true);
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
        } else {
            console.error('Cannot call closeOverlay, API not found.');
        }
    }
});