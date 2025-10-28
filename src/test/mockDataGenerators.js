/**
 * @file Mock data generators for testing
 * Provides utilities to generate realistic test data for abilities, heroes, scans, etc.
 */

const path = require('path');
const fs = require('fs');

/**
 * Sample ability names for mock data
 */
const SAMPLE_ABILITIES = [
    'Blink',
    'Ravage',
    'Black Hole',
    'Chronosphere',
    'Fiend\'s Grip',
    'Spell Steal',
    'Finger of Death',
    'Shockwave',
    'Dragon Slave',
    'Magic Missile',
    'Frostbite',
    'Laguna Blade',
    'Shadow Fiend Presence',
    'Metamorphosis',
    'Chemical Rage',
    'Blur',
    'Take Aim',
    'Arctic Burn',
    'Flesh Heap',
    'Kraken Shell',
    'Juggernaut Critical Strike',
    'Phantom Assassin Critical Strike',
    'Essence Shift',
    'Marksmanship',
    'Split Shot',
    'Moon Glaives',
    'Multicast',
    'Double Edge',
    'God\'s Strength',
    'Grow',
    'Greater Bash',
    'Overpower',
    'Mirror Image',
    'Shadow Dance',
    'Borrowed Time',
    'Reincarnation',
    'Time Lock',
    'Enchant Totem',
    'Walrus Punch',
    'Omnislash',
    'Sleight of Fist',
    'Blade Fury',
    'Counter Helix',
    'Berserker\'s Call',
    'Battle Hunger',
    'Culling Blade'
];

/**
 * Sample hero names for mock data
 */
const SAMPLE_HEROES = [
    'Anti-Mage',
    'Axe',
    'Crystal Maiden',
    'Drow Ranger',
    'Earthshaker',
    'Juggernaut',
    'Mirana',
    'Shadow Fiend',
    'Phantom Assassin',
    'Pudge',
    'Invoker',
    'Faceless Void',
    'Zeus',
    'Tinker',
    'Sniper',
    'Nature\'s Prophet',
    'Lifestealer',
    'Witch Doctor',
    'Lina',
    'Lion',
    'Shadow Shaman',
    'Slardar',
    'Tidehunter',
    'Wraith King',
    'Enigma'
];

/**
 * Generate a random integer between min and max (inclusive)
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Random integer
 */
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a random float between min and max
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {number} decimals - Number of decimal places
 * @returns {number} Random float
 */
function randomFloat(min, max, decimals = 2) {
    const value = Math.random() * (max - min) + min;
    return parseFloat(value.toFixed(decimals));
}

/**
 * Pick random element from array
 * @param {Array} array - Array to pick from
 * @returns {*} Random element
 */
function randomPick(array) {
    return array[randomInt(0, array.length - 1)];
}

/**
 * Pick multiple random elements from array (without duplicates)
 * @param {Array} array - Array to pick from
 * @param {number} count - Number of elements to pick
 * @returns {Array} Random elements
 */
function randomPickMultiple(array, count) {
    const shuffled = [...array].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, array.length));
}

/**
 * Generate mock ability data
 * @param {object} options - Options
 * @param {string} options.name - Ability name (optional, random if not provided)
 * @param {number} options.id - Ability ID (optional, random if not provided)
 * @returns {object} Mock ability
 */
function generateAbility(options = {}) {
    const name = options.name || randomPick(SAMPLE_ABILITIES);
    const id = options.id || randomInt(1, 500);

    return {
        id,
        name,
        winrate: randomFloat(45, 55, 2),
        pickrate: randomFloat(5, 25, 2),
        avg_pick_order: randomFloat(1, 50, 2),
        games: randomInt(1000, 50000),
        wins: randomInt(500, 25000),
        hero_name: randomPick(SAMPLE_HEROES),
        is_ultimate: Math.random() > 0.7
    };
}

/**
 * Generate array of mock abilities
 * @param {number} count - Number of abilities to generate
 * @param {object} options - Options for each ability
 * @returns {Array} Array of mock abilities
 */
function generateAbilities(count, options = {}) {
    const abilities = [];
    const usedNames = new Set();

    for (let i = 0; i < count; i++) {
        let ability;
        let attempts = 0;

        // Ensure unique ability names
        do {
            ability = generateAbility({ ...options, id: i + 1 });
            attempts++;
        } while (usedNames.has(ability.name) && attempts < 100);

        usedNames.add(ability.name);
        abilities.push(ability);
    }

    return abilities;
}

/**
 * Generate mock hero data
 * @param {object} options - Options
 * @param {string} options.name - Hero name (optional)
 * @param {number} options.id - Hero ID (optional)
 * @returns {object} Mock hero
 */
function generateHero(options = {}) {
    const name = options.name || randomPick(SAMPLE_HEROES);
    const id = options.id || randomInt(1, 150);

    return {
        id,
        name,
        primary_attribute: randomPick(['str', 'agi', 'int']),
        attack_type: randomPick(['melee', 'ranged']),
        roles: randomPickMultiple(['Carry', 'Support', 'Nuker', 'Disabler', 'Initiator', 'Durable'], randomInt(1, 3))
    };
}

/**
 * Generate mock scan result
 * @param {object} options - Options
 * @param {boolean} options.isInitialScan - Whether this is an initial scan
 * @param {number} options.abilityCount - Number of abilities detected
 * @returns {object} Mock scan result
 */
function generateScanResult(options = {}) {
    const isInitialScan = options.isInitialScan !== false;
    const abilityCount = options.abilityCount || randomInt(10, 20);

    const abilities = generateAbilities(abilityCount);

    const result = {
        status: 'success',
        isInitialScan,
        timestamp: Date.now(),
        results: {
            detected_abilities: abilities.map((ability, index) => ({
                name: ability.name,
                confidence: randomFloat(0.85, 0.99, 3),
                position: {
                    x: randomInt(100, 1800),
                    y: randomInt(100, 900),
                    width: randomInt(80, 120),
                    height: randomInt(80, 120)
                },
                grid_position: {
                    row: Math.floor(index / 5),
                    col: index % 5
                }
            })),
            scan_duration: randomInt(1000, 5000),
            resolution: '1920x1080',
            model_info: {
                version: '1.0.0',
                confidence_threshold: 0.9
            }
        }
    };

    if (isInitialScan) {
        result.results.hero_models = randomPickMultiple(SAMPLE_HEROES, 10).map((heroName, index) => ({
            name: heroName,
            position: index,
            confidence: randomFloat(0.9, 0.99, 3)
        }));
    }

    return result;
}

/**
 * Generate mock ability pair data
 * @param {string} ability1 - First ability name
 * @param {string} ability2 - Second ability name
 * @returns {object} Mock ability pair
 */
function generateAbilityPair(ability1, ability2) {
    return {
        ability1_name: ability1,
        ability2_name: ability2,
        winrate: randomFloat(45, 55, 2),
        games: randomInt(100, 5000),
        synergy_score: randomFloat(-5, 15, 2)
    };
}

/**
 * Generate mock prediction results
 * @param {Array} selectedAbilities - Array of already selected ability names
 * @param {number} suggestionCount - Number of suggestions to generate
 * @returns {object} Mock prediction results
 */
function generatePredictionResults(selectedAbilities = [], suggestionCount = 10) {
    const availableAbilities = SAMPLE_ABILITIES.filter(
        (name) => !selectedAbilities.includes(name)
    );

    const suggestions = randomPickMultiple(availableAbilities, suggestionCount).map(
        (abilityName) => ({
            name: abilityName,
            score: randomFloat(0.5, 1.0, 4),
            winrate: randomFloat(45, 55, 2),
            pickrate: randomFloat(5, 25, 2),
            avg_pick_order: randomFloat(1, 50, 2),
            synergies: selectedAbilities.slice(0, 3).map((selected) => ({
                with_ability: selected,
                synergy_score: randomFloat(-5, 15, 2)
            }))
        })
    );

    return {
        success: true,
        suggestions: suggestions.sort((a, b) => b.score - a.score),
        based_on_abilities: selectedAbilities,
        timestamp: Date.now()
    };
}

/**
 * Generate mock screenshot data URL
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {string} color - Fill color (hex)
 * @returns {string} Data URL
 */
function generateMockScreenshot(width = 1920, height = 1080, color = '#1a1a2e') {
    // Generate a simple SVG as mock screenshot
    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${color}"/>
        <text x="50%" y="50%" font-family="Arial" font-size="48" fill="white" text-anchor="middle">
            Mock Screenshot ${width}x${height}
        </text>
        <text x="50%" y="60%" font-family="Arial" font-size="24" fill="gray" text-anchor="middle">
            Generated at ${new Date().toISOString()}
        </text>
    </svg>`;

    const base64 = Buffer.from(svg).toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
}

/**
 * Generate mock database query result
 * @param {string} queryType - Type of query (abilities, heroes, pairs, etc.)
 * @param {number} count - Number of results
 * @returns {Array} Mock query results
 */
function generateQueryResults(queryType, count = 10) {
    switch (queryType) {
        case 'abilities':
            return generateAbilities(count);
        case 'heroes':
            return Array.from({ length: count }, (_, i) => generateHero({ id: i + 1 }));
        case 'pairs':
            const abilities = randomPickMultiple(SAMPLE_ABILITIES, count * 2);
            return Array.from({ length: count }, (_, i) =>
                generateAbilityPair(abilities[i * 2], abilities[i * 2 + 1])
            );
        default:
            return [];
    }
}

/**
 * Generate mock IPC event
 * @param {string} channel - IPC channel name
 * @param {*} data - Event data
 * @returns {object} Mock IPC event
 */
function generateMockIPCEvent(channel, data) {
    return {
        sender: {
            send: (eventChannel, eventData) => {
                console.log(`[Mock IPC] ${eventChannel}:`, eventData);
            },
            isDestroyed: () => false
        },
        channel,
        data,
        returnValue: null
    };
}

/**
 * Generate mock layout coordinates configuration
 * @param {string} resolution - Resolution string (e.g., '1920x1080')
 * @returns {object} Mock layout coordinates
 */
function generateLayoutCoordinates(resolution = '1920x1080') {
    const [width, height] = resolution.split('x').map(Number);

    return {
        resolution,
        ability_grid: {
            top_left_x: Math.floor(width * 0.1),
            top_left_y: Math.floor(height * 0.2),
            cell_width: 100,
            cell_height: 100,
            gap_x: 10,
            gap_y: 10,
            rows: 4,
            cols: 5
        },
        hero_models: {
            top_y: Math.floor(height * 0.1),
            model_width: 80,
            model_height: 100,
            gap: 15,
            start_x: Math.floor(width * 0.2)
        },
        my_selection_indicator: {
            width: 200,
            height: 50,
            y: Math.floor(height * 0.15)
        }
    };
}

/**
 * Save mock data to file
 * @param {string} filename - Output filename
 * @param {*} data - Data to save
 * @param {boolean} pretty - Pretty print JSON
 */
function saveMockData(filename, data, pretty = true) {
    const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    fs.writeFileSync(filename, json, 'utf8');
    console.log(`Mock data saved to: ${filename}`);
}

/**
 * Load mock data from file
 * @param {string} filename - Input filename
 * @returns {*} Loaded data
 */
function loadMockData(filename) {
    const json = fs.readFileSync(filename, 'utf8');
    return JSON.parse(json);
}

module.exports = {
    // Random utilities
    randomInt,
    randomFloat,
    randomPick,
    randomPickMultiple,

    // Data generators
    generateAbility,
    generateAbilities,
    generateHero,
    generateScanResult,
    generateAbilityPair,
    generatePredictionResults,
    generateMockScreenshot,
    generateQueryResults,
    generateMockIPCEvent,
    generateLayoutCoordinates,

    // File I/O
    saveMockData,
    loadMockData,

    // Sample data
    SAMPLE_ABILITIES,
    SAMPLE_HEROES
};
