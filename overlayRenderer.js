const tooltipElement = document.getElementById('tooltip');
const closeOverlayButton = document.getElementById('close-overlay-btn');
const scanNowButton = document.getElementById('scan-now-btn');
const takeSnapshotButton = document.getElementById('take-snapshot-btn');
const snapshotStatusElement = document.getElementById('snapshot-status');
const controlsContainer = document.getElementById('controls-container');

const opCombinationsContainer = document.getElementById('op-combinations-container');
const opCombinationsWindow = document.getElementById('op-combinations-window');
const opCombinationsListElement = document.getElementById('op-combinations-list');
const hideOpCombinationsButton = document.getElementById('hide-op-combinations-btn');
const showOpCombinationsButton = document.getElementById('show-op-combinations-btn');

let currentCoordinatesConfig = null;
let currentTargetResolution = null;
let currentScaleFactor = 1;
let scanHasBeenPerformed = false;
let isTooltipVisible = false;
let opCombinationsAvailable = false;

let identifiedHeroesCache = [];
let selectedHeroOrder = null;
const MY_HERO_BUTTON_WIDTH = 70;
const MY_HERO_BUTTON_HEIGHT = 25;
const MY_HERO_BUTTON_MARGIN = 5;

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
    opCombinationsListElement.innerHTML = '';
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
        if (opCombinationsWindow.style.display === 'none' && showOpCombinationsButton.style.display !== 'none') {
            opCombinationsWindow.style.display = 'block';
            showOpCombinationsButton.style.display = 'none';
        } else if (opCombinationsWindow.style.display === 'none' && showOpCombinationsButton.style.display === 'none') {
            opCombinationsWindow.style.display = 'block';
            showOpCombinationsButton.style.display = 'none';
        }
    } else {
        opCombinationsAvailable = false;
        opCombinationsWindow.style.display = 'none';
        showOpCombinationsButton.style.display = 'none';
    }
}

function updateMyHeroAbilityHighlights() {
    document.querySelectorAll('.ability-hotspot.selected-ability-hotspot').forEach(hotspot => {
        hotspot.classList.remove('my-hero-selected-ability');
        if (selectedHeroOrder !== null && parseInt(hotspot.dataset.heroOrder) === selectedHeroOrder) {
            hotspot.classList.add('my-hero-selected-ability');
        }
    });
}

