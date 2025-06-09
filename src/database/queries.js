const Database = require('better-sqlite3');

/**
 * Fetches all heroes (hero_id, name, display_name) from the database.
 * @param {string} dbPath - Path to the SQLite database file.
 * @returns {Promise<Array<{hero_id: number, name: string, display_name: string}>>}
 */
async function getAllHeroes(dbPath) {
    let db;
    try {
        db = new Database(dbPath, { readonly: true });
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
 * Fetches details for a list of ability names from the database.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string[]} abilityNames - An array of ability internal names to query.
 * @returns {Map<string, object | null>} A Map where keys are ability internal names
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
                displayName: row.display_name || row.name,
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
 * Fetches high winrate combinations for a specific ability against a pool of other abilities.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} baseAbilityInternalName - The internal name of the ability to find synergies for.
 * @param {string[]} draftPoolInternalNames - An array of internal names of other abilities in the draft pool.
 * @returns {Promise<Array<{partnerAbilityDisplayName: string, partnerInternalName: string, synergyWinrate: number}>>}
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
            console.warn(`[DB Queries] Base ability "${baseAbilityInternalName}" not found for synergy check.`);
            return combinations;
        }
        const baseAbilityHeroId = baseAbilityInfo.hero_id;

        const otherPoolAbilities = draftPoolInternalNames.filter(name => name !== baseAbilityInternalName);
        if (otherPoolAbilities.length === 0) {
            return combinations;
        }

        const otherPoolPlaceholders = otherPoolAbilities.map(() => '?').join(', ');
        const heroIdFilterClause = baseAbilityHeroId === null ? '1=1' : 'ab_other.hero_id IS NOT NULL AND ab_other.hero_id != ?';

        const synergyQuery = `
            SELECT
                s.synergy_winrate,
                ab_other.display_name AS partner_display_name,
                ab_other.name AS partner_internal_name
            FROM AbilitySynergies s
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
                partnerAbilityDisplayName: row.partner_display_name || row.partner_internal_name,
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
 * @returns {Promise<Array<{ability1DisplayName: string, ability2DisplayName: string, synergyWinrate: number}>>}
 */
async function getOPCombinationsInPool(dbPath, draftPoolInternalNames) {
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
              AND a1.name < a2.name;
        `;

        const queryParams = [...draftPoolInternalNames, ...draftPoolInternalNames];
        const opStmt = db.prepare(opQuery);
        const opRows = opStmt.all(...queryParams);

        opRows.forEach(row => {
            if (draftPoolInternalNames.includes(row.ability1_internal_name) && draftPoolInternalNames.includes(row.ability2_internal_name)) {
                opCombinations.push({
                    ability1DisplayName: row.ability1_display_name || row.ability1_internal_name,
                    ability2DisplayName: row.ability2_display_name || row.ability2_internal_name,
                    synergyWinrate: row.synergy_winrate
                });
            }
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
 * Fetches basic hero details (ID, name, display name) using an ability name that belongs to that hero.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} abilityName - The internal name of an ability associated with the hero.
 * @returns {Promise<{hero_id: number, heroName: string, heroDisplayName: string} | null>}
 */
async function getHeroDetailsByAbilityName(dbPath, abilityName) {
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
        return heroDetails || null;
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
 * Fetches detailed hero information by the hero's database ID.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {number} heroId - The database ID (hero_id) of the hero.
 * @returns {Promise<object | null>} An object with detailed hero statistics or null if not found.
 */
async function getHeroDetailsById(dbPath, heroId) {
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
                heroDisplayName: row.display_name,
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
 * Fetches all "OP" (overpowered) ability combinations from the database.
 * @param {string} dbPath - Path to the SQLite database file.
 * @returns {Promise<Array<object>>}
 */
async function getAllOPCombinations(dbPath) {
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
              AND a1.name < a2.name; 
        `;
        const opStmt = db.prepare(opQuery);
        const opRows = opStmt.all();

        opRows.forEach(row => {
            opCombinations.push({
                ability1InternalName: row.ability1_internal_name,
                ability1DisplayName: row.ability1_display_name || row.ability1_internal_name,
                ability2InternalName: row.ability2_internal_name,
                ability2DisplayName: row.ability2_display_name || row.ability2_internal_name,
                synergyWinrate: row.synergy_winrate
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

/**
 * Fetches all abilities associated with a specific hero_id.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {number} heroId - The database ID of the hero.
 * @returns {Promise<Array<object>>}
 */
async function getAbilitiesByHeroId(dbPath, heroId) {
    if (heroId === null || typeof heroId === 'undefined') {
        return [];
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true });
        const query = `
            SELECT
                name,
                display_name,
                is_ultimate,
                ability_order
            FROM Abilities
            WHERE hero_id = ?
            ORDER BY ability_order ASC;
        `;
        const stmt = db.prepare(query);
        const abilities = stmt.all(heroId);
        return abilities;
    } catch (err) {
        console.error(`[DB Queries] Error fetching abilities for hero_id ${heroId}: ${err.message}`);
        return [];
    } finally {
        if (db && db.open) {
            db.close();
        }
    }
}

module.exports = {
    getAbilityDetails,
    getHighWinrateCombinations,
    getOPCombinationsInPool,
    getAllOPCombinations,
    getHeroDetailsByAbilityName,
    getHeroDetailsById,
    getAllHeroes,
    getAbilitiesByHeroId
};