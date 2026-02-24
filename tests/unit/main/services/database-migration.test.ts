import { describe, it, expect, vi, beforeEach } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'

// Mocks required because database-service.ts imports electron and electron-log at module level
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/mock/app/path',
    getPath: () => '/mock/user/data',
  },
}))

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

import { runColumnMigrations } from '../../../../src/main/services/database-service'
import { SCHEMA_SQL } from '../../../../src/core/database/schema'

// The exact schema from the bundled resources/dota_ad_data.db (v1 / pre-synergy_increase).
// This is the schema that users who installed an earlier build will have on disk.
const V1_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS Heroes (
    hero_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT,
    winrate REAL,
    windrun_id INTEGER,
    high_skill_winrate REAL,
    pick_rate REAL,
    hs_pick_rate REAL
  );

  CREATE TABLE IF NOT EXISTS Abilities (
    ability_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT,
    hero_id INTEGER REFERENCES Heroes(hero_id) ON DELETE SET NULL ON UPDATE CASCADE,
    winrate REAL,
    high_skill_winrate REAL,
    is_ultimate BOOL,
    ability_order INT,
    pick_rate REAL,
    hs_pick_rate REAL
  );
  CREATE INDEX IF NOT EXISTS idx_abilities_hero_id ON Abilities (hero_id);

  CREATE TABLE IF NOT EXISTS AbilitySynergies (
    synergy_id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_ability_id INTEGER NOT NULL,
    synergy_ability_id INTEGER NOT NULL,
    synergy_winrate REAL NOT NULL,
    is_op BOOLEAN DEFAULT 0,
    FOREIGN KEY (base_ability_id) REFERENCES Abilities (ability_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (synergy_ability_id) REFERENCES Abilities (ability_id) ON DELETE CASCADE ON UPDATE CASCADE,
    UNIQUE (base_ability_id, synergy_ability_id)
  );
  CREATE INDEX IF NOT EXISTS idx_synergy_base_ability ON AbilitySynergies (base_ability_id);
  CREATE INDEX IF NOT EXISTS idx_synergy_pair_ability ON AbilitySynergies (synergy_ability_id);

  CREATE TABLE IF NOT EXISTS Metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`

function getColumns(db: SqlJsDatabase, table: string): string[] {
  const result = db.exec(`PRAGMA table_info(${table})`)
  if (result.length === 0) return []
  return result[0].values.map((row) => row[1] as string)
}

describe('runColumnMigrations', () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>

  beforeEach(async () => {
    SQL = await initSqlJs()
  })

  it('adds synergy_increase to AbilitySynergies on a v1 database', () => {
    const db = new SQL.Database()
    db.run(V1_SCHEMA_SQL)

    expect(getColumns(db, 'AbilitySynergies')).not.toContain('synergy_increase')

    runColumnMigrations(db)

    expect(getColumns(db, 'AbilitySynergies')).toContain('synergy_increase')
    db.close()
  })

  it('does not fail when synergy_increase already exists (idempotent)', () => {
    const db = new SQL.Database()
    db.run(SCHEMA_SQL) // full current schema already has the column

    expect(() => runColumnMigrations(db)).not.toThrow()
    expect(getColumns(db, 'AbilitySynergies')).toContain('synergy_increase')
    db.close()
  })

  it('preserves existing rows in AbilitySynergies after migration', () => {
    const db = new SQL.Database()
    db.run(V1_SCHEMA_SQL)

    // Seed old-style rows (no synergy_increase column yet)
    db.run(`INSERT INTO Heroes (name, winrate) VALUES ('antimage', 0.52)`)
    db.run(`INSERT INTO Abilities (name, hero_id, winrate) VALUES ('antimage_mana_break', 1, 0.55)`)
    db.run(`INSERT INTO Abilities (name, hero_id, winrate) VALUES ('crystal_maiden_frostbite', 1, 0.50)`)
    db.run(
      `INSERT INTO AbilitySynergies (base_ability_id, synergy_ability_id, synergy_winrate, is_op)
       VALUES (1, 2, 0.65, 0)`,
    )

    runColumnMigrations(db)

    const rows = db.exec(`SELECT * FROM AbilitySynergies`)
    expect(rows[0].values).toHaveLength(1)
    // synergy_increase column exists and is NULL for migrated rows
    const colNames = rows[0].columns
    expect(colNames).toContain('synergy_increase')
    const row = rows[0].values[0]
    const synergyIncreaseIdx = colNames.indexOf('synergy_increase')
    expect(row[synergyIncreaseIdx]).toBeNull()
    db.close()
  })

  it('allows inserting rows with synergy_increase after migration', () => {
    const db = new SQL.Database()
    db.run(V1_SCHEMA_SQL)
    runColumnMigrations(db)

    db.run(`INSERT INTO Heroes (name, winrate) VALUES ('antimage', 0.52)`)
    db.run(`INSERT INTO Abilities (name, hero_id, winrate) VALUES ('mana_break', 1, 0.55)`)
    db.run(`INSERT INTO Abilities (name, hero_id, winrate) VALUES ('frostbite', 1, 0.50)`)

    expect(() =>
      db.run(
        `INSERT INTO AbilitySynergies (base_ability_id, synergy_ability_id, synergy_winrate, synergy_increase, is_op)
         VALUES (1, 2, 0.65, 0.15, 0)`,
      ),
    ).not.toThrow()

    const rows = db.exec(`SELECT synergy_increase FROM AbilitySynergies`)
    expect(rows[0].values[0][0]).toBe(0.15)
    db.close()
  })

  it('skips tables that do not exist yet (new tables handled by SCHEMA_SQL)', () => {
    const db = new SQL.Database()
    db.run(V1_SCHEMA_SQL) // HeroAbilitySynergies, AbilityTriplets, HeroAbilityTriplets don't exist

    // Should not throw even though migration list includes those tables
    expect(() => runColumnMigrations(db)).not.toThrow()

    // Tables still don't exist (SCHEMA_SQL hasn't run yet in this test)
    expect(getColumns(db, 'HeroAbilitySynergies')).toHaveLength(0)
    db.close()
  })
})
