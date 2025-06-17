/**
 * @fileoverview Scrapes ability data (order, ultimate status) from Liquipedia
 * using its API and updates the local SQLite database.
 * It prioritizes matching abilities by their display name and hero association.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');
const { getAllHeroes } = require('../database/queries');

const AXIOS_TIMEOUT = 30000; // 30 seconds
// Updated User-Agent to be more descriptive as per Liquipedia API terms
// IMPORTANT: Replace 'your@example.com' with a real contact email if deployed!
const USER_AGENT = 'Dota2AbilityDraftPlusOverlay/1.0 (https://github.com/tiarin-hino/ability-draft-plus; your@example.com)';
const LIQUIPEDIA_API_BASE_URL = 'https://liquipedia.net/dota2/api.php';
/** API request delay in milliseconds. Liquipedia recommends ~30 seconds between `action=parse` requests. */
const API_REQUEST_DELAY_MS = 31000;

// Hotkey to Ability Order/isUltimate mapping
const HOTKEY_MAPPING = {
    'Q': { ability_order: 1, is_ultimate: false },
    'W': { ability_order: 2, is_ultimate: false },
    'E': { ability_order: 3, is_ultimate: false },
    'R': { ability_order: 0, is_ultimate: true },  // 'R' is conventionally the ultimate, assigned order 0.
};

/**
 * A simple delay function.
 * @param {number} ms - The number of milliseconds to wait.
 * @returns {Promise<void>} A promise that resolves after the specified delay.
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Normalizes a display name for use in Liquipedia element IDs and sometimes URLs.
 * Replaces spaces with underscores. Removes apostrophes.
 * @param {string} displayName - The ability or hero display name.
 * @returns {string} The normalized string.
 */
function normalizeForLiquipediaId(displayName) {
    return displayName.replace(/ /g, '_').replace(/\./g, '');
}

/**
 * Normalizes a display name for use in Liquipedia API page titles (URLs).
 * Replaces spaces with underscores. Preserves hyphens. Removes apostrophes.
 * @param {string} displayName - The hero display name.
 * @returns {string} The normalized string for URL.
 */
function normalizeForLiquipediaPageTitle(displayName) {
    return displayName.replace(/ /g, '_').replace(/'/g, '');
}

/**
 * Scrapes ability order and ultimate status from Liquipedia (via its API) and updates the database.
 * This scraper will prioritize matching abilities by their display name.
 * It respects Liquipedia's API usage guidelines by including a User-Agent and request delay.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {function(string): void} statusCallback - Function to send status updates.
 * @param {boolean} [testMode=false] - If true, only processes the first hero for testing.
 */
async function scrapeAndStoreLiquipediaData(dbPath, statusCallback, testMode = false) {
    let db;
    try {
        statusCallback('Connecting to database for Liquipedia data...');
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');

        const updateAbilityStmt = db.prepare(`
            UPDATE Abilities
            SET
                is_ultimate = @is_ultimate,
                ability_order = @ability_order
            WHERE display_name = @display_name AND hero_id = @hero_id;
        `);

        const getAbilitiesOfHeroFromDb = db.prepare(`
            SELECT ability_id, hero_id, name, display_name, is_ultimate, ability_order
            FROM Abilities
            WHERE hero_id = ?;
        `);

        const checkHeroAbilitiesNeedUpdateStmt = db.prepare(`
            SELECT COUNT(*) AS count
            FROM Abilities
            WHERE hero_id = ?
              AND (is_ultimate IS NULL OR ability_order IS NULL);
        `);

        statusCallback('Fetching hero list from local database...');
        const heroes = await getAllHeroes(dbPath);
        if (heroes.length === 0) {
            statusCallback('No heroes found in database to scrape from Liquipedia. Skipping.');
            return;
        }
        statusCallback(`Found ${heroes.length} heroes. Starting Liquipedia API scrape...`);

        let processedHeroesCount = 0;
        let updatedAbilitiesCount = 0;

        for (const hero of heroes) {
            if (testMode && processedHeroesCount >= 1) { // Only process one hero in test mode
                statusCallback('Test mode active: Processed one hero. Skipping remaining heroes.');
                break;
            }

            // Check if this hero's abilities already have the required data
            const needsUpdateResult = checkHeroAbilitiesNeedUpdateStmt.get(hero.hero_id);
            if (needsUpdateResult.count === 0) {
                console.log(`[Liquipedia Scraper] Skipping "${hero.display_name}": All abilities already have order and ultimate status.`);
                processedHeroesCount++;
                continue; // Skip API call and delay if no update is needed for this hero
            }
            const liquipediaPageTitle = normalizeForLiquipediaPageTitle(hero.display_name);
            const apiUrl = `${LIQUIPEDIA_API_BASE_URL}?action=parse&page=${liquipediaPageTitle}&format=json`;
            statusCallback(`Fetching API data for ${hero.display_name} from ${apiUrl}...`);

            try {
                const response = await axios.get(apiUrl, {
                    headers: {
                        'User-Agent': USER_AGENT,
                        'Accept-Encoding': 'gzip'
                    },
                    timeout: AXIOS_TIMEOUT
                });

                if (!response.data || !response.data.parse || !response.data.parse.text || !response.data.parse.text['*']) {
                    console.warn(`[Liquipedia Scraper] No parsed HTML content found for "${hero.display_name}" via API. Skipping.`);
                    processedHeroesCount++;
                    await delay(API_REQUEST_DELAY_MS);
                    continue;
                }

                const htmlContent = response.data.parse.text['*'];
                const $ = cheerio.load(htmlContent);

                const abilitiesOfCurrentHero = getAbilitiesOfHeroFromDb.all(hero.hero_id);
                for (const dbAbility of abilitiesOfCurrentHero) {
                    // Only attempt to update if the ability is missing data
                    if (dbAbility.is_ultimate !== null && dbAbility.ability_order !== null) {
                        continue; // Skip if already populated
                    }

                    const normalizedAbilityId = normalizeForLiquipediaId(dbAbility.display_name);
                    const spellcardWrapper = $(`.spellcard-wrapper[id="${normalizedAbilityId}"]`);

                    if (spellcardWrapper.length > 0) {
                        const hotkeySpan = spellcardWrapper.find('div[title="Default Hotkey"] span').first();
                        const hotkeyChar = hotkeySpan.text().trim().toUpperCase();

                        if (hotkeyChar && HOTKEY_MAPPING[hotkeyChar]) {
                            const mapping = HOTKEY_MAPPING[hotkeyChar];

                            const updateResult = updateAbilityStmt.run({
                                is_ultimate: mapping.is_ultimate ? 1 : 0,
                                ability_order: mapping.ability_order,
                                display_name: dbAbility.display_name,
                                hero_id: dbAbility.hero_id
                            });

                            if (updateResult.changes > 0) {
                                updatedAbilitiesCount++;
                                // console.log(`[Liquipedia Scraper] Updated ${hero.display_name}'s ability: "${dbAbility.display_name}" (Hotkey: ${hotkeyChar})`);
                            }
                        } else {
                            console.warn(`[Liquipedia Scraper] Hotkey not found or not Q/W/E/R for "${dbAbility.display_name}" on "${hero.display_name}"'s page. Skipping update.`);
                        }
                    } else {
                        // This might happen for innate abilities, Aghs/Shard abilities, or if normalization
                        // for ID doesn't match Liquipedia's actual ID for the spellcard.
                        // Or simply abilities not found on the main hero page in a spellcard wrapper.
                        console.warn(`[Liquipedia Scraper] Spellcard-wrapper for "${dbAbility.display_name}" (ID: #${normalizedAbilityId}) not found on "${hero.display_name}"'s page. Skipping update.`);
                    }
                }
            } catch (error) {
                if (error.response && error.response.status === 404) {
                    console.warn(`[Liquipedia Scraper] API page not found for "${hero.display_name}" (normalized: "${liquipediaPageTitle}") at "${apiUrl}". Skipping.`);
                } else if (error.response && error.response.status === 429) {
                    console.error(`[Liquipedia Scraper] Rate limit hit (429) for "${hero.display_name}". This indicates either insufficient delay or a temporary IP ban. Please wait before retrying a full scrape. Stopping scrape.`);
                    break;
                } else {
                    console.error(`[Liquipedia Scraper] Error fetching or parsing data for "${hero.display_name}" from API (${apiUrl}): ${error.message}`);
                }
            }
            processedHeroesCount++;
            await delay(API_REQUEST_DELAY_MS);
        }

        statusCallback(`Liquipedia API scrape finished. Processed ${processedHeroesCount} heroes, updated ${updatedAbilitiesCount} abilities.`);
    } catch (error) {
        console.error('[Liquipedia Scraper] Fatal error during Liquipedia API scraping:', error);
        statusCallback(`Liquipedia API scraping failed: ${error.message}. Check console for details.`);
        throw error; // Rethrow to be caught by the main process
    } finally {
        if (db && db.open) {
            db.close(); //
            console.log('[Liquipedia Scraper] Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreLiquipediaData };