const Database = require('better-sqlite3');

/**
 * Fetches normal winrates for a list of ability names.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string[]} abilityNames - An array of ability names to query.
 * @returns {Map<string, number | null>} A Map where keys are ability names and values are winrates (or null if not found).
 */
function getAbilityWinrates(dbPath, abilityNames) {
    const winrateMap = new Map();
    if (!abilityNames || abilityNames.length === 0) {
        return winrateMap; // Return empty map if no names provided
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true }); // Open read-only

        // Prepare placeholder string for IN clause: (?, ?, ...)
        const placeholders = abilityNames.map(() => '?').join(', ');
        const sql = `SELECT name, winrate FROM Abilities WHERE name IN (${placeholders})`;

        const stmt = db.prepare(sql);
        const rows = stmt.all(abilityNames); // Bind the array of names

        // Populate the map with results
        rows.forEach(row => {
            // Ensure winrate is stored as a number or null
            winrateMap.set(row.name, (typeof row.winrate === 'number') ? row.winrate : null);
        });

        // For names provided but not found in DB, map will not have an entry (or we could explicitly set null)
        // The calling function will handle lookup misses.

    } catch (err) {
        console.error(`Error fetching ability winrates: ${err.message}`);
        // On error, return an empty map or rethrow, depending on desired handling
        // For now, log error and return potentially incomplete map or empty map
        return new Map(); // Return empty map on error to avoid partial data issues downstream
    } finally {
        if (db) {
            db.close();
        }
    }
    return winrateMap;
}

module.exports = { getAbilityWinrates };