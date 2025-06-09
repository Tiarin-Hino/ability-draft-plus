// --- DOM Element References ---
const tooltipElement = document.getElementById('tooltip');
const scanStatusPopup = document.getElementById('scan-status-popup');
const closeOverlayButton = document.getElementById('close-overlay-btn');
const initialScanButton = document.getElementById('initial-scan-btn');
const rescanButton = document.getElementById('rescan-btn');
const resetOverlayButton = document.getElementById('reset-overlay-btn');
const takeSnapshotButton = document.getElementById('take-snapshot-btn');
const snapshotStatusElement = document.getElementById('snapshot-status');
const controlsContainer = document.getElementById('controls-container');
const opCombinationsContainer = document.getElementById('op-combinations-container');
const opCombinationsWindow = document.getElementById('op-combinations-window');
const opCombinationsListElement = document.getElementById('op-combinations-list');
const hideOpCombinationsButton = document.getElementById('hide-op-combinations-btn');
const showOpCombinationsButton = document.getElementById('show-op-combinations-btn');
const initialScanConfirmPopup = document.getElementById('initial-scan-confirm-popup');
const confirmScanProceedBtn = document.getElementById('confirm-scan-proceed-btn');
const confirmScanDontShowBtn = document.getElementById('confirm-scan-dont-show-btn');


// --- Constants for Dynamic Buttons ---
const MY_HERO_BUTTON_WIDTH = 70; // px
const MY_HERO_BUTTON_HEIGHT = 25; // px
const MY_HERO_BUTTON_MARGIN = 5; // px

const MY_MODEL_BUTTON_WIDTH = 90; // px
const MY_MODEL_BUTTON_HEIGHT = 25; // px
const MY_MODEL_BUTTON_MARGIN = 3; // px

// --- Module State ---
let currentCoordinatesConfig = null;
let currentTargetResolution = null;
let currentScaleFactor = 1; // Default scale factor
let scanHasBeenPerformed = false;
let isTooltipVisible = false;
let opCombinationsAvailable = false;
let hideInitialScanConfirm = false;

let currentHeroModelData = []; // Holds data for identified hero models on screen
let currentHeroesForMyHeroUIData = []; // Holds data for the "My Hero" selection buttons

let selectedHeroOriginalOrder = null; // Original 0-9 order of the user's drafted hero
let selectedModelScreenOrder = null;  // 0-11 screen order of the user-selected "model" hero

console.log('overlayRenderer.js loaded');

// --- Core UI & Scan Logic ---

/**
 * Loads the user's preference for showing the initial scan confirmation.
 */
function loadScanConfirmPreference() {
    try {
        const storedPref = localStorage.getItem('hideInitialScanConfirm');
        hideInitialScanConfirm = storedPref === 'true';
    } catch (e) {
        console.error("Could not read from localStorage", e);
        hideInitialScanConfirm = false; // Default to showing the confirmation on error
    }
}

/**
 * Resets the overlay UI to its initial state.
 */
function resetOverlayUI() {
    console.log('[OverlayRenderer] Resetting Overlay UI to initial state.');

    // Remove dynamically generated elements
    document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot, .synergy-suggestion-hotspot, .hero-model-hotspot, .my-hero-btn-original, .change-my-hero-btn-original, .my-model-btn, .change-my-model-btn').forEach(el => el.remove());

    // Reset state variables
    scanHasBeenPerformed = false;
    selectedHeroOriginalOrder = null;
    selectedModelScreenOrder = null;
    currentHeroModelData = [];
    currentHeroesForMyHeroUIData = [];
    opCombinationsAvailable = false;

    // Reset button visibility and states
    if (initialScanButton) { initialScanButton.style.display = 'inline-block'; initialScanButton.disabled = false; }
    if (rescanButton) { rescanButton.style.display = 'none'; }
    if (takeSnapshotButton) { takeSnapshotButton.style.display = 'none'; takeSnapshotButton.disabled = true; }
    if (resetOverlayButton) { resetOverlayButton.style.display = 'none'; }

    hideTooltip();
    if (opCombinationsWindow) { opCombinationsWindow.style.display = 'none'; opCombinationsWindow.setAttribute('aria-hidden', 'true'); }
    if (opCombinationsListElement) { opCombinationsListElement.innerHTML = ''; }
    if (showOpCombinationsButton) { showOpCombinationsButton.style.display = 'none'; showOpCombinationsButton.setAttribute('aria-expanded', 'false'); }

    if (snapshotStatusElement) { snapshotStatusElement.textContent = ''; snapshotStatusElement.style.display = 'none'; }
    if (scanStatusPopup) { scanStatusPopup.textContent = ''; scanStatusPopup.style.display = 'none'; }

    toggleTopTierBordersVisibility(false);

    manageHeroModelButtons();
    manageMyHeroButtons();
    updateVisualHighlights();

    console.log('[OverlayRenderer] Overlay UI reset complete.');
}

/**
 * Triggers a scan (initial or rescan) by sending a request to the main process.
 * @param {boolean} isInitialScan - True if it's the first scan, false for a rescan.
 */
function triggerScan(isInitialScan) {
    const scanButtonToDisable = isInitialScan ? initialScanButton : rescanButton;

    if (scanButtonToDisable && scanButtonToDisable.disabled) return;

    if (scanButtonToDisable) scanButtonToDisable.disabled = true;
    if (takeSnapshotButton) takeSnapshotButton.disabled = true;
    if (resetOverlayButton && resetOverlayButton.style.display !== 'none') resetOverlayButton.style.display = 'none';

    document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot, .synergy-suggestion-hotspot').forEach(el => el.remove());
    if (opCombinationsWindow) { opCombinationsWindow.style.display = 'none'; opCombinationsWindow.setAttribute('aria-hidden', 'true'); }
    if (showOpCombinationsButton) { showOpCombinationsButton.style.display = 'none'; showOpCombinationsButton.setAttribute('aria-expanded', 'false'); }
    if (opCombinationsListElement) { opCombinationsListElement.innerHTML = ''; }

    hideTooltip();
    toggleTopTierBordersVisibility(false);

    if (!currentTargetResolution) {
        console.error('[OverlayRenderer] Cannot scan: target resolution not set.');
        showScanStatusPopup('Error: Resolution not set.', true);
        if (scanButtonToDisable) scanButtonToDisable.disabled = false;
        if (takeSnapshotButton && initialScanButton && initialScanButton.style.display === 'none') takeSnapshotButton.disabled = false;
        return;
    }

    showScanStatusPopup(`Scanning for ${currentTargetResolution}...`);
    console.log(`[OverlayRenderer] Triggering scan. Initial: ${isInitialScan}, Hero Order for Drafting: ${selectedHeroOriginalOrder}`);
    window.electronAPI.executeScanFromOverlay(currentTargetResolution, selectedHeroOriginalOrder, isInitialScan);
}

/**
 * Displays a status message in the scan status popup.
 * @param {string} message - The message to display.
 * @param {boolean} [isError=false] - True if the message is an error, for styling.
 */
function showScanStatusPopup(message, isError = false) {
    if (scanStatusPopup) {
        scanStatusPopup.textContent = message;
        scanStatusPopup.style.backgroundColor = isError ? 'rgba(200,0,0,0.8)' : 'rgba(0,100,200,0.8)';
        scanStatusPopup.style.display = 'block';
    }
}

/**
 * Toggles the visibility of borders on top-tier ability hotspots.
 * @param {boolean} visible - True to show borders, false to hide.
 */
function toggleTopTierBordersVisibility(visible) {
    const hotspots = document.querySelectorAll('.ability-hotspot.top-tier-ability, .synergy-suggestion-hotspot, .hero-model-hotspot.top-tier-hero-model, .hero-model-hotspot.is-my-model');
    hotspots.forEach(hotspot => {
        hotspot.classList.toggle('snapshot-hidden-border', !visible);
    });
}

// --- Tooltip Management ---

/** Displays and positions the tooltip with provided content. */
function showTooltip(hotspotElement, content) {
    if (tooltipElement) {
        tooltipElement.innerHTML = content;
        tooltipElement.style.display = 'block';
        tooltipElement.setAttribute('aria-hidden', 'false');
        isTooltipVisible = true;

        document.querySelectorAll('.top-tier-ability, .top-tier-hero-model, .synergy-suggestion-hotspot, .is-my-model').forEach(el => {
            el.classList.add('snapshot-hidden-border');
        });
        positionTooltip(hotspotElement);
    }
}

/** Hides the tooltip. */
function hideTooltip() {
    if (tooltipElement) {
        tooltipElement.style.display = 'none';
        tooltipElement.setAttribute('aria-hidden', 'true');
    }
    isTooltipVisible = false;
    document.querySelectorAll('.top-tier-ability, .top-tier-hero-model, .synergy-suggestion-hotspot, .is-my-model').forEach(el => {
        el.classList.remove('snapshot-hidden-border');
    });
}

/**
 * Calculates and sets the position of the tooltip relative to the hovered hotspot.
 * @param {HTMLElement} hotspotElement - The hotspot element being hovered.
 */
function positionTooltip(hotspotElement) {
    if (!tooltipElement || !hotspotElement) return;

    const hotspotRect = hotspotElement.getBoundingClientRect();
    const tooltipWidth = tooltipElement.offsetWidth;
    const tooltipHeight = tooltipElement.offsetHeight;

    if (isNaN(tooltipWidth) || isNaN(tooltipHeight) || tooltipWidth === 0 || tooltipHeight === 0) {
        tooltipElement.style.left = `${hotspotRect.left}px`;
        tooltipElement.style.top = `${hotspotRect.bottom + 5}px`;
        return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 10;

    let calculatedX, calculatedY;

    calculatedX = hotspotRect.left - tooltipWidth - margin;
    calculatedY = hotspotRect.top;

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


// --- Dynamic UI Element Creation ---

/**
 * Creates and manages ability hotspots based on scan data.
 * @param {Array<object>} abilityResultArray - Array of ability data objects.
 * @param {string} type - The type of ability.
 * @param {boolean} [isSelectedAbilityHotspot=false] - True if for a picked ability.
 */
function createHotspotsForType(abilityResultArray, type, isSelectedAbilityHotspot = false) {
    if (!abilityResultArray || !Array.isArray(abilityResultArray)) {
        return;
    }
    abilityResultArray.forEach((abilityInfo, index) => {
        if (abilityInfo && abilityInfo.internalName && abilityInfo.displayName !== 'Unknown Ability' && abilityInfo.coord) {
            const safeInternalNamePart = (abilityInfo.internalName || 'unknown').replace(/[^a-zA-Z0-9_]/g, '').substring(0, 10);
            createHotspotElement(abilityInfo.coord, abilityInfo, `${type}-${safeInternalNamePart}-${index}`, isSelectedAbilityHotspot);
        }
    });
}

/**
 * Creates a single hotspot element for an ability.
 * @param {object} coord - Coordinate data.
 * @param {object} abilityData - Detailed data for the ability.
 * @param {string | number} uniqueIdPart - A unique part for the hotspot's ID.
 * @param {boolean} isSelectedAbilityHotspot - True if for a picked ability.
 */
function createHotspotElement(coord, abilityData, uniqueIdPart, isSelectedAbilityHotspot) {
    const hotspot = document.createElement('div');
    hotspot.className = isSelectedAbilityHotspot ? 'ability-hotspot selected-ability-hotspot' : 'ability-hotspot';
    hotspot.id = `hotspot-${uniqueIdPart}`;

    hotspot.style.left = `${coord.x / currentScaleFactor}px`;
    hotspot.style.top = `${coord.y / currentScaleFactor}px`;
    hotspot.style.width = `${coord.width / currentScaleFactor}px`;
    hotspot.style.height = `${coord.height / currentScaleFactor}px`;

    hotspot.dataset.heroOrder = coord.hero_order ?? abilityData.hero_order ?? 'unknown';
    hotspot.dataset.abilityName = abilityData.displayName || abilityData.internalName;
    hotspot.dataset.internalName = abilityData.internalName;
    hotspot.dataset.winrate = typeof abilityData.winrate === 'number' ? abilityData.winrate.toFixed(3) : 'N/A';
    hotspot.dataset.highSkillWinrate = typeof abilityData.highSkillWinrate === 'number' ? abilityData.highSkillWinrate.toFixed(3) : 'N/A';
    hotspot.dataset.pickRate = typeof abilityData.pickRate === 'number' ? abilityData.pickRate.toFixed(2) : 'N/A';
    hotspot.dataset.hsPickRate = typeof abilityData.hsPickRate === 'number' ? abilityData.hsPickRate.toFixed(2) : 'N/A';
    hotspot.dataset.combinations = JSON.stringify(abilityData.highWinrateCombinations || []);
    hotspot.dataset.confidence = typeof abilityData.confidence === 'number' ? abilityData.confidence.toFixed(2) : 'N/A';
    hotspot.dataset.isSynergySuggestion = String(abilityData.isSynergySuggestionForMyHero === true && !isSelectedAbilityHotspot);
    hotspot.dataset.isGeneralTopTier = String(abilityData.isGeneralTopTier === true && !isSelectedAbilityHotspot);

    if (isSelectedAbilityHotspot) {
        if (selectedHeroOriginalOrder !== null && parseInt(hotspot.dataset.heroOrder) === selectedHeroOriginalOrder) {
            hotspot.classList.add('my-hero-selected-ability');
        }
    } else {
        if (abilityData.isSynergySuggestionForMyHero) {
            hotspot.classList.add('synergy-suggestion-hotspot');
        } else if (abilityData.isGeneralTopTier) {
            hotspot.classList.add('top-tier-ability');
        }
    }

    hotspot.addEventListener('mouseenter', () => {
        const nameForDisplay = (hotspot.dataset.abilityName || 'Unknown').replace(/_/g, ' ');
        const wr = hotspot.dataset.winrate;
        const winrateFormatted = wr !== 'N/A' ? `${(parseFloat(wr) * 100).toFixed(1)}%` : 'N/A';
        const hsWr = hotspot.dataset.highSkillWinrate;
        const highSkillWinrateFormatted = hsWr !== 'N/A' ? `${(parseFloat(hsWr) * 100).toFixed(1)}%` : 'N/A';
        const pr = hotspot.dataset.pickRate;
        const hsPr = hotspot.dataset.hsPickRate;

        let tooltipContent = '';

        if (hotspot.classList.contains('my-hero-selected-ability')) {
            tooltipContent += '<span style="color: #FFD700;">(Your Hero Pick)</span><br>';
        }
        if (hotspot.dataset.isSynergySuggestion === 'true') {
            tooltipContent += '<span style="color: #00BCD4; font-weight: bold;">&#10022; SYNERGY PICK!</span><br>';
        }
        if (hotspot.dataset.isGeneralTopTier === 'true') {
            tooltipContent += '<span style="color: #66ff66; font-weight: bold;">&#9733; TOP PICK!</span><br>';
        }

        tooltipContent += `
            <div class="tooltip-title">${nameForDisplay}</div>
            <div class="tooltip-stat">Winrate: ${winrateFormatted}</div>
            <div class="tooltip-stat">HS Winrate: ${highSkillWinrateFormatted}</div>
            <div class="tooltip-stat">Pick Rate: ${pr}</div>
            <div class="tooltip-stat">HS Pick Rate: ${hsPr}</div>
        `;

        const combinations = JSON.parse(hotspot.dataset.combinations || '[]');
        if (combinations.length > 0) {
            tooltipContent += `<div class="tooltip-section-title">Strong Synergies (with Pool):</div>`;
            combinations.slice(0, 5).forEach(combo => {
                const comboPartnerName = (combo.partnerAbilityDisplayName || 'Unknown Partner').replace(/_/g, ' ');
                const comboWrFormatted = combo.synergyWinrate !== null ? `${(parseFloat(combo.synergyWinrate) * 100).toFixed(1)}%` : 'N/A';
                tooltipContent += `<div class="tooltip-combo">- ${comboPartnerName} (${comboWrFormatted} WR)</div>`;
            });
        }

        showTooltip(hotspot, tooltipContent);
    });

    hotspot.addEventListener('mouseleave', hideTooltip);
    document.body.appendChild(hotspot);
}


/**
 * Creates hotspots for identified hero models.
 * @param {Array<object>} heroModelDataArray - Array of hero model data.
 */
function createHeroModelHotspots(heroModelDataArray) {
    if (!heroModelDataArray || heroModelDataArray.length === 0) return;

    heroModelDataArray.forEach(heroData => {
        if (!heroData.coord || heroData.heroDisplayName === "Unknown Hero") return;

        const hotspot = document.createElement('div');
        hotspot.className = 'hero-model-hotspot';
        hotspot.id = `hero-model-hotspot-${heroData.heroOrder}`;

        hotspot.style.left = `${heroData.coord.x / currentScaleFactor}px`;
        hotspot.style.top = `${heroData.coord.y / currentScaleFactor}px`;
        hotspot.style.width = `${heroData.coord.width / currentScaleFactor}px`;
        hotspot.style.height = `${heroData.coord.height / currentScaleFactor}px`;

        hotspot.dataset.heroName = heroData.heroDisplayName;
        hotspot.dataset.internalHeroName = heroData.heroName;
        hotspot.dataset.winrate = typeof heroData.winrate === 'number' ? heroData.winrate.toFixed(3) : 'N/A';
        hotspot.dataset.highSkillWinrate = typeof heroData.highSkillWinrate === 'number' ? heroData.highSkillWinrate.toFixed(3) : 'N/A';
        hotspot.dataset.pickRate = typeof heroData.pickRate === 'number' ? heroData.pickRate.toFixed(2) : 'N/A';
        hotspot.dataset.hsPickRate = typeof heroData.hsPickRate === 'number' ? heroData.hsPickRate.toFixed(2) : 'N/A';
        hotspot.dataset.heroOrder = heroData.heroOrder;
        hotspot.dataset.dbHeroId = heroData.dbHeroId;
        hotspot.dataset.isGeneralTopTier = String(heroData.isGeneralTopTier === true);
        hotspot.dataset.consolidatedScore = (typeof heroData.consolidatedScore === 'number' ? heroData.consolidatedScore.toFixed(3) : 'N/A');

        if (heroData.isGeneralTopTier) {
            hotspot.classList.add('top-tier-hero-model');
        }
        if (selectedModelScreenOrder !== null && parseInt(hotspot.dataset.heroOrder) === selectedModelScreenOrder) {
            hotspot.classList.add('is-my-model');
        }

        hotspot.addEventListener('mouseenter', () => {
            const nameForDisplay = hotspot.dataset.heroName.replace(/_/g, ' ');
            const wr = hotspot.dataset.winrate;
            const winrateFormatted = wr !== 'N/A' ? `${(parseFloat(wr) * 100).toFixed(1)}%` : 'N/A';
            const hsWr = hotspot.dataset.highSkillWinrate;
            const hsWinrateFormatted = hsWr !== 'N/A' ? `${(parseFloat(hsWr) * 100).toFixed(1)}%` : 'N/A';
            const pr = hotspot.dataset.pickRate;
            const hsPr = hotspot.dataset.hsPickRate;
            const topTierIndicator = hotspot.dataset.isGeneralTopTier === 'true' ? '<span style="color: #FFD700; font-weight: bold;">&#9733; TOP MODEL!</span><br>' : '';

            const tooltipContent = `
                ${topTierIndicator}
                <div class="tooltip-title">${nameForDisplay}</div>
                <div class="tooltip-stat">Win Rate: ${winrateFormatted}</div>
                <div class="tooltip-stat">HS Win Rate: ${hsWinrateFormatted}</div>
                <div class="tooltip-stat">Pick Rate: ${pr}</div>
                <div class="tooltip-stat">HS Pick Rate: ${hsPr}</div>
            `;
            showTooltip(hotspot, tooltipContent);
        });
        hotspot.addEventListener('mouseleave', hideTooltip);
        document.body.appendChild(hotspot);
    });
}

/**
 * Helper function to create dynamic buttons (My Hero, My Model).
 * @param {object} config - Configuration for the button.
 */
function createDynamicButton({
    dataHeroOrder, dataDbHeroId, baseClassName, changeClassName, baseText, changeText,
    isSelected, anySelected, positionStyle, buttonWidth, buttonHeight, onClickCallback
}) {
    const button = document.createElement('button');
    button.classList.add('overlay-button');

    if (isSelected) {
        button.classList.add(changeClassName);
    } else {
        button.classList.add(baseClassName);
    }

    button.dataset.heroOrder = dataHeroOrder;
    if (dataDbHeroId !== null) button.dataset.dbHeroId = dataDbHeroId;

    button.style.position = 'absolute';
    button.style.width = `${buttonWidth}px`;
    button.style.height = `${buttonHeight}px`;
    Object.assign(button.style, positionStyle);

    button.textContent = isSelected ? changeText : baseText;
    button.style.display = (isSelected || !anySelected) ? 'inline-block' : 'none';

    button.addEventListener('click', onClickCallback);
    button.addEventListener('mouseenter', () => window.electronAPI?.setOverlayMouseEvents(false));
    button.addEventListener('mouseleave', () => window.electronAPI?.setOverlayMouseEvents(true));

    document.body.appendChild(button);
}

/** Creates or updates "My Hero" selection buttons next to hero portraits. */
function manageMyHeroButtons() {
    document.querySelectorAll('.my-hero-btn-original, .change-my-hero-btn-original').forEach(btn => btn.remove());

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
            const heroBoxX = heroCoordInfo.x / currentScaleFactor;
            const heroBoxY = heroCoordInfo.y / currentScaleFactor;
            const heroBoxWidth = resolutionCoords.heroes_params.width / currentScaleFactor;
            const heroBoxHeight = resolutionCoords.heroes_params.height / currentScaleFactor;

            const positionStyle = {
                left: (heroDataForUI.heroOrder <= 4)
                    ? `${heroBoxX - MY_HERO_BUTTON_WIDTH - MY_HERO_BUTTON_MARGIN}px`
                    : `${heroBoxX + heroBoxWidth + MY_HERO_BUTTON_MARGIN}px`,
                top: `${heroBoxY + (heroBoxHeight / 2) - (MY_HERO_BUTTON_HEIGHT / 2)}px`
            };

            createDynamicButton({
                dataHeroOrder: heroDataForUI.heroOrder,
                dataDbHeroId: heroDataForUI.dbHeroId,
                baseClassName: 'my-hero-btn-original',
                changeClassName: 'change-my-hero-btn-original',
                baseText: 'My Hero',
                changeText: 'My Hero (Change)',
                isSelected: selectedHeroOriginalOrder === heroDataForUI.heroOrder,
                anySelected: selectedHeroOriginalOrder !== null,
                positionStyle,
                buttonWidth: MY_HERO_BUTTON_WIDTH,
                buttonHeight: MY_HERO_BUTTON_HEIGHT,
                onClickCallback: () => {
                    window.electronAPI?.selectMyHeroForDrafting({
                        heroOrder: heroDataForUI.heroOrder,
                        dbHeroId: heroDataForUI.dbHeroId
                    });
                }
            });
        }
    });
}

