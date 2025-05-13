const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');

// --- Reusable Helper Functions (Consider moving to a shared utils file later) ---
function parseWinrate(text) {
    if (!text) return null;
    const cleanedText = text.trim().replace('%', '');
    const parsedRate = parseFloat(cleanedText);
    return !isNaN(parsedRate) ? parsedRate / 100.0 : null;
}

function extractAbilityName(imgSrc) {
    if (!imgSrc) return null;
    const filename = imgSrc.split('/').pop();
    return filename.replace(/\.png$/i, '');
}
// --- End Helper Functions ---

/**
 * Scrapes ability pair data from windrun.io, dynamically finds columns,
 * and updates the database based on a winrate threshold.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} url - The URL to scrape (e.g., 'https://windrun.io/ability-pairs').
 * @param {function(string): void} statusCallback - Function to send status updates.
 */
async function scrapeAndStoreAbilityPairs(dbPath, url, statusCallback) {
    let db;
    const WINRATE_THRESHOLD = 0.50; // 50%

    try {
        statusCallback(`Workspaceing ability pairs data from ${url}...`);
        const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });

        statusCallback('Parsing HTML and finding columns...');
        const $ = cheerio.load(html);

        // --- Find Column Indices ---
        let colIndexAbilityOne = -1;
        let colIndexAbilityTwo = -1;
        let colIndexWinrate = -1;

        // Select the second row in the thead, then find th elements within it
        const headerCells = $('thead tr:nth-child(2) th');
        if (headerCells.length === 0) {
             throw new Error('Could not find header cells (thead tr:nth-child(2) th). DOM structure might have changed.');
        }

        headerCells.each((index, element) => {
            const dataField = $(element).attr('data-field');
            if (dataField === 'ability-one-pic') colIndexAbilityOne = index;
            else if (dataField === 'ability-two-pic') colIndexAbilityTwo = index;
            else if (dataField === 'combined-winrate') colIndexWinrate = index;
        });

        if (colIndexAbilityOne === -1 || colIndexAbilityTwo === -1 || colIndexWinrate === -1) {
            throw new Error(`Could not find all required columns: ability-one-pic (found=${colIndexAbilityOne!==-1}), ability-two-pic (found=${colIndexAbilityTwo!==-1}), combined-winrate (found=${colIndexWinrate!==-1}). Check data-field attributes.`);
        }
        statusCallback(`Column indices found: Abil1=${colIndexAbilityOne}, Abil2=${colIndexAbilityTwo}, WR=${colIndexWinrate}`);

        // --- Pre-fetch Ability IDs ---
        statusCallback('Fetching existing ability IDs from database...');
        db = new Database(dbPath, { readonly: true }); // Open read-only initially
        const abilities = db.prepare('SELECT ability_id, name FROM Abilities').all();
        const abilityNameToIdMap = new Map(abilities.map(a => [a.name, a.ability_id]));
        db.close(); // Close read-only connection
        statusCallback(`Loaded ${abilityNameToIdMap.size} abilities into map.`);

        if (abilityNameToIdMap.size === 0) {
            throw new Error("Ability map is empty. Please run 'Update Ability Winrates' first.");
        }

        // --- Extract Data from Table Body ---
        const rows = $('tbody tr');
        if (rows.length === 0) throw new Error('No ability pair data rows found in tbody.');
        statusCallback(`Found ${rows.length} pair rows. Processing...`);

        const pairsToInsert = [];
        const pairsToDelete = [];

        rows.each((index, element) => {
            const row = $(element);
            const cells = row.find('td'); // Get all cells in the row

            // Ensure row has enough cells before trying to access by index
            if (cells.length > Math.max(colIndexAbilityOne, colIndexAbilityTwo, colIndexWinrate)) {
                const tdAbilityOne = cells.eq(colIndexAbilityOne);
                const tdAbilityTwo = cells.eq(colIndexAbilityTwo);
                const tdWinrate = cells.eq(colIndexWinrate);

                const name1 = extractAbilityName(tdAbilityOne.find('img').attr('src'));
                const name2 = extractAbilityName(tdAbilityTwo.find('img').attr('src'));
                const winrate = parseWinrate(tdWinrate.text());

                if (name1 && name2 && winrate !== null) {
                    const id1 = abilityNameToIdMap.get(name1);
                    const id2 = abilityNameToIdMap.get(name2);

                    if (id1 && id2 && id1 !== id2) { // Ensure both abilities exist in DB and are different
                        // Enforce consistent ordering: lower ID first
                        const baseAbilityId = Math.min(id1, id2);
                        const synergyAbilityId = Math.max(id1, id2);

                        if (winrate >= WINRATE_THRESHOLD) {
                            pairsToInsert.push({ baseAbilityId, synergyAbilityId, winrate });
                        } else {
                            pairsToDelete.push({ baseAbilityId, synergyAbilityId });
                        }
                    } else if (!id1 || !id2) {
                        console.warn(`Skipping pair row ${index + 1}: Ability "${!id1 ? name1 : name2}" not found in local Abilities table.`);
                    }
                } else {
                     console.warn(`Skipping pair row ${index + 1}: Could not extract valid data (Name1: ${name1}, Name2: ${name2}, Winrate: ${winrate})`);
                }
            } else {
                 console.warn(`Skipping pair row ${index + 1}: Row does not have enough cells (needs at least ${Math.max(colIndexAbilityOne, colIndexAbilityTwo, colIndexWinrate) + 1}).`);
            }
        });

        statusCallback(`Processed rows. Pairs >= ${WINRATE_THRESHOLD*100}%: ${pairsToInsert.length}. Pairs < ${WINRATE_THRESHOLD*100}% to check/delete: ${pairsToDelete.length}.`);

        // --- Database Update ---
        if (pairsToInsert.length === 0 && pairsToDelete.length === 0) {
            statusCallback('No valid pairs found to update or delete.');
            return; // Nothing more to do
        }

        statusCallback('Updating database with pairs data...');
        db = new Database(dbPath); // Re-open for writing
        db.pragma('journal_mode = WAL');

        // Prepare statements
        const insertStmt = db.prepare(`
            INSERT INTO AbilitySynergies (base_ability_id, synergy_ability_id, synergy_winrate)
            VALUES (@baseAbilityId, @synergyAbilityId, @winrate)
            ON CONFLICT(base_ability_id, synergy_ability_id) DO UPDATE SET -- Update winrate if pair exists
               synergy_winrate = excluded.synergy_winrate
        `);
        // NOTE: Changed from INSERT OR IGNORE to allow updating winrate if a >50% pair already exists but has a new winrate.

        const deleteStmt = db.prepare(`
            DELETE FROM AbilitySynergies
            WHERE base_ability_id = @baseAbilityId AND synergy_ability_id = @synergyAbilityId
        `);

        // Use a transaction
        const updateTransaction = db.transaction((toInsert, toDelete) => {
            let inserted = 0;
            let deleted = 0;
            // Insert/Update pairs >= threshold
            for (const pair of toInsert) {
                const info = insertStmt.run(pair);
                if (info.changes > 0) inserted++; // Count actual changes
            }
            // Delete pairs < threshold (if they exist)
            for (const pair of toDelete) {
                const info = deleteStmt.run(pair);
                if (info.changes > 0) deleted++; // Count actual deletions
            }
            return { inserted, deleted };
        });

        const result = updateTransaction(pairsToInsert, pairsToDelete);
        statusCallback(`Database update successful. Inserted/Updated: ${result.inserted}. Deleted: ${result.deleted}.`);
        // --- End Database Update ---

    } catch (error) {
        console.error('Error during ability pair scraping or database update:', error);
        throw new Error(`Ability pairs scraping failed: ${error.message}`);
    } finally {
        if (db && db.open) { // Check if connection is open before closing
            db.close();
            console.log('Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreAbilityPairs };