const path = require('path');
const Database = require('better-sqlite3');
const { app } = require('electron');

const dbPath = path.join(app.getPath('userData'), 'dota_ad_data.db');

const setupSql = `
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS Heroes (
        hero_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,      -- Internal name, e.g., "antimage"
        display_name TEXT,              -- Display name, e.g., "Anti-Mage"
        winrate REAL
    );

    CREATE TABLE IF NOT EXISTS Abilities (
        ability_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,      -- Internal name, e.g., "abaddon_frostmourne"
        display_name TEXT,              -- Display name, e.g., "Curse of Avernus"
        hero_id INTEGER,
        winrate REAL,
        high_skill_winrate REAL,
        pick_order REAL,                -- <<< NEW: Added pick_order column
        is_ultimate BOOL,
        ability_order INT,
        FOREIGN KEY (hero_id) REFERENCES Heroes (hero_id) ON DELETE SET NULL ON UPDATE CASCADE
    );

    CREATE TABLE IF NOT EXISTS AbilitySynergies (
        synergy_id INTEGER PRIMARY KEY AUTOINCREMENT,
        base_ability_id INTEGER NOT NULL,
        synergy_ability_id INTEGER NOT NULL,
        synergy_winrate REAL NOT NULL,
        FOREIGN KEY (base_ability_id) REFERENCES Abilities (ability_id) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (synergy_ability_id) REFERENCES Abilities (ability_id) ON DELETE CASCADE ON UPDATE CASCADE,
        UNIQUE (base_ability_id, synergy_ability_id)
    );

    CREATE INDEX IF NOT EXISTS idx_abilities_hero_id ON Abilities (hero_id);
    CREATE INDEX IF NOT EXISTS idx_synergy_base_ability ON AbilitySynergies (base_ability_id);
    CREATE INDEX IF NOT EXISTS idx_synergy_pair_ability ON AbilitySynergies (synergy_ability_id);
`;

function setupDatabase() {
    let db;
    try {
        console.log(`[setupDatabase] Using database at: ${dbPath}`);
        db = new Database(dbPath, { verbose: console.log });
        db.exec(setupSql);
        console.log('Base table setup complete or already exists.');

        const abilityColumnsToAdd = [
            { table: 'Abilities', column: 'high_skill_winrate', type: 'REAL' },
            { table: 'Abilities', column: 'hero_id', type: 'INTEGER' },
            { table: 'Abilities', column: 'is_ultimate', type: 'BOOL' },
            { table: 'Abilities', column: 'ability_order', type: 'INT' },
            { table: 'Abilities', column: 'display_name', type: 'TEXT' },
            { table: 'Abilities', column: 'pick_order', type: 'REAL' } // <<< NEW: Add pick_order here
        ];

        const heroColumnsToAdd = [
            { table: 'Heroes', column: 'display_name', type: 'TEXT' }
        ];

        const columnsToAdd = [...abilityColumnsToAdd, ...heroColumnsToAdd];

        for (const { table, column, type } of columnsToAdd) {
            try {
                db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
                console.log(`Added ${column} column to ${table} table.`);
            } catch (err) {
                if (err.message.includes('duplicate column name')) {
                    console.log(`${column} column already exists in ${table} table.`);
                } else {
                    console.error(`Error adding column ${column} to ${table}:`, err.message);
                }
            }
        }
        console.log('Database schema setup/update complete.');
    } catch (err) {
        console.error('Error setting up database:', err.message);
        throw err;
    } finally {
        if (db && db.open) {
            db.close();
            console.log('Database connection closed.');
        }
    }
}

module.exports = setupDatabase;