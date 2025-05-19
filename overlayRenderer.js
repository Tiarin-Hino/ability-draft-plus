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
                if (hero.heroOrder <= 4) { // Assuming heroOrder 0-4 are on the left, 5-9 on the right
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
            button.dataset.heroOrder = selectedHeroOrder; // Store for potential future use, though click just deselects
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
        // Determine scale factor
        if (typeof data.scaleFactor === 'number' && data.scaleFactor > 0) {
            currentScaleFactor = data.scaleFactor;
        } else if (data.initialSetup && (!data.scaleFactor || data.scaleFactor <= 0)) {
            // Fallback for initial setup if scaleFactor isn't provided or invalid
            currentScaleFactor = 1;
            console.warn('[OVERLAY RENDERER] Scale factor not provided or invalid during initial setup, defaulting to 1.');
        }
        // Persist essential context
        if (data.coordinatesConfig) currentCoordinatesConfig = data.coordinatesConfig;
        if (data.targetResolution) currentTargetResolution = data.targetResolution;

        // Handle error messages
        if (data && data.error) {
            console.error('[OVERLAY RENDERER] Error message received:', data.error);
            tooltipElement.innerHTML = `<div class="tooltip-title">Error</div><div class="tooltip-winrate">${data.error}</div>`;
            tooltipElement.style.display = 'block';
            isTooltipVisible = true;
            toggleTopTierBordersVisibility(false); // Hide borders on error
            // Clear dynamic elements
            document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot, .ability-hotspot').forEach(el => el.remove());
            // Reset scan button state
            if (scanNowButton) {
                scanNowButton.disabled = false;
                scanNowButton.style.display = 'inline-block'; // Ensure it's visible
            }
            if (takeSnapshotButton) takeSnapshotButton.style.display = 'none';
            scanHasBeenPerformed = false; // Reset scan status
            updateOPCombinationsDisplay([]); // Clear OP combinations
            return; // Stop further processing on error
        }

        // Update OP Combinations window
        if (data && typeof data.opCombinations !== 'undefined') {
            updateOPCombinationsDisplay(data.opCombinations);
        }

        // Update identified heroes cache (used by manageMyHeroButtons)
        if (data && data.identifiedHeroes) {
            identifiedHeroesCache = data.identifiedHeroes;
            // Manage hero buttons only if a scan has occurred or during initial setup if heroes are present
            if (scanHasBeenPerformed || data.initialSetup) {
                manageMyHeroButtons();
            }
        }


        // Handle initial setup of the overlay
        if (data && data.initialSetup) {
            console.log('[OVERLAY RENDERER] Initial setup.');
            // Clear previous dynamic elements
            document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot, .my-hero-btn, .change-my-hero-btn').forEach(el => el.remove());
            selectedHeroOrder = null; // Reset selected hero
            identifiedHeroesCache = data.identifiedHeroes || []; // Cache heroes if provided

            scanHasBeenPerformed = false; // Reset scan status
            if (scanNowButton) {
                scanNowButton.disabled = false;
                scanNowButton.style.display = 'inline-block'; // Ensure visible and enabled
            }
            if (takeSnapshotButton) {
                takeSnapshotButton.style.display = 'none'; // Hide snapshot button initially
                takeSnapshotButton.disabled = true;
            }
            tooltipElement.style.display = 'none'; // Hide tooltip
            isTooltipVisible = false;
            toggleTopTierBordersVisibility(true); // Show top-tier borders if any
            if (snapshotStatusElement) snapshotStatusElement.style.display = 'none'; // Hide snapshot status

            // If opCombinations is not explicitly provided in initialSetup, clear it.
            if (typeof data.opCombinations === 'undefined') {
                updateOPCombinationsDisplay([]);
            }
            manageMyHeroButtons(); // Attempt to draw buttons if heroes identified initially
            updateMyHeroAbilityHighlights(); // Update highlights (likely removing all initially)


            // Handle data from a completed scan
        } else if (data && data.scanData) {
            console.log('[OVERLAY RENDERER] Scan data received.');
            scanHasBeenPerformed = true;
            const receivedScanDataObject = data.scanData;

            // Validate essential data structures
            if (!receivedScanDataObject || typeof receivedScanDataObject.ultimates === 'undefined' || typeof receivedScanDataObject.standard === 'undefined') {
                console.error('[OVERLAY RENDERER] Scan data object invalid. Ultimates or standard abilities missing.');
                updateOPCombinationsDisplay(data.opCombinations || []); // Still try to update OP combos
                document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot, .ability-hotspot').forEach(el => el.remove());
                return; // Abort if core scan data is missing
            }
            if (!currentCoordinatesConfig || !currentTargetResolution) {
                console.error('[OVERLAY RENDERER] Coordinate configuration or target resolution missing for scan data display.');
                updateOPCombinationsDisplay(data.opCombinations || []);
                document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot, .ability-hotspot').forEach(el => el.remove());
                return;
            }
            const resolutionCoords = currentCoordinatesConfig.resolutions[currentTargetResolution];
            if (!resolutionCoords) {
                console.error(`[OVERLAY RENDERER] Coordinate data for resolution "${currentTargetResolution}" not found.`);
                updateOPCombinationsDisplay(data.opCombinations || []);
                document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot, .ability-hotspot').forEach(el => el.remove());
                return;
            }

            // Attempt to update UI elements based on scan data
            try {
                document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot').forEach(el => el.remove()); // Clear old hotspots
                createHotspotsForType(receivedScanDataObject.ultimates, resolutionCoords.ultimate_slots_coords, 'ultimates');
                createHotspotsForType(receivedScanDataObject.standard, resolutionCoords.standard_slots_coords, 'standard');

                // Create hotspots for selected abilities (player-picked abilities)
                if (receivedScanDataObject.selectedAbilities && resolutionCoords.selected_abilities_coords && resolutionCoords.selected_abilities_params) {
                    const selectedAbilityHotspotData = [];
                    resolutionCoords.selected_abilities_coords.forEach((coordEntry, index) => {
                        const abilitiesForThisHeroOrder = receivedScanDataObject.selectedAbilities.filter(ab => ab.hero_order === coordEntry.hero_order);
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
                                coord: {
                                    x: coordEntry.x,
                                    y: coordEntry.y,
                                    width: resolutionCoords.selected_abilities_params.width,
                                    height: resolutionCoords.selected_abilities_params.height,
                                    hero_order: coordEntry.hero_order
                                },
                                abilityData: specificAbilityData,
                                type: 'selected'
                            });
                        }
                    });
                    selectedAbilityHotspotData.forEach(item => {
                        createHotspot(item.coord, item.abilityData, `sel-${item.coord.hero_order}-${item.abilityData.internalName.slice(0, 5)}`, item.type, true);
                    });
                }

                // Update identified heroes (if provided) and manage "My Hero" buttons
                if (data.identifiedHeroes) {
                    identifiedHeroesCache = data.identifiedHeroes;
                }
                manageMyHeroButtons();
                updateMyHeroAbilityHighlights();

                // Ensure Scan Now button remains visible and enabled
                if (scanNowButton) {
                    scanNowButton.style.display = 'inline-block';
                    scanNowButton.disabled = false;
                }
                if (takeSnapshotButton) {
                    takeSnapshotButton.style.display = 'block'; // Show snapshot button after a successful scan
                    takeSnapshotButton.disabled = false;
                }
                tooltipElement.style.display = 'none'; // Hide tooltip after scan, will reappear on hover
                isTooltipVisible = false;
                toggleTopTierBordersVisibility(true); // Ensure top-tier borders are visible
                if (snapshotStatusElement) snapshotStatusElement.style.display = 'none'; // Hide snapshot status

            } catch (hotspotError) {
                console.error('[OVERLAY RENDERER] Error during hotspot/UI update after scan:', hotspotError);
                // Attempt to still show OP combinations even if hotspot creation fails
                updateOPCombinationsDisplay(data.opCombinations || []);
                document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot, .ability-hotspot').forEach(el => el.remove());
            }
        } else if (!data.initialSetup) {
            // This case might occur if data is sent that isn't an error, initial setup, or a full scan.
            // console.warn('[OVERLAY RENDERER] Received non-initial, non-scanData:', JSON.stringify(data, null, 2));
        }
    });
} else {
    // Critical error: Electron API not available.
    console.error('[OVERLAY RENDERER] electronAPI.onOverlayData is not available. Preload script might have issues.');
    if (tooltipElement) {
        tooltipElement.innerHTML = '<div class="tooltip-title">API Error</div><div class="tooltip-winrate">Overlay API not available. Cannot function.</div>';
        tooltipElement.style.display = 'block';
        isTooltipVisible = true;
        toggleTopTierBordersVisibility(false);
    }
    if (opCombinationsWindow) opCombinationsWindow.style.display = 'none';
    if (showOpCombinationsButton) showOpCombinationsButton.style.display = 'none';
    // Clear any dynamic elements that might be present
    document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot, .ability-hotspot').forEach(el => el.remove());
    if (scanNowButton) scanNowButton.disabled = true; // Disable scan button as it won't work
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
        if (scanNowButton.disabled) return; // Prevent multiple rapid clicks if needed

        scanNowButton.disabled = true; // Temporarily disable to prevent spamming while processing starts
        // It will be re-enabled explicitly when scan data is processed or on error.

        // Clear previous scan results visually
        if (opCombinationsWindow) opCombinationsWindow.style.display = 'none';
        if (showOpCombinationsButton) showOpCombinationsButton.style.display = 'none';
        document.querySelectorAll('.my-hero-btn, .change-my-hero-btn, .selected-ability-hotspot, .ability-hotspot').forEach(el => el.remove());
        selectedHeroOrder = null;
        identifiedHeroesCache = [];
        // scanHasBeenPerformed = false; // Reset for a new scan cycle -- this is already done in onOverlayData for initialSetup
        // Keeping it false here ensures "My Hero" buttons don't appear prematurely.

        if (!currentTargetResolution) {
            console.error('Cannot scan, target resolution not set.');
            tooltipElement.innerHTML = '<div class="tooltip-title">Error</div><div class="tooltip-winrate">Resolution not set.</div>';
            tooltipElement.style.display = 'block'; isTooltipVisible = true; toggleTopTierBordersVisibility(false);
            scanNowButton.disabled = false; // Re-enable if there's an immediate pre-scan error
            return;
        }

        tooltipElement.innerHTML = `<div class="tooltip-title">Scanning...</div><div class="tooltip-winrate">Identifying for ${currentTargetResolution}.</div>`;
        tooltipElement.style.display = 'block'; isTooltipVisible = true; toggleTopTierBordersVisibility(false);

        // Position tooltip near the scan button or a fixed point if controlsContainer is complex
        if (controlsContainer) { /* you might want to position tooltipElement based on controlsContainer or scanNowButton rect */ }

        window.electronAPI.executeScanFromOverlay(currentTargetResolution);
    });
}


if (takeSnapshotButton && window.electronAPI && window.electronAPI.takeSnapshot) {
    takeSnapshotButton.addEventListener('click', () => {
        if (!scanHasBeenPerformed || takeSnapshotButton.disabled) { // Ensure scan was done and button is enabled
            return;
        }
        console.log('Take Snapshot button clicked.');
        takeSnapshotButton.disabled = true; // Disable to prevent multiple clicks
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

            // Re-enable button if not a fatal error or if retries are allowed
            if (!status.error || status.allowRetry) {
                if (takeSnapshotButton) takeSnapshotButton.disabled = false;
            }

            // Auto-hide message after a delay
            setTimeout(() => {
                snapshotStatusElement.style.display = 'none';
            }, 5000); // Display for 5 seconds
        } else {
            // Fallback if status element isn't found, still manage button state
            if (takeSnapshotButton && (!status.error || status.allowRetry)) takeSnapshotButton.disabled = false;
        }
    });
}


function makeControlsInteractive(interactive) {
    if (window.electronAPI && window.electronAPI.setOverlayMouseEvents) {
        // Check if mouse is over any of the interactive UI elements in the top-right
        const isOverControls = controlsContainer ? controlsContainer.matches(':hover') : false;
        const isOverOpWindow = opCombinationsWindow ? opCombinationsWindow.matches(':hover') : false;
        const isOverShowOpButton = showOpCombinationsButton ? showOpCombinationsButton.matches(':hover') : false;

        let onHeroButton = false;
        document.querySelectorAll('.my-hero-btn, .change-my-hero-btn').forEach(btn => {
            if (btn.matches(':hover')) {
                onHeroButton = true;
            }
        });

        if (interactive || isOverControls || isOverOpWindow || isOverShowOpButton || onHeroButton) {
            window.electronAPI.setOverlayMouseEvents(false); // Make overlay clickable (accept mouse events)
        } else {
            window.electronAPI.setOverlayMouseEvents(true);  // Make overlay pass through clicks
        }
    }
}


if (controlsContainer) {
    controlsContainer.addEventListener('mouseenter', () => makeControlsInteractive(true));
    controlsContainer.addEventListener('mouseleave', () => makeControlsInteractive(false));
}
if (opCombinationsWindow) { // The container for the OP list
    opCombinationsWindow.addEventListener('mouseenter', () => makeControlsInteractive(true));
    opCombinationsWindow.addEventListener('mouseleave', () => makeControlsInteractive(false));
}
if (showOpCombinationsButton) { // The button to show the OP list
    showOpCombinationsButton.addEventListener('mouseenter', () => makeControlsInteractive(true));
    showOpCombinationsButton.addEventListener('mouseleave', () => makeControlsInteractive(false));
}

// Add event delegation for dynamically created "My Hero" and "Change Hero" buttons
document.body.addEventListener('mouseenter', (event) => {
    if (event.target.matches('.my-hero-btn') || event.target.matches('.change-my-hero-btn')) {
        makeControlsInteractive(true);
    }
}, true); // Use capture phase to ensure it fires

document.body.addEventListener('mouseleave', (event) => {
    if (event.target.matches('.my-hero-btn') || event.target.matches('.change-my-hero-btn')) {
        // Delay slightly to check if the mouse entered another interactive element immediately
        setTimeout(() => {
            makeControlsInteractive(false); // This will re-evaluate all hover states
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
    hotspot.className = isSelectedAbilityHotspot ? 'ability-hotspot selected-ability-hotspot' : 'ability-hotspot';
    hotspot.id = `hotspot-${type}-${indexOrUniqueId}`;

    // Apply scaling factor
    hotspot.style.left = `${coord.x / currentScaleFactor}px`;
    hotspot.style.top = `${coord.y / currentScaleFactor}px`;
    hotspot.style.width = `${coord.width / currentScaleFactor}px`;
    hotspot.style.height = `${coord.height / currentScaleFactor}px`;

    // Store hero_order for highlighting "my hero's" abilities
    if (typeof coord.hero_order === 'number') { // For selected abilities, coord will have hero_order
        hotspot.dataset.heroOrder = coord.hero_order;
    } else if (typeof abilityData.hero_order === 'number') { // For draft pool abilities, abilityData might have it
        // This might be undefined for draft pool abilities if not directly assigned during prediction
        // For draft pool, hero_order isn't as relevant for individual hotspots as it is for selected ones.
        // But if available, store it.
        hotspot.dataset.heroOrder = abilityData.hero_order;
    }


    if (abilityData.isTopTier && !isSelectedAbilityHotspot) { // Top tier only for draft pool abilities
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
    // Selected abilities usually don't have combinations relevant *from* the draft pool in the same way the tooltip suggests.
    // The tooltip shows combinations *with* this ability from the draft pool.
    hotspot.dataset.combinations = isSelectedAbilityHotspot ? JSON.stringify([]) : JSON.stringify(abilityData.highWinrateCombinations || []);
    hotspot.dataset.isTopTier = String(abilityData.isTopTier === true && !isSelectedAbilityHotspot); // Only for draft pool
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
        if (combinations && combinations.length > 0) { // Combinations usually for draft pool abilities
            tooltipContent += `<div class="tooltip-section-title">Strong Combinations in Pool:</div>`;
            combinations.slice(0, 5).forEach(combo => { // Show top 5
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
        positionTooltip(hotspot); // Position the tooltip relative to the hotspot
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

    // If dimensions are not yet available (e.g., display:none just removed), try again shortly
    if (isNaN(tooltipWidth) || isNaN(tooltipHeight) || tooltipWidth === 0 || tooltipHeight === 0) {
        // Fallback or very basic positioning if dimensions are weird
        tooltipElement.style.left = `${hotspotRect.left}px`;
        tooltipElement.style.top = `${hotspotRect.bottom}px`;
        return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 10; // Margin from viewport edges and hotspot

    // Try placing to the left of the hotspot first
    let calculatedX = hotspotRect.left - tooltipWidth - margin;
    let calculatedY = hotspotRect.top;

    // If it overflows left, try placing to the right
    if (calculatedX < margin) {
        calculatedX = hotspotRect.right + margin;
    }

    // If it still overflows right (e.g., hotspot is wide or near right edge), adjust
    if (calculatedX + tooltipWidth > viewportWidth - margin) {
        calculatedX = viewportWidth - tooltipWidth - margin; // Stick to right edge
    }
    // Final check to ensure it's not off-screen left if all else fails
    if (calculatedX < margin) {
        calculatedX = margin;
    }


    // Adjust Y to keep tooltip within viewport
    if (calculatedY + tooltipHeight > viewportHeight - margin) {
        calculatedY = viewportHeight - tooltipHeight - margin; // Stick to bottom edge
    }
    if (calculatedY < margin) {
        calculatedY = margin; // Stick to top edge
    }

    tooltipElement.style.left = `${calculatedX}px`;
    tooltipElement.style.top = `${calculatedY}px`;
    tooltipElement.style.right = 'auto'; // Clear any previous 'right'
    tooltipElement.style.bottom = 'auto'; // Clear any previous 'bottom'
    tooltipElement.style.transform = 'none'; // Clear any previous transform
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