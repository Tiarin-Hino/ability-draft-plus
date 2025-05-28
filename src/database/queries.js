const Database = require('better-sqlite3');

/**
 * Fetches details for a list of ability names.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string[]} abilityNames - An array of ability internal names to query.
 * @returns {Map<string, object | null>} A Map where keys are ability internal names
 * and values are objects containing { internalName, displayName, winrate, highSkillWinrate, avgPickOrder, valuePercentage } or null if not found.
 */
function getAbilityDetails(dbPath, abilityNames) {
    const detailsMap = new Map();
    if (!abilityNames || abilityNames.length === 0) {
        return detailsMap;
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true });

        const placeholders = abilityNames.map(() => '?').join(', ');
        const sql = `
            SELECT name, display_name, winrate, high_skill_winrate, avg_pick_order, value_percentage 
            FROM Abilities 
            WHERE name IN (${placeholders})
        `;

        const stmt = db.prepare(sql);
        const rows = stmt.all(abilityNames);

        rows.forEach(row => {
            detailsMap.set(row.name, {
                internalName: row.name,
                displayName: row.display_name || row.name,
                winrate: (typeof row.winrate === 'number') ? row.winrate : null,
                highSkillWinrate: (typeof row.high_skill_winrate === 'number') ? row.high_skill_winrate : null,
                avgPickOrder: (typeof row.avg_pick_order === 'number') ? row.avg_pick_order : null,
                valuePercentage: (typeof row.value_percentage === 'number') ? row.value_percentage : null
            });
        });

    } catch (err) {
        console.error(`Error fetching ability details: ${err.message}`);
        return new Map(); // Return an empty map on error
    } finally {
        if (db) {
            db.close();
        }
    }
    return detailsMap;
}

/**
 * Fetches high winrate combinations for a specific ability against a pool of other abilities,
 * ensuring that synergistic abilities are from different heroes.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} baseAbilityInternalName - The internal name of the ability to find synergies for.
 * @param {string[]} draftPoolInternalNames - An array of internal names of other abilities in the draft pool.
 * @returns {Promise<Array<{partnerAbilityDisplayName: string, synergyWinrate: number}>>}
 */
async function getHighWinrateCombinations(dbPath, baseAbilityInternalName, draftPoolInternalNames) {
    const combinations = [];
    if (!baseAbilityInternalName || !draftPoolInternalNames || draftPoolInternalNames.length === 0) {
        return combinations;
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true });

        const baseAbilityInfo = db.prepare('SELECT hero_id FROM Abilities WHERE name = ?').get(baseAbilityInternalName);
        if (!baseAbilityInfo) {
            console.warn(`Base ability ${baseAbilityInternalName} not found in DB for synergy check.`);
            return combinations;
        }
        const baseAbilityHeroId = baseAbilityInfo.hero_id;

        const otherPoolAbilities = draftPoolInternalNames.filter(name => name !== baseAbilityInternalName);
        if (otherPoolAbilities.length === 0) {
            return combinations;
        }
        const otherPoolPlaceholders = otherPoolAbilities.map(() => '?').join(', ');

        const synergyQuery = `
            SELECT
                s.synergy_winrate,
                ab_other.display_name AS partner_display_name,
                ab_other.name AS partner_internal_name,
                ab_other.hero_id AS partner_hero_id
            FROM AbilitySynergies s
            JOIN Abilities ab_base ON (s.base_ability_id = ab_base.ability_id OR s.synergy_ability_id = ab_base.ability_id)
            JOIN Abilities ab_other ON ((s.synergy_ability_id = ab_other.ability_id AND s.base_ability_id = ab_base.ability_id) OR (s.base_ability_id = ab_other.ability_id AND s.synergy_ability_id = ab_base.ability_id))
            WHERE ab_base.name = ?
              AND ab_other.name IN (${otherPoolPlaceholders})
              AND ab_other.name != ?
              AND (
                    ${baseAbilityHeroId === null ? '1=1' : 'ab_other.hero_id IS NOT NULL AND ab_other.hero_id != ?'}
                  )
            ORDER BY s.synergy_winrate DESC;
        `;

        const queryParams = [baseAbilityInternalName, ...otherPoolAbilities, baseAbilityInternalName];
        if (baseAbilityHeroId !== null) {
            queryParams.push(baseAbilityHeroId);
        }

        const synergyStmt = db.prepare(synergyQuery);
        const synergyRows = synergyStmt.all(...queryParams);

        synergyRows.forEach(row => {
            combinations.push({
                partnerAbilityDisplayName: row.partner_display_name || row.partner_internal_name,
                synergyWinrate: row.synergy_winrate
            });
        });

    } catch (err) {
        console.error(`Error fetching high winrate combinations for ${baseAbilityInternalName}: ${err.message}`);
    } finally {
        if (db) {
            db.close();
        }
    }
    return combinations;
}

/**
 * Fetches "OP" ability combinations present in the current draft pool.
 * An OP combination is one where the 'is_op' flag is true in the AbilitySynergies table.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string[]} draftPoolInternalNames - An array of internal names of all abilities in the draft pool.
 * @returns {Promise<Array<{ability1DisplayName: string, ability2DisplayName: string, synergyWinrate: number}>>}
 */
async function getOPCombinationsInPool(dbPath, draftPoolInternalNames) {
    const opCombinations = [];
    if (!draftPoolInternalNames || draftPoolInternalNames.length < 2) { // Need at least two abilities for a pair
        return opCombinations;
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true });

        // Create placeholders for the IN clause
        const poolPlaceholders = draftPoolInternalNames.map(() => '?').join(',');

        const opQuery = `
            SELECT
                a1.display_name AS ability1_display_name,
                a1.name AS ability1_internal_name,
                a2.display_name AS ability2_display_name,
                a2.name AS ability2_internal_name,
                s.synergy_winrate
            FROM AbilitySynergies s
            JOIN Abilities a1 ON s.base_ability_id = a1.ability_id
            JOIN Abilities a2 ON s.synergy_ability_id = a2.ability_id
            WHERE s.is_op = 1                         -- Check for the OP flag
              AND a1.name IN (${poolPlaceholders})    -- Both abilities must be in the pool
              AND a2.name IN (${poolPlaceholders})
              AND a1.name < a2.name;                  -- Ensure each pair is reported once (a1 < a2)
        `;
        // The query parameters will be draftPoolInternalNames repeated twice for the two IN clauses.
        const queryParams = [...draftPoolInternalNames, ...draftPoolInternalNames];
        const opStmt = db.prepare(opQuery);
        const opRows = opStmt.all(...queryParams);

        opRows.forEach(row => {
            // Filter again in JS to be absolutely sure both are in the current pool,
            // as SQL IN clause with repeated params might not be strictly what we want here
            // if an ability could be base and synergy in different DB rows but only one present in pool.
            // The a1.name < a2.name handles uniqueness of pairs already.
            if (draftPoolInternalNames.includes(row.ability1_internal_name) && draftPoolInternalNames.includes(row.ability2_internal_name)) {
                opCombinations.push({
                    ability1DisplayName: row.ability1_display_name || row.ability1_internal_name,
                    ability2DisplayName: row.ability2_display_name || row.ability2_internal_name,
                    synergyWinrate: row.synergy_winrate // You might want to display this too
                });
            }
        });

    } catch (err) {
        console.error(`Error fetching OP combinations: ${err.message}`);
    } finally {
        if (db) {
            db.close();
        }
    }
    return opCombinations;
}

/**
 * Fetches hero details by an ability name that belongs to that hero.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} abilityName - The internal name of the ability.
 * @returns {Promise<{heroId: number, heroName: string, heroDisplayName: string} | null>}
 */
async function getHeroDetailsByAbilityName(dbPath, abilityName) {
    if (!abilityName) {
        return null;
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true });
        const query = `
            SELECT H.hero_id, H.name AS heroName, H.display_name AS heroDisplayName
            FROM Abilities A
            JOIN Heroes H ON A.hero_id = H.hero_id
            WHERE A.name = ?;
        `;
        const stmt = db.prepare(query);
        const heroDetails = stmt.get(abilityName);

        return heroDetails || null;

    } catch (err) {
        console.error(`Error fetching hero details by ability name ${abilityName}: ${err.message}`);
        return null;
    } finally {
        if (db) {
            db.close();
        }
    }
}

/**
 * Fetches hero details including winrate by hero_id.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {number} heroId - The database ID of the hero.
 * @returns {Promise<{dbHeroId: number, heroName: string, heroDisplayName: string, winrate: number} | null>}
 */
async function getHeroDetailsById(dbPath, heroId) {
    if (heroId === null || typeof heroId === 'undefined') {
        console.warn('[Queries] getHeroDetailsById called with null or undefined heroId.');
        return null;
    }
    let db;
    try {
        db = new Database(dbPath, { readonly: true });
        const row = db.prepare('SELECT hero_id, name, display_name, winrate FROM Heroes WHERE hero_id = ?').get(heroId);
        if (row) {
            return {
                dbHeroId: row.hero_id,
                heroName: row.name,
                heroDisplayName: row.display_name,
                winrate: (typeof row.winrate === 'number') ? row.winrate : null
            };
        }
        return null;
    } catch (err) {
        console.error(`Error fetching hero details for hero_id ${heroId}: ${err.message}`);
        return null;
    } finally {
        if (db && db.open) db.close();
    }
}


module.exports = {
    getAbilityDetails,
    getHighWinrateCombinations,
    getOPCombinationsInPool,
    getHeroDetailsByAbilityName,
    getHeroDetailsById 
};