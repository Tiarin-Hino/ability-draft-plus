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

let currentHeroModelData = []; // Holds data for identified hero models on screen
let currentHeroesForMyHeroUIData = []; // Holds data for the "My Hero" selection buttons

let selectedHeroOriginalOrder = null; // Original 0-9 order of the user's drafted hero
let selectedModelScreenOrder = null;  // 0-11 screen order of the user-selected "model" hero

console.log('overlayRenderer.js loaded');

// --- Core UI & Scan Logic ---

/**
 * Resets the overlay UI to its initial state.
 * Clears hotspots, dynamic buttons, scan status, and relevant state variables.
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

    // Re-render empty button containers (they will do nothing if data is empty)
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

    if (scanButtonToDisable && scanButtonToDisable.disabled) return; // Prevent multiple rapid clicks

    if (scanButtonToDisable) scanButtonToDisable.disabled = true;
    if (takeSnapshotButton) takeSnapshotButton.disabled = true;
    if (resetOverlayButton && resetOverlayButton.style.display !== 'none') resetOverlayButton.style.display = 'none';

    document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot, .synergy-suggestion-hotspot').forEach(el => el.remove());
    if (opCombinationsWindow) { opCombinationsWindow.style.display = 'none'; opCombinationsWindow.setAttribute('aria-hidden', 'true'); }
    if (showOpCombinationsButton) { showOpCombinationsButton.style.display = 'none'; showOpCombinationsButton.setAttribute('aria-expanded', 'false'); }
    if (opCombinationsListElement) opCombinationsListElement.innerHTML = '';

    hideTooltip();
    toggleTopTierBordersVisibility(false); // Hide borders during scan

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

        // Temporarily disable all animated borders when any tooltip is active
        // This uses the 'snapshot-hidden-border' class which effectively removes borders and animations.
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
    // Restore animated borders if they were hidden by a tooltip
    document.querySelectorAll('.top-tier-ability, .top-tier-hero-model, .synergy-suggestion-hotspot, .is-my-model').forEach(el => {
        el.classList.remove('snapshot-hidden-border');
    });
}

/**
 * Calculates and sets the position of the tooltip relative to the hovered hotspot.
 * Tries to position to the left, then right, then adjusts to fit viewport.
 * @param {HTMLElement} hotspotElement - The hotspot element being hovered.
 */
function positionTooltip(hotspotElement) {
    if (!tooltipElement || !hotspotElement) return;

    const hotspotRect = hotspotElement.getBoundingClientRect();
    const tooltipWidth = tooltipElement.offsetWidth;
    const tooltipHeight = tooltipElement.offsetHeight;

    // Failsafe if dimensions aren't ready
    if (isNaN(tooltipWidth) || isNaN(tooltipHeight) || tooltipWidth === 0 || tooltipHeight === 0) {
        tooltipElement.style.left = `${hotspotRect.left}px`;
        tooltipElement.style.top = `${hotspotRect.bottom + 5}px`;
        return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 10;

    let calculatedX, calculatedY;

    // Try left of hotspot
    calculatedX = hotspotRect.left - tooltipWidth - margin;
    calculatedY = hotspotRect.top;

    // If left doesn't fit, try right
    if (calculatedX < margin) {
        calculatedX = hotspotRect.right + margin;
    }

    // Adjust if still out of bounds horizontally
    if (calculatedX + tooltipWidth > viewportWidth - margin) {
        calculatedX = viewportWidth - tooltipWidth - margin;
    }
    if (calculatedX < margin) { // Final check
        calculatedX = margin;
    }

    // Adjust vertically to fit viewport
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
 * Each abilityInfo in abilityResultArray is expected to have a 'coord' property.
 * @param {Array<object>} abilityResultArray - Array of ability data objects.
 * @param {string} type - The type of ability (e.g., 'ultimates', 'standard').
 * @param {boolean} [isSelectedAbilityHotspot=false] - True if these are for abilities already picked by heroes.
 */
function createHotspotsForType(abilityResultArray, type, isSelectedAbilityHotspot = false) {
    if (!abilityResultArray || !Array.isArray(abilityResultArray)) {
        console.warn(`[OverlayRenderer] Cannot create hotspots for type "${type}": invalid abilityResultArray provided.`);
        return;
    }

    abilityResultArray.forEach((abilityInfo, index) => {
        // Ensure the ability was identified and has its coordinate data
        if (abilityInfo && abilityInfo.internalName && abilityInfo.displayName !== 'Unknown Ability' && abilityInfo.coord) {
            const safeInternalNamePart = (abilityInfo.internalName || 'unknown').replace(/[^a-zA-Z0-9_]/g, '').substring(0, 10);
            createHotspotElement(abilityInfo.coord, abilityInfo, `${type}-${safeInternalNamePart}-${index}`, isSelectedAbilityHotspot);
        } else if (abilityInfo && abilityInfo.coord && !abilityInfo.internalName) {
            // Slot was likely cached but not reconfirmed (empty/changed), no hotspot needed.
        } else if (abilityInfo && !abilityInfo.coord) {
            console.warn(`[OverlayRenderer] Skipping hotspot for ${abilityInfo.internalName || 'unknown ability'} in ${type} list: missing coordinate data.`);
        }
    });
}

/**
 * Creates a single hotspot element for an ability.
 * @param {object} coord - Coordinate data { x, y, width, height, hero_order }.
 * @param {object} abilityData - Detailed data for the ability.
 * @param {string | number} uniqueIdPart - A unique part for the hotspot's ID.
 * @param {boolean} isSelectedAbilityHotspot - True if for an ability picked by a hero.
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
    hotspot.dataset.winrate = abilityData.winrate !== null ? abilityData.winrate.toFixed(3) : 'N/A';
    hotspot.dataset.highSkillWinrate = abilityData.highSkillWinrate !== null ? abilityData.highSkillWinrate.toFixed(3) : 'N/A';
    hotspot.dataset.combinations = JSON.stringify(abilityData.highWinrateCombinations || []);
    hotspot.dataset.confidence = abilityData.confidence !== null ? abilityData.confidence.toFixed(2) : 'N/A';
    hotspot.dataset.isSynergySuggestion = String(abilityData.isSynergySuggestionForMyHero === true && !isSelectedAbilityHotspot);
    hotspot.dataset.isGeneralTopTier = String(abilityData.isGeneralTopTier === true && !isSelectedAbilityHotspot);

    // Apply CSS classes based on suggestion type
    if (abilityData.isSynergySuggestionForMyHero && !isSelectedAbilityHotspot) {
        hotspot.classList.add('synergy-suggestion-hotspot');
    } else if (abilityData.isGeneralTopTier && !isSelectedAbilityHotspot) {
        hotspot.classList.add('top-tier-ability');
    }

    if (isSelectedAbilityHotspot && selectedHeroOriginalOrder !== null && parseInt(hotspot.dataset.heroOrder) === selectedHeroOriginalOrder) {
        hotspot.classList.add('my-hero-selected-ability');
    }

    hotspot.addEventListener('mouseenter', () => {
        const nameForDisplay = hotspot.dataset.abilityName.replace(/_/g, ' ');
        const wr = hotspot.dataset.winrate;
        const winrateFormatted = wr !== 'N/A' ? `${(parseFloat(wr) * 100).toFixed(1)}%` : 'N/A';
        const hsWr = hotspot.dataset.highSkillWinrate;
        const highSkillWinrateFormatted = hsWr !== 'N/A' ? `${(parseFloat(hsWr) * 100).toFixed(1)}%` : 'N/A';

        const synergyIndicator = hotspot.dataset.isSynergySuggestion === 'true' ? '<span style="color: #00BCD4; font-weight: bold;">&#10022; SYNERGY PICK!</span><br>' : '';
        const generalTopTierIndicator = hotspot.dataset.isGeneralTopTier === 'true' ? '<span style="color: #66ff66; font-weight: bold;">&#9733; TOP PICK!</span><br>' : '';
        const confidenceIndicator = hotspot.dataset.confidence !== 'N/A' ? `<span style="font-size: 0.8em; color: #aaa;">Confidence: ${hotspot.dataset.confidence}</span><br>` : '';
        const myHeroAbilityIndicator = hotspot.classList.contains('my-hero-selected-ability') ? '<span style="color: #FFD700;">(Your Hero Pick)</span><br>' : '';

        let tooltipContent = `
            ${myHeroAbilityIndicator}
            ${synergyIndicator} 
            ${generalTopTierIndicator}
            <div class="tooltip-title">${nameForDisplay}</div>
            <div class="tooltip-winrate">Winrate: ${winrateFormatted}</div>
            <div class="tooltip-winrate">High Skill WR: ${highSkillWinrateFormatted}</div>
            ${confidenceIndicator}
        `;

        const combinations = JSON.parse(hotspot.dataset.combinations);
        if (combinations && combinations.length > 0) {
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
        hotspot.id = `hero-model-hotspot-${heroData.heroOrder}`; // heroOrder is screen order (0-11)

        hotspot.style.left = `${heroData.coord.x / currentScaleFactor}px`;
        hotspot.style.top = `${heroData.coord.y / currentScaleFactor}px`;
        hotspot.style.width = `${heroData.coord.width / currentScaleFactor}px`;
        hotspot.style.height = `${heroData.coord.height / currentScaleFactor}px`;

        hotspot.dataset.heroName = heroData.heroDisplayName;
        hotspot.dataset.internalHeroName = heroData.heroName;
        hotspot.dataset.winrate = heroData.winrate !== null ? heroData.winrate.toFixed(3) : 'N/A';
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
            const topTierIndicator = hotspot.dataset.isGeneralTopTier === 'true' ? '<span style="color: #FFD700; font-weight: bold;">&#9733; TOP MODEL!</span><br>' : '';
            const scoreDisplay = hotspot.dataset.consolidatedScore !== 'N/A' ? `<span style="font-size: 0.8em; color: #ccc;">Score: ${hotspot.dataset.consolidatedScore}</span><br>` : '';

            const tooltipContent = `
                ${topTierIndicator}
                <div class="tooltip-title">${nameForDisplay} (Hero Model)</div>
                <div class="tooltip-winrate">Base Win Rate: ${winrateFormatted}</div>
                ${scoreDisplay}
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
 * @param {number} config.dataHeroOrder - The hero_order associated with this button.
 * @param {number | null} config.dataDbHeroId - The database hero_id.
 * @param {string} config.baseClassName - Base CSS class for the button.
 * @param {string} config.changeClassName - CSS class when the button is for "Change".
 * @param {string} config.baseText - Text for the button in its base state.
 * @param {string} config.changeText - Text for "Change" state.
 * @param {boolean} isSelected - Whether this hero/model is currently selected.
 * @param {boolean} anySelected - Whether any hero/model of this type is selected overall.
 * @param {object} positionStyle - CSS styles for positioning (left, top).
 * @param {number} buttonWidth - Width of the button.
 * @param {number} buttonHeight - Height of the button.
 * @param {function} onClickCallback - Callback function when the button is clicked.
 */
function createDynamicButton({
    dataHeroOrder, dataDbHeroId, baseClassName, changeClassName, baseText, changeText,
    isSelected, anySelected, positionStyle, buttonWidth, buttonHeight, onClickCallback
}) {
    const button = document.createElement('button');
    button.classList.add('overlay-button'); // Apply common styling first

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
        // heroDataForUI.heroOrder is the 0-9 original list order
        const heroCoordInfo = resolutionCoords.heroes_coords.find(hc => hc.hero_order === heroDataForUI.heroOrder);
        if (heroCoordInfo && heroDataForUI.dbHeroId !== null) {
            const heroBoxX = heroCoordInfo.x / currentScaleFactor;
            const heroBoxY = heroCoordInfo.y / currentScaleFactor;
            const heroBoxWidth = resolutionCoords.heroes_params.width / currentScaleFactor;
            const heroBoxHeight = resolutionCoords.heroes_params.height / currentScaleFactor;

            const positionStyle = {
                left: (heroDataForUI.heroOrder <= 4) // Dire heroes (left side of screen)
                    ? `${heroBoxX - MY_HERO_BUTTON_WIDTH - MY_HERO_BUTTON_MARGIN}px`
                    : `${heroBoxX + heroBoxWidth + MY_HERO_BUTTON_MARGIN}px`, // Radiant heroes (right)
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
        // heroModel.heroOrder is the 0-11 screen order
        if (heroModel.dbHeroId === null && heroModel.heroDisplayName === "Unknown Hero") return;

        const modelHotspotElement = document.getElementById(`hero-model-hotspot-${heroModel.heroOrder}`);
        if (!modelHotspotElement) return;

        const rect = modelHotspotElement.getBoundingClientRect();
        const positionStyle = {
            top: `${rect.top + (rect.height / 2) - (MY_MODEL_BUTTON_HEIGHT / 2)}px`,
            left: ((heroModel.heroOrder >= 0 && heroModel.heroOrder <= 4) || heroModel.heroOrder === 10) // Left column models
                ? `${rect.left - MY_MODEL_BUTTON_WIDTH - MY_MODEL_BUTTON_MARGIN}px`
                : `${rect.right + MY_MODEL_BUTTON_MARGIN}px` // Right column models
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
    // Highlight abilities selected by "My Hero"
    document.querySelectorAll('.ability-hotspot.selected-ability-hotspot').forEach(hotspot => {
        hotspot.classList.remove('my-hero-selected-ability');
        if (selectedHeroOriginalOrder !== null && parseInt(hotspot.dataset.heroOrder) === selectedHeroOriginalOrder) {
            hotspot.classList.add('my-hero-selected-ability');
        }
    });

    // Highlight "My Model" and "Top Tier" hero models
    document.querySelectorAll('.hero-model-hotspot').forEach(hotspot => {
        if (selectedModelScreenOrder !== null && parseInt(hotspot.dataset.heroOrder) === selectedModelScreenOrder) {
            hotspot.classList.add('is-my-model');
        } else {
            hotspot.classList.remove('is-my-model');
        }
        // Top-tier status is based on data and applied during hotspot creation/update
        // This function primarily handles selection-based highlights.
        // The 'top-tier-hero-model' class should be managed when hero models are created/updated with new scan data.
    });

    // Ensure top-tier ability borders are visible if no tooltip is active
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
        console.error("[OverlayRenderer] OP Combinations UI elements not found.");
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

        // Sync selected hero/model state from main
        if (typeof data.selectedHeroForDraftingDbId !== 'undefined') {
            const myHeroEntry = currentHeroesForMyHeroUIData.find(h => h.dbHeroId === data.selectedHeroForDraftingDbId);
            selectedHeroOriginalOrder = myHeroEntry ? myHeroEntry.heroOrder : null;
        }
        if (typeof data.selectedModelHeroOrder !== 'undefined') {
            selectedModelScreenOrder = data.selectedModelHeroOrder;
        }

        if (data && data.initialSetup) {
            console.log('[OverlayRenderer] Processing initialSetup...');
            resetOverlayUI(); // Ensures a clean state for a new overlay session
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

            // Create hotspots for abilities in draft pool
            createHotspotsForType(data.scanData.ultimates, 'ultimates');
            createHotspotsForType(data.scanData.standard, 'standard');

            // Create hotspots for abilities already selected by heroes
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
        // If showing borders, only do so if no tooltip is active (tooltip manages its own border hiding)
        // If hiding borders, always hide them (e.g., for snapshot).
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
    initialScanButton.addEventListener('click', () => triggerScan(true));
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

// Manage mouse event pass-through for static control areas
document.addEventListener('DOMContentLoaded', () => {
    const staticInteractiveElements = [
        controlsContainer,
        opCombinationsWindow,
        showOpCombinationsButton
    ];
    staticInteractiveElements.forEach(element => {
        if (element) {
            element.addEventListener('mouseenter', () => window.electronAPI?.setOverlayMouseEvents(false));
            element.addEventListener('mouseleave', () => window.electronAPI?.setOverlayMouseEvents(true));
        }
    });
    // Initially, make the overlay click-through
    window.electronAPI?.setOverlayMouseEvents(true);
});

// Global key listener for Esc to close overlay
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        window.electronAPI?.closeOverlay();
    }
});