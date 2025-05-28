const tooltipElement = document.getElementById('tooltip');
const scanStatusPopup = document.getElementById('scan-status-popup');
const closeOverlayButton = document.getElementById('close-overlay-btn');

const initialScanButton = document.getElementById('initial-scan-btn');
const rescanButton = document.getElementById('rescan-btn');
const resetOverlayButton = document.getElementById('reset-overlay-btn'); // ADDED

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

let currentHeroModelData = [];
let currentHeroesForMyHeroUIData = [];

let selectedHeroOrder = null;
let selectedModelHeroOrder_overlay = null;

const MY_HERO_BUTTON_WIDTH = 70;
const MY_HERO_BUTTON_HEIGHT = 25;
const MY_HERO_BUTTON_MARGIN = 5;

const MY_MODEL_BUTTON_WIDTH = 90;
const MY_MODEL_BUTTON_HEIGHT = 25;
const MY_MODEL_BUTTON_MARGIN = 3;

console.log('overlayRenderer.js loaded');

function resetOverlayUI() {
    console.log('[OVERLAY RENDERER] Resetting Overlay UI to initial state.');
    document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot, .hero-model-hotspot, .my-hero-btn-original, .change-my-hero-btn-original, .my-model-btn, .change-my-model-btn').forEach(el => el.remove());

    scanHasBeenPerformed = false;
    selectedHeroOrder = null;
    selectedModelHeroOrder_overlay = null;
    currentHeroModelData = [];
    currentHeroesForMyHeroUIData = [];
    opCombinationsAvailable = false;

    if (initialScanButton) { initialScanButton.style.display = 'inline-block'; initialScanButton.disabled = false; }
    if (rescanButton) rescanButton.style.display = 'none';
    if (takeSnapshotButton) { takeSnapshotButton.style.display = 'none'; takeSnapshotButton.disabled = true; }
    if (resetOverlayButton) resetOverlayButton.style.display = 'none'; // Hide reset button itself

    if (tooltipElement) tooltipElement.style.display = 'none';
    isTooltipVisible = false;
    toggleTopTierBordersVisibility(false);

    if (snapshotStatusElement) snapshotStatusElement.style.display = 'none';
    if (scanStatusPopup) scanStatusPopup.style.display = 'none';

    if (opCombinationsWindow) opCombinationsWindow.style.display = 'none';
    if (opCombinationsListElement) opCombinationsListElement.innerHTML = '';
    if (showOpCombinationsButton) showOpCombinationsButton.style.display = 'none';

    // If there's any specific logic in main.js that needs resetting for a "new game" scenario
    // *without* closing the overlay, we might need an IPC call here.
    // For now, we assume that the next "Initial Scan" will correctly re-initialize main.js state.
    // Re-render empty "My Hero" and "My Model" button containers if they are managed by initial setup
    manageHeroModelButtons();
    manageMyHeroButtons();
    updateVisualHighlights(); // This will ensure borders etc are cleared
    console.log('[OVERLAY RENDERER] Overlay UI reset complete.');
}


function triggerScan(isInitialScan) {
    const scanButtonToDisable = isInitialScan ? initialScanButton : rescanButton;

    if (scanButtonToDisable && scanButtonToDisable.disabled) return;
    if (scanButtonToDisable) scanButtonToDisable.disabled = true;
    if (takeSnapshotButton) takeSnapshotButton.disabled = true;
    if (resetOverlayButton) resetOverlayButton.style.display = 'none'; // Hide reset during scan


    document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot').forEach(el => el.remove());
    if (opCombinationsWindow) opCombinationsWindow.style.display = 'none';
    if (showOpCombinationsButton) showOpCombinationsButton.style.display = 'none';
    if (tooltipElement) tooltipElement.style.display = 'none';
    isTooltipVisible = false;

    toggleTopTierBordersVisibility(false);

    if (!currentTargetResolution) {
        console.error('[OVERLAY RENDERER] Cannot scan, target resolution not set.');
        if (scanStatusPopup) {
            scanStatusPopup.textContent = 'Error: Resolution not set.';
            scanStatusPopup.style.backgroundColor = 'rgba(200,0,0,0.8)';
            scanStatusPopup.style.display = 'block';
        }
        if (scanButtonToDisable) scanButtonToDisable.disabled = false;
        if (takeSnapshotButton && (initialScanButton.style.display === 'none')) takeSnapshotButton.disabled = false;
        // Don't show reset button here if scan failed before first completion
        return;
    }

    if (scanStatusPopup) {
        scanStatusPopup.textContent = `Scanning for ${currentTargetResolution}...`;
        scanStatusPopup.style.backgroundColor = 'rgba(0,100,200,0.8)';
        scanStatusPopup.style.display = 'block';
    }
    console.log(`[OVERLAY RENDERER] Triggering scan. Initial: ${isInitialScan}, Hero Order for Drafting: ${selectedHeroOrder}`);
    window.electronAPI.executeScanFromOverlay(currentTargetResolution, selectedHeroOrder, isInitialScan);
}

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

function manageMyHeroButtons() {
    const allOriginalMyHeroButtons = document.querySelectorAll('.my-hero-btn-original, .change-my-hero-btn-original');
    allOriginalMyHeroButtons.forEach(btn => btn.remove());

    console.log('[ManageMyHeroButtons] Running. SelectedHeroOrder:', selectedHeroOrder, 'UIData Count:', currentHeroesForMyHeroUIData.length);

    if (!currentCoordinatesConfig || !currentTargetResolution || !currentHeroesForMyHeroUIData || currentHeroesForMyHeroUIData.length === 0) {
        return;
    }
    const resolutionCoords = currentCoordinatesConfig.resolutions[currentTargetResolution];
    if (!resolutionCoords || !resolutionCoords.heroes_coords || !resolutionCoords.heroes_params) {
        return;
    }

    currentHeroesForMyHeroUIData.forEach(heroDataForUI => {
        const heroCoordInfo = resolutionCoords.heroes_coords.find(hc => hc.hero_order === heroDataForUI.heroOrder);
        if (heroCoordInfo && heroDataForUI.dbHeroId !== null) {
            const button = document.createElement('button');
            button.dataset.heroOrder = heroDataForUI.heroOrder;
            button.dataset.dbHeroId = heroDataForUI.dbHeroId;

            const heroBoxX = heroCoordInfo.x / currentScaleFactor;
            const heroBoxY = heroCoordInfo.y / currentScaleFactor;
            const heroBoxWidth = resolutionCoords.heroes_params.width / currentScaleFactor;
            if (heroDataForUI.heroOrder <= 4) {
                button.style.left = `${heroBoxX - MY_HERO_BUTTON_WIDTH - MY_HERO_BUTTON_MARGIN}px`;
            } else {
                button.style.left = `${heroBoxX + heroBoxWidth + MY_HERO_BUTTON_MARGIN}px`;
            }
            button.style.top = `${heroBoxY + (resolutionCoords.heroes_params.height / currentScaleFactor / 2) - (MY_HERO_BUTTON_HEIGHT / 2)}px`;
            button.style.width = `${MY_HERO_BUTTON_WIDTH}px`;
            button.style.height = `${MY_HERO_BUTTON_HEIGHT}px`;
            button.style.position = 'absolute';

            if (selectedHeroOrder === heroDataForUI.heroOrder) {
                button.className = 'change-my-hero-btn-original';
                button.textContent = 'Change Hero';
                button.style.display = 'inline-block';
            } else {
                button.className = 'my-hero-btn-original';
                button.textContent = 'My Hero';
                button.style.display = selectedHeroOrder !== null ? 'none' : 'inline-block';
            }

            button.addEventListener('click', () => {
                const clickedHeroOrder = parseInt(button.dataset.heroOrder);
                const clickedDbHeroId = parseInt(button.dataset.dbHeroId);
                window.electronAPI.selectMyHeroForDrafting({
                    heroOrder: clickedHeroOrder,
                    dbHeroId: clickedDbHeroId
                });
            });
            button.addEventListener('mouseenter', () => { if (window.electronAPI) window.electronAPI.setOverlayMouseEvents(false); });
            button.addEventListener('mouseleave', () => { if (window.electronAPI) window.electronAPI.setOverlayMouseEvents(true); });
            document.body.appendChild(button);
        }
    });
}


if (window.electronAPI && window.electronAPI.onOverlayData) {
    window.electronAPI.onOverlayData((data) => {
        console.log('[OVERLAY RENDERER] === New Overlay Data Received ===');

        if (typeof data.scaleFactor === 'number' && data.scaleFactor > 0) currentScaleFactor = data.scaleFactor;
        if (data.coordinatesConfig) currentCoordinatesConfig = data.coordinatesConfig;
        if (data.targetResolution) currentTargetResolution = data.targetResolution;

        if (scanStatusPopup) scanStatusPopup.style.display = 'none';
        if (data && data.error) {
            console.error('[OVERLAY RENDERER] Error message received from main:', data.error);
            if (scanStatusPopup) {
                scanStatusPopup.textContent = `Error: ${data.error}`;
                scanStatusPopup.style.backgroundColor = 'rgba(200, 0, 0, 0.8)';
                scanStatusPopup.style.display = 'block';
            }

            if (initialScanButton && initialScanButton.disabled) initialScanButton.disabled = false;
            if (rescanButton && rescanButton.disabled) rescanButton.disabled = false;
            if (takeSnapshotButton && takeSnapshotButton.disabled && initialScanButton && initialScanButton.style.display === 'none') {
                takeSnapshotButton.disabled = false;
            }
            if (resetOverlayButton && scanHasBeenPerformed) resetOverlayButton.style.display = 'inline-block'; // Show if scan was done before error
            return;
        }

        if (data && typeof data.opCombinations !== 'undefined') updateOPCombinationsDisplay(data.opCombinations);
        if (data && data.heroModels) currentHeroModelData = data.heroModels;
        if (data.heroesForMyHeroUI) currentHeroesForMyHeroUIData = data.heroesForMyHeroUI;

        if (typeof data.selectedHeroForDraftingDbId !== 'undefined') {
            const myHeroEntry = currentHeroesForMyHeroUIData.find(h => h.dbHeroId === data.selectedHeroForDraftingDbId);
            selectedHeroOrder = myHeroEntry ? myHeroEntry.heroOrder : null;
        }
        if (typeof data.selectedModelHeroOrder !== 'undefined') {
            selectedModelHeroOrder_overlay = data.selectedModelHeroOrder;
        }

        if (data && data.initialSetup) {
            console.log('[OVERLAY RENDERER] Processing initialSetup (which is now resetOverlayUI)...');
            resetOverlayUI(); // Use the new reset function for initial setup
            console.log('[OVERLAY RENDERER] Initial setup (via resetOverlayUI) complete.');
        } else if (data && data.scanData) {
            console.log('[OVERLAY RENDERER] Processing scanData...');
            scanHasBeenPerformed = true;

            if (!currentCoordinatesConfig || !currentTargetResolution) {
                console.error('[OVERLAY RENDERER] Crucial config missing. Cannot display hotspots.');
                if (initialScanButton && initialScanButton.disabled) initialScanButton.disabled = false;
                else if (rescanButton && rescanButton.disabled) rescanButton.disabled = false;
                return;
            }
            const resolutionCoords = currentCoordinatesConfig.resolutions[currentTargetResolution];
            if (!resolutionCoords) {
                console.error(`[OVERLAY RENDERER] Coordinate data for resolution "${currentTargetResolution}" not found.`);
                if (initialScanButton && initialScanButton.disabled) initialScanButton.disabled = false;
                else if (rescanButton && rescanButton.disabled) rescanButton.disabled = false;
                return;
            }

            const receivedScanDataObject = data.scanData;
            if (!receivedScanDataObject || typeof receivedScanDataObject.ultimates === 'undefined' || typeof receivedScanDataObject.standard === 'undefined') {
                console.error('[OVERLAY RENDERER] Scan data object invalid.');
                if (initialScanButton && initialScanButton.disabled) initialScanButton.disabled = false;
                else if (rescanButton && rescanButton.disabled) rescanButton.disabled = false;
                return;
            }

            document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot, .hero-model-hotspot, .my-hero-btn-original, .change-my-hero-btn-original, .my-model-btn, .change-my-model-btn').forEach(el => el.remove());

            createHotspotsForType(data.scanData.ultimates, resolutionCoords.ultimate_slots_coords, 'ultimates');
            createHotspotsForType(data.scanData.standard, resolutionCoords.standard_slots_coords, 'standard');
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
            if (currentHeroModelData && currentHeroModelData.length > 0) {
                createHeroModelHotspots(currentHeroModelData);
            }

            manageHeroModelButtons();
            manageMyHeroButtons();
            updateVisualHighlights();

            if (initialScanButton) initialScanButton.style.display = 'none';
            if (rescanButton) { rescanButton.style.display = 'inline-block'; rescanButton.disabled = false; }
            if (takeSnapshotButton) { takeSnapshotButton.style.display = 'block'; takeSnapshotButton.disabled = false; }
            if (resetOverlayButton) resetOverlayButton.style.display = 'inline-block'; // Show Reset button after scan

            if (tooltipElement) tooltipElement.style.display = 'none';
            isTooltipVisible = false;
            toggleTopTierBordersVisibility(true);
            if (snapshotStatusElement) snapshotStatusElement.style.display = 'none';
            console.log('[OVERLAY RENDERER] Scan data processing finished.');
        }
    });
} else {
    console.error('[OVERLAY RENDERER] electronAPI.onOverlayData is not available.');
    // ... existing error handling ...
}

if (resetOverlayButton) { // ADDED Event Listener for Reset Button
    resetOverlayButton.addEventListener('click', () => {
        console.log('[OVERLAY RENDERER] Reset Overlay button clicked.');
        resetOverlayUI();
    });
} // END ADDED

// ... (rest of your overlayRenderer.js, including onMyModelSelectionChanged, onMyHeroForDraftingSelectionChanged, button event listeners, hotspot creation, etc.)
// Ensure other parts of the code handle the visibility of resetOverlayButton correctly if needed (e.g., in triggerScan)

if (window.electronAPI.onMyModelSelectionChanged) {
    window.electronAPI.onMyModelSelectionChanged(({ selectedModelHeroOrder }) => {
        selectedModelHeroOrder_overlay = selectedModelHeroOrder;
        manageHeroModelButtons();
        updateVisualHighlights();
    });
}
if (window.electronAPI.onMyHeroForDraftingSelectionChanged) {
    window.electronAPI.onMyHeroForDraftingSelectionChanged(({ selectedHeroOrderForDrafting }) => {
        selectedHeroOrder = selectedHeroOrderForDrafting;
        manageMyHeroButtons();
        updateVisualHighlights();
    });
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

if (initialScanButton && window.electronAPI && window.electronAPI.executeScanFromOverlay) {
    initialScanButton.addEventListener('click', () => {
        triggerScan(true);
    });
}

if (rescanButton && window.electronAPI && window.electronAPI.executeScanFromOverlay) {
    rescanButton.addEventListener('click', () => {
        triggerScan(false);
    });
}

if (takeSnapshotButton && window.electronAPI && window.electronAPI.takeSnapshot) {
    takeSnapshotButton.addEventListener('click', () => {
        if (!scanHasBeenPerformed || takeSnapshotButton.disabled) return;
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

if (controlsContainer) {
    controlsContainer.addEventListener('mouseenter', () => {
        if (window.electronAPI && window.electronAPI.setOverlayMouseEvents) {
            window.electronAPI.setOverlayMouseEvents(false);
        }
    });
    controlsContainer.addEventListener('mouseleave', () => {
        if (window.electronAPI && window.electronAPI.setOverlayMouseEvents) {
            window.electronAPI.setOverlayMouseEvents(true);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const staticInteractiveElements = [
        document.getElementById('controls-container'),
        document.getElementById('op-combinations-window'),
        document.getElementById('show-op-combinations-btn'),
        document.getElementById('initial-scan-btn'),
        document.getElementById('rescan-btn'),
        document.getElementById('reset-overlay-btn'), // ADDED reset button here
        document.getElementById('close-overlay-btn'),
        document.getElementById('take-snapshot-btn'),
        document.getElementById('hide-op-combinations-btn')
    ];

    staticInteractiveElements.forEach(element => {
        if (element) {
            element.addEventListener('mouseenter', () => {
                if (window.electronAPI && window.electronAPI.setOverlayMouseEvents) {
                    window.electronAPI.setOverlayMouseEvents(false);
                }
            });
            element.addEventListener('mouseleave', () => {
                if (window.electronAPI && window.electronAPI.setOverlayMouseEvents) {
                    window.electronAPI.setOverlayMouseEvents(true);
                }
            });
        }
    });
    if (window.electronAPI && window.electronAPI.setOverlayMouseEvents) {
        window.electronAPI.setOverlayMouseEvents(true);
    }
});

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

    hotspot.style.left = `${coord.x / currentScaleFactor}px`;
    hotspot.style.top = `${coord.y / currentScaleFactor}px`;
    hotspot.style.width = `${coord.width / currentScaleFactor}px`;
    hotspot.style.height = `${coord.height / currentScaleFactor}px`;

    if (typeof coord.hero_order === 'number') {
        hotspot.dataset.heroOrder = coord.hero_order;
    } else if (typeof abilityData.hero_order === 'number') {
        hotspot.dataset.heroOrder = abilityData.hero_order;
    }

    if (abilityData.isTopTier && !isSelectedAbilityHotspot) {
        hotspot.classList.add('top-tier-ability');
    }
    if (isSelectedAbilityHotspot && selectedHeroOrder !== null && coord.hero_order === selectedHeroOrder) {
        hotspot.classList.add('my-hero-selected-ability');
    }

    hotspot.dataset.abilityName = abilityData.displayName;
    hotspot.dataset.internalName = abilityData.internalName;
    hotspot.dataset.winrate = abilityData.winrate !== null ? abilityData.winrate : 'N/A';
    hotspot.dataset.highSkillWinrate = abilityData.highSkillWinrate !== null ? abilityData.highSkillWinrate : 'N/A';
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
        if (combinations && combinations.length > 0) {
            tooltipContent += `<div class="tooltip-section-title">Strong Combinations in Pool:</div>`;
            combinations.slice(0, 5).forEach(combo => {
                const comboPartnerName = (combo.partnerAbilityDisplayName || 'Unknown Partner').replace(/_/g, ' ');
                const comboWrFormatted = combo.synergyWinrate !== null ? `${(parseFloat(combo.synergyWinrate) * 100).toFixed(1)}%` : 'N/A';
                tooltipContent += `<div class="tooltip-combo">- ${comboPartnerName} (${comboWrFormatted} WR)</div>`;
            });
        }

        if (tooltipElement) {
            tooltipElement.innerHTML = tooltipContent;
            tooltipElement.style.display = 'block';
            isTooltipVisible = true;
            toggleTopTierBordersVisibility(false);
            if (hotspot.classList.contains('top-tier-ability')) {
                hotspot.classList.add('snapshot-hidden-border');
            }
            positionTooltip(hotspot);
        }
    });

    hotspot.addEventListener('mouseleave', () => {
        if (tooltipElement) tooltipElement.style.display = 'none';
        isTooltipVisible = false;
        toggleTopTierBordersVisibility(true);
    });
    document.body.appendChild(hotspot);
}

function createHeroModelHotspots(heroModelDataArray) {
    if (!heroModelDataArray || heroModelDataArray.length === 0) return;

    heroModelDataArray.forEach(heroData => {
        if (!heroData.coord) return;

        const coord = heroData.coord;
        const hotspot = document.createElement('div');
        hotspot.className = 'hero-model-hotspot';
        hotspot.id = `hero-model-hotspot-${heroData.heroOrder}`;

        hotspot.style.left = `${coord.x / currentScaleFactor}px`;
        hotspot.style.top = `${coord.y / currentScaleFactor}px`;
        hotspot.style.width = `${coord.width / currentScaleFactor}px`;
        hotspot.style.height = `${coord.height / currentScaleFactor}px`;

        hotspot.dataset.heroName = heroData.heroDisplayName;
        hotspot.dataset.internalHeroName = heroData.heroName;
        hotspot.dataset.winrate = heroData.winrate !== null ? heroData.winrate : 'N/A';
        hotspot.dataset.heroOrder = heroData.heroOrder;
        hotspot.dataset.dbHeroId = heroData.dbHeroId;
        hotspot.dataset.isTopTier = String(heroData.isTopTier === true);
        hotspot.dataset.consolidatedScore = (typeof heroData.consolidatedScore === 'number' ? heroData.consolidatedScore.toFixed(3) : 'N/A');

        if (heroData.isTopTier) hotspot.classList.add('top-tier-hero-model');
        if (selectedModelHeroOrder_overlay !== null && parseInt(hotspot.dataset.heroOrder) === selectedModelHeroOrder_overlay) {
            hotspot.classList.add('is-my-model');
        }

        if (heroData.heroDisplayName !== "Unknown Hero") {
            hotspot.addEventListener('mouseenter', (event) => {
                const nameForDisplay = hotspot.dataset.heroName.replace(/_/g, ' ');
                let wr = hotspot.dataset.winrate;
                const winrateFormatted = wr !== 'N/A' ? `${(parseFloat(wr) * 100).toFixed(1)}%` : 'N/A';
                const topTierIndicator = hotspot.dataset.isTopTier === 'true' ? '<span style="color: #FFD700;">&#9733; Top Model!</span><br>' : '';
                const scoreDisplay = hotspot.dataset.consolidatedScore !== 'N/A' ? `<span style="font-size: 0.8em; color: #ccc;">Score: ${hotspot.dataset.consolidatedScore}</span><br>` : '';

                let tooltipContent = `
                    ${topTierIndicator}
                    <div class="tooltip-title">${nameForDisplay} (Hero Model)</div>
                    <div class="tooltip-winrate">Win Rate: ${winrateFormatted}</div>
                    ${scoreDisplay}
                `;

                if (tooltipElement) {
                    tooltipElement.innerHTML = tooltipContent;
                    tooltipElement.style.display = 'block';
                    isTooltipVisible = true;
                    toggleTopTierBordersVisibility(false);
                    if (hotspot.classList.contains('top-tier-hero-model') || hotspot.classList.contains('is-my-model')) {
                        hotspot.classList.add('snapshot-hidden-border');
                    }
                    positionTooltip(hotspot);
                }
            });

            hotspot.addEventListener('mouseleave', () => {
                if (tooltipElement) tooltipElement.style.display = 'none';
                isTooltipVisible = false;
                toggleTopTierBordersVisibility(true);
                if ((hotspot.classList.contains('top-tier-hero-model') || hotspot.classList.contains('is-my-model')) && hotspot.classList.contains('snapshot-hidden-border')) {
                    hotspot.classList.remove('snapshot-hidden-border');
                }
            });
        }
        document.body.appendChild(hotspot);
    });
}

function manageHeroModelButtons() {
    const allMyModelButtons = document.querySelectorAll('.my-model-btn, .change-my-model-btn');
    allMyModelButtons.forEach(btn => btn.remove());

    if (!currentHeroModelData || currentHeroModelData.length === 0) return;

    currentHeroModelData.forEach(heroModel => {
        if (heroModel.dbHeroId === null && heroModel.heroDisplayName === "Unknown Hero") return;
        const modelHotspotElement = document.getElementById(`hero-model-hotspot-${heroModel.heroOrder}`);
        if (!modelHotspotElement) return;

        const rect = modelHotspotElement.getBoundingClientRect();
        const button = document.createElement('button');
        button.dataset.heroOrder = heroModel.heroOrder;
        button.dataset.dbHeroId = heroModel.dbHeroId;

        button.style.position = 'absolute';
        button.style.top = `${rect.top + (rect.height / 2) - (MY_MODEL_BUTTON_HEIGHT / 2)}px`;
        button.style.width = `${MY_MODEL_BUTTON_WIDTH}px`;
        button.style.height = `${MY_MODEL_BUTTON_HEIGHT}px`;

        if ((heroModel.heroOrder >= 0 && heroModel.heroOrder <= 4) || heroModel.heroOrder === 10) {
            button.style.left = `${rect.left - MY_MODEL_BUTTON_WIDTH - MY_MODEL_BUTTON_MARGIN}px`;
        } else if ((heroModel.heroOrder >= 5 && heroModel.heroOrder <= 9) || heroModel.heroOrder === 11) {
            button.style.left = `${rect.right + MY_MODEL_BUTTON_MARGIN}px`;
        } else {
            button.style.left = `${rect.right + MY_MODEL_BUTTON_MARGIN}px`;
        }

        if (selectedModelHeroOrder_overlay === heroModel.heroOrder) {
            button.className = 'change-my-model-btn';
            button.textContent = 'Change Model';
            button.style.display = 'inline-block';
        } else {
            button.className = 'my-model-btn';
            button.textContent = 'My Model';
            button.style.display = selectedModelHeroOrder_overlay !== null ? 'none' : 'inline-block';
        }

        button.addEventListener('click', () => {
            const clickedHeroOrder = parseInt(button.dataset.heroOrder);
            const clickedDbHeroId = button.dataset.dbHeroId ? parseInt(button.dataset.dbHeroId) : null;
            window.electronAPI.selectMyModel({
                heroOrder: clickedHeroOrder,
                dbHeroId: clickedDbHeroId
            });
        });
        button.addEventListener('mouseenter', () => { if (window.electronAPI) window.electronAPI.setOverlayMouseEvents(false); });
        button.addEventListener('mouseleave', () => { if (window.electronAPI) window.electronAPI.setOverlayMouseEvents(true); });
        document.body.appendChild(button);
    });
}

function updateVisualHighlights() {
    document.querySelectorAll('.ability-hotspot.selected-ability-hotspot').forEach(hotspot => {
        hotspot.classList.remove('my-hero-selected-ability');
        if (selectedHeroOrder !== null && parseInt(hotspot.dataset.heroOrder) === selectedHeroOrder) {
            hotspot.classList.add('my-hero-selected-ability');
        }
    });

    document.querySelectorAll('.hero-model-hotspot').forEach(hotspot => {
        hotspot.classList.remove('is-my-model', 'top-tier-hero-model');
        if (selectedModelHeroOrder_overlay !== null && parseInt(hotspot.dataset.heroOrder) === selectedModelHeroOrder_overlay) {
            hotspot.classList.add('is-my-model');
        }
        if (hotspot.dataset.isTopTier === 'true') {
            hotspot.classList.add('top-tier-hero-model');
        }
    });
    document.querySelectorAll('.ability-hotspot.top-tier-ability').forEach(hotspot => {
        if (!isTooltipVisible) {
            hotspot.classList.remove('snapshot-hidden-border');
        }
    });
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
    if (calculatedX < margin) calculatedX = hotspotRect.right + margin;
    if (calculatedX + tooltipWidth > viewportWidth - margin) calculatedX = viewportWidth - tooltipWidth - margin;
    if (calculatedX < margin) calculatedX = margin;
    if (calculatedY + tooltipHeight > viewportHeight - margin) calculatedY = viewportHeight - tooltipHeight - margin;
    if (calculatedY < margin) calculatedY = margin;
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