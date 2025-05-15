const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');

// --- Reusable Helper Functions ---
function parsePercentageValue(text) { // Renamed for clarity from parseWinrate
    if (!text) return null;
    const cleanedText = text.trim().replace('%', '').replace(',', '.'); // Handle comma as decimal
    const parsedRate = parseFloat(cleanedText);
    return !isNaN(parsedRate) ? parsedRate : null; // Return the direct percentage value
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
    const WINRATE_THRESHOLD = 0.50; // 50% for synergy_winrate
    const OP_THRESHOLD_PERCENTAGE = 0.09; // 9% for is_op flag

    try {
        statusCallback(`Workspaceing ability pairs data from ${url}...`);
        const { data: html } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });

        statusCallback('Parsing HTML and finding columns...');
        const $ = cheerio.load(html);

        let colIndexAbilityOne = -1;
        let colIndexAbilityTwo = -1;
        let colIndexWinrate = -1;
        let colIndexOpPercentage = -1;
        // We need to find the column index for the OP percentage.
        // Let's assume it's consistently the last td with a numeric percentage.
        // If the site has a specific data-field for it, that would be more robust.
        // For now, we'll iterate and find it.

        const headerCells = $('thead tr:nth-child(2) th');
        if (headerCells.length === 0) {
            throw new Error('Could not find header cells (thead tr:nth-child(2) th). DOM structure might have changed.');
        }

        headerCells.each((index, element) => {
            const dataField = $(element).attr('data-field');
            if (dataField === 'ability-one-pic') colIndexAbilityOne = index;
            else if (dataField === 'ability-two-pic') colIndexAbilityTwo = index;
            else if (dataField === 'combined-winrate') colIndexWinrate = index;
            else if (dataField === 'synergy') colIndexOpPercentage = index
            // Add more specific data-field if available for the OP percentage column
        });

        if (colIndexAbilityOne === -1 || colIndexAbilityTwo === -1 || colIndexWinrate === -1) {
            throw new Error(`Could not find all required columns: ability-one-pic (found=${colIndexAbilityOne !== -1}), ability-two-pic (found=${colIndexAbilityTwo !== -1}), combined-winrate (found=${colIndexWinrate !== -1}). Check data-field attributes.`);
        }
        statusCallback(`Column indices found: Abil1=${colIndexAbilityOne}, Abil2=${colIndexAbilityTwo}, WR=${colIndexWinrate}`);

        statusCallback('Fetching existing ability details (ID and Hero ID) from database...');
        db = new Database(dbPath, { readonly: true });
        const abilities = db.prepare('SELECT ability_id, name, hero_id FROM Abilities').all();
        const abilityNameToDetailsMap = new Map(abilities.map(a => [a.name, { id: a.ability_id, heroId: a.hero_id }]));
        db.close();
        statusCallback(`Loaded ${abilityNameToDetailsMap.size} abilities with details into map.`);

        if (abilityNameToDetailsMap.size === 0) {
            throw new Error("Ability details map is empty. Please run 'Update Ability Winrates' first.");
        }

        const rows = $('tbody tr');
        if (rows.length === 0) throw new Error('No ability pair data rows found in tbody.');
        statusCallback(`Found ${rows.length} pair rows. Processing...`);

        const pairsToInsert = [];

        rows.each((index, element) => {
            const row = $(element);
            const cells = row.find('td');

            const tdOpPercentageValue = cells.eq(colIndexOpPercentage);
            const opPercentageText = tdOpPercentageValue.text(); // Get text for synergy winrate
            const opPercentageValue = parsePercentageValue(opPercentageText) / 100.0; // Convert to 0-1 scale

            if (cells.length > Math.max(colIndexAbilityOne, colIndexAbilityTwo, colIndexWinrate)) {
                const tdAbilityOne = cells.eq(colIndexAbilityOne);
                const tdAbilityTwo = cells.eq(colIndexAbilityTwo);
                const tdWinrate = cells.eq(colIndexWinrate);

                const name1 = extractAbilityName(tdAbilityOne.find('img').attr('src'));
                const name2 = extractAbilityName(tdAbilityTwo.find('img').attr('src'));
                const synergyWinrateText = tdWinrate.text(); // Get text for synergy winrate
                const synergyWinrate = parsePercentageValue(synergyWinrateText) / 100.0; // Convert to 0-1 scale

                if (name1 && name2 && synergyWinrate !== null) {
                    const details1 = abilityNameToDetailsMap.get(name1);
                    const details2 = abilityNameToDetailsMap.get(name2);

                    if (details1 && details2 && details1.id !== details2.id) {
                        if (details1.heroId !== null && details2.heroId !== null && details1.heroId === details2.heroId) {
                            // console.warn(`Skipping pair row ${index + 1} ("${name1}" and "${name2}"): Abilities are from the same hero (Hero ID: ${details1.heroId}).`);
                            return;
                        }

                        if (synergyWinrate >= WINRATE_THRESHOLD) {
                            const baseAbilityId = Math.min(details1.id, details2.id);
                            const synergyAbilityId = Math.max(details1.id, details2.id);
                            const isOp = opPercentageValue !== null && opPercentageValue >= OP_THRESHOLD_PERCENTAGE;

                            pairsToInsert.push({
                                baseAbilityId,
                                synergyAbilityId,
                                winrate: synergyWinrate, // This is the synergy_winrate
                                is_op: isOp ? 1 : 0 // Store as 1 for true, 0 for false
                            });
                        }
                    } else if (!details1 || !details2) {
                        console.warn(`Skipping pair row ${index + 1}: Ability "${!details1 ? name1 : name2}" not found in local Abilities table.`);
                    }
                } else {
                    console.warn(`Skipping pair row ${index + 1}: Could not extract valid data (Name1: ${name1}, Name2: ${name2}, SynergyWinrate: ${synergyWinrate})`);
                }
            } else {
                console.warn(`Skipping pair row ${index + 1}: Row does not have enough cells (needs at least ${Math.max(colIndexAbilityOne, colIndexAbilityTwo, colIndexWinrate) + 1}).`);
            }
        });

        statusCallback(`Processed rows. Valid pairs to insert (synergy >= ${WINRATE_THRESHOLD * 100}%, different heroes): ${pairsToInsert.length}.`);

        if (pairsToInsert.length === 0) {
            statusCallback('No valid pairs found to insert after filtering.');
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
                throw clearError;
            }
            return;
        }

        statusCallback('Updating database with new pairs data...');
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');

        statusCallback('Clearing all existing ability synergies from the database...');
        const deleteInfo = db.prepare('DELETE FROM AbilitySynergies').run();
        statusCallback(`Cleared ${deleteInfo.changes} existing synergies.`);

        const insertStmt = db.prepare(`
            INSERT INTO AbilitySynergies (base_ability_id, synergy_ability_id, synergy_winrate, is_op)
            VALUES (@baseAbilityId, @synergyAbilityId, @winrate, @is_op)
            ON CONFLICT(base_ability_id, synergy_ability_id) DO UPDATE SET
               synergy_winrate = excluded.synergy_winrate,
               is_op = excluded.is_op
        `);

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

    } catch (error) {
        console.error('Error during ability pair scraping or database update:', error);
        const finalErrorMessage = `Ability pairs scraping failed: ${error.message}`;
        statusCallback(finalErrorMessage);
        throw new Error(finalErrorMessage);
    } finally {
        if (db && db.open) {
            db.close();
            console.log('Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreAbilityPairs };