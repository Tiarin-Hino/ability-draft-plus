/**
 * @file Manages the setup and migration of the application's SQLite database.
 * This includes creating the initial schema if it doesn't exist,
 * and applying simple migrations like adding or dropping columns to ensure
 * the database schema is up-to-date with the application version.
 */

const path = require('path');
const Database = require('better-sqlite3');
const { app } = require('electron');

/**
 * @const {string} dbPath - The absolute path to the SQLite database file,
 * located within the Electron application's user data directory.
 */
const dbPath = path.join(app.getPath('userData'), 'dota_ad_data.db');

/**
 * @const {string} initialSchemaSql - SQL statements for creating the initial database schema.
 * This includes tables for Heroes, Abilities, AbilitySynergies, and Metadata.
 * Indexes are also created to optimize query performance.
 */
const initialSchemaSql = `
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS Heroes (
        hero_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,      -- Internal name, e.g., "antimage"
        display_name TEXT,              -- Display name, e.g., "Anti-Mage"
        winrate REAL,
        high_skill_winrate REAL,        -- Winrate from high-skill specific data
        pick_rate REAL,                 -- Formerly avg_pick_order
        hs_pick_rate REAL,              -- High-skill pick rate
        windrun_id INTEGER              -- ID from windrun.io for potential linking
    );

    CREATE TABLE IF NOT EXISTS Abilities (
        ability_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,      -- Internal name, e.g., "abaddon_frostmourne"
        display_name TEXT,              -- Display name, e.g., "Curse of Avernus"
        hero_id INTEGER,                -- Foreign key to Heroes table
        winrate REAL,                   -- Regular winrate
        high_skill_winrate REAL,        -- Winrate from high-skill specific data
        pick_rate REAL,                 -- Formerly avg_pick_order
        hs_pick_rate REAL,              -- High-skill pick rate
        is_ultimate BOOLEAN,            -- True if the ability is an ultimate
        ability_order INTEGER,          -- Order of the ability for a hero (1, 2, 3, ult=4 etc.)
        FOREIGN KEY (hero_id) REFERENCES Heroes (hero_id) ON DELETE SET NULL ON UPDATE CASCADE
    );

    CREATE TABLE IF NOT EXISTS AbilitySynergies (
        synergy_id INTEGER PRIMARY KEY AUTOINCREMENT,
        base_ability_id INTEGER NOT NULL,
        synergy_ability_id INTEGER NOT NULL,
        synergy_winrate REAL NOT NULL,
        is_op BOOLEAN DEFAULT 0,        -- True if this is considered an "OP" combination
        FOREIGN KEY (base_ability_id) REFERENCES Abilities (ability_id) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (synergy_ability_id) REFERENCES Abilities (ability_id) ON DELETE CASCADE ON UPDATE CASCADE,
        UNIQUE (base_ability_id, synergy_ability_id)
    );

    CREATE TABLE IF NOT EXISTS HeroAbilitySynergies (
        synergy_id INTEGER PRIMARY KEY AUTOINCREMENT,
        hero_id INTEGER NOT NULL,
        ability_id INTEGER NOT NULL,
        synergy_winrate REAL NOT NULL,
        synergy_increase REAL,          -- Synergy increase percentage (e.g., 0.1462 for 14.62%)
        is_op BOOLEAN DEFAULT 0,        -- True if this is considered an "OP" combination
        FOREIGN KEY (hero_id) REFERENCES Heroes (hero_id) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (ability_id) REFERENCES Abilities (ability_id) ON DELETE CASCADE ON UPDATE CASCADE,
        UNIQUE (hero_id, ability_id)
    );

    CREATE INDEX IF NOT EXISTS idx_abilities_hero_id ON Abilities (hero_id);
    CREATE INDEX IF NOT EXISTS idx_synergy_base_ability ON AbilitySynergies (base_ability_id);
    CREATE INDEX IF NOT EXISTS idx_synergy_pair_ability ON AbilitySynergies (synergy_ability_id);
    CREATE INDEX IF NOT EXISTS idx_hero_synergy_hero ON HeroAbilitySynergies (hero_id);
    CREATE INDEX IF NOT EXISTS idx_hero_synergy_ability ON HeroAbilitySynergies (ability_id);

    CREATE TABLE IF NOT EXISTS Metadata (
        key TEXT PRIMARY KEY,
        value TEXT
    );

    -- Initialize metadata for tracking the last successful data scrape.
    INSERT OR IGNORE INTO Metadata (key, value) VALUES ('last_successful_scrape_date', NULL);
`;

/**
 * @const {Array<{table: string, column: string, type: string}>} columnsToEnsure
 * - An array of objects defining columns to be added to tables if they don't already exist.
 * This is used for simple schema migrations.
 */
const columnsToEnsure = [
    // Abilities table
    { table: 'Abilities', column: 'ability_order', type: 'INTEGER' },
    { table: 'Abilities', column: 'display_name', type: 'TEXT' },
    { table: 'Abilities', column: 'hero_id', type: 'INTEGER' }, // Foreign key to Heroes
    { table: 'Abilities', column: 'high_skill_winrate', type: 'REAL' },
    { table: 'Abilities', column: 'hs_pick_rate', type: 'REAL' },
    { table: 'Abilities', column: 'is_ultimate', type: 'BOOLEAN' },
    { table: 'Abilities', column: 'pick_rate', type: 'REAL' },

    // AbilitySynergies table
    { table: 'AbilitySynergies', column: 'is_op', type: 'BOOLEAN DEFAULT 0' },
    { table: 'AbilitySynergies', column: 'synergy_increase', type: 'REAL' },

    // Heroes table
    { table: 'Heroes', column: 'display_name', type: 'TEXT' },
    { table: 'Heroes', column: 'high_skill_winrate', type: 'REAL' },
    { table: 'Heroes', column: 'hs_pick_rate', type: 'REAL' },
    { table: 'Heroes', column: 'pick_rate', type: 'REAL' },
    { table: 'Heroes', column: 'windrun_id', type: 'INTEGER' }, // ID from windrun.io
];

/**
 * @const {Array<{table: string, column: string}>} columnsToDrop
 * - An array of objects defining obsolete columns that should be removed from the database for cleanup.
 */
const columnsToDrop = [
    // Abilities table
    { table: 'Abilities', column: 'avg_pick_order' },
    { table: 'Abilities', column: 'pick_order' },
    { table: 'Abilities', column: 'value_percentage' },
    // Heroes table
    { table: 'Heroes', column: 'value_percentage' },
    { table: 'Heroes', column: 'avg_pick_order' },
];


/**
 * Sets up the SQLite database.
 * This function creates the necessary tables, adds missing columns for forward compatibility,
 * and drops obsolete columns for cleanup.
 *
 * @throws {Error} If there's a critical error during database setup.
 */
function setupDatabase() {
    let db;
    try {
        db = new Database(dbPath); // Removed verbose logging to reduce SQL statement spam

        // Execute initial schema creation (tables, indexes).
        db.exec(initialSchemaSql);

        // Perform simple migrations by adding columns if they don't exist.
        for (const { table, column, type } of columnsToEnsure) {
            try {
                db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`).run();
            } catch (err) {
                if (!err.message.includes('duplicate column name')) {
                    console.error(`[DB Setup] Error adding column "${column}" to "${table}": ${err.message}`);
                }
            }
        }

        // New step: Clean up obsolete columns from previous versions.
        for (const { table, column } of columnsToDrop) {
            try {
                // Check if the column exists before trying to drop it.
                const tableInfo = db.prepare(`PRAGMA table_info(${table});`).all();
                const columnExists = tableInfo.some(col => col.name === column);

                if (columnExists) {
                    // The `DROP COLUMN` syntax is supported in recent SQLite versions.
                    db.prepare(`ALTER TABLE ${table} DROP COLUMN ${column};`).run();
                }
            } catch (err) {
                // This might fail on very old SQLite versions, but it's a non-critical cleanup task.
                console.error(`[DB Setup] Could not drop column "${column}" from "${table}": ${err.message}.`);
            }
        }

    } catch (err) {
        console.error('[DB Setup] Critical error setting up database:', err.message);
        throw err; // Rethrow critical errors to be handled by the application.
    } finally {
        if (db && db.open) {
            db.close();
        }
    }
}

module.exports = setupDatabase;