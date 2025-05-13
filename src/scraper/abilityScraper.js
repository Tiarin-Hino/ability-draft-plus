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
 * Scrapes ability data and stores it, including icons.
 * @param {string} dbPath - Path to the SQLite database file.
 * @param {string} iconsDownloadPath - Path to the directory where icons should be saved.
 * @param {string} urlRegular - The URL for regular ability winrates.
 * @param {string} urlHighSkill - The URL for high-skill ability winrates.
 * @param {function(string): void} statusCallback - Function to send status updates.
 */
async function scrapeAndStoreAbilities(dbPath, iconsDownloadPath, urlRegular, urlHighSkill, statusCallback) {
    let db;
    const abilityDataMap = new Map();
    let heroNameToIdMap = new Map();

    try {
        statusCallback('Fetching hero IDs from database...');
        db = new Database(dbPath, { readonly: true }); // Uses dbPath parameter
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
        } finally {
            if (db && db.open) db.close();
        }

        statusCallback('Checking/creating icon directory...');
        await fs.mkdir(iconsDownloadPath, { recursive: true }); // MODIFIED: Use iconsDownloadPath

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
            const winrateCell = row.find('td.color-range').eq(1);
            const regularWinrate = parseWinrate(winrateCell.text());

            if (abilityName) {
                const heroId = findHeroIdForAbility(abilityName, heroNameToIdMap);
                abilityDataMap.set(abilityName, {
                    name: abilityName,
                    hero_id: heroId,
                    winrate: regularWinrate,
                    high_skill_winrate: null,
                    icon_url: iconUrl,
                    icon_filename: iconFilename
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
            const { name: abilityName, url: iconUrl, filename: iconFilename } = extractAbilityNameAndIcon(imgElement);
            const winrateCell = row.find('td.color-range').eq(1);
            const highSkillWinrate = parseWinrate(winrateCell.text());

            if (abilityName) {
                const existingData = abilityDataMap.get(abilityName);
                if (existingData) {
                    existingData.high_skill_winrate = highSkillWinrate;
                } else {
                    console.warn(`Ability "${abilityName}" found in high-skill data but not regular. Adding.`);
                    const heroId = findHeroIdForAbility(abilityName, heroNameToIdMap);
                    abilityDataMap.set(abilityName, {
                        name: abilityName,
                        hero_id: heroId,
                        winrate: null,
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
                const iconPath = path.join(iconsDownloadPath, ability.icon_filename); // MODIFIED: Use iconsDownloadPath
                try {
                    const response = await axios.get(ability.icon_url, { responseType: 'arraybuffer' });
                    const resizedBuffer = await sharp(response.data)
                        .resize(ICON_TARGET_SIZE, ICON_TARGET_SIZE)
                        .png()
                        .toBuffer();
                    await fs.writeFile(iconPath, resizedBuffer);
                    processedIconCount++;
                    if (processedIconCount % 50 === 0) {
                        statusCallback(`Processed <span class="math-inline">\{processedIconCount\}/</span>{finalAbilityList.length} icons...`);
                    }
                } catch (error) {
                    if (error.response) { console.error(`Failed to download icon ${ability.icon_filename}: ${error.response.status}`); }
                    else if (error.code === 'ERR_INVALID_ARG_TYPE') { console.error(`Failed to process/resize icon ${ability.icon_filename}: Invalid image data.`); }
                    else { console.error(`Failed processing icon ${ability.icon_filename}: ${error.message}`); }
                    ability.icon_filename = null;
                }
            } else {
                ability.icon_filename = null;
            }
        }
        statusCallback(`Icon processing complete. Processed ${processedIconCount} icons. Updating database...`);
        // --- End Download Icons Section ---

        // --- Database Update ---
        db = new Database(dbPath); // Re-open connection for writing, uses dbPath parameter
        db.pragma('journal_mode = WAL');

        const insertStmt = db.prepare(`
           INSERT INTO Abilities (name, hero_id, winrate, high_skill_winrate, icon_filename)
           VALUES (@name, @hero_id, @winrate, @high_skill_winrate, @icon_filename)
           ON CONFLICT(name) DO UPDATE SET
               hero_id = excluded.hero_id,
               winrate = excluded.winrate,
               high_skill_winrate = excluded.high_skill_winrate,
               icon_filename = excluded.icon_filename
       `);

        const insertTransaction = db.transaction((abilityData) => {
            let count = 0;
            for (const ability of abilityData) {
                if (!ability.name) {
                    console.warn('Skipping database insert for ability with no name.');
                    continue;
                }
                const info = insertStmt.run({
                    name: ability.name,
                    hero_id: ability.hero_id,
                    winrate: ability.winrate,
                    high_skill_winrate: ability.high_skill_winrate,
                    icon_filename: ability.icon_filename
                });
                if (info.changes > 0) count++;
            }
            return count;
        });

        const processedDbCount = insertTransaction(finalAbilityList);
        statusCallback(`Database update successful. Processed ${processedDbCount} abilities.`);

    } catch (error) {
        console.error('Error during ability scraping or database update:', error);
        throw new Error(`Ability scraping failed: ${error.message}`);
    } finally {
        if (db && db.open) {
            db.close();
            console.log('Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreAbilities };