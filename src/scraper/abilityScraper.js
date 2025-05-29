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
 * It assumes specific path segments like '/heroes/' or '/abilities/' in the imgSrc.
 * @param {cheerio.CheerioAPI} $ - The Cheerio instance for the current row.
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

    // Determine if hero or ability based on image URL path
    if (imgSrc.includes('/heroes/')) {
        name = filename?.replace(/_full\.png$|_vert\.jpg$/i, ''); // Typical hero image suffixes
        isHero = true;
    } else if (imgSrc.includes('/abilities/')) {
        name = filename?.replace(/\.png$/i, ''); // Typical ability image suffix
        isHero = false;
    } else {
        // Fallback: if path unknown, assume ability and try to clean .png
        name = filename?.replace(/\.png$/i, '');
        isHero = false;
        // console.warn(`[Entity Scraper] Unknown image path structure for ${imgSrc}. Assuming ability.`);
    }
    return { name: name || null, isHero };
}

/**
 * Attempts to find the hero_id for a given ability name by matching parts of the
 * ability name (typically a prefix) against known hero internal names.
 * Handles common naming conventions like "heroName_abilitySuffix".
 * @param {string} abilityName - The internal name of the ability.
 * @param {Map<string, number>} heroNameToIdMap - A map of hero internal names to their database IDs.
 * @returns {number | null} The hero_id if a match is found, otherwise null.
 */
function findHeroIdForAbility(abilityName, heroNameToIdMap) {
    if (!abilityName || !heroNameToIdMap) return null;

    const parts = abilityName.split('_');
    if (parts.length < 2) return null; // Needs at least hero_ability

    // Attempt to match hero name from longest possible prefix to shortest
    // e.g., for "ancient_apparition_ice_blast", try "ancient_apparition_ice", then "ancient_apparition", then "ancient"
    for (let i = parts.length - 1; i >= 1; i--) {
        const potentialHeroName = parts.slice(0, i).join('_');
        if (heroNameToIdMap.has(potentialHeroName)) {
            return heroNameToIdMap.get(potentialHeroName);
        }
    }

    // Special case handling for names like 'sand_king' which might be part of 'sandking_burrowstrike'
    if (abilityName.toLowerCase().startsWith("sandking_") && heroNameToIdMap.has('sand_king')) {
        return heroNameToIdMap.get('sand_king');
    }
    // Add other special cases if known, e.g. Io (wisp)
    if (abilityName.toLowerCase().startsWith("wisp_") && heroNameToIdMap.has('wisp')) {
        return heroNameToIdMap.get('wisp');
    }


    // console.warn(`[Entity Scraper] Could not automatically determine hero_id for ability: ${abilityName}`);
    return null;
}


/**
 * Processes rows from a Cheerio-loaded HTML table to extract entity data.
 * @param {cheerio.CheerioAPI} $ - The Cheerio instance for the page.
 * @param {cheerio.Cheerio<cheerio.Element>} rows - The Cheerio collection of <tr> elements.
 * @param {Map<string, any>} entityDataMap - Map to populate/update with extracted entity data.
 * @param {Map<string, number>} heroNameToIdMap - Map of hero names to IDs.
 * @param {function} heroInsertTransaction - DB transaction function to insert/update heroes and get their ID.
 * @param {boolean} isHighSkillPage - Flag indicating if parsing high-skill specific data (impacts which winrate field is set).
 * @param {function(string): void} statusCallback - Function for status updates.
 */
function parseEntityRows($, rows, entityDataMap, heroNameToIdMap, heroInsertTransaction, isHighSkillPage, statusCallback) {
    rows.each((index, element) => {
        const row = $(element);
        const imgElement = row.find('td.abil-picture img'); // Standard selector for entity image
        const { name: entityName, isHero } = extractEntityNameFromImg(imgElement);

        if (!entityName) {
            console.warn(`[Entity Scraper] Skipping row ${index + 1} on ${isHighSkillPage ? 'high-skill' : 'regular'} page: Could not extract valid entity name.`);
            return; // continue to next .each iteration
        }

        const displayNameElement = row.find('td').eq(1).find('a'); // Second <td> usually contains name link
        const displayName = displayNameElement.text().trim() || null;
        const windrunHref = displayNameElement.attr('href');
        const windrunId = windrunHref ? windrunHref.split('/').pop() : null;

        // Windrun.io ability/hero pages: Winrate (index 1), Avg Pick (index 2), Value (index 3)
        // Note: Indices are 0-based for .eq()
        const winrateCell = row.find('td.color-range').eq(1);
        const avgPickOrderCell = row.find('td.color-range').eq(2);
        const valueCell = row.find('td.color-range').eq(3);

        const winrate = parsePercentageValue(winrateCell.text());
        const avgPickOrder = parseNumericValue(avgPickOrderCell.text());
        const valuePercentage = parsePercentageValue(valueCell.text());


        let existingData = entityDataMap.get(entityName);

        if (isHighSkillPage) {
            if (existingData) {
                existingData.high_skill_winrate = winrate; // 'winrate' here is from high-skill page
                if (!existingData.display_name && displayName) existingData.display_name = displayName; // Fill if missing
            } else {
                // Entity found only in high-skill data. Less likely for heroes but possible for new/obscure abilities.
                const heroIdForNewEntity = isHero ? null : findHeroIdForAbility(entityName, heroNameToIdMap);
                entityDataMap.set(entityName, {
                    name: entityName,
                    display_name: displayName,
                    isHero: isHero,
                    hero_id: heroIdForNewEntity,
                    winrate: null, // No regular winrate known
                    high_skill_winrate: winrate,
                    avg_pick_order: avgPickOrder, // High-skill page might also have these
                    value_percentage: valuePercentage,
                    windrunId: isHero ? windrunId : null,
                    is_ultimate: null, // Cannot determine from this page
                    ability_order: null // Cannot determine from this page
                });
                if (isHero) { // If it's a new hero found only on high-skill page
                    const newHeroEntry = entityDataMap.get(entityName);
                    const heroId = heroInsertTransaction(newHeroEntry);
                    if (heroId) heroNameToIdMap.set(entityName, heroId);
                }
            }
        } else { // Regular page processing
            if (existingData) { // Should not happen if entityName is unique key and map is fresh
                statusCallback(`Warning: Duplicate entity '${entityName}' found on regular page. Overwriting.`);
            }
            const entry = {
                name: entityName,
                display_name: displayName,
                isHero: isHero,
                hero_id: isHero ? null : findHeroIdForAbility(entityName, heroNameToIdMap),
                winrate: winrate,
                high_skill_winrate: null, // Initialize, will be filled by high-skill parse
                avg_pick_order: avgPickOrder,
                value_percentage: valuePercentage,
                windrunId: isHero ? windrunId : null,
                is_ultimate: null, // Cannot determine from this page
                ability_order: null // Cannot determine from this page
            };
            entityDataMap.set(entityName, entry);

            if (isHero) { // Insert/update hero into DB immediately and update heroNameToIdMap
                const heroId = heroInsertTransaction(entry);
                if (heroId) heroNameToIdMap.set(entityName, heroId);
            }
        }
    });
}


/**
 * Scrapes hero and ability data from Windrun.io (regular and high-skill pages),
 * merges the data, and stores it in the SQLite database.
 *
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} urlRegular - URL for the regular abilities/heroes page.
 * @param {string} urlHighSkill - URL for the high-skill specific abilities/heroes page.
 * @param {function(string): void} statusCallback - Function to send status updates.
 * @throws {Error} If critical errors occur during scraping or database operations.
 */
async function scrapeAndStoreAbilitiesAndHeroes(dbPath, urlRegular, urlHighSkill, statusCallback) {
    let db;
    const entityDataMap = new Map(); // Stores { entityName: {data} }
    let heroNameToIdMap = new Map();   // Stores { heroInternalName: hero_id }

    try {
        statusCallback('Initializing database connection and loading existing hero IDs...');
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');

        try {
            const existingHeroes = db.prepare('SELECT hero_id, name FROM Heroes').all();
            heroNameToIdMap = new Map(existingHeroes.map(h => [h.name, h.hero_id]));
            statusCallback(heroNameToIdMap.size > 0 ? `Loaded ${heroNameToIdMap.size} existing hero IDs from DB.` : 'No existing heroes found in DB to pre-load.');
        } catch (err) {
            statusCallback(`Warning: Failed to load existing heroes from DB - ${err.message}. Proceeding with scrape.`);
        }

        // SQL for inserting/updating heroes. RETURNING hero_id is specific to some DBs;
        // better-sqlite3 handles this by returning info object with lastInsertRowid.
        const insertHeroStmt = db.prepare(`
            INSERT INTO Heroes (name, display_name, winrate, windrun_id, avg_pick_order, value_percentage)
            VALUES (@name, @displayName, @winrate, @windrunId, @avg_pick_order, @value_percentage)
            ON CONFLICT(name) DO UPDATE SET
                display_name = excluded.display_name,
                winrate = excluded.winrate,
                windrun_id = excluded.windrun_id,
                avg_pick_order = excluded.avg_pick_order,
                value_percentage = excluded.value_percentage
            RETURNING hero_id;
        `);
        // Transaction function to insert/update a single hero and return its ID
        const heroInsertTransaction = db.transaction((heroToInsert) => {
            const result = insertHeroStmt.get(heroToInsert); // .get() for RETURNING
            return result ? result.hero_id : null;
        });


        // --- Scrape Regular Entities Page ---
        statusCallback(`Fetching regular entity data from ${urlRegular}...`);
        const { data: htmlRegular } = await axios.get(urlRegular, { headers: { 'User-Agent': USER_AGENT }, timeout: AXIOS_TIMEOUT });
        statusCallback('Parsing regular entity HTML...');
        const $regular = cheerio.load(htmlRegular);
        const rowsRegular = $regular('tbody tr');
        if (rowsRegular.length === 0) throw new Error(`No data rows found on regular entity page (${urlRegular}). DOM structure might have changed.`);
        statusCallback(`Found ${rowsRegular.length} regular entity rows. Extracting...`);
        parseEntityRows($regular, rowsRegular, entityDataMap, heroNameToIdMap, heroInsertTransaction, false, statusCallback);
        statusCallback(`Processed ${entityDataMap.size} unique entities from regular data.`);


        // --- Scrape High-Skill Entities Page ---
        statusCallback(`Fetching high-skill entity data from ${urlHighSkill}...`);
        const { data: htmlHighSkill } = await axios.get(urlHighSkill, { headers: { 'User-Agent': USER_AGENT }, timeout: AXIOS_TIMEOUT });
        statusCallback('Parsing high-skill entity HTML...');
        const $highSkill = cheerio.load(htmlHighSkill);
        const rowsHighSkill = $highSkill('tbody tr');
        if (rowsHighSkill.length === 0) throw new Error(`No data rows found on high-skill entity page (${urlHighSkill}). DOM structure might have changed.`);
        statusCallback(`Found ${rowsHighSkill.length} high-skill entity rows. Merging...`);
        parseEntityRows($highSkill, rowsHighSkill, entityDataMap, heroNameToIdMap, heroInsertTransaction, true, statusCallback);
        statusCallback(`Data merging complete. Total unique entities processed: ${entityDataMap.size}.`);


        // --- Prepare and Insert Abilities ---
        const finalAbilityList = [];
        entityDataMap.forEach(entity => {
            if (!entity.isHero) {
                // Ensure hero_id is current for abilities, especially if a hero was just added from high-skill page
                if (!entity.hero_id && entity.name) {
                    entity.hero_id = findHeroIdForAbility(entity.name, heroNameToIdMap);
                }
                // is_ultimate and ability_order are not determined by this scraper from Windrun.io
                // They remain null unless populated by another source/process.
                finalAbilityList.push(entity);
            }
        });

        if (finalAbilityList.length === 0 && heroNameToIdMap.size === 0) {
            throw new Error('Scraping resulted in 0 valid heroes and 0 abilities. Check selectors or website content.');
        }
        statusCallback(`Updating/Inserting ${finalAbilityList.length} abilities into the database...`);

        const insertAbilityStmt = db.prepare(`
            INSERT INTO Abilities (name, display_name, hero_id, winrate, high_skill_winrate, avg_pick_order, value_percentage, is_ultimate, ability_order)
            VALUES (@name, @display_name, @hero_id, @winrate, @high_skill_winrate, @avg_pick_order, @value_percentage, @is_ultimate, @ability_order)
            ON CONFLICT(name) DO UPDATE SET
                display_name = excluded.display_name,
                hero_id = excluded.hero_id,
                winrate = excluded.winrate,
                high_skill_winrate = excluded.high_skill_winrate,
                avg_pick_order = excluded.avg_pick_order,
                value_percentage = excluded.value_percentage,
                is_ultimate = excluded.is_ultimate,
                ability_order = excluded.ability_order;
        `);

        const abilityInsertTransaction = db.transaction((abilitiesToInsert) => {
            let count = 0;
            for (const ability of abilitiesToInsert) {
                if (!ability.name) {
                    console.warn('[Entity Scraper] Skipping database insert for ability with no name.');
                    continue;
                }
                try {
                    const info = insertAbilityStmt.run({
                        name: ability.name,
                        display_name: ability.display_name,
                        hero_id: ability.hero_id,
                        winrate: ability.winrate,
                        high_skill_winrate: ability.high_skill_winrate,
                        avg_pick_order: ability.avg_pick_order,
                        value_percentage: ability.value_percentage,
                        is_ultimate: ability.is_ultimate, // Remains null if not determinable
                        ability_order: ability.ability_order  // Remains null if not determinable
                    });
                    if (info.changes > 0) count++;
                } catch (dbError) {
                    console.error(`[Entity Scraper] Error inserting/updating ability "${ability.name}": ${dbError.message}`);
                }
            }
            return count;
        });

        const processedDbAbilitiesCount = abilityInsertTransaction(finalAbilityList);
        statusCallback(`Database update successful. Total heroes in DB: ${heroNameToIdMap.size}. Processed (Inserted/Updated) abilities in this run: ${processedDbAbilitiesCount}.`);

    } catch (error) {
        console.error('[Entity Scraper] Error during entity scraping or database update:', error);
        statusCallback(`Hero/Ability scraping failed: ${error.message}. Check console for details.`);
        throw error; // Rethrow for main process to handle
    } finally {
        if (db && db.open) {
            db.close();
            console.log('[Entity Scraper] Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreAbilitiesAndHeroes };