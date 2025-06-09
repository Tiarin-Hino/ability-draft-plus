const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');

const AXIOS_TIMEOUT = 30000; // 30 seconds
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

/**
 * Parses a generic numeric value from text.
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
 * Parses a percentage value from text and converts it to a decimal.
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
 * @param {cheerio.Element} imgElement - The Cheerio <img> element.
 * @returns {{name: string | null, isHero: boolean}} An object containing the extracted name and a boolean indicating if it's a hero.
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
    } else {
        name = filename?.replace(/\.png$/i, '');
        isHero = false;
    }
    return { name: name || null, isHero };
}

/**
 * Attempts to find the hero_id for a given ability name by matching parts of the name.
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
    if (abilityName.toLowerCase().startsWith("sandking_") && heroNameToIdMap.has('sand_king')) {
        return heroNameToIdMap.get('sand_king');
    }
    if (abilityName.toLowerCase().startsWith("wisp_") && heroNameToIdMap.has('wisp')) {
        return heroNameToIdMap.get('wisp');
    }
    return null;
}

/**
 * Processes rows from a Cheerio-loaded HTML table to extract entity data.
 * @param {cheerio.CheerioAPI} $ - The Cheerio instance for the page.
 * @param {cheerio.Cheerio<cheerio.Element>} rows - The Cheerio collection of <tr> elements.
 * @param {Map<string, any>} entityDataMap - Map to populate with extracted entity data.
 * @param {object} colIndexes - An object mapping data-field names to their column index.
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
            hero_id: null, // Will be resolved later
            winrate: parsePercentageValue(cells.eq(colIndexes.winrate).text()),
            highSkillWinrate: parsePercentageValue(cells.eq(colIndexes.hs_winrate).text()),
            pickRate: parseNumericValue(cells.eq(colIndexes.pick_rate).text()),
            hsPickRate: parseNumericValue(cells.eq(colIndexes.hs_pick_rate).text()),
            windrunId: isHero ? windrunId : null,
        });
    });
}


/**
 * Scrapes hero and ability data from a single Windrun.io page and stores it in the database.
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

        // --- Scraping Phase ---
        statusCallback(`Fetching entity data from ${url}...`);
        const { data: html } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: AXIOS_TIMEOUT });
        const $ = cheerio.load(html);

        // Dynamically find column indices based on data-field attributes
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

        // --- Database Update Phase ---

        // 1. Process Heroes to populate heroNameToIdMap
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
            const existingHeroes = db.prepare('SELECT hero_id, name FROM Heroes').all();
            existingHeroes.forEach(h => heroNameToIdMap.set(h.name, h.hero_id));
        }
        statusCallback(`Hero processing complete. Total heroes in map: ${heroNameToIdMap.size}.`);

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
        console.error('[Entity Scraper] Error during entity scraping or database update:', error);
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