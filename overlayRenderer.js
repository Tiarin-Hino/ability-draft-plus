// overlayRenderer.js
const tooltipElement = document.getElementById('tooltip');
const closeOverlayButton = document.getElementById('close-overlay-btn');
// For debugging hotspot visibility
// document.body.style.backgroundColor = 'rgba(255, 0, 0, 0.05)';


let currentCoordinatesConfig = null;
let currentTargetResolution = null;

console.log('overlayRenderer.js loaded');

if (window.electronAPI && window.electronAPI.onOverlayData) {
    console.log('Setting up onOverlayData listener');
    window.electronAPI.onOverlayData((data) => {
        console.log('Overlay data received in overlayRenderer:', JSON.stringify(data).substring(0, 300) + "..."); // Log truncated data
        const { abilities, coordinatesConfig, targetResolution } = data;

        if (!abilities || !coordinatesConfig || !targetResolution) {
            console.error('Overlay data is incomplete:', data);
            tooltipElement.textContent = 'Error: Incomplete data for overlay.';
            tooltipElement.style.display = 'block';
            return;
        }

        currentCoordinatesConfig = coordinatesConfig;
        currentTargetResolution = targetResolution;
        const resolutionCoords = currentCoordinatesConfig.resolutions[currentTargetResolution];

        if (!resolutionCoords) {
            console.error('Coordinates for target resolution not found:', targetResolution);
            tooltipElement.textContent = `Error: No coordinates for ${targetResolution}.`;
            tooltipElement.style.display = 'block';
            return;
        }

        document.querySelectorAll('.ability-hotspot').forEach(el => el.remove());
        console.log('Previous hotspots cleared.');

        const createHotspotsForType = (abilityArray, coordArray, type) => {
            if (abilityArray && Array.isArray(abilityArray) && coordArray && Array.isArray(coordArray)) {
                console.log(`Creating hotspots for ${type}, count: ${abilityArray.length}`);
                abilityArray.forEach((abilityInfo, index) => {
                    if (abilityInfo && abilityInfo.displayName && abilityInfo.displayName !== 'Unknown Ability' && coordArray[index]) {
                        createHotspot(coordArray[index], abilityInfo);
                    } else if (abilityInfo && abilityInfo.internalName && coordArray[index]) {
                        // Fallback if displayName was problematic but internalName exists
                        console.warn(`Using internalName as fallback for hotspot: ${abilityInfo.internalName}`);
                        createHotspot(coordArray[index], {
                            ...abilityInfo, // Spread existing properties like winrate
                            displayName: abilityInfo.internalName // Use internalName as displayName
                        });
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
        tooltipElement.textContent = 'Error: Overlay API not available.';
        tooltipElement.style.display = 'block';
    }
}

function createHotspot(coord, abilityData) {
    const hotspot = document.createElement('div');
    hotspot.className = 'ability-hotspot';
    // Make hotspots slightly visible for debugging if needed
    // hotspot.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
    // hotspot.style.border = '1px dashed yellow';

    hotspot.style.left = `${coord.x}px`;
    hotspot.style.top = `${coord.y}px`;
    hotspot.style.width = `${coord.width}px`;
    hotspot.style.height = `${coord.height}px`;

    hotspot.dataset.abilityName = abilityData.displayName;
    hotspot.dataset.winrate = abilityData.winrate !== null ? abilityData.winrate : 'N/A';

    hotspot.addEventListener('mouseenter', (event) => {
        console.log(`Mouse ENTER over ${hotspot.dataset.abilityName}`);
        // REMOVED: if (window.electronAPI) window.electronAPI.setOverlayMouseEvents(false);

        const nameForDisplay = hotspot.dataset.abilityName;
        let wr = hotspot.dataset.winrate;
        const winrateText = wr !== 'N/A' ? `${(parseFloat(wr) * 100).toFixed(1)}% WR` : 'WR: N/A';

        tooltipElement.innerHTML = `<strong>${nameForDisplay.replace(/_/g, ' ')}</strong>\n${winrateText}`;
        tooltipElement.style.display = 'block';
        console.log(`Tooltip displayed for ${nameForDisplay}`);
        positionTooltip(event);
    });

    hotspot.addEventListener('mousemove', (event) => {
        positionTooltip(event);
    });

    hotspot.addEventListener('mouseleave', () => {
        console.log(`Mouse LEAVE from ${hotspot.dataset.abilityName}`);
        tooltipElement.style.display = 'none';
        console.log('Tooltip hidden');
        // No setIgnoreMouseEvents(true) here anymore for hotspots

        // Experiment: Try to force a repaint by briefly changing opacity
        // This might not be effective if the issue is OS/game level compositing
        if (window.electronAPI && window.electronAPI.forceOverlayRepaint) {
            window.electronAPI.forceOverlayRepaint();
        }
    });

    document.body.appendChild(hotspot);
}

function positionTooltip(mouseEvent) {
    const offsetX = 15;
    const offsetY = 15;
    let x = mouseEvent.clientX + offsetX;
    let y = mouseEvent.clientY + offsetY;

    tooltipElement.style.left = `${x}px`;
    tooltipElement.style.top = `${y}px`;

    const tooltipRect = tooltipElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (x + tooltipRect.width > viewportWidth) {
        x = mouseEvent.clientX - tooltipRect.width - offsetX;
    }
    if (y + tooltipRect.height > viewportHeight) {
        y = mouseEvent.clientY - tooltipRect.height - offsetY;
    }
    if (x < 0) x = offsetX;
    if (y < 0) y = offsetY;

    tooltipElement.style.left = `${x}px`;
    tooltipElement.style.top = `${y}px`;
}

if (closeOverlayButton && window.electronAPI && window.electronAPI.closeOverlay) {
    console.log('Adding close button listener');
    closeOverlayButton.addEventListener('click', () => {
        console.log('Close button clicked');
        window.electronAPI.closeOverlay();
    });
    // Keep these for the close button so it can be clicked
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
    // console.log(`Keydown event: ${event.key}`); // Keep for debugging if needed
    if (event.key === 'Escape') {
        console.log('Escape key pressed in overlay');
        if (window.electronAPI && window.electronAPI.closeOverlay) {
            window.electronAPI.closeOverlay();
        } else {
            console.error('Cannot call closeOverlay, API not found.');
        }
    }
});