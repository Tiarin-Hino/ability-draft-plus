const axios = require('axios'); // HTTP client for fetching data
const cheerio = require('cheerio'); // HTML parser
const Database = require('better-sqlite3'); // SQLite database library

const AXIOS_TIMEOUT = 30000; // 30 seconds
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

// Thresholds for determining significant synergies
/** @type {number} Only store pairs with a combined winrate >= this threshold (0.0 - 1.0). */
const SYNERGY_WINRATE_THRESHOLD = 0.50;
/** @type {number} Synergy percentage increase (0.0 - 1.0) to be marked as "OP" (Overpowered). */
const OP_SYNERGY_THRESHOLD_PERCENTAGE = 0.13;

/**
 * Parses a text value representing a percentage.
 * @param {string | null} text - The text to parse (e.g., "55.5%", "55,5").
 * @returns {number | null} The parsed percentage as a decimal (e.g., 0.555), or null if parsing fails.
 */
function parsePercentageValue(text) {
    if (text === null || typeof text === 'undefined' || text.trim() === '') return null;
    const cleanedText = text.trim().replace('%', '').replace(',', '.');
    const parsedRate = parseFloat(cleanedText); // Parses "55.5" or "55,5" after cleaning
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
    return filename ? filename.replace(/\.png$/i, '') : null; // Remove .png extension
}

/**
 * Extracts a hero's internal name from an image source URL.
 * Hero model images end with "_full.png" (e.g., "medusa_full.png").
 * @param {string | null} imgSrc - The image source URL.
 * @returns {string | null} The extracted hero name, or null if not a hero model image.
 */
function extractHeroNameFromImgSrc(imgSrc) {
    if (!imgSrc) return null;
    const filename = imgSrc.split('/').pop();
    if (!filename || !filename.endsWith('_full.png')) return null;
    return filename.replace(/_full\.png$/i, ''); // Remove _full.png extension
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

    statusCallback(`Fetching ability pairs data from ${url}...`);
    try {
        const { data: html } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: AXIOS_TIMEOUT });

        // --- HTML Parsing and Column Identification ---
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
            else if (dataField === 'ability-two-pic') colIndexAbilityTwo = index; // Column for the second ability's picture
            else if (dataField === 'combined-winrate') colIndexCombinedWinrate = index;
            else if (dataField === 'synergy') colIndexSynergyPercentage = index; // This column shows the synergy *increase*
        });

        if (colIndexAbilityOne === -1 || colIndexAbilityTwo === -1 || colIndexCombinedWinrate === -1 || colIndexSynergyPercentage === -1) {
            throw new Error(`Could not find all required column data-fields: ability-one-pic (found=${colIndexAbilityOne !== -1}), ability-two-pic (found=${colIndexAbilityTwo !== -1}), combined-winrate (found=${colIndexCombinedWinrate !== -1}), synergy (found=${colIndexSynergyPercentage !== -1}). Check site structure or data-field attributes.`);
        }
        statusCallback(`Column indices identified: Ability1=${colIndexAbilityOne}, Ability2=${colIndexAbilityTwo}, CombinedWR=${colIndexCombinedWinrate}, SynergyIncrease=${colIndexSynergyPercentage}.`);

        // --- Fetching Local Ability and Hero Data ---
        statusCallback('Fetching existing ability and hero details from the local database...');
        db = new Database(dbPath, { readonly: true });
        const abilitiesFromDb = db.prepare('SELECT ability_id, name, hero_id FROM Abilities').all();
        const abilityNameToDetailsMap = new Map(abilitiesFromDb.map(a => [a.name, { id: a.ability_id, heroId: a.hero_id }]));

        const heroesFromDb = db.prepare('SELECT hero_id, name FROM Heroes').all();
        const heroNameToIdMap = new Map(heroesFromDb.map(h => [h.name, h.hero_id]));
        db.close(); // Close read-only connection before opening a write connection later.

        if (abilityNameToDetailsMap.size === 0) {
            statusCallback('Warning: No abilities found in the local database. Synergies cannot be processed. Please run "Update Windrun Data (Full)" first.');
            return; // Stop if no abilities to link to.
        }
        statusCallback(`Loaded ${abilityNameToDetailsMap.size} abilities and ${heroNameToIdMap.size} heroes from local DB for cross-referencing.`);

        // --- Processing Table Rows ---
        const rows = $('tbody tr');
        if (rows.length === 0) {
            statusCallback('No ability pair data rows found in the table body. The page might be empty or structure changed.');
            return;
        }
        statusCallback(`Found ${rows.length} potential synergy rows. Processing and filtering...`);

        const pairsToInsert = [];
        const heroSynergiesToInsert = [];

        rows.each((index, element) => {
            const row = $(element);
            const cells = row.find('td');

            if (cells.length > Math.max(colIndexAbilityOne, colIndexAbilityTwo, colIndexCombinedWinrate, colIndexSynergyPercentage)) {
                const imgSrc1 = cells.eq(colIndexAbilityOne).find('img').attr('src');
                const heroName = extractHeroNameFromImgSrc(imgSrc1);

                // Check if this is a hero-ability synergy row
                if (heroName) {
                    // This is a hero-ability synergy
                    const abilityName = extractAbilityNameFromImgSrc(cells.eq(colIndexAbilityTwo).find('img').attr('src'));
                    const combinedWinrate = parsePercentageValue(cells.eq(colIndexCombinedWinrate).text()) / 100.0;
                    const synergyIncreasePercentage = parsePercentageValue(cells.eq(colIndexSynergyPercentage).text()) / 100.0;

                    if (abilityName && combinedWinrate !== null) {
                        const heroId = heroNameToIdMap.get(heroName);
                        const abilityDetails = abilityNameToDetailsMap.get(abilityName);

                        if (heroId && abilityDetails) {
                            // Filter out synergies where hero model pairs with its own abilities
                            if (abilityDetails.heroId !== null && abilityDetails.heroId === heroId) {
                                return; // Skip this pair, continue to next .each iteration
                            }

                            // Store all hero-ability synergies (both positive and negative)
                            const isOp = synergyIncreasePercentage !== null && synergyIncreasePercentage >= OP_SYNERGY_THRESHOLD_PERCENTAGE;

                            heroSynergiesToInsert.push({
                                heroId,
                                abilityId: abilityDetails.id,
                                synergy_winrate: combinedWinrate,
                                synergy_increase: synergyIncreasePercentage,
                                is_op: isOp ? 1 : 0
                            });
                        }
                    }
                } else {
                    // This is an ability-ability synergy
                    const name1 = extractAbilityNameFromImgSrc(imgSrc1);
                    const name2 = extractAbilityNameFromImgSrc(cells.eq(colIndexAbilityTwo).find('img').attr('src'));
                    const combinedWinrate = parsePercentageValue(cells.eq(colIndexCombinedWinrate).text()) / 100.0;
                    const synergyIncreasePercentage = parsePercentageValue(cells.eq(colIndexSynergyPercentage).text()) / 100.0;

                    if (name1 && name2 && combinedWinrate !== null) {
                        const details1 = abilityNameToDetailsMap.get(name1);
                        const details2 = abilityNameToDetailsMap.get(name2);

                        // Ensure both abilities exist in our DB and are not the same ability.
                        if (details1 && details2 && details1.id !== details2.id) {
                            // Filter out pairs where both abilities belong to the same hero.
                            if (details1.heroId !== null && details2.heroId !== null && details1.heroId === details2.heroId) {
                                return; // Skip this pair, continue to next .each iteration
                            }

                            // Store all ability-ability synergies (both positive and negative)
                            const baseAbilityId = Math.min(details1.id, details2.id);
                            const synergyAbilityId = Math.max(details1.id, details2.id);
                            const isOp = synergyIncreasePercentage !== null && synergyIncreasePercentage >= OP_SYNERGY_THRESHOLD_PERCENTAGE;

                            pairsToInsert.push({
                                baseAbilityId,
                                synergyAbilityId,
                                synergy_winrate: combinedWinrate,
                                synergy_increase: synergyIncreasePercentage,
                                is_op: isOp ? 1 : 0
                            });
                        }
                    }
                }
            }
        });
        statusCallback(`Processed all rows. Found ${pairsToInsert.length} ability-ability synergies and ${heroSynergiesToInsert.length} hero-ability synergies (including both positive and negative synergies).`);

        // Database update part
        db = new Database(dbPath); // Open for writing
        db.pragma('journal_mode = WAL'); // Enable WAL mode for better concurrency and performance.

        statusCallback('Clearing all existing synergies from the database...');
        const deleteAbilityInfo = db.prepare('DELETE FROM AbilitySynergies').run();
        const deleteHeroInfo = db.prepare('DELETE FROM HeroAbilitySynergies').run();
        statusCallback(`Cleared ${deleteAbilityInfo.changes} existing ability synergies and ${deleteHeroInfo.changes} hero synergies.`);

        if (pairsToInsert.length === 0 && heroSynergiesToInsert.length === 0) {
            statusCallback('No new valid synergies to insert after filtering. Synergies tables remain empty.');
            return;
        }

        // Insert ability-ability synergies
        if (pairsToInsert.length > 0) {
            statusCallback(`Inserting ${pairsToInsert.length} ability-ability synergies into the database...`);
            const insertAbilityStmt = db.prepare(`
                INSERT INTO AbilitySynergies (base_ability_id, synergy_ability_id, synergy_winrate, synergy_increase, is_op)
                VALUES (@baseAbilityId, @synergyAbilityId, @synergy_winrate, @synergy_increase, @is_op)
                ON CONFLICT(base_ability_id, synergy_ability_id) DO UPDATE SET
                   synergy_winrate = excluded.synergy_winrate,
                   synergy_increase = excluded.synergy_increase,
                   is_op = excluded.is_op;
            `);

            const insertAbilityTransaction = db.transaction((pairs) => {
                let insertedCount = 0;
                for (const pair of pairs) {
                    const info = insertAbilityStmt.run(pair);
                    if (info.changes > 0) insertedCount++;
                }
                return insertedCount;
            });

            const abilityInsertedCount = insertAbilityTransaction(pairsToInsert);
            statusCallback(`Inserted/Updated ${abilityInsertedCount} ability-ability synergies.`);
        }

        // Insert hero-ability synergies
        if (heroSynergiesToInsert.length > 0) {
            statusCallback(`Inserting ${heroSynergiesToInsert.length} hero-ability synergies into the database...`);
            const insertHeroStmt = db.prepare(`
                INSERT INTO HeroAbilitySynergies (hero_id, ability_id, synergy_winrate, synergy_increase, is_op)
                VALUES (@heroId, @abilityId, @synergy_winrate, @synergy_increase, @is_op)
                ON CONFLICT(hero_id, ability_id) DO UPDATE SET
                   synergy_winrate = excluded.synergy_winrate,
                   synergy_increase = excluded.synergy_increase,
                   is_op = excluded.is_op;
            `);

            const insertHeroTransaction = db.transaction((synergies) => {
                let insertedCount = 0;
                for (const synergy of synergies) {
                    const info = insertHeroStmt.run(synergy);
                    if (info.changes > 0) insertedCount++;
                }
                return insertedCount;
            });

            const heroInsertedCount = insertHeroTransaction(heroSynergiesToInsert);
            statusCallback(`Inserted/Updated ${heroInsertedCount} hero-ability synergies.`);
        }

        statusCallback(`Database update successful. Total synergies stored: ${pairsToInsert.length} ability-ability + ${heroSynergiesToInsert.length} hero-ability.`);

    } catch (error) { // Catch any errors during fetch, parse, or DB operations
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