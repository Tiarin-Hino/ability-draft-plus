const { performance } = require('perf_hooks');
const {
    // Database Query Functions
    getAbilityDetails,
    getHighWinrateCombinations,
    getAllOPCombinations,
    getAllHeroSynergies,
    getAllHeroAbilitySynergiesUnfiltered,
    getHeroSynergiesInPool,
    getAllTrapCombinations,
    getAllHeroTrapSynergies,
    getHeroDetailsByAbilityName,
    getHeroDetailsById
} = require('../database/queries'); // Adjusted path
const {
    NUM_TOP_TIER_SUGGESTIONS,
    WEIGHT_WINRATE,
    WEIGHT_PICK_ORDER,
    MIN_PICK_ORDER_FOR_NORMALIZATION,
    MAX_PICK_ORDER_FOR_NORMALIZATION
} = require('../../config');
const { sendStatusUpdate } = require('./utils');

/**
 * @module scanProcessor
 * @description Processes raw scan results from the ML worker, enriches them with database information,
 * performs scoring, and prepares data for the overlay UI and for updating the main application state.
 */

// --- Data Identification and Preparation Helpers ---

/**
 * Identifies hero models based on their defining abilities detected in the scan.
 * @param {Array<object>} heroDefiningAbilities - Array of abilities identified as defining heroes, with name and confidence.
 * @param {Array<object>} modelCoords - Coordinates configuration for hero models.
 * @param {string} activeDbPath - Path to the active SQLite database.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of identified hero model data.
 */
async function identifyHeroModels(heroDefiningAbilities, modelCoords, activeDbPath) {
    const tempIdentifiedHeroesMap = new Map();
    const validDefiningAbilities = heroDefiningAbilities.filter(ability => ability.name !== null);

    for (const heroAbility of validDefiningAbilities) {
        const heroIdentity = await getHeroDetailsByAbilityName(activeDbPath, heroAbility.name);
        if (heroIdentity && heroIdentity.hero_id !== null) {
            const fullHeroDetails = await getHeroDetailsById(activeDbPath, heroIdentity.hero_id);
            if (fullHeroDetails) {
                tempIdentifiedHeroesMap.set(heroAbility.hero_order, {
                    heroDisplayName: fullHeroDetails.heroDisplayName,
                    dbHeroId: fullHeroDetails.dbHeroId,
                    heroName: fullHeroDetails.heroName,
                    winrate: fullHeroDetails.winrate,
                    highSkillWinrate: fullHeroDetails.highSkillWinrate,
                    pickRate: fullHeroDetails.pickRate,
                    hsPickRate: fullHeroDetails.hsPickRate,
                    identificationConfidence: heroAbility.confidence
                });
            }
        }
    }

    const heroModelData = [];
    if (modelCoords) {
        for (const modelCoord of modelCoords) {
            const matchedHero = tempIdentifiedHeroesMap.get(modelCoord.hero_order);
            if (matchedHero) {
                heroModelData.push({ coord: modelCoord, ...matchedHero, heroOrder: modelCoord.hero_order });
            } else {
                heroModelData.push({
                    coord: modelCoord, heroDisplayName: "Unknown Hero", heroName: `unknown_model_${modelCoord.hero_order}`,
                    dbHeroId: null, winrate: null, pickRate: null, // Adjusted from avg_pick_order
                    heroOrder: modelCoord.hero_order, identificationConfidence: 0
                });
            }
        }
    }
    return heroModelData;
}

/**
 * Prepares a simplified list of hero data for the "My Spot" selection UI.
 * @param {Array<object> | null} cachedHeroModels - Cached data of identified hero models.
 * @param {Array<object>} heroScreenCoords - Coordinates configuration for hero pick slots.
 * @returns {Array<object>} An array of objects, each containing heroOrder, heroName, and dbHeroId for UI display.
 */
function prepareHeroesForMySpotUI(cachedHeroModels, heroScreenCoords) {
    if (!cachedHeroModels || cachedHeroModels.length === 0 || !heroScreenCoords || heroScreenCoords.length === 0) return [];
    const uiData = [];
    for (const heroScreenCoord of heroScreenCoords) {
        const matchedModel = cachedHeroModels.find(model => model.heroOrder === heroScreenCoord.hero_order);
        if (matchedModel && matchedModel.dbHeroId) {
            uiData.push({
                heroOrder: heroScreenCoord.hero_order,
                heroName: matchedModel.heroDisplayName,
                dbHeroId: matchedModel.dbHeroId,
            });
        } else {
            uiData.push({ heroOrder: heroScreenCoord.hero_order, heroName: "Unknown", dbHeroId: null });
        }
    }
    return uiData;
}