function manageMyHeroButtons() {
    document.querySelectorAll('.my-hero-btn, .change-my-hero-btn').forEach(btn => btn.remove());
    if (!scanHasBeenPerformed || !currentCoordinatesConfig || !currentTargetResolution || identifiedHeroesCache.length === 0) {
        return;
    }
    const resolutionCoords = currentCoordinatesConfig.resolutions[currentTargetResolution];
    if (!resolutionCoords || !resolutionCoords.heroes_coords || !resolutionCoords.heroes_params) {
        return;
    }

    if (selectedHeroOrder === null) {
        identifiedHeroesCache.forEach(hero => {
            const heroCoordData = resolutionCoords.heroes_coords.find(hc => hc.hero_order === hero.heroOrder);
            if (heroCoordData) {
                const button = document.createElement('button');
                button.className = 'my-hero-btn';
                button.textContent = 'My Hero';
                button.dataset.heroOrder = hero.heroOrder;
                const heroBoxX = heroCoordData.x / currentScaleFactor;
                const heroBoxY = heroCoordData.y / currentScaleFactor;
                const heroBoxWidth = resolutionCoords.heroes_params.width / currentScaleFactor;
                if (hero.heroOrder <= 4) {
                    button.style.left = `${heroBoxX - MY_HERO_BUTTON_WIDTH - MY_HERO_BUTTON_MARGIN}px`;
                } else {
                    button.style.left = `${heroBoxX + heroBoxWidth + MY_HERO_BUTTON_MARGIN}px`;
                }
                button.style.top = `${heroBoxY + (resolutionCoords.heroes_params.height / currentScaleFactor / 2) - (MY_HERO_BUTTON_HEIGHT / 2)}px`;
                button.style.width = `${MY_HERO_BUTTON_WIDTH}px`;
                button.style.height = `${MY_HERO_BUTTON_HEIGHT}px`;
                button.addEventListener('click', () => {
                    selectedHeroOrder = parseInt(button.dataset.heroOrder);
                    console.log(`[OVERLAY RENDERER] Hero ${selectedHeroOrder} selected.`);
                    manageMyHeroButtons();
                    updateMyHeroAbilityHighlights(); // Update highlights after selection
                });
                document.body.appendChild(button);
            }
        });
    } else {
        const hero = identifiedHeroesCache.find(h => h.heroOrder === selectedHeroOrder);
        const heroCoordData = resolutionCoords.heroes_coords.find(hc => hc.hero_order === selectedHeroOrder);
        if (hero && heroCoordData) {
            const button = document.createElement('button');
            button.className = 'change-my-hero-btn';
            button.textContent = 'Change Hero';
            button.dataset.heroOrder = selectedHeroOrder;
            const heroBoxX = heroCoordData.x / currentScaleFactor;
            const heroBoxY = heroCoordData.y / currentScaleFactor;
            const heroBoxWidth = resolutionCoords.heroes_params.width / currentScaleFactor;
            if (selectedHeroOrder <= 4) {
                button.style.left = `${heroBoxX - MY_HERO_BUTTON_WIDTH - MY_HERO_BUTTON_MARGIN}px`;
            } else {
                button.style.left = `${heroBoxX + heroBoxWidth + MY_HERO_BUTTON_MARGIN}px`;
            }
            button.style.top = `${heroBoxY + (resolutionCoords.heroes_params.height / currentScaleFactor / 2) - (MY_HERO_BUTTON_HEIGHT / 2)}px`;
            button.style.width = `${MY_HERO_BUTTON_WIDTH}px`;
            button.style.height = `${MY_HERO_BUTTON_HEIGHT}px`;
            button.addEventListener('click', () => {
                console.log(`[OVERLAY RENDERER] Hero ${selectedHeroOrder} deselected.`);
                selectedHeroOrder = null;
                manageMyHeroButtons();
                updateMyHeroAbilityHighlights(); // Update highlights after deselection
            });
            document.body.appendChild(button);
        }
    }
}


if (window.electronAPI && window.electronAPI.onOverlayData) {
    window.electronAPI.onOverlayData((data) => {
        console.log('[OVERLAY RENDERER] === New Overlay Data Received ===');
        if (typeof data.scaleFactor === 'number' && data.scaleFactor > 0) {
            currentScaleFactor = data.scaleFactor;
        } else if (data.initialSetup && (!data.scaleFactor || data.scaleFactor <= 0)) {
            currentScaleFactor = 1;
        }
        if (data.coordinatesConfig) currentCoordinatesConfig = data.coordinatesConfig;
        if (data.targetResolution) currentTargetResolution = data.targetResolution;

        if (data && data.error) {
            console.error('[OVERLAY RENDERER] Error message received:', data.error);
            tooltipElement.innerHTML = `<div class="tooltip-title">Error</div><div class="tooltip-winrate">${data.error}</div>`;
            tooltipElement.style.display = 'block';
            isTooltipVisible = true;
            toggleTopTierBordersVisibility(false);
            document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot').forEach(el => el.remove());
            if (scanNowButton) {
                scanNowButton.disabled = false;
                scanNowButton.style.display = 'inline-block';
            }
            if (takeSnapshotButton) takeSnapshotButton.style.display = 'none';
            scanHasBeenPerformed = false;
            updateOPCombinationsDisplay([]);
            return;
        }

        if (data && typeof data.opCombinations !== 'undefined') {
            updateOPCombinationsDisplay(data.opCombinations);
        }

        if (data && data.identifiedHeroes) {
            identifiedHeroesCache = data.identifiedHeroes;
            if (scanHasBeenPerformed) { // Only manage buttons if a scan has occurred
                manageMyHeroButtons();
            }
        }


        if (data && data.initialSetup) {
            console.log('[OVERLAY RENDERER] Initial setup.');
            document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot, .my-hero-btn, .change-my-hero-btn').forEach(el => el.remove());
            selectedHeroOrder = null;
            identifiedHeroesCache = data.identifiedHeroes || []; // Cache if provided during initial setup

            scanHasBeenPerformed = false; // Reset scan status
            if (scanNowButton) {
                scanNowButton.disabled = false;
                scanNowButton.style.display = 'inline-block';
            }
            if (takeSnapshotButton) {
                takeSnapshotButton.style.display = 'none';
                takeSnapshotButton.disabled = true;
            }
            tooltipElement.style.display = 'none';
            isTooltipVisible = false;
            toggleTopTierBordersVisibility(true);
            if (snapshotStatusElement) snapshotStatusElement.style.display = 'none';
            if (typeof data.opCombinations === 'undefined') {
                updateOPCombinationsDisplay([]);
            }
            manageMyHeroButtons(); // Attempt to draw buttons if heroes identified initially
            updateMyHeroAbilityHighlights();


        } else if (data && data.scanData) {
            console.log('[OVERLAY RENDERER] Scan data received.');
            scanHasBeenPerformed = true;
            const receivedScanDataObject = data.scanData;

            if (!receivedScanDataObject || typeof receivedScanDataObject.ultimates === 'undefined' || typeof receivedScanDataObject.standard === 'undefined') {
                console.error('[OVERLAY RENDERER] Scan data object invalid.');
                updateOPCombinationsDisplay(data.opCombinations || []);
                document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot').forEach(el => el.remove());
                return;
            }
            if (!currentCoordinatesConfig || !currentTargetResolution) {
                console.error('[OVERLAY RENDERER] Context missing for scan data.');
                updateOPCombinationsDisplay(data.opCombinations || []);
                document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot').forEach(el => el.remove());
                return;
            }
            const resolutionCoords = currentCoordinatesConfig.resolutions[currentTargetResolution];
            if (!resolutionCoords) {
                console.error(`[OVERLAY RENDERER] Coords for ${currentTargetResolution} not found.`);
                updateOPCombinationsDisplay(data.opCombinations || []);
                document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot').forEach(el => el.remove());
                return;
            }

            try {
                document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot').forEach(el => el.remove());
                createHotspotsForType(receivedScanDataObject.ultimates, resolutionCoords.ultimate_slots_coords, 'ultimates');
                createHotspotsForType(receivedScanDataObject.standard, resolutionCoords.standard_slots_coords, 'standard');

                // Create hotspots for selected abilities
                if (receivedScanDataObject.selectedAbilities && resolutionCoords.selected_abilities_coords && resolutionCoords.selected_abilities_params) {
                    // Map ability data to coordinate data; this assumes the order matches or a unique key can be formed.
                    // For selected abilities, we need their specific coordinates.
                    // The `formattedSelectedAbilities` from main.js already contains `hero_order`.
                    // We need to iterate through `resolutionCoords.selected_abilities_coords` and find the matching ability data.

                    const selectedAbilityHotspotData = [];
                    resolutionCoords.selected_abilities_coords.forEach((coordEntry, index) => {
                        // Find the ability data that matches this coordinate's hero_order and its position within that hero's selected abilities
                        // This assumes `receivedScanDataObject.selectedAbilities` is grouped or can be filtered by hero_order
                        // and then indexed.
                        const abilitiesForThisHeroOrder = receivedScanDataObject.selectedAbilities.filter(ab => ab.hero_order === coordEntry.hero_order);

                        // Determine which ability in `abilitiesForThisHeroOrder` corresponds to `coordEntry`
                        // This requires knowing the order of slots for each hero as defined in `selected_abilities_coords`
                        // We need a way to map the `index` of `coordEntry` within its `hero_order` group
                        let specificAbilityData = null;
                        let countForHeroOrder = 0;
                        for (let i = 0; i < index; i++) {
                            if (resolutionCoords.selected_abilities_coords[i].hero_order === coordEntry.hero_order) {
                                countForHeroOrder++;
                            }
                        }
                        specificAbilityData = abilitiesForThisHeroOrder[countForHeroOrder];


                        if (specificAbilityData && specificAbilityData.internalName) {
                            selectedAbilityHotspotData.push({
                                coord: { // Construct full coordinate object for createHotspot
                                    x: coordEntry.x,
                                    y: coordEntry.y,
                                    width: resolutionCoords.selected_abilities_params.width,
                                    height: resolutionCoords.selected_abilities_params.height,
                                    hero_order: coordEntry.hero_order // Pass hero_order for highlighting
                                },
                                abilityData: specificAbilityData, // This is { internalName, displayName, winrate, etc., hero_order }
                                type: 'selected' // Distinguish type for ID or class
                            });
                        }
                    });

                    selectedAbilityHotspotData.forEach(item => {
                        createHotspot(item.coord, item.abilityData, `sel-${item.coord.hero_order}-${item.abilityData.internalName.slice(0, 5)}`, item.type, true /*isSelecteAbilityHotspot*/);
                    });
                }


                if (data.identifiedHeroes) { // This should always be present with scanData now
                    identifiedHeroesCache = data.identifiedHeroes;
                }
                manageMyHeroButtons();
                updateMyHeroAbilityHighlights();


                if (scanNowButton) {
                    scanNowButton.style.display = 'none';
                    scanNowButton.disabled = true;
                }
                if (takeSnapshotButton) {
                    takeSnapshotButton.style.display = 'block';
                    takeSnapshotButton.disabled = false;
                }
                tooltipElement.style.display = 'none';
                isTooltipVisible = false;
                toggleTopTierBordersVisibility(true);
                if (snapshotStatusElement) snapshotStatusElement.style.display = 'none';

            } catch (hotspotError) {
                console.error('[OVERLAY RENDERER] Error during hotspot/UI update:', hotspotError);
                updateOPCombinationsDisplay(data.opCombinations || []);
                document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot').forEach(el => el.remove());
            }
        } else if (!data.initialSetup) {
            // console.warn('[OVERLAY RENDERER] Received non-initial, non-scanData:', JSON.stringify(data, null, 2));
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
    document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot').forEach(el => el.remove());
}


if (hideOpCombinationsButton && opCombinationsWindow && showOpCombinationsButton) {
    hideOpCombinationsButton.addEventListener('click', () => {
        opCombinationsWindow.style.display = 'none';
        if (opCombinationsAvailable) showOpCombinationsButton.style.display = 'block';
    });
}
if (showOpCombinationsButton && opCombinationsWindow && hideOpCombinationsButton) {
    showOpCombinationsButton.addEventListener('click', () => {
        opCombinationsWindow.style.display = 'block';
        showOpCombinationsButton.style.display = 'none';
    });
}


if (scanNowButton && window.electronAPI && window.electronAPI.executeScanFromOverlay) {
    scanNowButton.addEventListener('click', () => {
        if (scanNowButton.disabled) return;
        scanNowButton.disabled = true;
        if (opCombinationsWindow) opCombinationsWindow.style.display = 'none';
        if (showOpCombinationsButton) showOpCombinationsButton.style.display = 'none';
        document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot, .ability-hotspot').forEach(el => el.remove());
        selectedHeroOrder = null;
        identifiedHeroesCache = [];
        scanHasBeenPerformed = false; // Reset for a new scan cycle

        if (!currentTargetResolution) {
            console.error('Cannot scan, target resolution not set.');
            tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Resolution not set.</div>';
            tooltipElement.style.display = 'block'; isTooltipVisible = true; toggleTopTierBordersVisibility(false);
            scanNowButton.disabled = false; return;
        }
        tooltipElement.innerHTML = `<div class="tooltip-title">Scanning...</div><div class="tooltip-winrate">Identifying for ${currentTargetResolution}.</div>`;
        tooltipElement.style.display = 'block'; isTooltipVisible = true; toggleTopTierBordersVisibility(false);
        if (controlsContainer) { /* position tooltip */ }
        window.electronAPI.executeScanFromOverlay(currentTargetResolution);
    });
}


if (takeSnapshotButton && window.electronAPI && window.electronAPI.takeSnapshot) {
    takeSnapshotButton.addEventListener('click', () => {
        if (!scanHasBeenPerformed || takeSnapshotButton.disabled) {
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
        // Make hero selection buttons also interactive
        const heroButtons = document.querySelectorAll('.my-hero-btn, .change-my-hero-btn');
        let onHeroButton = false;
        heroButtons.forEach(btn => {
            if (btn.matches(':hover')) {
                onHeroButton = true;
            }
        });

        if (interactive || onHeroButton) {
            window.electronAPI.setOverlayMouseEvents(false); // Make overlay clickable
        } else {
            window.electronAPI.setOverlayMouseEvents(true); // Make overlay pass through clicks
        }
    }
}


if (controlsContainer) {
    controlsContainer.addEventListener('mouseenter', () => makeControlsInteractive(true));
    controlsContainer.addEventListener('mouseleave', () => makeControlsInteractive(false));
}
if (opCombinationsWindow) {
    opCombinationsWindow.addEventListener('mouseenter', () => makeControlsInteractive(true));
    opCombinationsWindow.addEventListener('mouseleave', () => makeControlsInteractive(false));
}
if (showOpCombinationsButton) {
    showOpCombinationsButton.addEventListener('mouseenter', () => makeControlsInteractive(true));
    showOpCombinationsButton.addEventListener('mouseleave', () => makeControlsInteractive(false));
}

// Add event delegation for dynamically created hero buttons
document.body.addEventListener('mouseenter', (event) => {
    if (event.target.matches('.my-hero-btn') || event.target.matches('.change-my-hero-btn')) {
        makeControlsInteractive(true);
    }
}, true); // Use capture phase

document.body.addEventListener('mouseleave', (event) => {
    if (event.target.matches('.my-hero-btn') || event.target.matches('.change-my-hero-btn')) {
        // Check if mouse is still over another interactive element before making non-interactive
        setTimeout(() => { // Delay to allow mouse to enter another element
            const isOverControls = controlsContainer ? controlsContainer.matches(':hover') : false;
            const isOverOpWindow = opCombinationsWindow ? opCombinationsWindow.matches(':hover') : false;
            const isOverShowOpButton = showOpCombinationsButton ? showOpCombinationsButton.matches(':hover') : false;
            let isOverAnyHeroButton = false;
            document.querySelectorAll('.my-hero-btn, .change-my-hero-btn').forEach(btn => {
                if (btn.matches(':hover')) isOverAnyHeroButton = true;
            });

            if (!isOverControls && !isOverOpWindow && !isOverShowOpButton && !isOverAnyHeroButton) {
                makeControlsInteractive(false);
            }
        }, 0);
    }
}, true); // Use capture phase


function createHotspotsForType(abilityResultArray, coordArray, type) {
    if (abilityResultArray && Array.isArray(abilityResultArray) && coordArray && Array.isArray(coordArray)) {
        abilityResultArray.forEach((abilityInfo, index) => {
            if (abilityInfo && abilityInfo.internalName && abilityInfo.displayName !== 'Unknown Ability' && coordArray[index]) {
                createHotspot(coordArray[index], abilityInfo, index, type);
            }
        });
    } else {
        console.warn(`Cannot create hotspots for ${type}: invalid data. Abilities: ${!!abilityResultArray}, Coords: ${!!coordArray}`);
    }
}

function createHotspot(coord, abilityData, indexOrUniqueId, type, isSelectedAbilityHotspot = false) {
    const hotspot = document.createElement('div');
    // Use a more specific class for selected ability hotspots for easier querying
    hotspot.className = isSelectedAbilityHotspot ? 'ability-hotspot selected-ability-hotspot' : 'ability-hotspot';
    hotspot.id = `hotspot-${type}-${indexOrUniqueId}`; // indexOrUniqueId can be a string for selected

    hotspot.style.left = `${coord.x / currentScaleFactor}px`;
    hotspot.style.top = `${coord.y / currentScaleFactor}px`;
    hotspot.style.width = `${coord.width / currentScaleFactor}px`;
    hotspot.style.height = `${coord.height / currentScaleFactor}px`;

    // Store hero_order on the hotspot for highlighting "my hero's" abilities
    if (typeof coord.hero_order === 'number') { // For selected abilities, coord will have hero_order
        hotspot.dataset.heroOrder = coord.hero_order;
    } else if (typeof abilityData.hero_order === 'number') { // For draft pool abilities, abilityData might have it
        hotspot.dataset.heroOrder = abilityData.hero_order; // This might be undefined for draft pool abilities from imageProcessor
    }


    if (abilityData.isTopTier && !isSelectedAbilityHotspot) { // Top tier only for draft pool
        hotspot.classList.add('top-tier-ability');
    }

    // Highlight if it's a selected ability of "my hero"
    if (isSelectedAbilityHotspot && selectedHeroOrder !== null && coord.hero_order === selectedHeroOrder) {
        hotspot.classList.add('my-hero-selected-ability');
    }


    hotspot.dataset.abilityName = abilityData.displayName;
    hotspot.dataset.internalName = abilityData.internalName;
    hotspot.dataset.winrate = abilityData.winrate !== null ? abilityData.winrate : 'N/A';
    hotspot.dataset.highSkillWinrate = abilityData.highSkillWinrate !== null ? abilityData.highSkillWinrate : 'N/A';
    // Selected abilities usually don't have combinations relevant to the draft pool in the same way
    hotspot.dataset.combinations = isSelectedAbilityHotspot ? JSON.stringify([]) : JSON.stringify(abilityData.highWinrateCombinations || []);
    hotspot.dataset.isTopTier = String(abilityData.isTopTier === true && !isSelectedAbilityHotspot);
    hotspot.dataset.confidence = abilityData.confidence !== null ? abilityData.confidence.toFixed(2) : 'N/A';


    hotspot.addEventListener('mouseenter', (event) => {
        const nameForDisplay = hotspot.dataset.abilityName.replace(/_/g, ' ');
        let wr = hotspot.dataset.winrate;
        const winrateFormatted = wr !== 'N/A' ? `${(parseFloat(wr) * 100).toFixed(1)}%` : 'N/A';
        let hsWr = hotspot.dataset.highSkillWinrate;
        const highSkillWinrateFormatted = hsWr !== 'N/A' ? `${(parseFloat(hsWr) * 100).toFixed(1)}%` : 'N/A';
        const topTierIndicator = hotspot.dataset.isTopTier === 'true' ? '<span style="color: #66ff66;">&#9733; Top Pick!</span><br>' : '';
        const confidenceIndicator = hotspot.dataset.confidence !== 'N/A' ? `<span style="font-size: 0.8em; color: #aaa;">Confidence: ${hotspot.dataset.confidence}</span><br>` : '';
        const myHeroAbilityIndicator = hotspot.classList.contains('my-hero-selected-ability') ? '<span style="color: #FFD700;">(Your Hero)</span><br>' : '';


        let tooltipContent = `
            ${myHeroAbilityIndicator}
            ${topTierIndicator}
            <div class="tooltip-title">${nameForDisplay}</div>
            <div class="tooltip-winrate">Winrate: ${winrateFormatted}</div>
            <div class="tooltip-winrate">High Skill WR: ${highSkillWinrateFormatted}</div>
            ${confidenceIndicator} 
        `;
        const combinations = JSON.parse(hotspot.dataset.combinations);
        if (combinations && combinations.length > 0) { // Combinations usually for draft pool
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
        toggleTopTierBordersVisibility(false); // Hide shimmer borders for all top-tier when any tooltip is active
        if (hotspot.classList.contains('top-tier-ability')) { // Specifically hide border for the hovered top-tier hotspot
            hotspot.classList.add('snapshot-hidden-border');
        }
        positionTooltip(hotspot);
    });

    hotspot.addEventListener('mouseleave', () => {
        tooltipElement.style.display = 'none';
        isTooltipVisible = false;
        toggleTopTierBordersVisibility(true); // Restore shimmer for all top-tier
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