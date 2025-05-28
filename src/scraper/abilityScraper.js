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


function extractNameFromImg(imgElement) {
    if (!imgElement || imgElement.length === 0) return { name: null, isHero: false };
    const imgSrc = imgElement.attr('src');
    if (!imgSrc) return { name: null, isHero: false };

    const filename = imgSrc.split('/').pop();
    let name = null;
    let isHero = false;

    if (imgSrc.includes('/heroes/')) { // Check if the path indicates a hero image
        name = filename?.replace(/_full\.png$|_vert\.jpg$/i, '');
        isHero = true;
    } else if (imgSrc.includes('/abilities/')) { // Check if it's an ability image
        name = filename?.replace(/\.png$/i, '');
        isHero = false;
    } else { // Fallback for older or unknown structures, assume ability if not clearly hero
        name = filename?.replace(/\.png$/i, '');
        isHero = false;
    }
    return { name: name || null, isHero };
}


function findHeroIdForAbility(abilityName, heroNameToIdMap) {
    if (!abilityName || !heroNameToIdMap) return null;
    const parts = abilityName.split('_');
    if (parts.length < 2) return null;

    // Iterate from longest possible hero name match to shortest
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
    if (abilityName.toLowerCase().startsWith("sandking_")) {
        return heroNameToIdMap.get('sand_king');
    }

    return null;
}

async function scrapeAndStoreAbilitiesAndHeroes(dbPath, urlRegular, urlHighSkill, statusCallback) {
    let db;
    const entityDataMap = new Map();
    let heroNameToIdMap = new Map();

    try {
        statusCallback('Fetching existing hero IDs from database (if any)...');
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');

        try {
            const heroes = db.prepare('SELECT hero_id, name FROM Heroes').all();
            heroNameToIdMap = new Map(heroes.map(h => [h.name, h.hero_id]));
            statusCallback(heroNameToIdMap.size > 0 ? `Loaded ${heroNameToIdMap.size} existing heroes into map.` : 'No existing heroes found in DB.');
        } catch (err) {
            statusCallback(`Warning: Failed to load existing heroes - ${err.message}. Continuing scrape.`);
        }
        // Keep db open for inserts/updates

        statusCallback(`Workspaceing regular entity (heroes & abilities) data from ${urlRegular}...`);
        const { data: htmlRegular } = await axios.get(urlRegular, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: AXIOS_TIMEOUT });
        statusCallback('Parsing regular entity HTML...');
        const $regular = cheerio.load(htmlRegular);
        const rowsRegular = $regular('tbody tr');

        if (rowsRegular.length === 0) throw new Error('No regular entity data rows found on windrun.io/abilities. DOM structure might have changed.');
        statusCallback(`Found ${rowsRegular.length} regular entity rows. Extracting...`);

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

        const heroInsertTransaction = db.transaction((heroToInsert) => {
            const result = insertHeroStmt.get(heroToInsert); // Use .get() to get the RETURNING hero_id
            return result ? result.hero_id : null;
        });


        for (const element of rowsRegular) {
            const row = $regular(element);
            const imgElement = row.find('td.abil-picture img');
            const { name: entityName, isHero } = extractNameFromImg(imgElement);

            const displayNameElement = row.find('td').eq(1).find('a');
            const displayName = displayNameElement.text().trim() || null;
            const windrunHref = displayNameElement.attr('href');
            const windrunId = windrunHref ? windrunHref.split('/').pop() : null;

            const winrateCell = row.find('td.color-range').eq(1); // Winrate is the 2nd 'td.color-range' (index 1)
            const regularWinrate = parsePercentageValue(winrateCell.text());

            const avgPickOrderCell = row.find('td.color-range').eq(2); // Avg Pick Order is the 3rd (index 2)
            const avgPickOrder = parseNumericValue(avgPickOrderCell.text());

            const valueCell = row.find('td.color-range').eq(3); // Value is the 4th (index 3)
            const valuePercentage = parsePercentageValue(valueCell.text());

            if (entityName) {
                if (isHero) {
                    const heroEntry = {
                        name: entityName,
                        displayName: displayName,
                        winrate: regularWinrate,
                        windrunId: windrunId,
                        avg_pick_order: avgPickOrder,
                        value_percentage: valuePercentage,
                        isHero: true, // Mark as hero
                        high_skill_winrate: null // Initialize
                    };
                    entityDataMap.set(entityName, heroEntry);

                    // Insert/update hero into DB immediately and update heroNameToIdMap
                    const heroId = heroInsertTransaction(heroEntry);
                    if (heroId) {
                        heroNameToIdMap.set(entityName, heroId);
                    }

                } else { // It's an ability
                    const heroId = findHeroIdForAbility(entityName, heroNameToIdMap);
                    entityDataMap.set(entityName, {
                        name: entityName,
                        display_name: displayName,
                        hero_id: heroId,
                        winrate: regularWinrate,
                        avg_pick_order: avgPickOrder,
                        value_percentage: valuePercentage,
                        isHero: false, // Mark as ability
                        high_skill_winrate: null, // Initialize
                        is_ultimate: null, // Will be determined later if possible
                        ability_order: null // Will be determined later if possible
                    });
                }
            } else {
                console.warn(`Skipping regular row: Could not extract valid entity name.`);
            }
        }
        statusCallback(`Processed ${entityDataMap.size} entities (heroes & abilities) from regular data.`);

        statusCallback(`Workspaceing high-skill entity data from ${urlHighSkill}...`);
        const { data: htmlHighSkill } = await axios.get(urlHighSkill, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: AXIOS_TIMEOUT });
        statusCallback('Parsing high-skill entity HTML...');
        const $highSkill = cheerio.load(htmlHighSkill);
        const rowsHighSkill = $highSkill('tbody tr');

        if (rowsHighSkill.length === 0) throw new Error('No high-skill entity data rows found on windrun.io/ability-high-skill. DOM structure might have changed.');
        statusCallback(`Found ${rowsHighSkill.length} high-skill entity rows. Merging...`);

        rowsHighSkill.each((index, element) => {
            const row = $highSkill(element);
            const imgElement = row.find('td.abil-picture img');
            const { name: entityName, isHero: isHeroHS } = extractNameFromImg(imgElement); // isHeroHS might not be needed if name is key

            const highSkillWinrateCell = row.find('td.color-range').eq(1); // High skill winrate is 2nd (index 1)
            const highSkillWinrate = parsePercentageValue(highSkillWinrateCell.text());

            if (entityName) {
                const existingData = entityDataMap.get(entityName);
                if (existingData) {
                    existingData.high_skill_winrate = highSkillWinrate;
                    if (!existingData.display_name) { // Fallback for display name
                        const displayNameElementHS = row.find('td').eq(1).find('a');
                        existingData.display_name = displayNameElementHS.text().trim() || existingData.display_name;
                    }
                } else {
                    // Entity found only in high-skill, less likely for heroes but possible for abilities
                    console.warn(`Entity "${entityName}" found in high-skill data but not in regular data. Adding with partial info.`);
                    const displayNameElementHS = row.find('td').eq(1).find('a');
                    const displayNameHS = displayNameElementHS.text().trim() || null;
                    const windrunHrefHS = displayNameElementHS.attr('href');
                    const windrunIdHS = windrunHrefHS ? windrunHrefHS.split('/').pop() : null;

                    let heroIdForNewEntity = null;
                    if (!isHeroHS) { // if it's an ability, try to find its hero
                        heroIdForNewEntity = findHeroIdForAbility(entityName, heroNameToIdMap);
                    }

                    entityDataMap.set(entityName, {
                        name: entityName,
                        display_name: displayNameHS,
                        isHero: isHeroHS,
                        hero_id: isHeroHS ? null : heroIdForNewEntity, // hero_id is for abilities
                        winrate: null, // No regular winrate known
                        avg_pick_order: null, // No regular avg_pick_order
                        value_percentage: null, // No regular value_percentage
                        high_skill_winrate: highSkillWinrate,
                        // For heroes specifically:
                        windrunId: isHeroHS ? windrunIdHS : null,
                        // For abilities specifically:
                        is_ultimate: null,
                        ability_order: null
                    });
                    // If it's a hero found only in high-skill, insert/update it and map its ID
                    if (isHeroHS) {
                        const newHeroEntry = entityDataMap.get(entityName);
                        const heroId = heroInsertTransaction(newHeroEntry);
                        if (heroId) {
                            heroNameToIdMap.set(entityName, heroId);
                        }
                    }
                }
            } else {
                console.warn(`Skipping high-skill row ${index + 1}: Could not extract valid entity name.`);
            }
        });

        const finalAbilityList = [];
        const finalHeroList = []; // No longer needed as heroes are inserted on-the-fly

        entityDataMap.forEach(entity => {
            if (!entity.isHero) {
                // Ensure hero_id is up-to-date for abilities if a hero was just added
                if (!entity.hero_id && entity.name) {
                    entity.hero_id = findHeroIdForAbility(entity.name, heroNameToIdMap);
                }
                finalAbilityList.push(entity);
            }
            // Heroes have already been processed and put into DB by heroInsertTransaction
        });


        if (finalAbilityList.length === 0 && heroNameToIdMap.size === 0) { // Check if any abilities OR heroes were processed
            throw new Error('Merged data resulted in 0 valid entities. Check scraping logic or website structure.');
        }
        statusCallback(`Data merged. Updating/Inserting ${finalAbilityList.length} abilities into database...`);


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
                ability_order = excluded.ability_order
        `);

        const abilityInsertTransaction = db.transaction((abilitiesToInsert) => {
            let count = 0;
            for (const ability of abilitiesToInsert) {
                if (!ability.name) {
                    console.warn('Skipping database insert for ability with no name.');
                    continue;
                }
                const info = insertAbilityStmt.run({
                    name: ability.name,
                    display_name: ability.display_name,
                    hero_id: ability.hero_id,
                    winrate: ability.winrate,
                    high_skill_winrate: ability.high_skill_winrate,
                    avg_pick_order: ability.avg_pick_order,
                    value_percentage: ability.value_percentage,
                    is_ultimate: ability.is_ultimate, // These might remain null if not determined
                    ability_order: ability.ability_order, // These might remain null if not determined
                });
                if (info.changes > 0) count++;
            }
            return count;
        });

        const processedDbAbilitiesCount = abilityInsertTransaction(finalAbilityList);
        statusCallback(`Database update successful. Processed ${heroNameToIdMap.size} heroes and ${processedDbAbilitiesCount} abilities.`);

    } catch (error) {
        console.error('Error during entity scraping or database update:', error);
        statusCallback(`Hero/Ability scraping failed: ${error.message}. Check console for details.`);
        throw error;
    } finally {
        if (db && db.open) {
            db.close();
            console.log('[EntityScraper] Database connection closed.');
        }
    }
}

module.exports = { scrapeAndStoreAbilitiesAndHeroes }; // Renamed export