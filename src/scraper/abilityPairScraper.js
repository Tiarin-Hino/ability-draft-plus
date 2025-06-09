const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');

const AXIOS_TIMEOUT = 30000; // 30 seconds
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

// Thresholds for determining significant synergies
const SYNERGY_WINRATE_THRESHOLD = 0.50; // Only store pairs with a combined winrate >= 50%
const OP_SYNERGY_THRESHOLD_PERCENTAGE = 0.13; // Synergy percentage increase to be marked as "OP" (Overpowered), e.g., +11%

/**
 * Parses a text value representing a percentage.
 * @param {string | null} text - The text to parse (e.g., "55.5%", "55,5").
 * @returns {number | null} The parsed percentage as a decimal (e.g., 0.555), or null if parsing fails.
 */
function parsePercentageValue(text) {
    if (text === null || typeof text === 'undefined' || text.trim() === '') return null;
    const cleanedText = text.trim().replace('%', '').replace(',', '.');
    const parsedRate = parseFloat(cleanedText);
    return !isNaN(parsedRate) ? parsedRate : null;
}

/**
 * Extracts an ability's internal name from an image source URL.
 * Assumes the image filename (without extension) is the internal name.
 * @param {string | null} imgSrc - The image source URL.
 * @returns {string | null} The extracted ability name, or null if extraction fails.
 */
function extractAbilityNameFromImgSrc(imgSrc) {
    if (!imgSrc) return null;
    const filename = imgSrc.split('/').pop();
    return filename ? filename.replace(/\.png$/i, '') : null;
}

/**
 * Scrapes ability pair data from Windrun.io, filters for significant synergies between
 * abilities of different heroes, and updates the database.
 * This function clears all existing synergies and repopulates the AbilitySynergies table.
 *
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} url - The URL to scrape for ability pair data (e.g., 'https://windrun.io/ability-pairs').
 * @param {function(string): void} statusCallback - Function to send status updates during the process.
 * @throws {Error} If critical errors occur during scraping or database operations.
 */
async function scrapeAndStoreAbilityPairs(dbPath, url, statusCallback) {
    let db;

    try {
        statusCallback(`Fetching ability pairs data from ${url}...`);
        const { data: html } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: AXIOS_TIMEOUT });

        statusCallback('Parsing HTML and identifying table column indices...');
        const $ = cheerio.load(html);

        let colIndexAbilityOne = -1, colIndexAbilityTwo = -1, colIndexCombinedWinrate = -1, colIndexSynergyPercentage = -1;

        // Dynamically find column indices based on data-field attributes in table headers.
        // This is more robust to minor changes in column order than fixed indices.
        const headerCells = $('thead tr:nth-child(2) th');
        if (headerCells.length === 0) {
            throw new Error('Could not find table header cells (thead tr:nth-child(2) th). DOM structure may have changed.');
        }

        headerCells.each((index, element) => {
            const dataField = $(element).attr('data-field');
            if (dataField === 'ability-one-pic') colIndexAbilityOne = index;
            else if (dataField === 'ability-two-pic') colIndexAbilityTwo = index;
            else if (dataField === 'combined-winrate') colIndexCombinedWinrate = index;
            else if (dataField === 'synergy') colIndexSynergyPercentage = index; // This column shows the synergy *increase*
        });

        if (colIndexAbilityOne === -1 || colIndexAbilityTwo === -1 || colIndexCombinedWinrate === -1 || colIndexSynergyPercentage === -1) {
            throw new Error(`Could not find all required column data-fields: ability-one-pic (found=${colIndexAbilityOne !== -1}), ability-two-pic (found=${colIndexAbilityTwo !== -1}), combined-winrate (found=${colIndexCombinedWinrate !== -1}), synergy (found=${colIndexSynergyPercentage !== -1}). Check site structure or data-field attributes.`);
        }
        statusCallback(`Column indices identified: Ability1=${colIndexAbilityOne}, Ability2=${colIndexAbilityTwo}, CombinedWR=${colIndexCombinedWinrate}, SynergyIncrease=${colIndexSynergyPercentage}.`);

        statusCallback('Fetching existing ability details (ID and Hero ID) from the local database...');
        db = new Database(dbPath, { readonly: true });
        const abilitiesFromDb = db.prepare('SELECT ability_id, name, hero_id FROM Abilities').all();
        const abilityNameToDetailsMap = new Map(abilitiesFromDb.map(a => [a.name, { id: a.ability_id, heroId: a.hero_id }]));
        db.close(); // Close read-only connection before opening a write connection later.

        if (abilityNameToDetailsMap.size === 0) {
            statusCallback('Warning: No abilities found in the local database. Synergies cannot be processed. Please run "Update Windrun Data (Full)" first.');
            return; // Stop if no abilities to link to.
        }
        statusCallback(`Loaded ${abilityNameToDetailsMap.size} abilities from local DB for cross-referencing.`);

        const rows = $('tbody tr');
        if (rows.length === 0) {
            statusCallback('No ability pair data rows found in the table body. The page might be empty or structure changed.');
            return;
        }
        statusCallback(`Found ${rows.length} potential ability pair rows. Processing and filtering...`);

        const pairsToInsert = [];
        rows.each((index, element) => {
            const row = $(element);
            const cells = row.find('td');

            if (cells.length > Math.max(colIndexAbilityOne, colIndexAbilityTwo, colIndexCombinedWinrate, colIndexSynergyPercentage)) {
                const name1 = extractAbilityNameFromImgSrc(cells.eq(colIndexAbilityOne).find('img').attr('src'));
                const name2 = extractAbilityNameFromImgSrc(cells.eq(colIndexAbilityTwo).find('img').attr('src'));
                const combinedWinrate = parsePercentageValue(cells.eq(colIndexCombinedWinrate).text()) / 100.0; // Convert to 0-1 scale
                const synergyIncreasePercentage = parsePercentageValue(cells.eq(colIndexSynergyPercentage).text()) / 100.0; // Convert to 0-1 scale

                if (name1 && name2 && combinedWinrate !== null) {
                    const details1 = abilityNameToDetailsMap.get(name1);
                    const details2 = abilityNameToDetailsMap.get(name2);

                    // Ensure both abilities exist in our DB and are not the same ability.
                    if (details1 && details2 && details1.id !== details2.id) {
                        // Filter out pairs where both abilities belong to the same hero.
                        if (details1.heroId !== null && details2.heroId !== null && details1.heroId === details2.heroId) {
                            return; // Skip this pair, continue to next .each iteration
                        }

                        // Store pair if combined winrate meets the threshold.
                        if (combinedWinrate >= SYNERGY_WINRATE_THRESHOLD) {
                            const baseAbilityId = Math.min(details1.id, details2.id); // Ensure consistent ordering for UNIQUE constraint
                            const synergyAbilityId = Math.max(details1.id, details2.id);
                            const isOp = synergyIncreasePercentage !== null && synergyIncreasePercentage >= OP_SYNERGY_THRESHOLD_PERCENTAGE;

                            pairsToInsert.push({
                                baseAbilityId,
                                synergyAbilityId,
                                synergy_winrate: combinedWinrate,
                                is_op: isOp ? 1 : 0 // Store boolean as 0 or 1
                            });
                        }
                    } else if (!details1 || !details2) {
                        // Log if an ability from a pair isn't found in our DB, might indicate new/changed abilities.
                        // console.warn(`[Pair Scraper] Skipping pair: Ability "${!details1 ? name1 : name2}" not found in local Abilities table.`);
                    }
                }
            }
        });

        statusCallback(`Processed all rows. Found ${pairsToInsert.length} valid synergistic pairs meeting criteria (Combined WR >= ${SYNERGY_WINRATE_THRESHOLD * 100}%, different heroes).`);

        // Database update part
        db = new Database(dbPath); // Open for writing
        db.pragma('journal_mode = WAL'); // Enable WAL mode for better concurrency and performance.

        statusCallback('Clearing all existing ability synergies from the database...');
        const deleteInfo = db.prepare('DELETE FROM AbilitySynergies').run();
        statusCallback(`Cleared ${deleteInfo.changes} existing synergies.`);

        if (pairsToInsert.length === 0) {
            statusCallback('No new valid pairs to insert after filtering. Synergies table remains empty.');
            return;
        }

        statusCallback(`Inserting ${pairsToInsert.length} new synergies into the database...`);
        const insertStmt = db.prepare(`
            INSERT INTO AbilitySynergies (base_ability_id, synergy_ability_id, synergy_winrate, is_op)
            VALUES (@baseAbilityId, @synergyAbilityId, @synergy_winrate, @is_op)
            ON CONFLICT(base_ability_id, synergy_ability_id) DO UPDATE SET
               synergy_winrate = excluded.synergy_winrate,
               is_op = excluded.is_op;
        `);

        const insertTransaction = db.transaction((pairs) => {
            let insertedCount = 0;
            for (const pair of pairs) {
                const info = insertStmt.run(pair);
                if (info.changes > 0) insertedCount++;
            }
            return insertedCount;
        });

        const insertedCount = insertTransaction(pairsToInsert);
        statusCallback(`Database update successful. Inserted/Updated ${insertedCount} ability synergies.`);

    } catch (error) {
        console.error('[Pair Scraper] Error during ability pair scraping or database update:', error);
        const finalErrorMessage = `Ability pairs scraping failed: ${error.message}`;
        statusCallback(finalErrorMessage); // Report specific error
        throw new Error(finalErrorMessage); // Rethrow to be caught by the main process
    } finally {
        if (db && db.open) {
            db.close();
        }
    }
}

module.exports = { scrapeAndStoreAbilityPairs };