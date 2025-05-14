const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');

// --- Reusable Helper Functions ---
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
 * filters for different heroes, and updates the database based on a winrate threshold.
 * This function will clear all existing synergies and repopulate the table.
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

        let colIndexAbilityOne = -1;
        let colIndexAbilityTwo = -1;
        let colIndexWinrate = -1;

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
            throw new Error(`Could not find all required columns: ability-one-pic (found=${colIndexAbilityOne !== -1}), ability-two-pic (found=${colIndexAbilityTwo !== -1}), combined-winrate (found=${colIndexWinrate !== -1}). Check data-field attributes.`);
        }
        statusCallback(`Column indices found: Abil1=${colIndexAbilityOne}, Abil2=${colIndexAbilityTwo}, WR=${colIndexWinrate}`);

        // --- Pre-fetch Ability Details (ID and hero_id) ---
        statusCallback('Fetching existing ability details (ID and Hero ID) from database...');
        db = new Database(dbPath, { readonly: true });
        // Fetch ability_id, name, AND hero_id
        const abilities = db.prepare('SELECT ability_id, name, hero_id FROM Abilities').all();
        const abilityNameToDetailsMap = new Map(abilities.map(a => [a.name, { id: a.ability_id, heroId: a.hero_id }]));
        db.close();
        statusCallback(`Loaded ${abilityNameToDetailsMap.size} abilities with details into map.`);

        if (abilityNameToDetailsMap.size === 0) {
            throw new Error("Ability details map is empty. Please run 'Update Ability Winrates' first.");
        }

        // --- Extract Data from Table Body ---
        const rows = $('tbody tr');
        if (rows.length === 0) throw new Error('No ability pair data rows found in tbody.');
        statusCallback(`Found ${rows.length} pair rows. Processing...`);

        const pairsToInsert = [];

        rows.each((index, element) => {
            const row = $(element);
            const cells = row.find('td');

            if (cells.length > Math.max(colIndexAbilityOne, colIndexAbilityTwo, colIndexWinrate)) {
                const tdAbilityOne = cells.eq(colIndexAbilityOne);
                const tdAbilityTwo = cells.eq(colIndexAbilityTwo);
                const tdWinrate = cells.eq(colIndexWinrate);

                const name1 = extractAbilityName(tdAbilityOne.find('img').attr('src'));
                const name2 = extractAbilityName(tdAbilityTwo.find('img').attr('src'));
                const winrate = parseWinrate(tdWinrate.text());

                if (name1 && name2 && winrate !== null) {
                    const details1 = abilityNameToDetailsMap.get(name1);
                    const details2 = abilityNameToDetailsMap.get(name2);

                    if (details1 && details2 && details1.id !== details2.id) { // Ensure both abilities exist in DB and are different

                        // --- NEW: Check if abilities are from the same hero ---
                        // Skip if both abilities have a hero_id and those hero_ids are the same.
                        // If one or both hero_ids are null, the synergy is still considered (as they aren't from the *same* defined hero).
                        if (details1.heroId !== null && details2.heroId !== null && details1.heroId === details2.heroId) {
                            console.warn(`Skipping pair row ${index + 1} ("${name1}" and "${name2}"): Abilities are from the same hero (Hero ID: ${details1.heroId}).`);
                            return; // Skips to the next iteration of .each()
                        }
                        // --- END NEW CHECK ---

                        if (winrate >= WINRATE_THRESHOLD) {
                            // Enforce consistent ordering: lower ID first
                            const baseAbilityId = Math.min(details1.id, details2.id);
                            const synergyAbilityId = Math.max(details1.id, details2.id);
                            pairsToInsert.push({ baseAbilityId, synergyAbilityId, winrate });
                        }
                    } else if (!details1 || !details2) {
                        console.warn(`Skipping pair row ${index + 1}: Ability "${!details1 ? name1 : name2}" not found in local Abilities table.`);
                    }
                } else {
                    console.warn(`Skipping pair row ${index + 1}: Could not extract valid data (Name1: ${name1}, Name2: ${name2}, Winrate: ${winrate})`);
                }
            } else {
                console.warn(`Skipping pair row ${index + 1}: Row does not have enough cells (needs at least ${Math.max(colIndexAbilityOne, colIndexAbilityTwo, colIndexWinrate) + 1}).`);
            }
        });

        statusCallback(`Processed rows. Valid pairs to insert (>= ${WINRATE_THRESHOLD * 100}%, different heroes): ${pairsToInsert.length}.`);

        // --- Database Update ---
        if (pairsToInsert.length === 0) {
            statusCallback('No valid pairs found to insert after filtering.');
            // Still attempt to clear the table if it's part of the "refresh" strategy
            try {
                db = new Database(dbPath);
                db.pragma('journal_mode = WAL');
                statusCallback('Clearing existing ability synergies from the database...');
                const deleteInfo = db.prepare('DELETE FROM AbilitySynergies').run();
                statusCallback(`Cleared ${deleteInfo.changes} existing synergies. No new synergies to add.`);
                db.close();
            } catch (clearError) {
                console.error('Error clearing AbilitySynergies table when no new pairs:', clearError);
                statusCallback(`Error clearing synergies: ${clearError.message}`);
                throw clearError; // Rethrow if critical
            }
            return;
        }

        statusCallback('Updating database with new pairs data...');
        db = new Database(dbPath); // Re-open for writing
        db.pragma('journal_mode = WAL');

        // --- Clear the AbilitySynergies table before inserting new data ---
        statusCallback('Clearing all existing ability synergies from the database...');
        const deleteInfo = db.prepare('DELETE FROM AbilitySynergies').run();
        statusCallback(`Cleared ${deleteInfo.changes} existing synergies.`);
        // --- End Clear Table ---

        // Prepare statement for insertion
        // Since we cleared the table, a simple INSERT is fine.
        // ON CONFLICT is kept for robustness in case the same pair (after ID ordering) is somehow duplicated in pairsToInsert.
        const insertStmt = db.prepare(`
            INSERT INTO AbilitySynergies (base_ability_id, synergy_ability_id, synergy_winrate)
            VALUES (@baseAbilityId, @synergyAbilityId, @winrate)
            ON CONFLICT(base_ability_id, synergy_ability_id) DO UPDATE SET
               synergy_winrate = excluded.synergy_winrate
        `);

        // Use a transaction
        const insertTransaction = db.transaction((toInsert) => {
            let insertedCount = 0;
            for (const pair of toInsert) {
                const info = insertStmt.run(pair);
                if (info.changes > 0) insertedCount++;
            }
            return insertedCount;
        });

        const insertedCount = insertTransaction(pairsToInsert);
        statusCallback(`Database update successful. Inserted/Updated ${insertedCount} new synergies.`);
        // --- End Database Update ---

    } catch (error) {
        console.error('Error during ability pair scraping or database update:', error);
        // Ensure status callback reflects the error for the UI
        const finalErrorMessage = `Ability pairs scraping failed: ${error.message}`;
        statusCallback(finalErrorMessage);
        throw new Error(finalErrorMessage); // Rethrow for main process to catch if needed
    } finally {
        if (db && db.open) {
            db.close();
            console.log('Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreAbilityPairs };