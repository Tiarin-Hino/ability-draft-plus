// src/database/setupDatabase.js
const Database = require('better-sqlite3');

// SQL statements to create the tables
const setupSql = `
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS Heroes (
        hero_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        winrate REAL
    );

    CREATE TABLE IF NOT EXISTS Abilities (
        ability_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        hero_id INTEGER, -- Added hero_id column
        winrate REAL,
        high_skill_winrate REAL, -- Ensure this column exists if needed
        icon_filename TEXT,
        is_ultimate BOOL,
        ability_order INT,
        FOREIGN KEY (hero_id) REFERENCES Heroes (hero_id) ON DELETE SET NULL ON UPDATE CASCADE -- Added foreign key constraint
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

    CREATE INDEX IF NOT EXISTS idx_abilities_hero_id ON Abilities (hero_id); -- Added index for hero_id
    CREATE INDEX IF NOT EXISTS idx_synergy_base_ability ON AbilitySynergies (base_ability_id);
    CREATE INDEX IF NOT EXISTS idx_synergy_pair_ability ON AbilitySynergies (synergy_ability_id);
`;

/**
 * Initializes the SQLite database and creates tables if they don't exist.
 * Also attempts to add new columns if they are missing (for backward compatibility).
 */
function setupDatabase(actualDbPath) {
    let db;
    try {
        // Open (or create) the database file
        db = new Database(actualDbPath, { verbose: console.log }); // verbose logs SQL executions

        // Execute the initial table creation/check SQL statements
        db.exec(setupSql);
        console.log('Base table setup complete or already exists.');

        // --- Add missing columns gracefully ---
        const columnsToAdd = [
            { table: 'Abilities', column: 'icon_filename', type: 'TEXT' },
            { table: 'Abilities', column: 'high_skill_winrate', type: 'REAL' },
            { table: 'Abilities', column: 'hero_id', type: 'INTEGER' } // Add hero_id here
        ];

        for (const { table, column, type } of columnsToAdd) {
            try {
                // Attempt to add the column. This will fail if it already exists.
                db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
                console.log(`Added ${column} column to ${table} table.`);
            } catch (err) {
                if (err.message.includes('duplicate column name')) {
                    // This is expected if the column already exists
                    console.log(`${column} column already exists in ${table} table.`);
                } else {
                    // Re-throw unexpected errors
                    console.error(`Error adding column ${column} to ${table}:`, err.message);
                    // Decide if you want to throw the error or just log it
                    // throw err;
                }
            }
        }

        // --- Add foreign key constraint if missing ---
        // This is trickier to do gracefully in SQLite without potentially dropping/recreating tables.
        // The initial setupSql handles it for new databases. For existing ones,
        // this might require manual intervention or more complex migration logic if the FK is missing.
        // We'll assume the setupSql handles it correctly for now.

        console.log('Database schema setup/update complete.');

    } catch (err) {
        console.error('Error setting up database:', err.message);
        throw err; // Re-throw error to indicate failure
    } finally {
        // Always close the connection if it was opened
        if (db && db.open) { // Check if connection is open
            db.close();
            console.log('Database connection closed.');
        }
    }
}

module.exports = setupDatabase;