/**
 * Collects unique ability names from the draft pool and all picked abilities.
 * @param {object} rawResults - Raw scan results containing ultimates, standard abilities, and selectedAbilities.
 * @param {Array<object>} [rawResults.ultimates] - Ultimates in the pool.
 * @param {Array<object>} [rawResults.standard] - Standard abilities in the pool.
 * @param {Array<object>} [rawResults.selectedAbilities] - Abilities already picked.
 * @returns {{uniqueAbilityNamesInPool: Set<string>, allPickedAbilityNames: Set<string>}} An object containing sets of ability names.
 */
function collectAbilityNames(rawResults) {
    const uniqueAbilityNamesInPool = new Set();
    if (rawResults.ultimates) rawResults.ultimates.forEach(res => res.name && uniqueAbilityNamesInPool.add(res.name));
    if (rawResults.standard) rawResults.standard.forEach(res => res.name && uniqueAbilityNamesInPool.add(res.name));

    const allPickedAbilityNames = new Set();
    if (rawResults.selectedAbilities) rawResults.selectedAbilities.forEach(res => res.name && allPickedAbilityNames.add(res.name));
    return { uniqueAbilityNamesInPool, allPickedAbilityNames };
}

/**
 * Prepares a unified list of entities (abilities and heroes) from scan results and caches for scoring.
 * @param {object} rawResults - Raw scan results.
 * @param {Map<string, object>} abilityDetailsMap - Map of ability names to their database details.
 * @param {Array<object> | null} cachedHeroModels - Cached data of identified hero models.
 * @returns {Array<object>} An array of entity objects ready for scoring.
 */
function prepareEntitiesForScoring(rawResults, abilityDetailsMap, cachedHeroModels) {
    const entities = [];
    const processPool = (resultsArray, isUltimateSource) => {
        if (!resultsArray) return;
        resultsArray.forEach(result => {
            if (result.name) {
                const details = abilityDetailsMap.get(result.name);
                if (details) {
                    entities.push({
                        ...details,
                        is_ultimate_from_coord_source: isUltimateSource,
                        entityType: 'ability',
                        consolidatedScore: 0,
                        hero_order_on_screen: result.hero_order,
                        ability_order_on_screen: result.ability_order,
                    });
                }
            }
        });
    };
    processPool(rawResults.ultimates, true);
    processPool(rawResults.standard, false);

    const addedHeroModelDbIds = new Set();
    if (cachedHeroModels) {
        for (const heroData of cachedHeroModels) {
            if (heroData.dbHeroId !== null && !addedHeroModelDbIds.has(heroData.dbHeroId)) {
                entities.push({
                    internalName: heroData.heroName,
                    displayName: heroData.heroDisplayName,
                    winrate: heroData.winrate,
                    pickRate: heroData.pickRate,
                    entityType: 'hero',
                    dbHeroId: heroData.dbHeroId,
                    heroOrderScreen: heroData.heroOrder,
                    consolidatedScore: 0
                });
                addedHeroModelDbIds.add(heroData.dbHeroId);
            }
        }
    }
    return entities;
}

// --- Scoring and Logic Helpers ---

/**
 * Calculates consolidated scores for entities based on winrate and pick rate.
 * @param {Array<object>} entities - Array of entities (abilities or heroes) with raw winrate and pickRate.
 * @returns {Array<object>} The same array of entities, with an added `consolidatedScore` property.
 */
function calculateConsolidatedScores(entities) {
    return entities.map(entity => {
        let wRaw = entity.winrate;
        let pRaw = entity.pickRate;

        const wNormalized = (wRaw !== null && typeof wRaw === 'number') ? wRaw : 0.5;

        let pNormalized = 0.5;
        if (pRaw !== null && typeof pRaw === 'number') {
            const clampedPRaw = Math.max(MIN_PICK_ORDER_FOR_NORMALIZATION, Math.min(MAX_PICK_ORDER_FOR_NORMALIZATION, pRaw));
            const range = MAX_PICK_ORDER_FOR_NORMALIZATION - MIN_PICK_ORDER_FOR_NORMALIZATION;
            if (range > 0) {
                pNormalized = (MAX_PICK_ORDER_FOR_NORMALIZATION - clampedPRaw) / range;
            }
        }
        entity.consolidatedScore = (WEIGHT_WINRATE * wNormalized) + (WEIGHT_PICK_ORDER * pNormalized);
        return entity;
    });
}

/**
 * Checks if the player's currently selected drafting spot ("My Spot") has already picked an ultimate ability.
 * @param {number | null} selectedHeroDbId - The database ID of the hero model for "My Spot".
 * @param {Array<object>} heroesForUI - Array of hero data prepared for the UI.
 * @param {Array<object> | undefined} pickedAbilities - Array of all abilities picked in the draft.
 * @returns {boolean} True if "My Spot" has picked an ultimate, false otherwise.
 */
function checkMySpotPickedUltimate(selectedHeroDbId, heroesForUI, pickedAbilities) {
    if (selectedHeroDbId === null || !pickedAbilities) return false;
    const myDraftingHeroUIInfo = heroesForUI.find(h => h.dbHeroId === selectedHeroDbId);
    if (!myDraftingHeroUIInfo) return false;

    const myDraftingHeroSlotOrder = myDraftingHeroUIInfo.heroOrder;
    for (const pickedAbility of pickedAbilities) {
        if (pickedAbility.name && pickedAbility.hero_order === myDraftingHeroSlotOrder && pickedAbility.is_ultimate === true) {
            return true;
        }
    }
    return false;
}

/**
 * Determines the top-tier entities (abilities/heroes) to suggest.
 * Prioritizes synergistic abilities for the player's spot, then fills with general high-scoring entities.
 * @param {Array<object>} allScoredEntities - All entities (abilities and heroes) with consolidated scores.
 * @param {number | null} selectedModelId - DB ID of the hero model selected by the player, if any.
 * @param {boolean} mySpotHasUlt - True if the player's current draft spot has already picked an ultimate.
 * @param {Set<string>} [synergisticPartnersInPoolForMySpot=new Set()] - Set of internal names of abilities in the pool that synergize with abilities already picked for "My Spot".
 * @returns {Array<object>} An array of top-tier entities, marked with `isSynergySuggestionForMySpot` or `isGeneralTopTier`.
 */
function determineTopTierEntities(allScoredEntities, selectedModelId, mySpotHasUlt, synergisticPartnersInPoolForMySpot = new Set()) {
    let entitiesToConsider = [...allScoredEntities];
    const finalTopTierEntities = [];

    let effectiveSynergisticPartners = new Set(synergisticPartnersInPoolForMySpot);

    if (mySpotHasUlt) {
        // Filter out ultimates from general consideration if "My Spot" already has an ultimate
        entitiesToConsider = entitiesToConsider.filter(entity => {
            if (entity.entityType === 'ability') return entity.is_ultimate_from_coord_source !== true && entity.is_ultimate_from_db !== true;
            return true;
        });

        // If "My Spot" has an ultimate, synergistic partners that are also ultimates should not be prioritized as synergies
        const nonUltimateSynergies = new Set();
        for (const partnerName of effectiveSynergisticPartners) {
            const partnerEntity = allScoredEntities.find(e => e.internalName === partnerName);
            if (partnerEntity && !(partnerEntity.is_ultimate_from_coord_source === true || partnerEntity.is_ultimate_from_db === true)) {
                nonUltimateSynergies.add(partnerName);
            }
        }
        effectiveSynergisticPartners = nonUltimateSynergies;
    }

    const synergySuggestionsFromPool = [];
    entitiesToConsider = entitiesToConsider.filter(entity => {
        if (entity.entityType === 'ability' && effectiveSynergisticPartners.has(entity.internalName)) {
            synergySuggestionsFromPool.push({ ...entity, isSynergySuggestionForMySpot: true, isGeneralTopTier: false });
            return false; // Remove from general consideration
        }
        return true;
    });
    synergySuggestionsFromPool.sort((a, b) => b.consolidatedScore - a.consolidatedScore);
    finalTopTierEntities.push(...synergySuggestionsFromPool);

    // Fill remaining slots with general top picks
    const remainingSlots = NUM_TOP_TIER_SUGGESTIONS - finalTopTierEntities.length;
    if (remainingSlots > 0) {
        let generalCandidates = [...entitiesToConsider];
        // If a model is selected, general top picks should only be abilities (not other hero models)
        if (selectedModelId !== null) {
            generalCandidates = generalCandidates.filter(entity => entity.entityType === 'ability');
        }
        const generalTopPicks = generalCandidates
            .sort((a, b) => b.consolidatedScore - a.consolidatedScore)
            .slice(0, remainingSlots)
            .map(entity => ({ ...entity, isSynergySuggestionForMySpot: false, isGeneralTopTier: true }));
        finalTopTierEntities.push(...generalTopPicks);
    }
    return finalTopTierEntities;
}

// --- UI Formatting Helpers ---

/**
 * Enriches hero model data with flags indicating if they are top-tier and their consolidated score.
 * @param {Array<object> | null} heroModels - The array of identified hero models.
 * @param {Array<object>} topTierMarkedEntities - Entities marked as top-tier.
 * @param {Array<object>} allScoredEntities - All entities with their scores.
 * @param {Map<string, Array<object>>} heroSynergiesMap - Map of hero internal names to their strong ability synergies.
 * @param {Map<string, Array<object>>} heroWeakSynergiesMap - Map of hero internal names to their weak ability synergies.
 * @returns {Array<object>} The enriched hero model data.
 */
function enrichHeroModelDataWithFlags(heroModels, topTierMarkedEntities, allScoredEntities, heroSynergiesMap = new Map(), heroWeakSynergiesMap = new Map()) {
    if (!heroModels) return [];
    return heroModels.map(hModel => {
        const scoredEntity = allScoredEntities.find(e => e.entityType === 'hero' && e.internalName === hModel.heroName);
        const topTierEntry = topTierMarkedEntities.find(tte => tte.entityType === 'hero' && tte.internalName === hModel.heroName && tte.isGeneralTopTier);
        const abilitySynergies = heroSynergiesMap.get(hModel.heroName) || [];
        const weakAbilitySynergies = heroWeakSynergiesMap.get(hModel.heroName) || [];
        return {
            ...hModel,
            isGeneralTopTier: !!topTierEntry,
            isSynergySuggestionForMySpot: false, // Hero models are not synergy suggestions for a spot
            consolidatedScore: scoredEntity ? scoredEntity.consolidatedScore : 0,
            abilitySynergies: abilitySynergies,
            weakAbilitySynergies: weakAbilitySynergies
        };
    });
}

/**
 * Formats an array of predicted results (abilities) for UI display, enriching with DB details and flags.
 * @param {Array<object> | undefined} predictedResultsArray - Array of raw ability results from ML or cache.
 * @param {Map<string, object>} abilityDetailsMap - Map of ability names to their database details.
 * @param {Array<object>} topTierMarkedEntitiesArray - Entities marked as top-tier.
 * @param {string} slotType - Type of slot (e.g., 'ultimates', 'standard', 'selected').
 * @param {Array<object>} allScoredEntities - All entities with their scores, used for abilities in the pool.
 * @param {boolean} [isForSelectedAbilityList=false] - True if formatting abilities already selected (less enrichment needed).
 * @returns {Array<object>} An array of formatted ability data for the UI.
 */
function formatResultsForUiWithFlags(
    predictedResultsArray, abilityDetailsMap, topTierMarkedEntitiesArray,
    _slotType, allScoredEntities, isForSelectedAbilityList = false // slotType not directly used, but kept for signature consistency if needed later
) {
    if (!Array.isArray(predictedResultsArray)) return [];
    return predictedResultsArray.map(result => {
        const internalName = result.name;
        const originalCoord = result.coord;
        const isUltimateFromLayoutSlot = result.is_ultimate; // From ML worker based on slot type

        if (internalName === null) {
            return {
                internalName: null, displayName: 'Unknown Ability', winrate: null, highSkillWinrate: null,
                pickRate: null, hsPickRate: null, highWinrateCombinations: [], lowWinrateCombinations: [],
                heroSynergies: [], weakHeroSynergies: [],
                isGeneralTopTier: false, isSynergySuggestionForMySpot: false,
                confidence: result.confidence, hero_order: result.hero_order, ability_order: result.ability_order,
                is_ultimate_from_layout: isUltimateFromLayoutSlot, is_ultimate_from_db: null,
                consolidatedScore: 0, coord: originalCoord
            };
        }

        const dbDetails = abilityDetailsMap.get(internalName);
        const topTierEntry = !isForSelectedAbilityList ? topTierMarkedEntitiesArray.find(tte => tte.entityType === 'ability' && tte.internalName === internalName) : null;
        const scoredPoolEntity = !isForSelectedAbilityList ? allScoredEntities.find(e => e.entityType === 'ability' && e.internalName === internalName) : null;

        return {
            internalName: internalName,
            displayName: dbDetails ? (dbDetails.displayName || internalName) : internalName,
            winrate: dbDetails ? dbDetails.winrate : null,
            highSkillWinrate: dbDetails ? dbDetails.highSkillWinrate : null,
            pickRate: dbDetails ? dbDetails.pickRate : null,
            hsPickRate: dbDetails ? dbDetails.hsPickRate : null,
            is_ultimate_from_db: dbDetails ? dbDetails.is_ultimate : null,
            is_ultimate_from_layout: isUltimateFromLayoutSlot,
            ability_order_from_db: dbDetails ? dbDetails.ability_order : null,
            highWinrateCombinations: dbDetails ? (dbDetails.highWinrateCombinations || []) : [],
            lowWinrateCombinations: dbDetails ? (dbDetails.lowWinrateCombinations || []) : [],
            heroSynergies: dbDetails ? (dbDetails.heroSynergies || []) : [],
            weakHeroSynergies: dbDetails ? (dbDetails.weakHeroSynergies || []) : [],
            isGeneralTopTier: topTierEntry ? (topTierEntry.isGeneralTopTier || false) : false,
            isSynergySuggestionForMySpot: topTierEntry ? (topTierEntry.isSynergySuggestionForMySpot || false) : false,
            confidence: result.confidence,
            hero_order: result.hero_order,
            ability_order: result.ability_order,
            consolidatedScore: scoredPoolEntity ? (scoredPoolEntity.consolidatedScore || 0) : (dbDetails ? 0 : 0), // Fallback for selected/unknown abilities
            coord: originalCoord
        };
    });
}


// --- Main Exported Function ---

/**
 * @typedef {object} UpdatedMainState
 * @property {{ultimates: Array<object>, standard: Array<object>}} initialPoolAbilitiesCache - Updated cache of abilities in the pool.
 * @property {Array<object> | null} identifiedHeroModelsCache - Updated cache of identified hero models.
 * @property {object | null} [lastRawScanResults] - The raw results from this processing cycle (updated on success).
 * @property {number | null} mySelectedSpotDbIdForDrafting - DB ID of the hero model for the player's drafting spot.
 * @property {number | null} mySelectedSpotOriginalOrder - Original screen order of the player's drafting spot.
 * @property {number | null} mySelectedModelDbHeroId - DB ID of the hero model selected by the player.
 * @property {number | null} mySelectedModelScreenOrder - Screen order of the hero model selected by the player.
 */

/**
 * @typedef {object} ProcessedScanResult
 * @property {boolean} success - Indicates if processing was successful.
 * @property {string} [error] - Error message if success is false.
 * @property {UpdatedMainState} updatedMainState - Object containing state properties that may have been updated.
 * @property {object} [processedDataForOverlay] - Data prepared for the overlay UI, present on success.
 */

/**
 * Processes raw scan results from the ML worker, enriches with DB data,
 * performs scoring, and prepares data for the overlay UI.
 *
 * @param {object} rawScanResults - Results from the ML worker.
 * @param {boolean} isInitialScan - True if this is the first scan of a session.
 * @param {object} mainState - Current relevant state from `stateManager`.
 * @param {string} mainState.activeDbPath - Path to the active database.
 * @param {object} mainState.fullLayoutConfigCache - Cached layout configuration.
 * @param {string} mainState.lastScanTargetResolution - The resolution key used for the scan.
 * @param {number} mainState.lastUsedScaleFactor - The scale factor used for the scan.
 * @param {{ultimates: Array<object>, standard: Array<object>}} mainState.initialPoolAbilitiesCache - Cache of abilities currently in the pool.
 * @param {Array<object> | null} mainState.identifiedHeroModelsCache - Cache of identified hero models.
 * @param {number | null} mainState.mySelectedSpotDbIdForDrafting - DB ID for the player's drafting spot.
 * @param {number | null} mainState.mySelectedSpotOriginalOrder - Screen order for the player's drafting spot.
 * @param {number | null} mainState.mySelectedModelDbHeroId - DB ID for the player-selected hero model.
 * @param {number | null} mainState.mySelectedModelScreenOrder - Screen order for the player-selected hero model.
 * @param {object} overlayWebContents - WebContents of the overlay window to send updates.
 * @returns {Promise<ProcessedScanResult>} An object containing processing status, data for overlay, and updated main.js state.
 */
async function processAndFinalizeScanData(rawScanResults, isInitialScan, mainState, overlayWebContents) {
    const overallProcessingStart = performance.now();
    let {
        activeDbPath, fullLayoutConfigCache, lastScanTargetResolution, lastUsedScaleFactor,
        initialPoolAbilitiesCache, identifiedHeroModelsCache,
        mySelectedSpotDbIdForDrafting, mySelectedSpotOriginalOrder,
        mySelectedModelDbHeroId, mySelectedModelScreenOrder
    } = mainState;

    try { // Note: mainState properties are destructured copies, not direct refs to stateManager's internal state object.
        const layoutConfig = fullLayoutConfigCache;
        const coords = layoutConfig.resolutions?.[lastScanTargetResolution];
        if (!coords) throw new Error(`Coordinates missing for ${lastScanTargetResolution}`);

        const { models_coords = [], heroes_coords = [] } = coords;
        let currentScanCycleResults; // Holds the effective raw results for this processing cycle

        if (isInitialScan) {
            currentScanCycleResults = rawScanResults;

            // Update caches based on initial scan
            initialPoolAbilitiesCache.ultimates = (currentScanCycleResults.ultimates || []).filter(item => item.name && item.coord).map(res => ({ ...res, type: 'ultimate' }));
            initialPoolAbilitiesCache.standard = (currentScanCycleResults.standard || []).filter(item => item.name && item.coord).map(res => ({ ...res, type: 'standard' }));

            // Reset selections on initial scan
            mySelectedSpotDbIdForDrafting = null;
            mySelectedSpotOriginalOrder = null;
            mySelectedModelDbHeroId = null;
            mySelectedModelScreenOrder = null;

            identifiedHeroModelsCache = await identifyHeroModels(currentScanCycleResults.heroDefiningAbilities || [], models_coords, activeDbPath);
        } else { // This is a rescan (selected abilities updated)
            const identifiedPickedAbilities = rawScanResults;
            const pickedAbilityNames = new Set((identifiedPickedAbilities || []).map(a => a.name).filter(Boolean));

            // Filter out newly picked abilities from the cached pool
            initialPoolAbilitiesCache.standard = initialPoolAbilitiesCache.standard.filter(ability => !pickedAbilityNames.has(ability.name));
            initialPoolAbilitiesCache.ultimates = initialPoolAbilitiesCache.ultimates.filter(ability => !pickedAbilityNames.has(ability.name));

            currentScanCycleResults = { // Reconstruct structure for consistent downstream processing
                ultimates: initialPoolAbilitiesCache.ultimates,
                standard: initialPoolAbilitiesCache.standard,
                selectedAbilities: identifiedPickedAbilities || [],
                heroDefiningAbilities: [] // Hero defining abilities are not re-scanned on subsequent scans
            };
        }

        const newLastRawScanResults = { ...currentScanCycleResults };

        let heroesForMySpotSelectionUI = prepareHeroesForMySpotUI(identifiedHeroModelsCache, heroes_coords);
        const { uniqueAbilityNamesInPool, allPickedAbilityNames } = collectAbilityNames(currentScanCycleResults);
        const allCurrentlyRelevantAbilityNames = Array.from(new Set([...uniqueAbilityNamesInPool, ...allPickedAbilityNames]));

        const abilityDetailsMap = await getAbilityDetails(activeDbPath, allCurrentlyRelevantAbilityNames);
        const centralDraftPoolArray = Array.from(uniqueAbilityNamesInPool);

        let synergisticPartnersInPoolForMySpot = new Set();
        if (mySelectedSpotDbIdForDrafting !== null && mySelectedSpotOriginalOrder !== null) {
            const mySpotPickedAbilitiesRaw = (currentScanCycleResults.selectedAbilities || []).filter(
                ab => ab.name && ab.hero_order === mySelectedSpotOriginalOrder
            );
            const mySpotPickedAbilityNames = mySpotPickedAbilitiesRaw.map(ab => ab.name);
            for (const pickedAbilityName of mySpotPickedAbilityNames) {
                const combinations = await getHighWinrateCombinations(activeDbPath, pickedAbilityName, centralDraftPoolArray);
                combinations.forEach(combo => {
                    if (combo.partnerInternalName) synergisticPartnersInPoolForMySpot.add(combo.partnerInternalName);
                });
            }
        }

        for (const abilityName of allCurrentlyRelevantAbilityNames) {
            const details = abilityDetailsMap.get(abilityName);
            if (details) {
                const allCombinations = await getHighWinrateCombinations(activeDbPath, abilityName, centralDraftPoolArray) || [];
                // Split into positive (strong) and negative (weak) synergies based on winrate > 50%
                details.highWinrateCombinations = allCombinations.filter(combo => combo.synergyWinrate >= 0.5);
                details.lowWinrateCombinations = allCombinations.filter(combo => combo.synergyWinrate < 0.5);
                abilityDetailsMap.set(abilityName, details);
            }
        }

        // Calculate hero synergies for abilities and hero models
        // Get ALL hero-ability synergies (unfiltered) so we can split into strong/weak for tooltips
        const allHeroSynergiesData = await getAllHeroAbilitySynergiesUnfiltered(activeDbPath);

        // Still need OP threshold for the OP combinations window
        const opThresholdPercentage = mainState.opThresholdPercentage;

        // Create a set of hero internal names that are in the pool
        const heroesInPool = new Set();
        if (identifiedHeroModelsCache) {
            identifiedHeroModelsCache.forEach(heroModel => {
                if (heroModel.heroName && heroModel.heroName !== 'Unknown Hero') {
                    heroesInPool.add(heroModel.heroName);
                }
            });
        }

        // Add hero synergies to each ability (which heroes synergize with this ability)
        // Only include heroes that are in the current pool
        // Split into strong (>= 50% WR) and weak (< 50% WR) synergies
        for (const abilityName of allCurrentlyRelevantAbilityNames) {
            const details = abilityDetailsMap.get(abilityName);
            if (details) {
                const allHeroSynergiesForAbility = allHeroSynergiesData
                    .filter(synergy => synergy.abilityInternalName === abilityName)
                    .filter(synergy => heroesInPool.has(synergy.heroInternalName)) // Only heroes in pool
                    .map(synergy => ({
                        heroDisplayName: synergy.heroDisplayName,
                        heroInternalName: synergy.heroInternalName,
                        synergyWinrate: synergy.synergyWinrate
                    }));

                // Split and sort separately
                const strongHeroSynergies = allHeroSynergiesForAbility
                    .filter(s => s.synergyWinrate >= 0.5)
                    .sort((a, b) => b.synergyWinrate - a.synergyWinrate)
                    .slice(0, 5); // Top 5 strong synergies

                const weakHeroSynergies = allHeroSynergiesForAbility
                    .filter(s => s.synergyWinrate < 0.5)
                    .sort((a, b) => a.synergyWinrate - b.synergyWinrate) // Ascending - worst first
                    .slice(0, 5); // Top 5 weak synergies

                details.heroSynergies = strongHeroSynergies;
                details.weakHeroSynergies = weakHeroSynergies;
                abilityDetailsMap.set(abilityName, details);
            }
        }

        // Calculate ability synergies for each hero model (which abilities synergize with this hero)
        // Split into strong (>= 50% WR) and weak (< 50% WR) synergies
        const heroModelSynergiesMap = new Map();
        const heroModelWeakSynergiesMap = new Map();
        if (identifiedHeroModelsCache) {
            for (const heroModel of identifiedHeroModelsCache) {
                if (heroModel.heroName) {
                    const allAbilitySynergiesForHero = allHeroSynergiesData
                        .filter(synergy => synergy.heroInternalName === heroModel.heroName)
                        .filter(synergy => uniqueAbilityNamesInPool.has(synergy.abilityInternalName) || allPickedAbilityNames.has(synergy.abilityInternalName))
                        .map(synergy => ({
                            abilityDisplayName: synergy.abilityDisplayName,
                            abilityInternalName: synergy.abilityInternalName,
                            synergyWinrate: synergy.synergyWinrate
                        }));

                    // Strong synergies (>= 50% WR)
                    const strongAbilitySynergies = allAbilitySynergiesForHero
                        .filter(s => s.synergyWinrate >= 0.5)
                        .sort((a, b) => b.synergyWinrate - a.synergyWinrate)
                        .slice(0, 5); // Top 5

                    // Weak synergies (< 50% WR)
                    const weakAbilitySynergies = allAbilitySynergiesForHero
                        .filter(s => s.synergyWinrate < 0.5)
                        .sort((a, b) => a.synergyWinrate - b.synergyWinrate) // Ascending - worst first
                        .slice(0, 5); // Top 5 worst

                    heroModelSynergiesMap.set(heroModel.heroName, strongAbilitySynergies);
                    heroModelWeakSynergiesMap.set(heroModel.heroName, weakAbilitySynergies);
                }
            }
        }
        const allDatabaseOPCombs = await getAllOPCombinations(activeDbPath, opThresholdPercentage);
        const relevantOPCombinations = allDatabaseOPCombs.filter(combo => {
            const a1InPool = uniqueAbilityNamesInPool.has(combo.ability1InternalName);
            const a2InPool = uniqueAbilityNamesInPool.has(combo.ability2InternalName);
            const a1Picked = allPickedAbilityNames.has(combo.ability1InternalName);
            const a2Picked = allPickedAbilityNames.has(combo.ability2InternalName);
            return (a1InPool && a2InPool) || (a1InPool && a2Picked) || (a1Picked && a2InPool);
        }).map(combo => ({ ability1DisplayName: combo.ability1DisplayName, ability2DisplayName: combo.ability2DisplayName, synergyWinrate: combo.synergyWinrate }));

        // Query hero-ability synergies (only for heroes in the pool AND only OP ones for the OP window)
        // We need to calculate synergy_increase from synergyWinrate to filter OP synergies
        // synergy_increase = synergyWinrate - 0.5 (baseline)
        const relevantHeroSynergies = allHeroSynergiesData.filter(synergy => {
            const abilityInPool = uniqueAbilityNamesInPool.has(synergy.abilityInternalName);
            const abilityPicked = allPickedAbilityNames.has(synergy.abilityInternalName);
            const heroInPool = heroesInPool.has(synergy.heroInternalName);
            const synergyIncrease = synergy.synergyWinrate - 0.5; // Calculate increase from baseline
            const isOP = synergyIncrease >= opThresholdPercentage; // Only include OP synergies
            return (abilityInPool || abilityPicked) && heroInPool && isOP;
        }).map(synergy => ({ heroDisplayName: synergy.heroDisplayName, abilityDisplayName: synergy.abilityDisplayName, synergyWinrate: synergy.synergyWinrate }));

        // Query trap combinations (negative synergy)
        const trapThresholdPercentage = mainState.trapThresholdPercentage;

        const allDatabaseTrapCombs = await getAllTrapCombinations(activeDbPath, trapThresholdPercentage);

        const relevantTrapCombinations = allDatabaseTrapCombs.filter(combo => {
            const a1InPool = uniqueAbilityNamesInPool.has(combo.ability1InternalName);
            const a2InPool = uniqueAbilityNamesInPool.has(combo.ability2InternalName);
            const a1Picked = allPickedAbilityNames.has(combo.ability1InternalName);
            const a2Picked = allPickedAbilityNames.has(combo.ability2InternalName);
            return (a1InPool && a2InPool) || (a1InPool && a2Picked) || (a1Picked && a2InPool);
        }).map(combo => ({ ability1DisplayName: combo.ability1DisplayName, ability2DisplayName: combo.ability2DisplayName, synergyWinrate: combo.synergyWinrate }));

        // Query hero-ability trap synergies (only for heroes in the pool)
        const allHeroTrapSynergiesData = await getAllHeroTrapSynergies(activeDbPath, trapThresholdPercentage);

        const relevantHeroTraps = allHeroTrapSynergiesData.filter(synergy => {
            const abilityInPool = uniqueAbilityNamesInPool.has(synergy.abilityInternalName);
            const abilityPicked = allPickedAbilityNames.has(synergy.abilityInternalName);
            const heroInPool = heroesInPool.has(synergy.heroInternalName);
            return (abilityInPool || abilityPicked) && heroInPool;
        }).map(synergy => ({ heroDisplayName: synergy.heroDisplayName, abilityDisplayName: synergy.abilityDisplayName, synergyWinrate: synergy.synergyWinrate }));

        let allEntitiesForScoring = prepareEntitiesForScoring(currentScanCycleResults, abilityDetailsMap, identifiedHeroModelsCache);
        allEntitiesForScoring = calculateConsolidatedScores(allEntitiesForScoring);
        const mySpotHasPickedUltimate = checkMySpotPickedUltimate(mySelectedSpotDbIdForDrafting, heroesForMySpotSelectionUI, currentScanCycleResults.selectedAbilities);
        const topTierMarkedEntities = determineTopTierEntities(allEntitiesForScoring, mySelectedModelDbHeroId, mySpotHasPickedUltimate, synergisticPartnersInPoolForMySpot);

        const enrichedHeroModels = enrichHeroModelDataWithFlags(identifiedHeroModelsCache, topTierMarkedEntities, allEntitiesForScoring, heroModelSynergiesMap, heroModelWeakSynergiesMap);
        const formattedUltimates = formatResultsForUiWithFlags(currentScanCycleResults.ultimates, abilityDetailsMap, topTierMarkedEntities, 'ultimates', allEntitiesForScoring);
        const formattedStandard = formatResultsForUiWithFlags(currentScanCycleResults.standard, abilityDetailsMap, topTierMarkedEntities, 'standard', allEntitiesForScoring);
        const formattedSelectedAbilities = formatResultsForUiWithFlags(currentScanCycleResults.selectedAbilities, abilityDetailsMap, [], 'selected', allEntitiesForScoring, true);

        const durationMs = Math.round(performance.now() - overallProcessingStart);
        console.log(`[ScanProcessor] Total scan & processing time: ${durationMs}ms.`);

        const processedDataForOverlay = {
            scanData: { ultimates: formattedUltimates, standard: formattedStandard, selectedAbilities: formattedSelectedAbilities },
            heroModels: enrichedHeroModels,
            heroesForMySpotUI: heroesForMySpotSelectionUI,
            targetResolution: lastScanTargetResolution,
            opCombinations: relevantOPCombinations,
            heroSynergies: relevantHeroSynergies,
            trapCombinations: relevantTrapCombinations,
            heroTraps: relevantHeroTraps,
            initialSetup: false, // This flag is true only for the very first data sent to overlay upon creation
            scaleFactor: lastUsedScaleFactor,
            selectedHeroForDraftingDbId: mySelectedSpotDbIdForDrafting,
            selectedModelHeroOrder: mySelectedModelScreenOrder,
            durationMs
        };

        // Send to overlay
        if (overlayWebContents && !overlayWebContents.isDestroyed() && overlayWebContents.send) {
            sendStatusUpdate(overlayWebContents, 'overlay-data', processedDataForOverlay);
        }

        return {
            success: true,
            updatedMainState: {
                initialPoolAbilitiesCache,
                identifiedHeroModelsCache,
                lastRawScanResults: newLastRawScanResults,
                mySelectedSpotDbIdForDrafting,
                mySelectedSpotOriginalOrder,
                mySelectedModelDbHeroId,
                mySelectedModelScreenOrder
            }
            // processedDataForOverlay is implicitly part of the successful return via the sendStatusUpdate above
        };

    } catch (error) {
        console.error('[ScanProcessor] Error during processing of scan results:', error);
        if (overlayWebContents && !overlayWebContents.isDestroyed() && overlayWebContents.send) {
            sendStatusUpdate(overlayWebContents, 'overlay-data', { error: `Processing error: ${error.message}`, scaleFactor: lastUsedScaleFactor });
        }
        return {
            success: false,
            error: error.message,
            updatedMainState: { // Return current (potentially partially modified) state
                initialPoolAbilitiesCache,
                identifiedHeroModelsCache,
                mySelectedSpotDbIdForDrafting,
                mySelectedSpotOriginalOrder,
                mySelectedModelDbHeroId,
                mySelectedModelScreenOrder
                // lastRawScanResults is intentionally not updated on error to preserve the last known good state.
            }
        };
    }
}

module.exports = {
    processAndFinalizeScanData,
};