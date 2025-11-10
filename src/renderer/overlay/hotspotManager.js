/**
 * @module hotspotManager
 * @description Manages the creation, update, and removal of interactive hotspots on the overlay.
 * Hotspots provide information about abilities and hero models on mouse hover.
 */

// Constants for CSS class names
const CSS_ABILITY_HOTSPOT = 'ability-hotspot';
const CSS_SELECTED_ABILITY_HOTSPOT = 'selected-ability-hotspot';
const CSS_MY_SPOT_SELECTED_ABILITY = 'my-spot-selected-ability';
const CSS_SYNERGY_SUGGESTION_HOTSPOT = 'synergy-suggestion-hotspot';
const CSS_TOP_TIER_ABILITY = 'top-tier-ability';
const CSS_HERO_MODEL_HOTSPOT = 'hero-model-hotspot';
const CSS_TOP_TIER_HERO_MODEL = 'top-tier-hero-model';
const CSS_IS_MY_MODEL = 'is-my-model';

let currentScaleFactor = 1;
let getSelectedHeroOriginalOrderFn = () => null;
let getSelectedModelScreenOrderFn = () => null;
let translateFn = (key) => key;
let tooltipModule = null;

/**
 * Initializes the hotspot manager with necessary configurations and callbacks.
 * @param {object} config - Configuration object.
 * @param {function(): number} [config.getScaleFactor] - Function to get the current UI scale factor. Defaults to 1.
 * @param {function(): (number | null)} config.getSelectedHeroOriginalOrder - Function to get the original order of the selected hero spot.
 * @param {function(): (number | null)} config.getSelectedModelScreenOrder - Function to get the screen order of the selected hero model.
 * @param {function(string, object=): string} config.translateFn - Function for translating UI strings.
 * @param {object} config.tooltip - Instance of the tooltip module.
 * @param {function(HTMLElement, string): void} config.tooltip.showTooltip - Function to show the tooltip.
 * @param {function(): void} config.tooltip.hideTooltip - Function to hide the tooltip.
 */
export function initHotspotManager(config) {
    currentScaleFactor = config.getScaleFactor ? config.getScaleFactor() : 1;
    getSelectedHeroOriginalOrderFn = config.getSelectedHeroOriginalOrder;
    getSelectedModelScreenOrderFn = config.getSelectedModelScreenOrder;
    translateFn = config.translateFn;
    tooltipModule = config.tooltip;
}

/**
 * Formats a numeric value for display, handling N/A cases.
 * @private
 * @param {string | number | null | undefined} value - The value to format.
 * @param {object} [options] - Formatting options.
 * @param {boolean} [options.isPercentage=false] - Whether to format as a percentage.
 * @param {number} [options.precision=1] - The number of decimal places for percentages or general numbers.
 * @returns {string} The formatted string or 'N/A'.
 */
function formatStatValue(value, { isPercentage = false, precision = 1 } = {}) {
    if (value === null || typeof value === 'undefined' || String(value).toUpperCase() === 'N/A') {
        return 'N/A';
    }
    const num = parseFloat(String(value));
    if (isNaN(num)) {
        return 'N/A';
    }
    return isPercentage ? `${(num * 100).toFixed(precision)}%` : num.toFixed(precision);
}

/**
 * Creates and appends an ability hotspot element to the DOM.
 * @private
 */
function _createAbilityHotspotElement(coord, abilityData, uniqueIdPart, isSelectedAbilityHotspot) {
    const hotspot = document.createElement('div');
    hotspot.className = isSelectedAbilityHotspot ? `${CSS_ABILITY_HOTSPOT} ${CSS_SELECTED_ABILITY_HOTSPOT}` : CSS_ABILITY_HOTSPOT;
    hotspot.id = `hotspot-${uniqueIdPart}`;

    hotspot.style.left = `${coord.x / currentScaleFactor}px`;
    hotspot.style.top = `${coord.y / currentScaleFactor}px`;
    hotspot.style.width = `${coord.width / currentScaleFactor}px`;
    hotspot.style.height = `${coord.height / currentScaleFactor}px`;

    // --- Data attributes ---
    hotspot.dataset.heroOrder = coord.hero_order ?? abilityData.hero_order ?? 'unknown';
    hotspot.dataset.abilityName = abilityData.displayName || abilityData.internalName;
    hotspot.dataset.internalName = abilityData.internalName;
    hotspot.dataset.winrate = typeof abilityData.winrate === 'number' ? abilityData.winrate.toFixed(3) : 'N/A';
    hotspot.dataset.highSkillWinrate = typeof abilityData.highSkillWinrate === 'number' ? abilityData.highSkillWinrate.toFixed(3) : 'N/A';
    hotspot.dataset.pickRate = typeof abilityData.pickRate === 'number' ? abilityData.pickRate.toFixed(2) : 'N/A';
    hotspot.dataset.hsPickRate = typeof abilityData.hsPickRate === 'number' ? abilityData.hsPickRate.toFixed(2) : 'N/A';
    hotspot.dataset.combinations = JSON.stringify(abilityData.highWinrateCombinations || []);
    hotspot.dataset.heroSynergies = JSON.stringify(abilityData.heroSynergies || []);
    hotspot.dataset.confidence = typeof abilityData.confidence === 'number' ? abilityData.confidence.toFixed(2) : 'N/A';
    hotspot.dataset.isSynergySuggestion = String(abilityData.isSynergySuggestionForMySpot && !isSelectedAbilityHotspot);
    hotspot.dataset.isGeneralTopTier = String(abilityData.isGeneralTopTier && !isSelectedAbilityHotspot);

    // --- CSS classes based on data ---
    if (isSelectedAbilityHotspot) {
        if (getSelectedHeroOriginalOrderFn() !== null && parseInt(hotspot.dataset.heroOrder) === getSelectedHeroOriginalOrderFn()) {
            hotspot.classList.add(CSS_MY_SPOT_SELECTED_ABILITY);
        }
    } else {
        if (abilityData.isSynergySuggestionForMySpot) {
            hotspot.classList.add(CSS_SYNERGY_SUGGESTION_HOTSPOT);
        } else if (abilityData.isGeneralTopTier) {
            hotspot.classList.add(CSS_TOP_TIER_ABILITY);
        }
    }

    // --- Event listeners for tooltip ---
    hotspot.addEventListener('mouseenter', () => {
        const nameForDisplay = (hotspot.dataset.abilityName || 'Unknown').replace(/_/g, ' ');
        const winrateFormatted = formatStatValue(hotspot.dataset.winrate, { isPercentage: true, precision: 1 });
        const highSkillWinrateFormatted = formatStatValue(hotspot.dataset.highSkillWinrate, { isPercentage: true, precision: 1 });
        const pickRateFormatted = formatStatValue(hotspot.dataset.pickRate, { precision: 2 });
        const hsPickRateFormatted = formatStatValue(hotspot.dataset.hsPickRate, { precision: 2 });

        let tooltipContent = '';
        if (hotspot.classList.contains(CSS_MY_SPOT_SELECTED_ABILITY)) {
            tooltipContent += `<span style="color: #FFD700;">${translateFn('overlay.tooltip.yourModelPick')}</span><br>`;
        }
        if (hotspot.dataset.isSynergySuggestion === 'true') {
            tooltipContent += `<span style="color: #00BCD4; font-weight: bold;">&#10022; ${translateFn('overlay.tooltip.synergyPick')}</span><br>`;
        }
        if (hotspot.dataset.isGeneralTopTier === 'true') {
            tooltipContent += `<span style="color: #66ff66; font-weight: bold;">&#9733; ${translateFn('overlay.tooltip.topPick')}</span><br>`;
        }
        tooltipContent += `
            <div class="tooltip-title">${nameForDisplay}</div>
            <div class="tooltip-stat">${translateFn('overlay.tooltip.winrate')}: ${winrateFormatted}</div>
            <div class="tooltip-stat">${translateFn('overlay.tooltip.hsWinrate')}: ${highSkillWinrateFormatted}</div>
            <div class="tooltip-stat">${translateFn('overlay.tooltip.pickRate')}: ${pickRateFormatted}</div>
            <div class="tooltip-stat">${translateFn('overlay.tooltip.hsPickRate')}: ${hsPickRateFormatted}</div>`;

        const combinations = JSON.parse(hotspot.dataset.combinations || '[]');
        if (combinations.length > 0) {
            tooltipContent += `<div class="tooltip-section-title">${translateFn('overlay.tooltip.synergiesTitle')}</div>`;
            combinations.slice(0, 5).forEach(combo => {
                const comboPartnerName = (combo.partnerAbilityDisplayName || translateFn('overlay.tooltip.unknownPartner')).replace(/_/g, ' ');
                const comboWrFormatted = formatStatValue(combo.synergyWinrate, { isPercentage: true, precision: 1 });
                tooltipContent += `<div class="tooltip-combo">- ${comboPartnerName} (${comboWrFormatted} WR)</div>`;
            });
        }

        const heroSynergies = JSON.parse(hotspot.dataset.heroSynergies || '[]');
        if (heroSynergies.length > 0) {
            tooltipContent += `<div class="tooltip-section-title">${translateFn('overlay.tooltip.heroSynergiesTitle')}</div>`;
            heroSynergies.slice(0, 5).forEach(synergy => {
                const heroName = (synergy.heroDisplayName || 'Hero').replace(/_/g, ' ');
                const synergyWrFormatted = formatStatValue(synergy.synergyWinrate, { isPercentage: true, precision: 1 });
                tooltipContent += `<div class="tooltip-combo" style="font-style: italic;">- ${heroName} (${synergyWrFormatted} WR)</div>`;
            });
        }
        tooltipModule.showTooltip(hotspot, tooltipContent);
    });

    hotspot.addEventListener('mouseleave', () => tooltipModule.hideTooltip());
    document.body.appendChild(hotspot);
}

/**
 * Creates and displays ability hotspots based on the provided data.
 * @param {Array<object>} abilityResultArray - Array of ability data objects.
 * Each object should contain `internalName`, `displayName`, `coord`, and other stat properties.
 * @param {string} type - A type string to be part of the hotspot ID (e.g., "draft", "preGame").
 * @param {boolean} [isSelectedAbilityHotspot=false] - True if these hotspots represent abilities
 * selected by the player for their current hero, false for general pool abilities.
 */
export function createAbilityHotspots(abilityResultArray, type, isSelectedAbilityHotspot = false) {
    if (!abilityResultArray || !Array.isArray(abilityResultArray)) return;

    abilityResultArray.forEach((abilityInfo, index) => {
        if (abilityInfo && abilityInfo.internalName && abilityInfo.displayName !== 'Unknown Ability' && abilityInfo.coord) {
            // Generate a reasonably safe and unique part for the DOM ID.
            const safeInternalNamePart = (abilityInfo.internalName || 'unknown').replace(/[^a-zA-Z0-9_]/g, '').substring(0, 10);
            const uniqueIdPart = `${type}-${safeInternalNamePart}-${index}`;
            _createAbilityHotspotElement(abilityInfo.coord, abilityInfo, uniqueIdPart, isSelectedAbilityHotspot);
        }
    });
}

/**
 * Creates and displays hero model hotspots based on the provided data.
 * @param {Array<object>} heroModelDataArray - Array of hero model data objects.
 * Each object should contain `coord`, `heroDisplayName`, `heroName`, and other stat properties.
 */
export function createHeroModelHotspots(heroModelDataArray) {
    if (!heroModelDataArray || heroModelDataArray.length === 0) return;

    heroModelDataArray.forEach(heroData => {
        if (!heroData.coord || heroData.heroDisplayName === "Unknown Hero") return;

        const hotspot = document.createElement('div');
        hotspot.className = CSS_HERO_MODEL_HOTSPOT;
        hotspot.id = `hero-model-hotspot-${heroData.heroOrder}`;

        hotspot.style.left = `${heroData.coord.x / currentScaleFactor}px`;
        hotspot.style.top = `${heroData.coord.y / currentScaleFactor}px`;
        hotspot.style.width = `${heroData.coord.width / currentScaleFactor}px`;
        hotspot.style.height = `${heroData.coord.height / currentScaleFactor}px`;

        // --- Data attributes ---
        hotspot.dataset.heroName = heroData.heroDisplayName;
        hotspot.dataset.internalHeroName = heroData.heroName;
        hotspot.dataset.winrate = typeof heroData.winrate === 'number' ? heroData.winrate.toFixed(3) : 'N/A';
        hotspot.dataset.highSkillWinrate = typeof heroData.highSkillWinrate === 'number' ? heroData.highSkillWinrate.toFixed(3) : 'N/A';
        hotspot.dataset.pickRate = typeof heroData.pickRate === 'number' ? heroData.pickRate.toFixed(2) : 'N/A';
        hotspot.dataset.hsPickRate = typeof heroData.hsPickRate === 'number' ? heroData.hsPickRate.toFixed(2) : 'N/A';
        hotspot.dataset.heroOrder = heroData.heroOrder;
        hotspot.dataset.dbHeroId = heroData.dbHeroId;
        hotspot.dataset.isGeneralTopTier = String(heroData.isGeneralTopTier);
        hotspot.dataset.consolidatedScore = (typeof heroData.consolidatedScore === 'number' ? heroData.consolidatedScore.toFixed(3) : 'N/A');
        hotspot.dataset.abilitySynergies = JSON.stringify(heroData.abilitySynergies || []);

        // --- CSS classes based on data ---
        if (heroData.isGeneralTopTier) {
            hotspot.classList.add(CSS_TOP_TIER_HERO_MODEL);
        }
        if (getSelectedModelScreenOrderFn() !== null && parseInt(hotspot.dataset.heroOrder) === getSelectedModelScreenOrderFn()) {
            hotspot.classList.add(CSS_IS_MY_MODEL);
        }

        // --- Event listeners for tooltip ---
        hotspot.addEventListener('mouseenter', () => {
            const nameForDisplay = hotspot.dataset.heroName.replace(/_/g, ' ');
            const winrateFormatted = formatStatValue(hotspot.dataset.winrate, { isPercentage: true, precision: 1 });
            const hsWinrateFormatted = formatStatValue(hotspot.dataset.highSkillWinrate, { isPercentage: true, precision: 1 });
            const pickRateFormatted = formatStatValue(hotspot.dataset.pickRate, { precision: 2 });
            const hsPickRateFormatted = formatStatValue(hotspot.dataset.hsPickRate, { precision: 2 });
            const topTierIndicator = hotspot.dataset.isGeneralTopTier === 'true' ? `<span style="color: #FFD700; font-weight: bold;">&#9733; ${translateFn('overlay.tooltip.topModel')}</span><br>` : '';

            let tooltipContent = `
                ${topTierIndicator}
                <div class="tooltip-title">${nameForDisplay}</div>
                <div class="tooltip-stat">${translateFn('overlay.tooltip.winrate')}: ${winrateFormatted}</div>
                <div class="tooltip-stat">${translateFn('overlay.tooltip.hsWinrate')}: ${hsWinrateFormatted}</div>
                <div class="tooltip-stat">${translateFn('overlay.tooltip.pickRate')}: ${pickRateFormatted}</div>
                <div class="tooltip-stat">${translateFn('overlay.tooltip.hsPickRate')}: ${hsPickRateFormatted}</div>
            `;

            const abilitySynergies = JSON.parse(hotspot.dataset.abilitySynergies || '[]');
            if (abilitySynergies.length > 0) {
                tooltipContent += `<div class="tooltip-section-title">${translateFn('overlay.tooltip.strongAbilitiesForHero')}</div>`;
                abilitySynergies.slice(0, 5).forEach(synergy => {
                    const abilityName = (synergy.abilityDisplayName || 'Ability').replace(/_/g, ' ');
                    const synergyWrFormatted = formatStatValue(synergy.synergyWinrate, { isPercentage: true, precision: 1 });
                    tooltipContent += `<div class="tooltip-combo" style="font-style: italic;">- ${abilityName} (${synergyWrFormatted} WR)</div>`;
                });
            }

            tooltipModule.showTooltip(hotspot, tooltipContent);
        });
        hotspot.addEventListener('mouseleave', () => tooltipModule.hideTooltip());
        document.body.appendChild(hotspot);
    });
}

/**
 * Removes all ability and hero model hotspots from the DOM.
 */
export function clearAllHotspots() {
    // Selects all elements with either base class and removes them.
    document.querySelectorAll(`.${CSS_ABILITY_HOTSPOT}, .${CSS_HERO_MODEL_HOTSPOT}`).forEach(el => el.remove());
}