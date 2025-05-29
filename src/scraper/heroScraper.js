const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');

const AXIOS_TIMEOUT = 15000; // 15 seconds timeout for fetching the hero page
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

/**
 * Scrapes hero data (name, display name, winrate, Windrun ID) from a specified URL
 * (typically Windrun.io's heroes page) and stores it in the SQLite database.
 *
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} url - The URL to scrape for hero data (e.g., 'https://windrun.io/heroes').
 * @param {function(string): void} statusCallback - A function to call with status updates during the scraping process.
 * @throws {Error} If a critical error occurs during scraping or database update that prevents completion.
 */
async function scrapeAndStoreHeroes(dbPath, url, statusCallback) {
    let db;

    try {
        statusCallback('Fetching hero data from source...');
        console.log(`[Hero Scraper] Attempting to fetch: ${url}`);
        const { data: html } = await axios.get(url, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: AXIOS_TIMEOUT
        });
        console.log(`[Hero Scraper] Successfully fetched: ${url}`);

        statusCallback('Parsing HTML data for heroes...');
        const $ = cheerio.load(html);
        const heroes = [];
        const rows = $('tbody tr'); // Select all table rows in the table body

        if (rows.length === 0) {
            throw new Error('No hero data rows found on the page. The website\'s DOM structure might have changed.');
        }
        statusCallback(`Found ${rows.length} hero rows. Extracting data...`);

        rows.each((index, element) => {
            const row = $(element);
            const heroImgElement = row.find('td.hero-picture img'); // Image element for internal name

            // Extract Display Name and Windrun ID from the second td's <a> tag
            const displayNameAnchor = row.find('td').eq(1).find('a'); // Second <td> contains link with display name
            const displayName = displayNameAnchor.text().trim() || null;
            const windrunHref = displayNameAnchor.attr('href');
            const windrunId = windrunHref ? windrunHref.split('/').pop() : null;

            // Winrate is typically in the first td with class 'color-range'
            const winrateCell = row.find('td.color-range').first();

            // Extract internal hero name from the image source URL
            const imgSrc = heroImgElement.attr('src');
            let internalName = null;
            if (imgSrc) {
                const filename = imgSrc.split('/').pop();
                // Remove common image extensions and hero suffixes like '_full.png' or '_vert.jpg'
                internalName = filename.replace(/_full\.png$|_vert\.jpg$/i, '');
            }

            // Extract winrate text and convert to a numeric value (0.0 to 1.0)
            const winrateText = winrateCell.text().trim();
            let winrateValue = null;
            if (winrateText) {
                const parsedRate = parseFloat(winrateText.replace('%', ''));
                if (!isNaN(parsedRate)) {
                    winrateValue = parsedRate / 100.0;
                }
            }

            // Add hero to list if all critical data points are present
            if (internalName && displayName && winrateValue !== null && windrunId) {
                heroes.push({
                    name: internalName,
                    displayName: displayName,
                    winrate: winrateValue,
                    windrunId: windrunId // Store the extracted Windrun ID
                });
            } else {
                console.warn(`[Hero Scraper] Skipping hero row ${index + 1}: Could not extract all required data. (InternalName: ${internalName}, DisplayName: ${displayName}, WinrateText: "${winrateText}", WindrunID: ${windrunId})`);
            }
        });

        if (heroes.length === 0) {
            throw new Error('Extracted 0 valid heroes after parsing. Check selectors or page content.');
        }

        statusCallback(`Extracted ${heroes.length} heroes. Updating database...`);
        console.log(`[Hero Scraper] Attempting to update ${heroes.length} heroes in the database.`);

        db = new Database(dbPath);
        db.pragma('journal_mode = WAL'); // Recommended for better performance and concurrency

        // Prepared statement for inserting or updating hero data
        // ON CONFLICT clause handles cases where a hero already exists, updating their details.
        const insertStmt = db.prepare(`
            INSERT INTO Heroes (name, display_name, winrate, windrun_id)
            VALUES (@name, @displayName, @winrate, @windrunId)
            ON CONFLICT(name) DO UPDATE SET
                display_name = excluded.display_name,
                winrate = excluded.winrate,
                windrun_id = excluded.windrun_id;
        `);

        // Use a transaction for batch inserting/updating for better performance.
        const insertTransaction = db.transaction((heroData) => {
            let processedCount = 0;
            for (const hero of heroData) {
                const info = insertStmt.run(hero);
                if (info.changes > 0) processedCount++;
            }
            return processedCount;
        });

        const processedCount = insertTransaction(heroes);
        console.log(`[Hero Scraper] Database transaction complete. Processed ${processedCount} heroes.`);
        statusCallback(`Database update successful. Processed ${processedCount} heroes.`);

    } catch (error) {
        console.error('[Hero Scraper] Error during hero scraping or database update:', error);
        let userMessage = `Error updating hero data: ${error.message}`;
        if (error.code === 'ECONNABORTED' || (error.response && error.response.status === 524)) { // Axios timeout or Cloudflare timeout
            userMessage = 'Error fetching hero data: The request to the data source timed out. Please try again later.';
        } else if (error.message.includes('No hero data rows found') || error.message.includes('Extracted 0 valid heroes')) {
            userMessage = 'Error fetching hero data: Could not parse data from the source. The website structure might have changed.';
        }
        statusCallback(userMessage);
        throw error; // Rethrow to be caught by the caller (e.g., IPC handler in main.js)
    } finally {
        if (db && db.open) {
            db.close();
            console.log('[Hero Scraper] Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreHeroes };