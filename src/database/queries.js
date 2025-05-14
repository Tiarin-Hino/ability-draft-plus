const Database = require('better-sqlite3');

/**
 * Fetches details for a list of ability names.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string[]} abilityNames - An array of ability internal names to query.
 * @returns {Map<string, object | null>} A Map where keys are ability internal names
 * and values are objects containing { name, displayName, winrate, highSkillWinrate } or null if not found.
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
        const sql = `SELECT name, display_name, winrate, high_skill_winrate FROM Abilities WHERE name IN (${placeholders})`;

        const stmt = db.prepare(sql);
        const rows = stmt.all(abilityNames);

        rows.forEach(row => {
            detailsMap.set(row.name, {
                internalName: row.name, // Keep original key as internalName for consistency
                displayName: row.display_name || row.name,
                winrate: (typeof row.winrate === 'number') ? row.winrate : null,
                highSkillWinrate: (typeof row.high_skill_winrate === 'number') ? row.high_skill_winrate : null // Added
            });
        });

    } catch (err) {
        console.error(`Error fetching ability details: ${err.message}`);
        return new Map();
    } finally {
        if (db) {
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

        // Get the ID and display name for the base ability
        const baseAbilityRow = db.prepare('SELECT ability_id, display_name FROM Abilities WHERE name = ?').get(baseAbilityInternalName);
        if (!baseAbilityRow) {
            console.warn(`Base ability ${baseAbilityInternalName} not found in DB for synergy check.`);
            return combinations;
        }
        const baseAbilityId = baseAbilityRow.ability_id;

        // Get IDs and display names for the draft pool abilities
        const poolPlaceholders = draftPoolInternalNames.map(() => '?').join(', ');
        const poolAbilitiesSql = `SELECT ability_id, name, display_name FROM Abilities WHERE name IN (${poolPlaceholders})`;
        const poolAbilityRows = db.prepare(poolAbilitiesSql).all(draftPoolInternalNames);
        const poolAbilityNameToDetailsMap = new Map(poolAbilityRows.map(row => [row.name, { id: row.ability_id, displayName: row.display_name || row.name }]));


        // Prepare the synergy query
        // We need to check both (base_ability_id = X AND synergy_ability_id = Y) OR (base_ability_id = Y AND synergy_ability_id = X)
        // because we store pairs with the lower ID first.
        const synergySql = `
            SELECT
                s.synergy_winrate,
                CASE
                    WHEN s.base_ability_id = ? THEN pa2.display_name
                    ELSE pa1.display_name
                END as partner_display_name,
                 CASE
                    WHEN s.base_ability_id = ? THEN pa2.name
                    ELSE pa1.name
                END as partner_internal_name
            FROM AbilitySynergies s
            JOIN Abilities pa1 ON s.base_ability_id = pa1.ability_id
            JOIN Abilities pa2 ON s.synergy_ability_id = pa2.ability_id
            WHERE
                (s.base_ability_id = ? AND s.synergy_ability_id IN (SELECT ability_id FROM Abilities WHERE name IN (${poolPlaceholders}) AND name != ?)) OR
                (s.synergy_ability_id = ? AND s.base_ability_id IN (SELECT ability_id FROM Abilities WHERE name IN (${poolPlaceholders}) AND name != ?))
            ORDER BY s.synergy_winrate DESC
        `;

        // Filter out the baseAbilityInternalName from the draftPoolInternalNames for the IN clause
        const otherPoolAbilities = draftPoolInternalNames.filter(name => name !== baseAbilityInternalName);
        if (otherPoolAbilities.length === 0) {
            return combinations; // No other abilities to check synergy with
        }
        const otherPoolPlaceholders = otherPoolAbilities.map(() => '?').join(', ');


        const synergyQueryActual = `
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
            ORDER BY s.synergy_winrate DESC;
        `;


        const synergyStmt = db.prepare(synergyQueryActual);
        const synergyRows = synergyStmt.all(baseAbilityInternalName, ...otherPoolAbilities, baseAbilityInternalName);


        synergyRows.forEach(row => {
            combinations.push({
                partnerAbilityDisplayName: row.partner_display_name || row.partner_internal_name, // Fallback
                synergyWinrate: row.synergy_winrate
            });
        });

    } catch (err) {
        console.error(`Error fetching high winrate combinations for ${baseAbilityInternalName}: ${err.message}`);
        // Return empty array on error
    } finally {
        if (db) {
            db.close();
        }
    }
    return combinations;
}


module.exports = { getAbilityDetails, getHighWinrateCombinations }; // Export new function