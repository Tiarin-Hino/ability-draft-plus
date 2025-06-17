/**
 * @module uiUpdater
 * @description Manages updates to various UI elements in the overlay,
 * including popups, lists, and visual highlights. It interacts with
 * translated strings and DOM elements provided during initialization.
 */

/**
 * @type {Object<string, HTMLElement>}
 * @description A collection of DOM elements managed by the UI updater.
 */
let uiElements = {};

/**
 * @type {function(string, object=): string}
 * @description Function to translate string keys, potentially with parameters.
 */
let translateFn = (key) => key;

export function initUIUpdater(elements, translateCallback) {
    uiElements = elements;
    translateFn = translateCallback;
}
export function showScanStatusPopup(messageOrKey, isError = false) {
    if (uiElements.scanStatusPopup) {
        let message;
        if (typeof messageOrKey === 'object' && messageOrKey.key) {
            message = translateFn(messageOrKey.key, messageOrKey.params);
        } else {
            message = messageOrKey;
        }
        uiElements.scanStatusPopup.textContent = message;
        uiElements.scanStatusPopup.style.backgroundColor = isError ? 'rgba(200,0,0,0.8)' : 'rgba(0,100,200,0.8)';
        uiElements.scanStatusPopup.style.display = 'block';
    }
}

export function showSnapshotStatus(message, isError = false) {
    if (uiElements.snapshotStatusElement) {
        uiElements.snapshotStatusElement.textContent = message;
        uiElements.snapshotStatusElement.style.backgroundColor = isError ? 'rgba(200,0,0,0.8)' : 'rgba(0,150,50,0.8)';
        uiElements.snapshotStatusElement.style.display = 'block';
        setTimeout(() => {
            if (uiElements.snapshotStatusElement) uiElements.snapshotStatusElement.style.display = 'none';
        }, 5000);
    }
}

/**
 * Updates the display of "OP" (overpowered) ability combinations.
 * Shows or hides the combinations window and list based on available data.
 * @param {Array<object>} opCombinations - Array of OP combination objects.
 * Each object should have `ability1DisplayName`, `ability2DisplayName`, and `synergyWinrate`.
 * @returns {boolean} True if OP combinations are available and displayed, false otherwise.
 */
export function updateOPCombinationsDisplay(opCombinations) {
    if (!uiElements.opCombinationsWindow || !uiElements.opCombinationsListElement || !uiElements.showOpCombinationsButton) {
        return false; // Cannot update if essential elements are missing
    }
    uiElements.opCombinationsListElement.innerHTML = '';

    if (opCombinations && opCombinations.length > 0) {
        opCombinations.forEach(combo => {
            const comboDiv = document.createElement('div');
            const ability1Display = (combo.ability1DisplayName || 'Ability 1').replace(/_/g, ' ');
            const ability2Display = (combo.ability2DisplayName || 'Ability 2').replace(/_/g, ' ');
            const wrFormatted = combo.synergyWinrate ? `(${(combo.synergyWinrate * 100).toFixed(1)}%)` : '';
            comboDiv.textContent = `${ability1Display} + ${ability2Display} ${wrFormatted}`;
            uiElements.opCombinationsListElement.appendChild(comboDiv);
        });
        uiElements.opCombinationsWindow.style.display = 'block';
        uiElements.opCombinationsWindow.setAttribute('aria-hidden', 'false');
        uiElements.showOpCombinationsButton.style.display = 'none';
        uiElements.showOpCombinationsButton.setAttribute('aria-expanded', 'true');
        return true;
    } else {
        uiElements.opCombinationsWindow.style.display = 'none';
        uiElements.opCombinationsWindow.setAttribute('aria-hidden', 'true');
        uiElements.showOpCombinationsButton.style.display = 'none';
        uiElements.showOpCombinationsButton.setAttribute('aria-expanded', 'false');
        return false;
    }
}

/**
 * Updates visual highlights on ability and hero model hotspots based on current selections.
 * Also ensures borders are correctly displayed if the tooltip is not active.
 * @param {number | null} selectedHeroOrder - The original order of the currently selected hero spot, or null if none.
 * @param {number | null} selectedModelOrder - The screen order of the currently selected hero model, or null if none.
 * @param {boolean} isTooltipCurrentlyVisible - Flag indicating if the tooltip is currently visible.
 * @param {function(boolean): void} toggleAllBordersFn - Function to toggle the visibility of all dynamic borders.
 *        Takes a boolean argument: `true` to show borders, `false` to hide.
 */
export function updateVisualHighlights(selectedHeroOrder, selectedModelOrder, isTooltipCurrentlyVisible, toggleAllBordersFn) {
    document.querySelectorAll('.ability-hotspot.selected-ability-hotspot').forEach(hotspot => {
        hotspot.classList.remove('my-spot-selected-ability');
        if (selectedHeroOrder !== null && hotspot.dataset.heroOrder && parseInt(hotspot.dataset.heroOrder, 10) === selectedHeroOrder) {
            hotspot.classList.add('my-spot-selected-ability');
        }
    });
    document.querySelectorAll('.hero-model-hotspot').forEach(hotspot => {
        hotspot.classList.toggle('is-my-model', selectedModelOrder !== null && parseInt(hotspot.dataset.heroOrder) === selectedModelOrder);
    });

    if (!isTooltipCurrentlyVisible) {
        toggleAllBordersFn(true); // Ensure borders are shown if the tooltip is not managing them (i.e., not visible)
    }
}

/**
 * Toggles a specific CSS class on all relevant hotspot elements to
 * control their border visibility, typically for UI snapshot purposes.
 * @param {boolean} visible - If true, borders are made visible (class is removed).
 *                            If false, borders are hidden (class is added).
 */
export function toggleAllDynamicBordersForSnapshot(visible) {
    const hotspots = document.querySelectorAll('.ability-hotspot, .selected-ability-hotspot, .synergy-suggestion-hotspot, .hero-model-hotspot');
    hotspots.forEach(hotspot => {
        hotspot.classList.toggle('snapshot-hidden-border', !visible);
    });
}