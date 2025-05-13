const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');

/**
 * Scrapes hero data from windrun.io and stores it in the database.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} url - The URL to scrape (e.g., 'https://windrun.io/heroes').
 * @param {function(string): void} statusCallback - Function to send status updates.
 */
async function scrapeAndStoreHeroes(dbPath, url, statusCallback) {
    let db; // Define db connection variable outside try block

    try {
        statusCallback('Fetching hero data from windrun.io...');
        const { data: html } = await axios.get(url, {
            headers: { // Add headers to mimic a browser request slightly
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        statusCallback('Parsing HTML data...');
        const $ = cheerio.load(html);
        const heroes = [];
        const rows = $('tbody tr'); // Select all table rows in the tbody

        if (rows.length === 0) {
            throw new Error('No hero data rows found on the page. DOM structure might have changed.');
        }

        statusCallback(`Found ${rows.length} hero rows. Extracting data...`);

        rows.each((index, element) => {
            const row = $(element);
            const heroImg = row.find('td.hero-picture img');
            const winrateCell = row.find('td.color-range').first(); // Get the first cell with this class

            // Extract hero name from image src (e.g., .../nevermore_full.png -> nevermore)
            const imgSrc = heroImg.attr('src');
            let heroName = null;
            if (imgSrc) {
                 // Get the filename, remove extension, handle potential variations
                 const filename = imgSrc.split('/').pop(); // e.g., nevermore_full.png
                 heroName = filename.replace(/_full\.png$|_vert\.jpg$/i, ''); // Remove common suffixes
            }


            // Extract winrate text and convert to number
            const winrateText = winrateCell.text().trim(); // e.g., "61.52%"
            let winrateValue = null;
            if (winrateText) {
                const parsedRate = parseFloat(winrateText.replace('%', ''));
                if (!isNaN(parsedRate)) {
                    winrateValue = parsedRate / 100.0; // Store as decimal (e.g., 0.6152)
                }
            }

            // Only add if we got valid data
            if (heroName && winrateValue !== null) {
                heroes.push({ name: heroName, winrate: winrateValue });
            } else {
                console.warn(`Skipping row ${index + 1}: Could not extract valid data (Name: ${heroName}, Winrate Text: ${winrateText})`);
            }
        });

        if (heroes.length === 0) {
             throw new Error('Extracted 0 valid heroes. Check selectors or page content.');
        }

        statusCallback(`Extracted ${heroes.length} heroes. Updating database...`);

        // --- Database Update ---
        db = new Database(dbPath); // Open connection
        // Enable WAL mode for potentially better write performance/concurrency, although less critical here
        db.pragma('journal_mode = WAL');

        // Prepare statement for inserting or updating
        const insertStmt = db.prepare(`
            INSERT INTO Heroes (name, winrate)
            VALUES (@name, @winrate)
            ON CONFLICT(name) DO UPDATE SET
                winrate = excluded.winrate
        `);

        // Use a transaction for bulk insert/update
        const insertTransaction = db.transaction((heroData) => {
            for (const hero of heroData) {
                insertStmt.run(hero);
            }
            return heroData.length;
        });

        const processedCount = insertTransaction(heroes);
        statusCallback(`Database update successful. Processed ${processedCount} heroes.`);
        // --- End Database Update ---

    } catch (error) {
        console.error('Error during scraping or database update:', error);
        // Rethrow to be caught by the IPC handler in main.js
        throw new Error(`Scraping failed: ${error.message}`);
    } finally {
        // Always ensure the database connection is closed
        if (db) {
            db.close();
            console.log('Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreHeroes };