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
        return new Map(); // Return an empty map on error to avoid downstream issues
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

        // Get the hero_id for the base ability
        const baseAbilityInfo = db.prepare('SELECT hero_id FROM Abilities WHERE name = ?').get(baseAbilityInternalName);
        if (!baseAbilityInfo) {
            console.warn(`Base ability ${baseAbilityInternalName} not found in DB for synergy check.`);
            return combinations;
        }
        const baseAbilityHeroId = baseAbilityInfo.hero_id;

        // Filter out the baseAbilityInternalName from the draftPoolInternalNames for the IN clause
        const otherPoolAbilities = draftPoolInternalNames.filter(name => name !== baseAbilityInternalName);
        if (otherPoolAbilities.length === 0) {
            return combinations; // No other abilities to check synergy with
        }
        const otherPoolPlaceholders = otherPoolAbilities.map(() => '?').join(', ');

        // Query to fetch synergies
        // Ensures that the partner ability's hero_id is different from the base ability's hero_id
        // Also explicitly checks that ab_other.hero_id IS NOT NULL if baseAbilityHeroId IS NOT NULL,
        // to handle cases where hero_id might be null for some abilities. If base hero_id is null,
        // any partner is fine. If base hero_id is not null, partner hero_id must also not be null and different.
        const synergyQuery = `
            SELECT
                s.synergy_winrate,
                ab_other.display_name AS partner_display_name,
                ab_other.name AS partner_internal_name,
                ab_other.hero_id AS partner_hero_id
            FROM AbilitySynergies s
            JOIN Abilities ab_base ON (s.base_ability_id = ab_base.ability_id OR s.synergy_ability_id = ab_base.ability_id)
            JOIN Abilities ab_other ON ((s.synergy_ability_id = ab_other.ability_id AND s.base_ability_id = ab_base.ability_id) OR (s.base_ability_id = ab_other.ability_id AND s.synergy_ability_id = ab_base.ability_id))
            WHERE ab_base.name = ?                                      -- The ability we are checking synergies for
              AND ab_other.name IN (${otherPoolPlaceholders})           -- The partner ability must be in the current draft pool
              AND ab_other.name != ?                                    -- The partner ability is not the same as the base ability
              AND (
                    ${baseAbilityHeroId === null ? '1=1' : 'ab_other.hero_id IS NOT NULL AND ab_other.hero_id != ?'}
                  )                                                     -- Partner ability must be from a different hero (if base hero has a hero_id)
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


module.exports = { getAbilityDetails, getHighWinrateCombinations };