// src/scraper/abilityScraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');
const fs = require('fs').promises; // Use promises version of file system module
const path = require('path');
const sharp = require('sharp')

// Define the target size for icons
const ICON_TARGET_SIZE = 64;

// Helper function to parse winrate percentage text
function parseWinrate(text) {
    if (!text) return null;
    const cleanedText = text.trim().replace('%', '');
    const parsedRate = parseFloat(cleanedText);
    return !isNaN(parsedRate) ? parsedRate / 100.0 : null;
}

function extractAbilityNameAndIcon(imgElement) {
    if (!imgElement || imgElement.length === 0) return { name: null, url: null, filename: null };
    const imgSrc = imgElement.attr('src');
    if (!imgSrc) return { name: null, url: null, filename: null };

    const filename = imgSrc.split('/').pop(); // e.g., alchemist_chemical_rage.png
    const name = filename?.replace(/\.png$/i, ''); // Remove .png suffix
    return { name: name || null, url: imgSrc, filename: filename || null };
}

const ICONS_DIR = path.resolve(__dirname, '../../ability_icons');

/**
 * Finds the hero_id for a given ability name by matching prefixes.
 * @param {string} abilityName - The ability name (e.g., "arc_warden_magnetic_field").
 * @param {Map<string, number>} heroNameToIdMap - Map of hero names to hero_ids.
 * @returns {number | null} The hero_id or null if no match found.
 */
function findHeroIdForAbility(abilityName, heroNameToIdMap) {
    if (!abilityName || !heroNameToIdMap) return null;

    const parts = abilityName.split('_');
    if (parts.length < 2) return null; // Need at least hero_ability

    for (let i = 1; i < parts.length; i++) {
        const potentialHeroName = parts.slice(0, i).join('_');
        if (heroNameToIdMap.has(potentialHeroName)) {
            return heroNameToIdMap.get(potentialHeroName);
        }
    }

    // console.warn(`Could not find matching hero for ability: ${abilityName}`);
    return null; // No hero found
}


/**
 * Scrapes ability data (regular and high-skill) from windrun.io urls
 * and stores it in the database, including hero association.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} urlRegular - The URL for regular ability winrates.
 * @param {string} urlHighSkill - The URL for high-skill ability winrates.
 * @param {function(string): void} statusCallback - Function to send status updates.
 */
async function scrapeAndStoreAbilities(dbPath, urlRegular, urlHighSkill, statusCallback) {
    let db; // Define db connection variable outside try block
    const abilityDataMap = new Map(); // Use a Map to store combined data
    let heroNameToIdMap = new Map(); // Map to store hero names -> hero_ids

    try {
        // --- Pre-fetch Hero IDs ---
        statusCallback('Fetching hero IDs from database...');
        db = new Database(dbPath, { readonly: true });
        try {
            const heroes = db.prepare('SELECT hero_id, name FROM Heroes').all();
            heroNameToIdMap = new Map(heroes.map(h => [h.name, h.hero_id]));
            if (heroNameToIdMap.size === 0) {
                 statusCallback('Warning: Heroes table is empty. Cannot associate abilities with heroes.');
            } else {
                statusCallback(`Loaded ${heroNameToIdMap.size} heroes into map.`);
            }
        } catch (err) {
            statusCallback(`Warning: Failed to load heroes - ${err.message}. Ability-hero association might fail.`);
             // Continue without hero association if loading fails
        } finally {
            if (db && db.open) db.close();
        }
        // --- End Pre-fetch Hero IDs ---


        // Ensure the icons directory exists
        statusCallback('Checking/creating icon directory...');
        await fs.mkdir(ICONS_DIR, { recursive: true });

        // --- Fetch and Parse Regular Winrates ---
        statusCallback(`Workspaceing regular ability data from ${urlRegular}...`);
        const { data: htmlRegular } = await axios.get(urlRegular, { headers: { 'User-Agent': 'Mozilla/5.0' } });

        statusCallback('Parsing regular ability HTML...');
        const $regular = cheerio.load(htmlRegular);
        const rowsRegular = $regular('tbody tr');

        if (rowsRegular.length === 0) throw new Error('No regular ability data rows found.');
        statusCallback(`Found ${rowsRegular.length} regular ability rows. Extracting...`);

        rowsRegular.each((index, element) => {
            const row = $regular(element);
            const imgElement = row.find('td.abil-picture img');
            const { name: abilityName, url: iconUrl, filename: iconFilename } = extractAbilityNameAndIcon(imgElement);
            const winrateCell = row.find('td.color-range').eq(1); // Adjust index if needed
            const regularWinrate = parseWinrate(winrateCell.text());

            if (abilityName) {
                 // *** Find Hero ID ***
                 const heroId = findHeroIdForAbility(abilityName, heroNameToIdMap);

                // Initialize entry with regular winrate, high-skill is null for now
                abilityDataMap.set(abilityName, {
                    name: abilityName,
                    hero_id: heroId, // Store found hero_id
                    winrate: regularWinrate,
                    high_skill_winrate: null, // Initialize
                    icon_url: iconUrl,       // Store URL temporarily
                    icon_filename: iconFilename // Store filename
                });
            } else {
                console.warn(`Skipping regular row ${index + 1}: Could not extract valid ability name.`);
            }
        });
        statusCallback(`Processed ${abilityDataMap.size} abilities from regular data.`);

        // --- Fetch and Parse High-Skill Winrates ---
        statusCallback(`Workspaceing high-skill ability data from ${urlHighSkill}...`);
        const { data: htmlHighSkill } = await axios.get(urlHighSkill, { headers: { 'User-Agent': 'Mozilla/5.0' } });

        statusCallback('Parsing high-skill ability HTML...');
        const $highSkill = cheerio.load(htmlHighSkill);
        const rowsHighSkill = $highSkill('tbody tr');

        if (rowsHighSkill.length === 0) throw new Error('No high-skill ability data rows found.');
        statusCallback(`Found ${rowsHighSkill.length} high-skill ability rows. Merging...`);

        rowsHighSkill.each((index, element) => {
            const row = $highSkill(element);
            const imgElement = row.find('td.abil-picture img');
            const { name: abilityName, url: iconUrl, filename: iconFilename } = extractAbilityNameAndIcon(imgElement); // Get details for potential new entries
            const winrateCell = row.find('td.color-range').eq(1); // Adjust index if needed
            const highSkillWinrate = parseWinrate(winrateCell.text());

            if (abilityName) {
                const existingData = abilityDataMap.get(abilityName);
                if (existingData) {
                    // Update the high-skill winrate for the existing entry
                    existingData.high_skill_winrate = highSkillWinrate;
                } else {
                    // Ability found in high-skill but not regular? Add it.
                    console.warn(`Ability "${abilityName}" found in high-skill data but not regular. Adding.`);
                     // *** Find Hero ID ***
                    const heroId = findHeroIdForAbility(abilityName, heroNameToIdMap);
                    abilityDataMap.set(abilityName, {
                        name: abilityName,
                        hero_id: heroId, // Store found hero_id
                        winrate: null, // No regular winrate found
                        high_skill_winrate: highSkillWinrate,
                        icon_url: iconUrl,
                        icon_filename: iconFilename
                    });
                }
            } else {
                console.warn(`Skipping high-skill row ${index + 1}: Could not extract valid ability name.`);
            }
        });

        const finalAbilityList = Array.from(abilityDataMap.values());
        if (finalAbilityList.length === 0) {
            throw new Error('Merged data resulted in 0 valid abilities.');
        }
        statusCallback(`Merged data for ${finalAbilityList.length} abilities. Processing icons...`);

        // --- Download Icons and Resize ---
        let processedIconCount = 0;
        statusCallback('Downloading and resizing icons...');
        for (const ability of finalAbilityList) {
            if (ability.icon_url && ability.icon_filename) {
                const iconPath = path.join(ICONS_DIR, ability.icon_filename);
                try {
                    const response = await axios.get(ability.icon_url, { responseType: 'arraybuffer' });
                    const resizedBuffer = await sharp(response.data)
                        .resize(ICON_TARGET_SIZE, ICON_TARGET_SIZE)
                        .png()
                        .toBuffer();
                    await fs.writeFile(iconPath, resizedBuffer);
                    processedIconCount++;
                    if (processedIconCount % 50 === 0) {
                        statusCallback(`Processed ${processedIconCount}/${finalAbilityList.length} icons...`);
                    }
                } catch (error) {
                    // Keep existing error handling, ensure icon_filename is nulled on failure
                    if (error.response) { console.error(`Failed to download icon ${ability.icon_filename}: ${error.response.status}`); }
                    else if (error.code === 'ERR_INVALID_ARG_TYPE') { console.error(`Failed to process/resize icon ${ability.icon_filename}: Invalid image data.`); }
                    else { console.error(`Failed processing icon ${ability.icon_filename}: ${error.message}`); }
                    ability.icon_filename = null; // Null filename on failure
                }
            } else {
                ability.icon_filename = null; // Ensure null if URL/filename was missing
            }
        }
        statusCallback(`Icon processing complete. Processed ${processedIconCount} icons. Updating database...`);
        // --- End Download Icons Section ---

        // --- Database Update ---
        db = new Database(dbPath); // Re-open connection for writing
        db.pragma('journal_mode = WAL'); // Optional: WAL mode

        // Prepare statement for inserting or updating, now including hero_id
        const insertStmt = db.prepare(`
            INSERT INTO Abilities (name, hero_id, winrate, high_skill_winrate, icon_filename)
            VALUES (@name, @hero_id, @winrate, @high_skill_winrate, @icon_filename)
            ON CONFLICT(name) DO UPDATE SET
                hero_id = excluded.hero_id, -- Update hero_id too
                winrate = excluded.winrate,
                high_skill_winrate = excluded.high_skill_winrate,
                icon_filename = excluded.icon_filename
        `);

        // Use a transaction for bulk insert/update
        const insertTransaction = db.transaction((abilityData) => {
            let count = 0;
            for (const ability of abilityData) {
                 if (!ability.name) { // Basic validation
                    console.warn('Skipping database insert for ability with no name.');
                    continue;
                 }
                const info = insertStmt.run({
                    name: ability.name,
                    hero_id: ability.hero_id, // Pass the found hero_id (can be null)
                    winrate: ability.winrate,
                    high_skill_winrate: ability.high_skill_winrate,
                    icon_filename: ability.icon_filename // Pass the filename (or null)
                });
                if (info.changes > 0) count++;
            }
            return count;
        });

        const processedDbCount = insertTransaction(finalAbilityList);
        statusCallback(`Database update successful. Processed ${processedDbCount} abilities.`);
        // --- End Database Update ---

    } catch (error) {
        console.error('Error during ability scraping or database update:', error);
        // Rethrow to be caught by the IPC handler in main.js
        throw new Error(`Ability scraping failed: ${error.message}`);
    } finally {
        // Always ensure the database connection is closed
        if (db && db.open) {
            db.close();
            console.log('Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreAbilities };