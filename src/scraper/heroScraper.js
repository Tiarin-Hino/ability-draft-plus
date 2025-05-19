const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');

const AXIOS_TIMEOUT = 15000; // 15 seconds timeout for fetching hero page

/**
 * Scrapes hero data from windrun.io and stores it in the database.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} url - The URL to scrape (e.g., 'https://windrun.io/heroes').
 * @param {function(string): void} statusCallback - Function to send status updates.
 */
async function scrapeAndStoreHeroes(dbPath, url, statusCallback) {
    let db;

    try {
        statusCallback('Fetching hero data from windrun.io...');
        console.log(`[HERO_SCRAPER_NETWORK] Attempting to fetch: ${url}`);
        const { data: html } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: AXIOS_TIMEOUT
        });
        console.log(`[HERO_SCRAPER_NETWORK] Successfully fetched: ${url}`);

        statusCallback('Parsing HTML data...');
        const $ = cheerio.load(html);
        const heroes = [];
        const rows = $('tbody tr');

        if (rows.length === 0) {
            throw new Error('No hero data rows found on the page. DOM structure might have changed.');
        }

        statusCallback(`Found ${rows.length} hero rows. Extracting data...`);

        rows.each((index, element) => {
            const row = $(element);
            const heroImg = row.find('td.hero-picture img'); // First td for image

            // --- Extract Display Name and Windrun ID from the second td's <a> tag ---
            const displayNameElement = row.find('td').eq(1).find('a');
            const displayName = displayNameElement.text().trim() || null;
            const windrunId = displayNameElement.attr('href').split('/').pop() || null;
            // --- End Extract Display Name ---

            const winrateCell = row.find('td.color-range').first(); // First td with class color-range for winrate

            // Extract internal hero name from image src
            const imgSrc = heroImg.attr('src');
            let internalName = null;
            if (imgSrc) {
                const filename = imgSrc.split('/').pop();
                internalName = filename.replace(/_full\.png$|_vert\.jpg$/i, '');
            }

            // Extract winrate text and convert to number
            const winrateText = winrateCell.text().trim();
            let winrateValue = null;
            if (winrateText) {
                const parsedRate = parseFloat(winrateText.replace('%', ''));
                if (!isNaN(parsedRate)) {
                    winrateValue = parsedRate / 100.0;
                }
            }

            if (internalName && displayName && winrateValue !== null) {
                heroes.push({
                    name: internalName,
                    displayName: displayName,
                    winrate: winrateValue,
                    windrunId: windrunId
                });
            } else {
                console.warn(`Skipping hero row ${index + 1}: Could not extract all required data (InternalName: ${internalName}, DisplayName: ${displayName}, Winrate Text: ${winrateText})`);
            }
        });

        if (heroes.length === 0) {
            throw new Error('Extracted 0 valid heroes. Check selectors or page content.');
        }

        statusCallback(`Extracted ${heroes.length} heroes. Updating database...`);
        console.log(`[HERO_SCRAPER_DB] Attempting to update ${heroes.length} heroes in the database.`);

        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');

        const insertStmt = db.prepare(`
            INSERT INTO Heroes (name, display_name, winrate, windrun_id)
            VALUES (@name, @displayName, @winrate, @windrunId)
            ON CONFLICT(name) DO UPDATE SET
                display_name = excluded.display_name,
                winrate = excluded.winrate,
                windrun_id = excluded.windrun_id
        `);

        const insertTransaction = db.transaction((heroData) => {
            for (const hero of heroData) {
                insertStmt.run(hero);
            }
            return heroData.length;
        });

        const processedCount = insertTransaction(heroes);
        console.log(`[HERO_SCRAPER_DB] Database transaction complete. Processed ${processedCount} heroes.`);
        statusCallback(`Database update successful. Processed ${processedCount} heroes.`);

    } catch (error) {
        console.error('Error during hero scraping or database update:', error);
        if (error.code === 'ECONNABORTED' || (error.response && error.response.status === 524)) {
            statusCallback(`Error fetching hero data: The request to windrun.io timed out or the server was too slow to respond. Please try again later.`);
        } else if (error.message.includes('No hero data rows found') || error.message.includes('Extracted 0 valid heroes')) {
            statusCallback(`Error fetching hero data: Could not parse data from windrun.io. The website structure might have changed.`);
        } else {
            statusCallback(`Error updating hero data: ${error.message}`);
        }
        throw error; // Rethrow to be caught by the IPC handler in main.js if needed for broader error handling
    } finally {
        if (db && db.open) {
            db.close();
            console.log('[HERO_SCRAPER_DB] Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreHeroes };