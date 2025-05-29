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
let selectedModelScreenOrder = null; // 0-11 screen order of the user-selected "model" hero

console.log('overlayRenderer.js loaded');

// --- Core UI & Scan Logic ---

/**
 * Resets the overlay UI to its initial state.
 * Clears hotspots, dynamic buttons, scan status, and relevant state variables.
 */
function resetOverlayUI() {
    console.log('[OverlayRenderer] Resetting Overlay UI to initial state.');

    // Remove dynamically generated elements
    document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot, .hero-model-hotspot, .my-hero-btn-original, .change-my-hero-btn-original, .my-model-btn, .change-my-model-btn').forEach(el => el.remove());

    // Reset state variables
    scanHasBeenPerformed = false;
    selectedHeroOriginalOrder = null; // User's own hero choice for drafting
    selectedModelScreenOrder = null;  // User's choice for "My Model" suggestion basis
    currentHeroModelData = [];
    currentHeroesForMyHeroUIData = [];
    opCombinationsAvailable = false;

    // Reset button visibility and states
    if (initialScanButton) { initialScanButton.style.display = 'inline-block'; initialScanButton.disabled = false; }
    if (rescanButton) { rescanButton.style.display = 'none'; }
    if (takeSnapshotButton) { takeSnapshotButton.style.display = 'none'; takeSnapshotButton.disabled = true; }
    if (resetOverlayButton) { resetOverlayButton.style.display = 'none'; } // Hide reset button itself until after a scan

    // Hide tooltip and OP combinations window
    hideTooltip();
    if (opCombinationsWindow) { opCombinationsWindow.style.display = 'none'; opCombinationsWindow.setAttribute('aria-hidden', 'true'); }
    if (opCombinationsListElement) { opCombinationsListElement.innerHTML = ''; }
    if (showOpCombinationsButton) { showOpCombinationsButton.style.display = 'none'; showOpCombinationsButton.setAttribute('aria-expanded', 'false'); }

    // Reset status messages
    if (snapshotStatusElement) { snapshotStatusElement.textContent = ''; snapshotStatusElement.style.display = 'none'; }
    if (scanStatusPopup) { scanStatusPopup.textContent = ''; scanStatusPopup.style.display = 'none'; }

    // Ensure borders are correctly set (likely hidden initially)
    toggleTopTierBordersVisibility(false);

    // Re-render empty button containers if they are managed by initial setup (they are dynamically added)
    manageHeroModelButtons(); // Will do nothing if currentHeroModelData is empty
    manageMyHeroButtons();    // Will do nothing if currentHeroesForMyHeroUIData is empty
    updateVisualHighlights(); // Clears any remaining highlights

    console.log('[OverlayRenderer] Overlay UI reset complete.');
}

/**
 * Triggers a scan (initial or rescan) by sending a request to the main process.
 * @param {boolean} isInitialScan - True if it's the first scan, false for a rescan.
 */
function triggerScan(isInitialScan) {
    const scanButtonToDisable = isInitialScan ? initialScanButton : rescanButton;

    if (scanButtonToDisable && scanButtonToDisable.disabled) return; // Prevent multiple rapid clicks

    // Disable buttons during scan
    if (scanButtonToDisable) scanButtonToDisable.disabled = true;
    if (takeSnapshotButton) takeSnapshotButton.disabled = true;
    if (resetOverlayButton && resetOverlayButton.style.display !== 'none') resetOverlayButton.style.display = 'none';


    // Clear previous visual elements
    document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot').forEach(el => el.remove());
    // OP combinations window is hidden, list cleared
    if (opCombinationsWindow) { opCombinationsWindow.style.display = 'none'; opCombinationsWindow.setAttribute('aria-hidden', 'true'); }
    if (showOpCombinationsButton) { showOpCombinationsButton.style.display = 'none'; showOpCombinationsButton.setAttribute('aria-expanded', 'false'); }
    if (opCombinationsListElement) opCombinationsListElement.innerHTML = ''; // Clear list content

    hideTooltip();
    toggleTopTierBordersVisibility(false); // Hide borders during scan

    if (!currentTargetResolution) {
        console.error('[OverlayRenderer] Cannot scan: target resolution not set.');
        showScanStatusPopup('Error: Resolution not set.', true);
        if (scanButtonToDisable) scanButtonToDisable.disabled = false;
        if (takeSnapshotButton && initialScanButton && initialScanButton.style.display === 'none') takeSnapshotButton.disabled = false;
        // Do not show reset button here if scan failed before first completion
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
    const hotspots = document.querySelectorAll('.ability-hotspot.top-tier-ability');
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
        toggleTopTierBordersVisibility(false); // Hide all top-tier borders when any tooltip is active
        if (hotspotElement.classList.contains('top-tier-ability') || hotspotElement.classList.contains('top-tier-hero-model') || hotspotElement.classList.contains('is-my-model')) {
            hotspotElement.classList.add('snapshot-hidden-border'); // Specifically hide border of the hovered top-tier item
        }
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
    toggleTopTierBordersVisibility(true); // Restore top-tier borders when no tooltip is active
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

    // Failsafe if dimensions aren't ready (e.g., tooltip content changed and reflow pending)
    if (isNaN(tooltipWidth) || isNaN(tooltipHeight) || tooltipWidth === 0 || tooltipHeight === 0) {
        tooltipElement.style.left = `${hotspotRect.left}px`;
        tooltipElement.style.top = `${hotspotRect.bottom + 5}px`; // Default below hotspot
        return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 10; // Margin from viewport edges and hotspot

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
    if (calculatedX < margin) { // Final check if it's too wide for any side
        calculatedX = margin;
    }

    // Adjust vertically to fit viewport (try to keep it level with hotspot top)
    if (calculatedY + tooltipHeight > viewportHeight - margin) {
        calculatedY = viewportHeight - tooltipHeight - margin;
    }
    if (calculatedY < margin) {
        calculatedY = margin;
    }

    tooltipElement.style.left = `${calculatedX}px`;
    tooltipElement.style.top = `${calculatedY}px`;
    tooltipElement.style.right = 'auto'; // Reset potentially conflicting styles
    tooltipElement.style.bottom = 'auto';
    tooltipElement.style.transform = 'none'; // Reset transforms if any
}


// --- Dynamic UI Element Creation ---

/**
 * Creates and manages ability hotspots based on scan data.
 * @param {Array<object>} abilityResultArray - Array of ability data objects.
 * @param {Array<object>} coordArray - Array of coordinate objects for these abilities.
 * @param {string} type - The type of ability (e.g., 'ultimates', 'standard').
 * @param {boolean} [isSelectedAbilityHotspot=false] - True if these are for abilities already picked by heroes.
 */
function createHotspotsForType(abilityResultArray, coordArray, type, isSelectedAbilityHotspot = false) {
    if (!abilityResultArray || !Array.isArray(abilityResultArray) || !coordArray || !Array.isArray(coordArray)) {
        console.warn(`[OverlayRenderer] Cannot create hotspots for type "${type}": invalid data provided.`);
        return;
    }

    abilityResultArray.forEach((abilityInfo, index) => {
        // Ensure there's a corresponding coordinate entry and the ability was identified
        if (abilityInfo && abilityInfo.internalName && abilityInfo.displayName !== 'Unknown Ability' && coordArray[index]) {
            createHotspotElement(coordArray[index], abilityInfo, `${type}-${index}`, isSelectedAbilityHotspot);
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
    hotspot.id = `hotspot-${uniqueIdPart}`; // More specific ID

    // Apply scaling to coordinates
    hotspot.style.left = `${coord.x / currentScaleFactor}px`;
    hotspot.style.top = `${coord.y / currentScaleFactor}px`;
    hotspot.style.width = `${coord.width / currentScaleFactor}px`;
    hotspot.style.height = `${coord.height / currentScaleFactor}px`;

    // Store data attributes for tooltip and other logic
    hotspot.dataset.heroOrder = coord.hero_order ?? abilityData.hero_order ?? 'unknown';
    hotspot.dataset.abilityName = abilityData.displayName || abilityData.internalName;
    hotspot.dataset.internalName = abilityData.internalName;
    hotspot.dataset.winrate = abilityData.winrate !== null ? abilityData.winrate.toFixed(3) : 'N/A';
    hotspot.dataset.highSkillWinrate = abilityData.highSkillWinrate !== null ? abilityData.highSkillWinrate.toFixed(3) : 'N/A';
    hotspot.dataset.combinations = JSON.stringify(abilityData.highWinrateCombinations || []);
    hotspot.dataset.isTopTier = String(abilityData.isTopTier === true && !isSelectedAbilityHotspot);
    hotspot.dataset.confidence = abilityData.confidence !== null ? abilityData.confidence.toFixed(2) : 'N/A';

    // Add classes for styling based on data
    if (abilityData.isTopTier && !isSelectedAbilityHotspot) {
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

        const topTierIndicator = hotspot.dataset.isTopTier === 'true' ? '<span style="color: #66ff66;">&#9733; Top Pick!</span><br>' : '';
        const confidenceIndicator = hotspot.dataset.confidence !== 'N/A' ? `<span style="font-size: 0.8em; color: #aaa;">Confidence: ${hotspot.dataset.confidence}</span><br>` : '';
        const myHeroAbilityIndicator = hotspot.classList.contains('my-hero-selected-ability') ? '<span style="color: #FFD700;">(Your Hero Pick)</span><br>' : '';

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
            combinations.slice(0, 5).forEach(combo => { // Show top 5
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
        if (!heroData.coord || heroData.heroDisplayName === "Unknown Hero") return; // Skip if no coords or unknown

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
        hotspot.dataset.heroOrder = heroData.heroOrder; // Screen order (0-11)
        hotspot.dataset.dbHeroId = heroData.dbHeroId;
        hotspot.dataset.isTopTier = String(heroData.isTopTier === true);
        hotspot.dataset.consolidatedScore = (typeof heroData.consolidatedScore === 'number' ? heroData.consolidatedScore.toFixed(3) : 'N/A');

        if (heroData.isTopTier) hotspot.classList.add('top-tier-hero-model');
        if (selectedModelScreenOrder !== null && parseInt(hotspot.dataset.heroOrder) === selectedModelScreenOrder) {
            hotspot.classList.add('is-my-model');
        }

        hotspot.addEventListener('mouseenter', () => {
            const nameForDisplay = hotspot.dataset.heroName.replace(/_/g, ' ');
            const wr = hotspot.dataset.winrate;
            const winrateFormatted = wr !== 'N/A' ? `${(parseFloat(wr) * 100).toFixed(1)}%` : 'N/A';
            const topTierIndicator = hotspot.dataset.isTopTier === 'true' ? '<span style="color: #FFD700;">&#9733; Top Model!</span><br>' : '';
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
        // heroDataForUI.heroOrder is the 0-9 original list order
        const heroCoordInfo = resolutionCoords.heroes_coords.find(hc => hc.hero_order === heroDataForUI.heroOrder);
        if (heroCoordInfo && heroDataForUI.dbHeroId !== null) { // Only show button if hero is identified
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
                        heroOrder: heroDataForUI.heroOrder, // Send original list order
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

        const rect = modelHotspotElement.getBoundingClientRect(); // Use rect of existing hotspot for positioning
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
                    heroOrder: heroModel.heroOrder, // Send screen order
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
        hotspot.classList.remove('is-my-model', 'top-tier-hero-model'); // Reset classes
        if (selectedModelScreenOrder !== null && parseInt(hotspot.dataset.heroOrder) === selectedModelScreenOrder) {
            hotspot.classList.add('is-my-model');
        }
        if (hotspot.dataset.isTopTier === 'true') {
            hotspot.classList.add('top-tier-hero-model');
        }
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
    opCombinationsListElement.innerHTML = ''; // Clear previous list

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
        // Show the window if it was previously hidden and now has content
        opCombinationsWindow.style.display = 'block';
        opCombinationsWindow.setAttribute('aria-hidden', 'false');
        showOpCombinationsButton.style.display = 'none'; // Hide the "Show" button
        showOpCombinationsButton.setAttribute('aria-expanded', 'true');

    } else {
        opCombinationsAvailable = false;
        opCombinationsWindow.style.display = 'none';
        opCombinationsWindow.setAttribute('aria-hidden', 'true');
        showOpCombinationsButton.style.display = 'none'; // Keep "Show" button hidden if no combos
        showOpCombinationsButton.setAttribute('aria-expanded', 'false');
    }
}

// --- IPC Event Handlers (from Main Process) ---

if (window.electronAPI) {
    window.electronAPI.onOverlayData((data) => {
        console.log('[OverlayRenderer] === New Overlay Data Received ===', data);

        // Update scale factor and coordinates if provided
        if (typeof data.scaleFactor === 'number' && data.scaleFactor > 0) currentScaleFactor = data.scaleFactor;
        if (data.coordinatesConfig) currentCoordinatesConfig = data.coordinatesConfig;
        if (data.targetResolution) currentTargetResolution = data.targetResolution;

        // Handle errors from main process
        if (data && data.error) {
            console.error('[OverlayRenderer] Error message received from main:', data.error);
            showScanStatusPopup(`Error: ${data.error}`, true);
            // Re-enable scan buttons on error
            if (initialScanButton && initialScanButton.disabled) initialScanButton.disabled = false;
            if (rescanButton && rescanButton.disabled) rescanButton.disabled = false;
            if (takeSnapshotButton && takeSnapshotButton.disabled && initialScanButton && initialScanButton.style.display === 'none') {
                takeSnapshotButton.disabled = false; // Re-enable snapshot if a scan was done
            }
            if (resetOverlayButton && scanHasBeenPerformed) resetOverlayButton.style.display = 'inline-block';
            return;
        }

        // Update state based on data from main process
        if (data && typeof data.opCombinations !== 'undefined') updateOPCombinationsDisplay(data.opCombinations);
        if (data && data.heroModels) currentHeroModelData = data.heroModels;
        if (data.heroesForMyHeroUI) currentHeroesForMyHeroUIData = data.heroesForMyHeroUI;

        // Sync selected hero/model state from main (important if main process logic changes these)
        // Note: selectedHeroOriginalOrder and selectedModelScreenOrder are primarily managed by user clicks in overlay,
        // but this ensures consistency if main process were to override.
        if (typeof data.selectedHeroForDraftingDbId !== 'undefined') {
            const myHeroEntry = currentHeroesForMyHeroUIData.find(h => h.dbHeroId === data.selectedHeroForDraftingDbId);
            selectedHeroOriginalOrder = myHeroEntry ? myHeroEntry.heroOrder : null;
        }
        if (typeof data.selectedModelHeroOrder !== 'undefined') {
            selectedModelScreenOrder = data.selectedModelHeroOrder;
        }


        // Process different types of data payloads
        if (data && data.initialSetup) {
            console.log('[OverlayRenderer] Processing initialSetup...');
            resetOverlayUI(); // Use the reset function for a clean initial state
        } else if (data && data.scanData) {
            console.log('[OverlayRenderer] Processing scanData...');
            scanHasBeenPerformed = true;
            if (scanStatusPopup) scanStatusPopup.style.display = 'none'; // Hide "Scanning..." popup

            if (!currentCoordinatesConfig || !currentTargetResolution) {
                console.error('[OverlayRenderer] Crucial config missing (coordinates/resolution). Cannot display hotspots.');
                showScanStatusPopup('Error: Layout data missing.', true);
                if (initialScanButton && initialScanButton.disabled) initialScanButton.disabled = false;
                else if (rescanButton && rescanButton.disabled) rescanButton.disabled = false;
                return;
            }
            const resolutionCoords = currentCoordinatesConfig.resolutions[currentTargetResolution];
            if (!resolutionCoords) {
                console.error(`[OverlayRenderer] Coordinate data for resolution "${currentTargetResolution}" not found.`);
                showScanStatusPopup(`Error: Coordinates for ${currentTargetResolution} missing.`, true);
                if (initialScanButton && initialScanButton.disabled) initialScanButton.disabled = false;
                else if (rescanButton && rescanButton.disabled) rescanButton.disabled = false;
                return;
            }

            // Clear previous dynamic elements before redrawing
            document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot, .hero-model-hotspot, .my-hero-btn-original, .change-my-hero-btn-original, .my-model-btn, .change-my-model-btn').forEach(el => el.remove());

            // Create hotspots for abilities in draft pool
            createHotspotsForType(data.scanData.ultimates, resolutionCoords.ultimate_slots_coords, 'ultimates');
            createHotspotsForType(data.scanData.standard, resolutionCoords.standard_slots_coords, 'standard');

            // Create hotspots for abilities already selected by heroes
            if (data.scanData.selectedAbilities && resolutionCoords.selected_abilities_coords && resolutionCoords.selected_abilities_params) {
                const selectedAbilityHotspotData = [];
                // This logic matches identified abilities with their specific coordinate slot
                data.scanData.selectedAbilities.forEach((abilityResult) => {
                    if (!abilityResult.internalName) return;

                    // Find the Nth occurrence of this hero_order in the coordinate list
                    let countForHeroOrder = 0;
                    let specificCoordEntry = null;

                    for (let i = 0; i < resolutionCoords.selected_abilities_coords.length; i++) {
                        const coordEntry = resolutionCoords.selected_abilities_coords[i];
                        if (coordEntry.hero_order === abilityResult.hero_order) {
                            // abilityResult.ability_order from ML might not be reliable for picked slots.
                            // Instead, we rely on the order of results for a given hero_order.
                            // Find the (countForHeroOrder)-th slot for this hero.
                            // This assumes results for a hero come in a fixed order matching layout.
                            if (countForHeroOrder === ((abilityResult.slot_index_within_hero || 0))) { // Assuming main.js could add slot_index_within_hero
                                specificCoordEntry = coordEntry;
                                break;
                            }
                            countForHeroOrder++;
                        }
                    }
                    // Fallback if slot_index_within_hero is not provided or robustly determined.
                    // This part is tricky if abilities are not returned in a perfectly predictable order from ML per hero.
                    // For now, let's assume a simpler direct mapping if the above is too complex or `slot_index_within_hero` is missing.
                    // The original code iterated through resolutionCoords.selected_abilities_coords and matched;
                    // this requires scanData.selectedAbilities to be in the same order as those coords, or a more robust mapping.
                    // A simpler approach for now, assuming the ML output for selectedAbilities for a hero_order
                    // comes in the order Q, W, E, R.

                    if (!specificCoordEntry) { // Fallback or primary logic if simpler
                        let NthAbilityForHero = 0;
                        for (let sa of data.scanData.selectedAbilities) {
                            if (sa.hero_order === abilityResult.hero_order) {
                                if (sa.internalName === abilityResult.internalName && sa.confidence === abilityResult.confidence) { // imperfect unique key
                                    specificCoordEntry = resolutionCoords.selected_abilities_coords.filter(c => c.hero_order === abilityResult.hero_order)[NthAbilityForHero];
                                    break;
                                }
                                NthAbilityForHero++;
                            }
                        }
                    }


                    if (specificCoordEntry) {
                        selectedAbilityHotspotData.push({
                            coord: { // Construct full coord data for the hotspot function
                                ...specificCoordEntry, // x, y, hero_order, is_ultimate (from layout.json)
                                width: resolutionCoords.selected_abilities_params.width,
                                height: resolutionCoords.selected_abilities_params.height,
                            },
                            abilityData: abilityResult, // The identified ability data from ML
                        });
                    }
                });

                selectedAbilityHotspotData.forEach(item => {
                    createHotspotElement(item.coord, item.abilityData, `sel-${item.coord.hero_order}-${item.abilityData.internalName.slice(0, 5)}`, true);
                });
            }


            // Create hotspots for hero models
            if (currentHeroModelData && currentHeroModelData.length > 0) {
                createHeroModelHotspots(currentHeroModelData);
            }

            // Re-render dynamic buttons
            manageHeroModelButtons();
            manageMyHeroButtons();
            updateVisualHighlights();

            // Update UI state
            if (initialScanButton) initialScanButton.style.display = 'none';
            if (rescanButton) { rescanButton.style.display = 'inline-block'; rescanButton.disabled = false; }
            if (takeSnapshotButton) { takeSnapshotButton.style.display = 'block'; takeSnapshotButton.disabled = false; }
            if (resetOverlayButton) resetOverlayButton.style.display = 'inline-block';

            hideTooltip(); // Ensure no stale tooltips
            toggleTopTierBordersVisibility(true); // Show top-tier borders
            if (snapshotStatusElement) snapshotStatusElement.style.display = 'none'; // Hide snapshot status
            console.log('[OverlayRenderer] Scan data processing finished.');
        }
    });

    window.electronAPI.onMyModelSelectionChanged(({ selectedModelHeroOrder }) => {
        console.log('[OverlayRenderer] My Model selection changed in main, updating UI. New selection:', selectedModelHeroOrder);
        selectedModelScreenOrder = selectedModelHeroOrder; // Update local state
        manageHeroModelButtons(); // Re-render buttons to reflect new state
        updateVisualHighlights(); // Update borders/highlights
    });

    window.electronAPI.onMyHeroForDraftingSelectionChanged(({ selectedHeroOrderForDrafting }) => {
        console.log('[OverlayRenderer] My Hero (for drafting) selection changed in main, updating UI. New selection:', selectedHeroOrderForDrafting);
        selectedHeroOriginalOrder = selectedHeroOrderForDrafting; // Update local state
        manageMyHeroButtons(); // Re-render buttons
        updateVisualHighlights(); // Update borders/highlights on selected abilities
    });

    window.electronAPI.onSnapshotTaken((status) => {
        if (snapshotStatusElement) {
            snapshotStatusElement.textContent = status.message;
            snapshotStatusElement.style.backgroundColor = status.error ? 'rgba(200,0,0,0.8)' : 'rgba(0,150,50,0.8)';
            snapshotStatusElement.style.display = 'block';

            if (takeSnapshotButton && (!status.error || status.allowRetry)) {
                takeSnapshotButton.disabled = false; // Re-enable button
            }
            setTimeout(() => { // Auto-hide message
                snapshotStatusElement.style.display = 'none';
            }, 5000);
        } else { // Fallback if element is missing
            if (takeSnapshotButton && (!status.error || status.allowRetry)) takeSnapshotButton.disabled = false;
        }
    });

    window.electronAPI.onToggleHotspotBorders((visible) => {
        if (visible) { // Show borders if no tooltip is active
            if (!isTooltipVisible) {
                toggleTopTierBordersVisibility(true);
            }
        } else { // Force hide borders (e.g., for snapshot)
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
        if (opCombinationsAvailable) { // Only show "Show" button if there's content
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
        opCombinationsWindow, // The window itself
        showOpCombinationsButton // The button to show it
        // Note: Dynamically created buttons add their own listeners
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