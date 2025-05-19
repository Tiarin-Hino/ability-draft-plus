const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');

const AXIOS_TIMEOUT = 15000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

async function retryAsync(fn, retriesLeft = MAX_RETRIES, interval = RETRY_DELAY_MS, errMsg = 'Retry failed') {
    try {
        return await fn();
    } catch (error) {
        if (retriesLeft === 0) {
            console.error(`[HeroAbilityScraper] ${errMsg}: Max retries reached.`);
            throw error;
        }
        await new Promise(resolve => setTimeout(resolve, interval));
        return retryAsync(fn, retriesLeft - 1, interval, errMsg);
    }
}

function parseNumericValue(text) {
    if (!text) return null;
    const cleanedText = text.trim().replace(/[^0-9.-]+/g, '');
    const parsedValue = parseFloat(cleanedText);
    return !isNaN(parsedValue) ? parsedValue : null;
}

function parsePercentageValue(text) {
    if (!text) return null;
    const cleanedText = text.trim().replace('%', '');
    const parsedRate = parseFloat(cleanedText);
    return !isNaN(parsedRate) ? parsedRate / 100.0 : null;
}

function extractAbilityNameFromImg(imgElement) {
    if (!imgElement || imgElement.length === 0) return null;
    const imgSrc = imgElement.attr('src');
    if (!imgSrc) return null;
    const filename = imgSrc.split('/').pop();
    return filename?.replace(/\.png$/i, '') || null;
}

function ensureHeroAbilityTableExists(db, heroId, heroInternalName) {
    const tableName = `HeroAbilities_${heroId}`;
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS ${tableName} (
                ability_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                display_name TEXT,
                hero_id INTEGER NOT NULL,
                winrate REAL,
                avg_pick_order REAL,
                value_percentage REAL,
                FOREIGN KEY (hero_id) REFERENCES Heroes (hero_id) ON DELETE CASCADE ON UPDATE CASCADE
            );
        `);
    } catch (error) {
        console.error(`[HeroAbilityScraper] Error ensuring table ${tableName} for hero ${heroInternalName}: ${error.message}`);
        throw error;
    }
    return tableName;
}

/**
 * Checks if a specific hero ability table exists and is populated.
 * @param {Database.Database} db - The database instance.
 * @param {number} heroId - The hero_id.
 * @returns {boolean} True if the table exists and has data, false otherwise.
 */
function heroAbilityTableExistsAndIsPopulated(db, heroId) {
    const tableName = `HeroAbilities_${heroId}`;
    try {
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
        if (!tableCheck) {
            return false;
        }
        const rowCount = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
        return rowCount && rowCount.count > 0;
    } catch (error) {
        console.error(`[HeroAbilityScraper] Error checking table ${tableName}: ${error.message}`);
        return false;
    }
}


/**
 * Scrapes and stores abilities for heroes from their specific pages.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {function(string): void} statusCallback - Function to send status updates.
 * @param {boolean} scrapeOnlyMissing - If true, only scrapes for heroes whose tables don't exist or are empty.
 */
async function scrapeAndStoreHeroAbilities(dbPath, statusCallback, scrapeOnlyMissing = false) {
    let db;
    let heroesToScrapeQuery = 'SELECT hero_id, name, windrun_id, display_name FROM Heroes WHERE windrun_id IS NOT NULL';

    try {
        statusCallback(scrapeOnlyMissing ? 'Fetching hero list for missing/empty ability tables...' : 'Fetching hero list for individual ability scraping...');
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');

        let allHeroes = db.prepare(heroesToScrapeQuery).all();
        let heroesToProcess = allHeroes;

        if (scrapeOnlyMissing) {
            heroesToProcess = allHeroes.filter(hero => !heroAbilityTableExistsAndIsPopulated(db, hero.hero_id));
            if (heroesToProcess.length === 0) {
                statusCallback('All hero-specific ability tables already exist and are populated. Nothing to do for "missing only" scrape.');
                if (db && db.open) db.close();
                return;
            }
            statusCallback(`Found ${heroesToProcess.length} heroes with missing/empty ability tables to process.`);
        } else {
            if (heroesToProcess.length === 0) {
                statusCallback('No heroes with windrun_id found in the database. Skipping hero-specific ability scraping.');
                if (db && db.open) db.close();
                return;
            }
            statusCallback(`Found ${heroesToProcess.length} heroes to process for individual abilities.`);
        }


        for (const hero of heroesToProcess) {
            const heroUrl = `https://windrun.io/heroes/${hero.windrun_id}`;
            const heroDisplayName = hero.display_name || hero.name;
            const heroId = hero.hero_id;

            const tableName = ensureHeroAbilityTableExists(db, heroId, hero.name);

            statusCallback(`Processing abilities for ${heroDisplayName} (ID: ${hero.windrun_id}). Fetching from ${heroUrl}...`);

            let html;
            try {
                const response = await retryAsync(async () => {
                    return axios.get(heroUrl, {
                        headers: { 'User-Agent': 'Mozilla/5.0' },
                        timeout: AXIOS_TIMEOUT
                    });
                }, MAX_RETRIES, RETRY_DELAY_MS, `Workspaceing page for ${heroDisplayName} (${heroUrl})`);
                html = response.data;

            } catch (networkError) {
                if (networkError.code === 'ECONNABORTED' || (networkError.response && (networkError.response.status === 404 || networkError.response.status === 524))) {
                    statusCallback(`Failed to fetch page for ${heroDisplayName} (URL: ${heroUrl}) after ${MAX_RETRIES + 1} attempts. Status: ${networkError.response ? networkError.response.status : 'Timeout'}. Skipping.`);
                } else {
                    statusCallback(`Network error fetching abilities for ${heroDisplayName} after retries: ${networkError.message}. Skipping.`);
                }
                console.error(`[HeroAbilityScraper] Final network error for ${heroUrl} after retries:`, networkError.message);
                continue;
            }

            const $ = cheerio.load(html);
            const abilityRows = $('tbody tr');

            if (abilityRows.length === 0) {
                statusCallback(`No ability rows found on page for ${heroDisplayName}.`);
                console.warn(`[HeroAbilityScraper] No ability rows for ${heroDisplayName} at ${heroUrl}`);
                continue;
            }

            const abilitiesForHero = [];
            abilityRows.each((index, element) => {
                const row = $(element);
                const imgElement = row.find('td.abil-picture img');
                const abilityName = extractAbilityNameFromImg(imgElement);
                const displayNameElement = row.find('td').eq(1).find('a').first();
                let abilityDisplayName = displayNameElement.text().trim() || null;
                if (!abilityDisplayName) {
                    abilityDisplayName = row.find('td').eq(1).text().trim() || null;
                }
                const winrateCell = row.find('td.color-range').eq(1);
                const winrate = parsePercentageValue(winrateCell.text());
                const avgPickOrderCell = row.find('td.color-range').eq(2);
                const avgPickOrder = parseNumericValue(avgPickOrderCell.text());
                const valueCell = row.find('td.color-range').eq(5);
                const valuePercentage = parsePercentageValue(valueCell.text());

                if (abilityName) {
                    abilitiesForHero.push({
                        name: abilityName,
                        display_name: abilityDisplayName || abilityName,
                        hero_id: heroId,
                        winrate: winrate,
                        avg_pick_order: avgPickOrder,
                        value_percentage: valuePercentage
                    });
                }
            });

            if (abilitiesForHero.length > 0) {
                const insertStmt = db.prepare(`
                    INSERT INTO ${tableName} (name, display_name, hero_id, winrate, avg_pick_order, value_percentage)
                    VALUES (@name, @display_name, @hero_id, @winrate, @avg_pick_order, @value_percentage)
                    ON CONFLICT(name) DO UPDATE SET
                        display_name = excluded.display_name,
                        winrate = excluded.winrate,
                        avg_pick_order = excluded.avg_pick_order,
                        value_percentage = excluded.value_percentage
                `);
                const insertTransaction = db.transaction((heroAbilityData) => {
                    let count = 0;
                    for (const ability of heroAbilityData) {
                        const info = insertStmt.run(ability);
                        if (info.changes > 0) count++;
                    }
                    return count;
                });
                const processedCount = insertTransaction(abilitiesForHero);
                statusCallback(`Updated ${processedCount} abilities for ${heroDisplayName} in table ${tableName}.`);
            } else {
                statusCallback(`No abilities extracted for ${heroDisplayName} from the page.`);
            }
            await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 200));
        }
        statusCallback(scrapeOnlyMissing ? 'Finished scraping missing hero-specific abilities.' : 'Finished scraping all hero-specific abilities.');

    } catch (error) {
        console.error('[HeroAbilityScraper] Error during hero-specific ability scraping or database update:', error);
        statusCallback(`Hero-specific ability scraping failed: ${error.message}. Check console for details.`);
    } finally {
        if (db && db.open) {
            db.close();
            console.log('[HeroAbilityScraper] Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreHeroAbilities };