const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');

const AXIOS_TIMEOUT = 15000;

function parseWinrate(text) {
    if (!text) return null;
    const cleanedText = text.trim().replace('%', '');
    const parsedRate = parseFloat(cleanedText);
    return !isNaN(parsedRate) ? parsedRate / 100.0 : null;
}

function extractAbilityName(imgElement) {
    if (!imgElement || imgElement.length === 0) return { name: null };
    const imgSrc = imgElement.attr('src');
    if (!imgSrc) return { name: null };

    const filename = imgSrc.split('/').pop();
    const name = filename?.replace(/\.png$/i, '');
    return { name: name || null };
}

function findHeroIdForAbility(abilityName, heroNameToIdMap) {
    if (!abilityName || !heroNameToIdMap) return null;
    const parts = abilityName.split('_');
    if (parts.length < 2) return null;

    for (let i = 1; i < parts.length; i++) {
        const potentialHeroName = parts.slice(0, i).join('_');
        if (potentialHeroName == 'sandking') {
            const adaptedName = 'sand_king'
            return heroNameToIdMap.get(adaptedName);
        }
        if (heroNameToIdMap.has(potentialHeroName)) {
            return heroNameToIdMap.get(potentialHeroName);
        }
    }
    return null;
}

async function scrapeAndStoreAbilities(dbPath, urlRegular, urlHighSkill, statusCallback) {
    let db;
    const abilityDataMap = new Map();
    let heroNameToIdMap = new Map();

    try {
        statusCallback('Fetching hero IDs from database...');
        db = new Database(dbPath, { readonly: true });
        try {
            const heroes = db.prepare('SELECT hero_id, name FROM Heroes').all();
            heroNameToIdMap = new Map(heroes.map(h => [h.name, h.hero_id]));
            statusCallback(heroNameToIdMap.size > 0 ? `Loaded ${heroNameToIdMap.size} heroes into map.` : 'Warning: Heroes table is empty.');
        } catch (err) {
            statusCallback(`Warning: Failed to load heroes - ${err.message}.`);
        } finally {
            if (db && db.open) db.close();
        }

        statusCallback(`Workspaceing regular ability data from ${urlRegular}...`);
        const { data: htmlRegular } = await axios.get(urlRegular, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: AXIOS_TIMEOUT });
        statusCallback('Parsing regular ability HTML...');
        const $regular = cheerio.load(htmlRegular);
        const rowsRegular = $regular('tbody tr');

        if (rowsRegular.length === 0) throw new Error('No regular ability data rows found.');
        statusCallback(`Found ${rowsRegular.length} regular ability rows. Extracting...`);

        rowsRegular.each((index, element) => {
            const row = $regular(element);
            const imgElement = row.find('td.abil-picture img');
            const { name: abilityName } = extractAbilityName(imgElement);

            const displayNameElement = row.find('td').eq(1).find('a');
            const displayName = displayNameElement.text().trim() || null;

            const winrateCell = row.find('td.color-range').eq(1);
            const regularWinrate = parseWinrate(winrateCell.text());

            if (abilityName) {
                const heroId = findHeroIdForAbility(abilityName, heroNameToIdMap);
                abilityDataMap.set(abilityName, {
                    name: abilityName,
                    display_name: displayName,
                    hero_id: heroId,
                    winrate: regularWinrate,
                    high_skill_winrate: null,
                    is_ultimate: null,
                    ability_order: null
                });
            } else {
                console.warn(`Skipping regular row ${index + 1}: Could not extract valid ability name.`);
            }
        });
        statusCallback(`Processed ${abilityDataMap.size} abilities from regular data.`);

        statusCallback(`Workspaceing high-skill ability data from ${urlHighSkill}...`);
        const { data: htmlHighSkill } = await axios.get(urlHighSkill, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: AXIOS_TIMEOUT });
        statusCallback('Parsing high-skill ability HTML...');
        const $highSkill = cheerio.load(htmlHighSkill);
        const rowsHighSkill = $highSkill('tbody tr');

        if (rowsHighSkill.length === 0) throw new Error('No high-skill ability data rows found.');
        statusCallback(`Found ${rowsHighSkill.length} high-skill ability rows. Merging...`);

        rowsHighSkill.each((index, element) => {
            const row = $highSkill(element);
            const imgElement = row.find('td.abil-picture img');
            const { name: abilityName } = extractAbilityName(imgElement);

            const displayNameElement = row.find('td').eq(1).find('a');
            const displayName = displayNameElement.text().trim() || null;

            const winrateCell = row.find('td.color-range').eq(1);
            const highSkillWinrate = parseWinrate(winrateCell.text());

            if (abilityName) {
                const existingData = abilityDataMap.get(abilityName);
                if (existingData) {
                    existingData.high_skill_winrate = highSkillWinrate;
                    if (!existingData.display_name && displayName) { // If display_name wasn't set from regular data
                        existingData.display_name = displayName;
                    }
                } else {
                    console.warn(`Ability "${abilityName}" found in high-skill data but not regular. Adding.`);
                    const heroId = findHeroIdForAbility(abilityName, heroNameToIdMap);
                    abilityDataMap.set(abilityName, {
                        name: abilityName,
                        display_name: displayName,
                        hero_id: heroId,
                        winrate: null,
                        high_skill_winrate: highSkillWinrate,
                        is_ultimate: null,
                        ability_order: null
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
        statusCallback(`Merged data for ${finalAbilityList.length} abilities.`);

        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');

        const insertStmt = db.prepare(`
            INSERT INTO Abilities (name, display_name, hero_id, winrate, high_skill_winrate, is_ultimate, ability_order)
            VALUES (@name, @display_name, @hero_id, @winrate, @high_skill_winrate, @is_ultimate, @ability_order)
            ON CONFLICT(name) DO UPDATE SET
                display_name = excluded.display_name, -- <<< ADDED display_name
                hero_id = excluded.hero_id,
                winrate = excluded.winrate,
                high_skill_winrate = excluded.high_skill_winrate,
                is_ultimate = excluded.is_ultimate,
                ability_order = excluded.ability_order
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
                    display_name: ability.display_name,
                    hero_id: ability.hero_id,
                    winrate: ability.winrate,
                    high_skill_winrate: ability.high_skill_winrate,
                    is_ultimate: null,
                    ability_order: null,
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