const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');

const AXIOS_TIMEOUT = 30000; // 30 seconds
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

/**
 * Parses a generic numeric value from a string.
 * @param {string | null} text - The text to parse.
 * @returns {number | null} The parsed number, or null if parsing fails.
 */
function parseNumericValue(text) {
    if (text === null || typeof text === 'undefined' || text.trim() === '') return null;
    const cleanedText = text.trim().replace(/[^0-9.-]+/g, ''); // Keep digits, dot, and minus
    const parsedValue = parseFloat(cleanedText);
    return !isNaN(parsedValue) ? parsedValue : null;
}

/**
 * Parses a percentage value from a string (e.g., "55.5%") and converts it to a decimal (e.g., 0.555).
 * @param {string | null} text - The text to parse (e.g., "55.5%").
 * @returns {number | null} The parsed percentage as a decimal (e.g., 0.555), or null if parsing fails.
 */
function parsePercentageValue(text) {
    if (text === null || typeof text === 'undefined' || text.trim() === '') return null;
    const cleanedText = text.trim().replace('%', '');
    const parsedRate = parseFloat(cleanedText);
    return !isNaN(parsedRate) ? parsedRate / 100.0 : null;
}

/**
 * Extracts an entity's internal name and type (hero/ability) from an image source URL.
 * It determines if the entity is a hero or ability based on path segments like '/heroes/' or '/abilities/'.
 * @param {cheerio.Element} imgElement - The Cheerio <img> element.
 * @returns {{name: string | null, isHero: boolean}} An object containing the extracted internal name and a boolean `isHero`.
 */
function extractEntityNameFromImg(imgElement) {
    if (!imgElement || imgElement.length === 0) return { name: null, isHero: false };

    const imgSrc = imgElement.attr('src');
    if (!imgSrc) return { name: null, isHero: false };

    const filename = imgSrc.split('/').pop();
    let name = null;
    let isHero = false;

    if (imgSrc.includes('/heroes/')) {
        name = filename?.replace(/_full\.png$|_vert\.jpg$/i, '');
        isHero = true;
    } else if (imgSrc.includes('/abilities/')) {
        name = filename?.replace(/\.png$/i, '');
        isHero = false;
    } else { // Fallback: if path doesn't specify, assume it's an ability image if it's a .png
        // This case might occur if the image source URL structure changes or for miscellaneous images.
        name = filename?.replace(/\.png$/i, '');
        isHero = false;
    }
    return { name: name || null, isHero };
}

/**
 * Attempts to find the `hero_id` for a given ability's internal name.
 * It works by iteratively checking parts of the ability name (e.g., "antimage_mana_break" -> "antimage")
 * against a map of known hero internal names to their IDs.
 * @param {string} abilityName - The internal name of the ability.
 * @param {Map<string, number>} heroNameToIdMap - A map of hero internal names to their database IDs.
 * @returns {number | null} The hero_id if a match is found, otherwise null.
 */
function findHeroIdForAbility(abilityName, heroNameToIdMap) {
    if (!abilityName || !heroNameToIdMap) return null;

    const parts = abilityName.split('_');
    if (parts.length < 2) return null; // Needs at least "hero_ability"

    for (let i = parts.length - 1; i >= 1; i--) {
        const potentialHeroName = parts.slice(0, i).join('_');
        if (heroNameToIdMap.has(potentialHeroName)) {
            return heroNameToIdMap.get(potentialHeroName);
        }
    }
    // Handle specific known inconsistencies in naming conventions.
    // For example, "sandking_burrowstrike" ability for hero "sand_king".
    if (abilityName.toLowerCase().startsWith("sandking_") && heroNameToIdMap.has('sand_king')) {
        return heroNameToIdMap.get('sand_king');
    }
    // For "wisp" (Io), abilities might be prefixed "wisp_".
    if (abilityName.toLowerCase().startsWith("wisp_") && heroNameToIdMap.has('wisp')) {
        return heroNameToIdMap.get('wisp');
    }
    return null;
}


/**
 * Processes rows from a Cheerio-loaded HTML table to extract entity data.
 * Populates `entityDataMap` with data for each hero or ability found.
 * @param {cheerio.CheerioAPI} $ - The Cheerio instance for the page.
 * @param {cheerio.Cheerio<cheerio.Element>} rows - The Cheerio collection of <tr> elements.
 * The key is the internal entity name, and the value is an object:
 * {
 *   name: string, (internal name)
 *   displayName: string | null,
 *   isHero: boolean,
 *   hero_id: number | null, (initially null for abilities, resolved later)
 *   winrate: number | null,
 *   highSkillWinrate: number | null,
 *   pickRate: number | null, (actually count, not rate)
 *   hsPickRate: number | null, (actually count, not rate)
 *   windrunId: string | null (only for heroes, from their Windrun.io page URL)
 * }
 * @param {Map<string, object>} entityDataMap - Map to populate with extracted entity data.
 * @param {{picture: number, ability: number, winrate: number, hs_winrate: number, pick_rate: number, hs_pick_rate: number}} colIndexes
 *        An object mapping data-field names (or conceptual column names) to their respective column index in the table row.
 */
function parseEntityRows($, rows, entityDataMap, colIndexes) {
    rows.each((index, element) => {
        const row = $(element);
        const cells = row.find('td');

        const imgElement = cells.eq(colIndexes.picture).find('img');
        const { name: entityName, isHero } = extractEntityNameFromImg(imgElement);
        if (!entityName) return;

        const displayName = cells.eq(colIndexes.ability).text().trim() || null;
        const windrunHref = cells.eq(colIndexes.ability).find('a').attr('href');
        const windrunId = windrunHref ? windrunHref.split('/').pop() : null;

        entityDataMap.set(entityName, {
            name: entityName,
            displayName: displayName,
            isHero: isHero,
            hero_id: null, // For abilities, this will be resolved after all heroes are processed.
            winrate: parsePercentageValue(cells.eq(colIndexes.winrate).text()),
            highSkillWinrate: parsePercentageValue(cells.eq(colIndexes.hs_winrate).text()),
            pickRate: parseNumericValue(cells.eq(colIndexes.pick_rate).text()),
            hsPickRate: parseNumericValue(cells.eq(colIndexes.hs_pick_rate).text()),
            windrunId: isHero ? windrunId : null,
        });
    });
}


/**
 * Scrapes hero and ability statistics from a specified Windrun.io page.
 * It parses the main data table, identifies heroes and abilities, extracts their stats,
 * and then upserts this information into the `Heroes` and `Abilities` tables in the SQLite database.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} url - The URL to scrape.
 * @param {function(string): void} statusCallback - Function to send status updates.
 * @throws {Error} If critical errors occur during scraping or database operations.
 */
async function scrapeAndStoreAbilitiesAndHeroes(dbPath, url, statusCallback) {
    let db;
    const entityDataMap = new Map();
    const heroNameToIdMap = new Map();

    try {
        statusCallback('Initializing database connection...');
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');

        statusCallback(`Fetching entity data from ${url}...`);
        const { data: html } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: AXIOS_TIMEOUT });
        const $ = cheerio.load(html);

        statusCallback('Identifying table column indices...');
        const colIndexes = {};
        const headerCells = $('thead tr th');
        if (headerCells.length === 0) throw new Error('Could not find table header cells.');

        headerCells.each((index, element) => {
            const dataField = $(element).attr('data-field');
            if (dataField === 'ability-picture') colIndexes.picture = index;
            else if (dataField === 'ability') colIndexes.ability = index;
            else if (dataField === 'overall-win-perc') colIndexes.winrate = index;
            else if (dataField === 'hs-win-perc') colIndexes.hs_winrate = index;
            else if (dataField === 'overall-pick-num') colIndexes.pick_rate = index;
            else if (dataField === 'hs-pick-num') colIndexes.hs_pick_rate = index;
        });

        const requiredCols = ['picture', 'ability', 'winrate', 'hs_winrate', 'pick_rate', 'hs_pick_rate'];
        for (const col of requiredCols) {
            if (colIndexes[col] === undefined) {
                throw new Error(`Could not find required column with data-field for "${col}". DOM may have changed.`);
            }
        }
        statusCallback('Column indices identified successfully.');

        const rows = $('tbody tr');
        if (rows.length === 0) throw new Error(`No data rows found on page (${url}).`);
        statusCallback(`Found ${rows.length} entity rows. Extracting...`);
        parseEntityRows($, rows, entityDataMap, colIndexes);
        statusCallback(`Data extraction complete. Total unique entities processed: ${entityDataMap.size}.`);

        // Process Heroes first to populate heroNameToIdMap, which is needed for linking abilities to heroes.
        const heroesToProcess = Array.from(entityDataMap.values()).filter(e => e.isHero);
        if (heroesToProcess.length > 0) {
            statusCallback(`Updating/Inserting ${heroesToProcess.length} heroes...`);
            const insertHeroStmt = db.prepare(`
                INSERT INTO Heroes (name, display_name, winrate, high_skill_winrate, pick_rate, hs_pick_rate, windrun_id)
                VALUES (@name, @displayName, @winrate, @highSkillWinrate, @pickRate, @hsPickRate, @windrunId)
                ON CONFLICT(name) DO UPDATE SET
                    display_name = excluded.display_name,
                    winrate = excluded.winrate,
                    high_skill_winrate = excluded.high_skill_winrate,
                    pick_rate = excluded.pick_rate,
                    hs_pick_rate = excluded.hs_pick_rate,
                    windrun_id = excluded.windrun_id
                RETURNING hero_id, name;
            `);
            const heroUpsertTx = db.transaction((heroes) => {
                for (const hero of heroes) {
                    const result = insertHeroStmt.get(hero);
                    if (result) {
                        heroNameToIdMap.set(result.name, result.hero_id);
                    }
                }
            });
            heroUpsertTx(heroesToProcess);
        } else {
            // If no heroes were parsed from the current page (e.g., page only had abilities or was empty of heroes),
            // load existing heroes from DB to ensure heroNameToIdMap is populated for ability linking.
            const existingHeroes = db.prepare('SELECT hero_id, name FROM Heroes').all();
            existingHeroes.forEach(h => heroNameToIdMap.set(h.name, h.hero_id));
        }
        statusCallback(`Hero processing complete. Total heroes available for linking: ${heroNameToIdMap.size}.`);

        // 2. Process Abilities
        const abilitiesToProcess = [];
        entityDataMap.forEach(entity => {
            if (!entity.isHero) {
                entity.hero_id = findHeroIdForAbility(entity.name, heroNameToIdMap);
                abilitiesToProcess.push(entity);
            }
        });

        if (abilitiesToProcess.length > 0) {
            statusCallback(`Updating/Inserting ${abilitiesToProcess.length} abilities...`);
            const insertAbilityStmt = db.prepare(`
                INSERT INTO Abilities (name, display_name, hero_id, winrate, high_skill_winrate, pick_rate, hs_pick_rate)
                VALUES (@name, @displayName, @hero_id, @winrate, @highSkillWinrate, @pickRate, @hsPickRate)
                ON CONFLICT(name) DO UPDATE SET
                    display_name = excluded.display_name,
                    hero_id = excluded.hero_id,
                    winrate = excluded.winrate,
                    high_skill_winrate = excluded.high_skill_winrate,
                    pick_rate = excluded.pick_rate,
                    hs_pick_rate = excluded.hs_pick_rate;
            `);
            const abilityInsertTransaction = db.transaction((abilities) => {
                let count = 0;
                for (const ability of abilities) {
                    if (!ability.name) continue;
                    const info = insertAbilityStmt.run(ability);
                    if (info.changes > 0) count++;
                }
                return count;
            });
            const processedCount = abilityInsertTransaction(abilitiesToProcess);
            statusCallback(`Database update successful. Processed abilities in this run: ${processedCount}.`);
        } else {
            statusCallback('No abilities found to update.');
        }

    } catch (error) {
        console.error('[AbilityScraper] Error during entity scraping or database update:', error);
        statusCallback(`Hero/Ability scraping failed: ${error.message}. Check console for details.`);
        throw error;
    } finally {
        if (db && db.open) {
            db.close();
            console.log('[Entity Scraper] Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreAbilitiesAndHeroes };