const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');

const AXIOS_TIMEOUT = 30000;

// General parser for non-percentage numeric values (like avg_pick_order)
function parseNumericValue(text) {
    if (!text) return null;
    const cleanedText = text.trim().replace(/[^0-9.-]+/g, ''); // Keep digits, dot, and minus
    const parsedValue = parseFloat(cleanedText);
    return !isNaN(parsedValue) ? parsedValue : null;
}

// Specific parser for percentage values (like winrate, value_percentage)
function parsePercentageValue(text) {
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

    for (let i = parts.length - 1; i >= 1; i--) {
        const potentialHeroName = parts.slice(0, i).join('_');
        if (heroNameToIdMap.has(potentialHeroName)) {
            return heroNameToIdMap.get(potentialHeroName);
        }
        // Handle special cases like 'sand_king' if parts were 'sand', 'king', 'ability_suffix'
        if (i > 1) {
            const twoPartName = parts.slice(0, i - 1).join('_') + '_' + parts[i - 1];
            if (heroNameToIdMap.has(twoPartName)) {
                return heroNameToIdMap.get(twoPartName);
            }
        }
    }
    // Special case for sand_king which might appear as sandking_burrowstrike
    if (abilityName.startsWith("sandking_")) {
        return heroNameToIdMap.get('sand_king');
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
            statusCallback(heroNameToIdMap.size > 0 ? `Loaded ${heroNameToIdMap.size} heroes into map.` : 'Warning: Heroes table is empty. Ability to hero linking will be impaired.');
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

        if (rowsRegular.length === 0) throw new Error('No regular ability data rows found on windrun.io/abilities. DOM structure might have changed.');
        statusCallback(`Found ${rowsRegular.length} regular ability rows. Extracting...`);

        rowsRegular.each((index, element) => {
            const row = $regular(element);
            const imgElement = row.find('td.abil-picture img');
            const { name: abilityName } = extractAbilityName(imgElement);

            const displayNameElement = row.find('td').eq(1).find('a'); // Second td for display name
            const displayName = displayNameElement.text().trim() || null;

            // Winrate is the 2nd 'td.color-range' (index 1)
            const winrateCell = row.find('td.color-range').eq(1);
            const regularWinrate = parsePercentageValue(winrateCell.text());

            // Avg Pick Order is the 3rd 'td.color-range' (index 2)
            const avgPickOrderCell = row.find('td.color-range').eq(2);
            const avgPickOrder = parseNumericValue(avgPickOrderCell.text());

            // Value is the 4th 'td.color-range' (index 3)
            const valueCell = row.find('td.color-range').eq(3);
            const valuePercentage = parsePercentageValue(valueCell.text());


            if (abilityName) {
                const heroId = findHeroIdForAbility(abilityName, heroNameToIdMap);
                abilityDataMap.set(abilityName, {
                    name: abilityName,
                    display_name: displayName,
                    hero_id: heroId,
                    winrate: regularWinrate,
                    avg_pick_order: avgPickOrder,
                    value_percentage: valuePercentage,
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

        if (rowsHighSkill.length === 0) throw new Error('No high-skill ability data rows found on windrun.io/ability-high-skill. DOM structure might have changed.');
        statusCallback(`Found ${rowsHighSkill.length} high-skill ability rows. Merging...`);

        rowsHighSkill.each((index, element) => {
            const row = $highSkill(element);
            const imgElement = row.find('td.abil-picture img');
            const { name: abilityName } = extractAbilityName(imgElement);

            // High skill winrate is the 2nd 'td.color-range' (index 1) in high-skill page
            const highSkillWinrateCell = row.find('td.color-range').eq(1);
            const highSkillWinrate = parsePercentageValue(highSkillWinrateCell.text());


            if (abilityName) {
                const existingData = abilityDataMap.get(abilityName);
                if (existingData) {
                    existingData.high_skill_winrate = highSkillWinrate;
                    // If display_name was somehow missed in regular scrape but available here (unlikely but safe)
                    if (!existingData.display_name) {
                        const displayNameElementHS = row.find('td').eq(1).find('a');
                        existingData.display_name = displayNameElementHS.text().trim() || existingData.display_name;
                    }
                } else {
                    // This case should be rare if regular scrape is comprehensive
                    console.warn(`Ability "${abilityName}" found in high-skill data but not in regular data. Adding with partial info.`);
                    const displayNameElementHS = row.find('td').eq(1).find('a');
                    const displayNameHS = displayNameElementHS.text().trim() || null;
                    const heroId = findHeroIdForAbility(abilityName, heroNameToIdMap);
                    abilityDataMap.set(abilityName, {
                        name: abilityName,
                        display_name: displayNameHS,
                        hero_id: heroId,
                        winrate: null,
                        avg_pick_order: null,
                        value_percentage: null,
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
            throw new Error('Merged data resulted in 0 valid abilities. Check scraping logic or website structure.');
        }
        statusCallback(`Merged data for ${finalAbilityList.length} abilities. Updating database...`);

        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');

        const insertStmt = db.prepare(`
            INSERT INTO Abilities (name, display_name, hero_id, winrate, high_skill_winrate, avg_pick_order, value_percentage, is_ultimate, ability_order)
            VALUES (@name, @display_name, @hero_id, @winrate, @high_skill_winrate, @avg_pick_order, @value_percentage, @is_ultimate, @ability_order)
            ON CONFLICT(name) DO UPDATE SET
                display_name = excluded.display_name,
                hero_id = excluded.hero_id,
                winrate = excluded.winrate,
                high_skill_winrate = excluded.high_skill_winrate,
                avg_pick_order = excluded.avg_pick_order,
                value_percentage = excluded.value_percentage,
                is_ultimate = excluded.is_ultimate,          -- Consider how these are updated if not scraped yet
                ability_order = excluded.ability_order      -- Consider how these are updated if not scraped yet
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
                    avg_pick_order: ability.avg_pick_order,
                    value_percentage: ability.value_percentage,
                    is_ultimate: ability.is_ultimate,
                    ability_order: ability.ability_order,
                });
                if (info.changes > 0) count++;
            }
            return count;
        });

        const processedDbCount = insertTransaction(finalAbilityList);
        statusCallback(`Database update successful. Processed ${processedDbCount} abilities.`);

    } catch (error) {
        console.error('Error during ability scraping or database update:', error);
        statusCallback(`Ability scraping failed: ${error.message}. Check console for details.`);
        throw error;
    } finally {
        if (db && db.open) {
            db.close();
            console.log('[AbilityScraper] Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreAbilities };