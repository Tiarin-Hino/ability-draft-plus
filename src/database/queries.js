const Database = require('better-sqlite3');

/**
 * Fetches all heroes from the database.
 * @param {string} dbPath - Path to the SQLite database file.
 * @returns {Array<{hero_id: number, name: string, display_name: string | null}>} An array of hero objects.
 */
function getAllHeroes(dbPath) {
    let db;
    try {
        db = new Database(dbPath, { readonly: true });
        // Fetches core hero identifiers. display_name can be null.
        const query = `
            SELECT
                hero_id,
                name,
                display_name
            FROM Heroes;
        `;
        const stmt = db.prepare(query);
        const heroes = stmt.all();
        return heroes;
    } catch (err) {
        console.error(`[DB Queries] Error fetching all heroes: ${err.message}`);
        return [];
    } finally {
        if (db && db.open) {
            db.close();
        }
    }
}

/**
 * Fetches detailed hero information by the hero's database ID.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {number} heroId - The database ID (hero_id) of the hero.
 * @returns {{dbHeroId: number, heroName: string, heroDisplayName: string | null, winrate: number | null, highSkillWinrate: number | null, pickRate: number | null, hsPickRate: number | null} | null} An object with detailed hero statistics or null if not found.
 */
function getHeroDetailsById(dbPath, heroId) {
    if (heroId === null || typeof heroId === 'undefined') {
        return null;
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true });
        const row = db.prepare(`
            SELECT
                hero_id,
                name,
                display_name,
                winrate,
                high_skill_winrate,
                pick_rate,
                hs_pick_rate
            FROM Heroes
            WHERE hero_id = ?;
        `).get(heroId);

        if (row) {
            return {
                dbHeroId: row.hero_id,
                heroName: row.name,
                heroDisplayName: row.display_name, // Can be null
                winrate: (typeof row.winrate === 'number') ? row.winrate : null,
                highSkillWinrate: (typeof row.high_skill_winrate === 'number') ? row.high_skill_winrate : null,
                pickRate: (typeof row.pick_rate === 'number') ? row.pick_rate : null,
                hsPickRate: (typeof row.hs_pick_rate === 'number') ? row.hs_pick_rate : null,
            };
        }
        return null;
    } catch (err) {
        console.error(`[DB Queries] Error fetching hero details for hero_id ${heroId}: ${err.message}`);
        return null;
    } finally {
        if (db && db.open) {
            db.close();
        }
    }
}

/**
 * Fetches basic hero details (ID, name, display name) using an ability name that belongs to that hero.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} abilityName - The internal name of an ability associated with the hero.
 * @returns {{hero_id: number, heroName: string, heroDisplayName: string | null} | null} Hero details or null if not found/error.
 */
function getHeroDetailsByAbilityName(dbPath, abilityName) {
    if (!abilityName) {
        return null;
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true });
        const query = `
            SELECT
                H.hero_id,
                H.name AS heroName,
                H.display_name AS heroDisplayName
            FROM Abilities A
            JOIN Heroes H ON A.hero_id = H.hero_id
            WHERE A.name = ?;
        `;
        const stmt = db.prepare(query);
        const heroDetails = stmt.get(abilityName);
        return heroDetails || null; // heroDisplayName can be null
    } catch (err) {
        console.error(`[DB Queries] Error fetching hero details by ability name "${abilityName}": ${err.message}`);
        return null;
    } finally {
        if (db && db.open) {
            db.close();
        }
    }
}

/**
 * Fetches details for a list of ability names from the database.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string[]} abilityNames - An array of ability internal names to query.
 * @returns {Map<string, object>} A Map where keys are ability internal names
 * and values are objects containing ability details.
 */
function getAbilityDetails(dbPath, abilityNames) {
    const detailsMap = new Map();
    if (!abilityNames || abilityNames.length === 0) {
        return detailsMap;
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true });
        // Placeholders for IN clause
        const placeholders = abilityNames.map(() => '?').join(', ');
        const sql = `
            SELECT
                name,
                display_name,
                winrate,
                high_skill_winrate,
                pick_rate,
                hs_pick_rate,
                is_ultimate,
                ability_order
            FROM Abilities
            WHERE name IN (${placeholders});
        `;

        const stmt = db.prepare(sql);
        const rows = stmt.all(abilityNames);

        rows.forEach(row => {
            detailsMap.set(row.name, {
                internalName: row.name,
                displayName: row.display_name || row.name, // Fallback to internal name if display_name is null
                winrate: (typeof row.winrate === 'number') ? row.winrate : null,
                highSkillWinrate: (typeof row.high_skill_winrate === 'number') ? row.high_skill_winrate : null,
                pickRate: (typeof row.pick_rate === 'number') ? row.pick_rate : null,
                hsPickRate: (typeof row.hs_pick_rate === 'number') ? row.hs_pick_rate : null,
                is_ultimate: row.is_ultimate,
                ability_order: row.ability_order
            });
        });

    } catch (err) {
        console.error(`[DB Queries] Error fetching ability details: ${err.message}`);
        return new Map();
    } finally {
        if (db && db.open) {
            db.close();
        }
    }
    return detailsMap;
}

/**
 * Fetches all abilities associated with a specific hero_id.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {number} heroId - The database ID of the hero.
 * @returns {Array<{name: string, display_name: string | null, is_ultimate: boolean, ability_order: number}>} An array of ability objects.
 */
function getAbilitiesByHeroId(dbPath, heroId) {
    if (heroId === null || typeof heroId === 'undefined') {
        return [];
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true });
        const query = `
            SELECT
                name,
                display_name, -- Can be null
                is_ultimate,
                ability_order
            FROM Abilities
            WHERE hero_id = ?
            ORDER BY ability_order ASC;
        `;
        const stmt = db.prepare(query);
        return stmt.all(heroId);
    } catch (err) {
        console.error(`[DB Queries] Error fetching abilities for hero_id ${heroId}: ${err.message}`);
        return [];
    } finally {
        if (db && db.open) {
            db.close();
        }
    }
}

/**
 * Fetches high winrate combinations for a specific ability against a pool of other abilities.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} baseAbilityInternalName - The internal name of the ability to find synergies for.
 * @param {string[]} draftPoolInternalNames - An array of internal names of other abilities in the draft pool.
 * @returns {Array<{partnerAbilityDisplayName: string, partnerInternalName: string, synergyWinrate: number}>} An array of synergy objects.
 */
function getHighWinrateCombinations(dbPath, baseAbilityInternalName, draftPoolInternalNames) {
    const combinations = [];
    if (!baseAbilityInternalName || !draftPoolInternalNames || draftPoolInternalNames.length === 0) {
        return combinations;
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true });

        const baseAbilityInfo = db.prepare('SELECT hero_id FROM Abilities WHERE name = ?').get(baseAbilityInternalName);
        // If base ability not found, cannot proceed
        if (!baseAbilityInfo) {
            console.warn(`[DB Queries] Base ability "${baseAbilityInternalName}" not found for synergy check.`);
            return combinations;
        }
        const baseAbilityHeroId = baseAbilityInfo.hero_id;

        const otherPoolAbilities = draftPoolInternalNames.filter(name => name !== baseAbilityInternalName);
        // If no other abilities in pool, no synergies to find
        if (otherPoolAbilities.length === 0) {
            return combinations;
        }

        const otherPoolPlaceholders = otherPoolAbilities.map(() => '?').join(', ');
        // Filter out synergies with abilities from the same hero as the base ability, unless base ability has no hero_id
        const heroIdFilterClause = (baseAbilityHeroId === null) ? '1=1' : '(ab_other.hero_id IS NULL OR ab_other.hero_id != ?)';

        const synergyQuery = `
            SELECT
                s.synergy_winrate,
                ab_other.display_name AS partner_display_name,
                ab_other.name AS partner_internal_name
            FROM AbilitySynergies s
            -- Join to find base ability and its partner in the synergy pair
            JOIN Abilities ab_base ON (s.base_ability_id = ab_base.ability_id OR s.synergy_ability_id = ab_base.ability_id)
            JOIN Abilities ab_other ON ((s.synergy_ability_id = ab_other.ability_id AND s.base_ability_id = ab_base.ability_id) OR (s.base_ability_id = ab_other.ability_id AND s.synergy_ability_id = ab_base.ability_id))
            WHERE ab_base.name = ?
              AND ab_other.name IN (${otherPoolPlaceholders})
              AND ab_other.name != ?
              AND (${heroIdFilterClause})
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
                partnerAbilityDisplayName: row.partner_display_name || row.partner_internal_name, // Fallback for display name
                partnerInternalName: row.partner_internal_name,
                synergyWinrate: row.synergy_winrate
            });
        });

    } catch (err) {
        console.error(`[DB Queries] Error fetching high winrate combinations for "${baseAbilityInternalName}": ${err.message}`);
    } finally {
        if (db && db.open) {
            db.close();
        }
    }
    return combinations;
}

/**
 * Fetches "OP" (overpowered) ability combinations present in the current draft pool.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string[]} draftPoolInternalNames - An array of internal names of all abilities in the draft pool.
 * @returns {Array<{ability1DisplayName: string, ability2DisplayName: string, synergyWinrate: number}>} An array of OP combination objects.
 */
function getOPCombinationsInPool(dbPath, draftPoolInternalNames) {
    const opCombinations = [];
    if (!draftPoolInternalNames || draftPoolInternalNames.length < 2) {
        return opCombinations;
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true });

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
            WHERE s.is_op = 1
              AND a1.name IN (${poolPlaceholders})
              AND a2.name IN (${poolPlaceholders}) 
              AND a1.name < a2.name; -- Ensures each pair is reported once in a canonical order
        `;

        const queryParams = [...draftPoolInternalNames, ...draftPoolInternalNames];
        const opStmt = db.prepare(opQuery);
        const opRows = opStmt.all(...queryParams);
        // The SQL query already ensures abilities are in the draft pool.
        opRows.forEach(row => {
            opCombinations.push({
                ability1DisplayName: row.ability1_display_name || row.ability1_internal_name, // Fallback for display name
                ability2DisplayName: row.ability2_display_name || row.ability2_internal_name, // Fallback for display name
                synergyWinrate: row.synergy_winrate
            });
        });

    } catch (err) {
        console.error(`[DB Queries] Error fetching OP combinations: ${err.message}`);
    } finally {
        if (db && db.open) {
            db.close();
        }
    }
    return opCombinations;
}

/**
 * Fetches all "OP" (overpowered) ability combinations from the database.
 * @param {string} dbPath - Path to the SQLite database file.
 * @returns {Array<{ability1InternalName: string, ability1DisplayName: string, ability2InternalName: string, ability2DisplayName: string, synergyWinrate: number}>} An array of all OP combination objects.
 */
function getAllOPCombinations(dbPath) {
    let db;
    const opCombinations = [];

    try {
        db = new Database(dbPath, { readonly: true });
        const opQuery = `
            SELECT
                a1.name AS ability1_internal_name,
                a1.display_name AS ability1_display_name,
                a2.name AS ability2_internal_name,
                a2.display_name AS ability2_display_name,
                s.synergy_winrate
            FROM AbilitySynergies s
            JOIN Abilities a1 ON s.base_ability_id = a1.ability_id
            JOIN Abilities a2 ON s.synergy_ability_id = a2.ability_id
            WHERE s.is_op = 1
              AND a1.name < a2.name; -- Ensures each pair is reported once in a canonical order
        `;
        const opStmt = db.prepare(opQuery);
        const opRows = opStmt.all();

        opRows.forEach(row => {
            opCombinations.push({
                ability1InternalName: row.ability1_internal_name,
                ability1DisplayName: row.ability1_display_name || row.ability1_internal_name, // Fallback for display name
                ability2InternalName: row.ability2_internal_name,
                ability2DisplayName: row.ability2_display_name || row.ability2_internal_name, // Fallback for display name
                synergyWinrate: row.synergy_winrate,
            });
        });
    } catch (err) {
        console.error(`[DB Queries] Error fetching ALL OP combinations: ${err.message}`);
    } finally {
        if (db && db.open) {
            db.close();
        }
    }
    return opCombinations;
}

module.exports = {
    // Hero Queries
    getAllHeroes,
    getHeroDetailsById,
    getHeroDetailsByAbilityName,
    // Ability Queries
    getAbilityDetails,
    getAbilitiesByHeroId,
    // Synergy Queries
    getHighWinrateCombinations,
    getOPCombinationsInPool,
    getAllOPCombinations,
};