/** Creates or updates "My Model" selection buttons next to hero model hotspots. */
function manageHeroModelButtons() {
    document.querySelectorAll('.my-model-btn, .change-my-model-btn').forEach(btn => btn.remove());

    if (!currentHeroModelData || currentHeroModelData.length === 0) return;

    currentHeroModelData.forEach(heroModel => {
        if (heroModel.dbHeroId === null && heroModel.heroDisplayName === "Unknown Hero") return;

        const modelHotspotElement = document.getElementById(`hero-model-hotspot-${heroModel.heroOrder}`);
        if (!modelHotspotElement) return;

        const rect = modelHotspotElement.getBoundingClientRect();
        const positionStyle = {
            top: `${rect.top + (rect.height / 2) - (MY_MODEL_BUTTON_HEIGHT / 2)}px`,
            left: ((heroModel.heroOrder >= 0 && heroModel.heroOrder <= 4) || heroModel.heroOrder === 10)
                ? `${rect.left - MY_MODEL_BUTTON_WIDTH - MY_MODEL_BUTTON_MARGIN}px`
                : `${rect.right + MY_MODEL_BUTTON_MARGIN}px`
        };

        createDynamicButton({
            dataHeroOrder: heroModel.heroOrder,
            dataDbHeroId: heroModel.dbHeroId,
            baseClassName: 'my-model-btn',
            changeClassName: 'change-my-model-btn',
            baseText: 'Set Model',
            changeText: 'My Model (Change)',
            isSelected: selectedModelScreenOrder === heroModel.heroOrder,
            anySelected: selectedModelScreenOrder !== null,
            positionStyle,
            buttonWidth: MY_MODEL_BUTTON_WIDTH,
            buttonHeight: MY_MODEL_BUTTON_HEIGHT,
            onClickCallback: () => {
                window.electronAPI?.selectMyModel({
                    heroOrder: heroModel.heroOrder,
                    dbHeroId: heroModel.dbHeroId
                });
            }
        });
    });
}

/** Updates visual highlights on hotspots based on current selections. */
function updateVisualHighlights() {
    document.querySelectorAll('.ability-hotspot.selected-ability-hotspot').forEach(hotspot => {
        hotspot.classList.remove('my-hero-selected-ability');
        if (selectedHeroOriginalOrder !== null && parseInt(hotspot.dataset.heroOrder) === selectedHeroOriginalOrder) {
            hotspot.classList.add('my-hero-selected-ability');
        }
    });

    document.querySelectorAll('.hero-model-hotspot').forEach(hotspot => {
        if (selectedModelScreenOrder !== null && parseInt(hotspot.dataset.heroOrder) === selectedModelScreenOrder) {
            hotspot.classList.add('is-my-model');
        } else {
            hotspot.classList.remove('is-my-model');
        }
    });

    if (!isTooltipVisible) {
        toggleTopTierBordersVisibility(true);
    }
}

/**
 * Updates the display of OP (Overpowered) combinations.
 * @param {Array<object>} opCombinations - Array of OP combination data.
 */
function updateOPCombinationsDisplay(opCombinations) {
    if (!opCombinationsWindow || !opCombinationsListElement || !showOpCombinationsButton) {
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
            comboDiv.textContent = `${ability1Display} + ${ability2Display} ${wrFormatted}`;
            opCombinationsListElement.appendChild(comboDiv);
        });
        opCombinationsWindow.style.display = 'block';
        opCombinationsWindow.setAttribute('aria-hidden', 'false');
        showOpCombinationsButton.style.display = 'none';
        showOpCombinationsButton.setAttribute('aria-expanded', 'true');
    } else {
        opCombinationsAvailable = false;
        opCombinationsWindow.style.display = 'none';
        opCombinationsWindow.setAttribute('aria-hidden', 'true');
        showOpCombinationsButton.style.display = 'none';
        showOpCombinationsButton.setAttribute('aria-expanded', 'false');
    }
}

// --- IPC Event Handlers (from Main Process) ---

if (window.electronAPI) {
    window.electronAPI.onOverlayData((data) => {
        console.log('[OverlayRenderer] === New Overlay Data Received ===', data);

        if (typeof data.scaleFactor === 'number' && data.scaleFactor > 0) currentScaleFactor = data.scaleFactor;
        if (data.coordinatesConfig) currentCoordinatesConfig = data.coordinatesConfig;
        if (data.targetResolution) currentTargetResolution = data.targetResolution;

        if (data && data.error) {
            console.error('[OverlayRenderer] Error message received from main:', data.error);
            showScanStatusPopup(`Error: ${data.error}`, true);
            if (initialScanButton && initialScanButton.disabled) initialScanButton.disabled = false;
            if (rescanButton && rescanButton.disabled) rescanButton.disabled = false;
            if (takeSnapshotButton && takeSnapshotButton.disabled && initialScanButton && initialScanButton.style.display === 'none') {
                takeSnapshotButton.disabled = false;
            }
            if (resetOverlayButton && scanHasBeenPerformed) resetOverlayButton.style.display = 'inline-block';
            return;
        }

        if (data && typeof data.opCombinations !== 'undefined') updateOPCombinationsDisplay(data.opCombinations);
        if (data && data.heroModels) currentHeroModelData = data.heroModels;
        if (data.heroesForMyHeroUI) currentHeroesForMyHeroUIData = data.heroesForMyHeroUI;

        if (typeof data.selectedHeroForDraftingDbId !== 'undefined') {
            const myHeroEntry = currentHeroesForMyHeroUIData.find(h => h.dbHeroId === data.selectedHeroForDraftingDbId);
            selectedHeroOriginalOrder = myHeroEntry ? myHeroEntry.heroOrder : null;
        }
        if (typeof data.selectedModelHeroOrder !== 'undefined') {
            selectedModelScreenOrder = data.selectedModelHeroOrder;
        }

        if (data && data.initialSetup) {
            console.log('[OverlayRenderer] Processing initialSetup...');
            resetOverlayUI();
        } else if (data && data.scanData) {
            console.log('[OverlayRenderer] Processing scanData...');
            scanHasBeenPerformed = true;
            if (scanStatusPopup) scanStatusPopup.style.display = 'none';

            if (!currentCoordinatesConfig || !currentTargetResolution) {
                console.error('[OverlayRenderer] Crucial config missing (coordinates/resolution). Cannot display hotspots.');
                showScanStatusPopup('Error: Layout data missing.', true);
                if (initialScanButton && initialScanButton.disabled) initialScanButton.disabled = false;
                else if (rescanButton && rescanButton.disabled) rescanButton.disabled = false;
                return;
            }

            document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot, .synergy-suggestion-hotspot, .hero-model-hotspot, .my-hero-btn-original, .change-my-hero-btn-original, .my-model-btn, .change-my-model-btn').forEach(el => el.remove());

            createHotspotsForType(data.scanData.ultimates, 'ultimates');
            createHotspotsForType(data.scanData.standard, 'standard');

            if (data.scanData.selectedAbilities) {
                createHotspotsForType(data.scanData.selectedAbilities, 'selected', true);
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
            if (resetOverlayButton) resetOverlayButton.style.display = 'inline-block';

            hideTooltip();
            toggleTopTierBordersVisibility(true);
            if (snapshotStatusElement) snapshotStatusElement.style.display = 'none';
            console.log('[OverlayRenderer] Scan data processing finished.');
        }
    });

    window.electronAPI.onMyModelSelectionChanged(({ selectedModelHeroOrder }) => {
        console.log('[OverlayRenderer] My Model selection changed in main. New selection:', selectedModelHeroOrder);
        selectedModelScreenOrder = selectedModelHeroOrder;
        manageHeroModelButtons();
        updateVisualHighlights();
    });

    window.electronAPI.onMyHeroForDraftingSelectionChanged(({ selectedHeroOrderForDrafting }) => {
        console.log('[OverlayRenderer] My Hero (for drafting) selection changed in main. New selection:', selectedHeroOrderForDrafting);
        selectedHeroOriginalOrder = selectedHeroOrderForDrafting;
        manageMyHeroButtons();
        updateVisualHighlights();
    });

    window.electronAPI.onSnapshotTaken((status) => {
        if (snapshotStatusElement) {
            snapshotStatusElement.textContent = status.message;
            snapshotStatusElement.style.backgroundColor = status.error ? 'rgba(200,0,0,0.8)' : 'rgba(0,150,50,0.8)';
            snapshotStatusElement.style.display = 'block';

            if (takeSnapshotButton && (!status.error || status.allowRetry)) {
                takeSnapshotButton.disabled = false;
            }
            setTimeout(() => {
                snapshotStatusElement.style.display = 'none';
            }, 5000);
        } else {
            if (takeSnapshotButton && (!status.error || status.allowRetry)) takeSnapshotButton.disabled = false;
        }
    });

    window.electronAPI.onToggleHotspotBorders((visible) => {
        if (visible) {
            if (!isTooltipVisible) {
                toggleTopTierBordersVisibility(true);
            }
        } else {
            toggleTopTierBordersVisibility(false);
        }
    });

} else {
    console.error('[OverlayRenderer] Electron API not found. Preload script might not be configured correctly.');
    showScanStatusPopup('Error: Application integration issue.', true);
}


// --- Event Listeners for Overlay Controls ---
if (initialScanButton) {
    initialScanButton.addEventListener('click', () => {
        if (hideInitialScanConfirm) {
            triggerScan(true);
        } else {
            if (initialScanConfirmPopup) {
                initialScanConfirmPopup.style.display = 'flex';
                // Prevent clicks from passing through to the game while the popup is visible
                window.electronAPI?.setOverlayMouseEvents(false);
            }
        }
    });
}
if (rescanButton) {
    rescanButton.addEventListener('click', () => triggerScan(false));
}
if (resetOverlayButton) {
    resetOverlayButton.addEventListener('click', resetOverlayUI);
}
if (takeSnapshotButton) {
    takeSnapshotButton.addEventListener('click', () => {
        if (!scanHasBeenPerformed || takeSnapshotButton.disabled) return;
        takeSnapshotButton.disabled = true;
        if (snapshotStatusElement) {
            snapshotStatusElement.textContent = 'Taking snapshot...';
            snapshotStatusElement.style.backgroundColor = 'rgba(0,100,200,0.8)';
            snapshotStatusElement.style.display = 'block';
        }
        window.electronAPI?.takeSnapshot();
    });
}
if (closeOverlayButton) {
    closeOverlayButton.addEventListener('click', () => window.electronAPI?.closeOverlay());
}
if (hideOpCombinationsButton && opCombinationsWindow && showOpCombinationsButton) {
    hideOpCombinationsButton.addEventListener('click', () => {
        opCombinationsWindow.style.display = 'none';
        opCombinationsWindow.setAttribute('aria-hidden', 'true');
        if (opCombinationsAvailable) {
            showOpCombinationsButton.style.display = 'block';
            showOpCombinationsButton.setAttribute('aria-expanded', 'false');
        }
    });
}
if (showOpCombinationsButton && opCombinationsWindow) {
    showOpCombinationsButton.addEventListener('click', () => {
        opCombinationsWindow.style.display = 'block';
        opCombinationsWindow.setAttribute('aria-hidden', 'false');
        showOpCombinationsButton.style.display = 'none';
        showOpCombinationsButton.setAttribute('aria-expanded', 'true');
    });
}
if (confirmScanProceedBtn) {
    confirmScanProceedBtn.addEventListener('click', () => {
        if (initialScanConfirmPopup) {
            initialScanConfirmPopup.style.display = 'none';
            // Allow clicks to pass through again
            window.electronAPI?.setOverlayMouseEvents(true);
        }
        triggerScan(true);
    });
}
if (confirmScanDontShowBtn) {
    confirmScanDontShowBtn.addEventListener('click', () => {
        if (initialScanConfirmPopup) {
            initialScanConfirmPopup.style.display = 'none';
        }
        hideInitialScanConfirm = true;
        try {
            localStorage.setItem('hideInitialScanConfirm', 'true');
        } catch (e) {
            console.error("Could not write to localStorage", e);
        }
        // Allow clicks to pass through again and trigger the scan
        window.electronAPI?.setOverlayMouseEvents(true);
        triggerScan(true);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    loadScanConfirmPreference();

    const staticInteractiveElements = [
        controlsContainer,
        opCombinationsWindow,
        showOpCombinationsButton,
        initialScanConfirmPopup
    ];
    staticInteractiveElements.forEach(element => {
        if (element) {
            element.addEventListener('mouseenter', () => window.electronAPI?.setOverlayMouseEvents(false));
            element.addEventListener('mouseleave', () => window.electronAPI?.setOverlayMouseEvents(true));
        }
    });
    window.electronAPI?.setOverlayMouseEvents(true);
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        window.electronAPI?.closeOverlay();
    }
});