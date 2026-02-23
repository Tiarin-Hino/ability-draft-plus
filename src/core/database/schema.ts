import { sqliteTable, text, integer, real, index, unique } from 'drizzle-orm/sqlite-core'

// @DEV-GUIDE: Database schema using Drizzle ORM's schema-as-code pattern.
// Defines both Drizzle table objects (for type-safe queries) and raw SCHEMA_SQL string
// (for sql.js CREATE TABLE IF NOT EXISTS on startup).
//
// 7 tables: Heroes, Abilities, AbilitySynergies, HeroAbilitySynergies,
// AbilityTriplets, HeroAbilityTriplets, Metadata.
// All foreign keys cascade on delete. Strategic indices on lookup columns.
//
// The SCHEMA_SQL string at the bottom is the raw SQL equivalent used by the sql.js
// initialization path (see database/index.ts). Both representations must be kept in sync.

// ── Heroes ──────────────────────────────────────────────────────────────────────
export const heroes = sqliteTable('Heroes', {
  heroId: integer('hero_id').primaryKey({ autoIncrement: true }),
  name: text('name').unique().notNull(),
  displayName: text('display_name'),
  winrate: real('winrate'),
  highSkillWinrate: real('high_skill_winrate'),
  pickRate: real('pick_rate'),
  hsPickRate: real('hs_pick_rate'),
  windrunId: integer('windrun_id'),
})

// ── Abilities ───────────────────────────────────────────────────────────────────
export const abilities = sqliteTable(
  'Abilities',
  {
    abilityId: integer('ability_id').primaryKey({ autoIncrement: true }),
    name: text('name').unique().notNull(),
    displayName: text('display_name'),
    heroId: integer('hero_id').references(() => heroes.heroId, {
      onDelete: 'set null',
    }),
    winrate: real('winrate'),
    highSkillWinrate: real('high_skill_winrate'),
    pickRate: real('pick_rate'),
    hsPickRate: real('hs_pick_rate'),
    isUltimate: integer('is_ultimate', { mode: 'boolean' }),
    abilityOrder: integer('ability_order'),
  },
  (table) => [index('idx_abilities_hero_id').on(table.heroId)],
)

// ── AbilitySynergies ────────────────────────────────────────────────────────────
export const abilitySynergies = sqliteTable(
  'AbilitySynergies',
  {
    synergyId: integer('synergy_id').primaryKey({ autoIncrement: true }),
    baseAbilityId: integer('base_ability_id')
      .notNull()
      .references(() => abilities.abilityId, { onDelete: 'cascade' }),
    synergyAbilityId: integer('synergy_ability_id')
      .notNull()
      .references(() => abilities.abilityId, { onDelete: 'cascade' }),
    synergyWinrate: real('synergy_winrate').notNull(),
    synergyIncrease: real('synergy_increase'),
    isOp: integer('is_op', { mode: 'boolean' }).default(false),
  },
  (table) => [
    unique('uq_ability_synergy_pair').on(table.baseAbilityId, table.synergyAbilityId),
    index('idx_synergy_base_ability').on(table.baseAbilityId),
    index('idx_synergy_pair_ability').on(table.synergyAbilityId),
  ],
)

// ── HeroAbilitySynergies ────────────────────────────────────────────────────────
export const heroAbilitySynergies = sqliteTable(
  'HeroAbilitySynergies',
  {
    synergyId: integer('synergy_id').primaryKey({ autoIncrement: true }),
    heroId: integer('hero_id')
      .notNull()
      .references(() => heroes.heroId, { onDelete: 'cascade' }),
    abilityId: integer('ability_id')
      .notNull()
      .references(() => abilities.abilityId, { onDelete: 'cascade' }),
    synergyWinrate: real('synergy_winrate').notNull(),
    synergyIncrease: real('synergy_increase'),
    isOp: integer('is_op', { mode: 'boolean' }).default(false),
  },
  (table) => [
    unique('uq_hero_ability_synergy_pair').on(table.heroId, table.abilityId),
    index('idx_hero_synergy_hero').on(table.heroId),
    index('idx_hero_synergy_ability').on(table.abilityId),
  ],
)

// ── AbilityTriplets ───────────────────────────────────────────────────────────
export const abilityTriplets = sqliteTable(
  'AbilityTriplets',
  {
    tripletId: integer('triplet_id').primaryKey({ autoIncrement: true }),
    abilityIdOne: integer('ability_id_one')
      .notNull()
      .references(() => abilities.abilityId, { onDelete: 'cascade' }),
    abilityIdTwo: integer('ability_id_two')
      .notNull()
      .references(() => abilities.abilityId, { onDelete: 'cascade' }),
    abilityIdThree: integer('ability_id_three')
      .notNull()
      .references(() => abilities.abilityId, { onDelete: 'cascade' }),
    synergyWinrate: real('synergy_winrate').notNull(),
    synergyIncrease: real('synergy_increase'),
    numPicks: integer('num_picks'),
    isOp: integer('is_op', { mode: 'boolean' }).default(false),
  },
  (table) => [
    unique('uq_ability_triplet').on(table.abilityIdOne, table.abilityIdTwo, table.abilityIdThree),
    index('idx_triplet_a1').on(table.abilityIdOne),
    index('idx_triplet_a2').on(table.abilityIdTwo),
    index('idx_triplet_a3').on(table.abilityIdThree),
  ],
)

// ── HeroAbilityTriplets ──────────────────────────────────────────────────────
export const heroAbilityTriplets = sqliteTable(
  'HeroAbilityTriplets',
  {
    tripletId: integer('triplet_id').primaryKey({ autoIncrement: true }),
    heroId: integer('hero_id')
      .notNull()
      .references(() => heroes.heroId, { onDelete: 'cascade' }),
    abilityIdOne: integer('ability_id_one')
      .notNull()
      .references(() => abilities.abilityId, { onDelete: 'cascade' }),
    abilityIdTwo: integer('ability_id_two')
      .notNull()
      .references(() => abilities.abilityId, { onDelete: 'cascade' }),
    synergyWinrate: real('synergy_winrate').notNull(),
    synergyIncrease: real('synergy_increase'),
    numPicks: integer('num_picks'),
    isOp: integer('is_op', { mode: 'boolean' }).default(false),
  },
  (table) => [
    unique('uq_hero_ability_triplet').on(table.heroId, table.abilityIdOne, table.abilityIdTwo),
    index('idx_hero_triplet_hero').on(table.heroId),
    index('idx_hero_triplet_a1').on(table.abilityIdOne),
    index('idx_hero_triplet_a2').on(table.abilityIdTwo),
  ],
)

// ── Metadata ────────────────────────────────────────────────────────────────────
export const metadata = sqliteTable('Metadata', {
  key: text('key').primaryKey(),
  value: text('value'),
})

// Schema creation SQL for sql.js (used when no migration system is active)
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS Heroes (
    hero_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT,
    winrate REAL,
    high_skill_winrate REAL,
    pick_rate REAL,
    hs_pick_rate REAL,
    windrun_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS Abilities (
    ability_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT,
    hero_id INTEGER REFERENCES Heroes(hero_id) ON DELETE SET NULL,
    winrate REAL,
    high_skill_winrate REAL,
    pick_rate REAL,
    hs_pick_rate REAL,
    is_ultimate INTEGER,
    ability_order INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_abilities_hero_id ON Abilities (hero_id);

  CREATE TABLE IF NOT EXISTS AbilitySynergies (
    synergy_id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_ability_id INTEGER NOT NULL REFERENCES Abilities(ability_id) ON DELETE CASCADE,
    synergy_ability_id INTEGER NOT NULL REFERENCES Abilities(ability_id) ON DELETE CASCADE,
    synergy_winrate REAL NOT NULL,
    synergy_increase REAL,
    is_op INTEGER DEFAULT 0,
    UNIQUE (base_ability_id, synergy_ability_id)
  );
  CREATE INDEX IF NOT EXISTS idx_synergy_base_ability ON AbilitySynergies (base_ability_id);
  CREATE INDEX IF NOT EXISTS idx_synergy_pair_ability ON AbilitySynergies (synergy_ability_id);

  CREATE TABLE IF NOT EXISTS HeroAbilitySynergies (
    synergy_id INTEGER PRIMARY KEY AUTOINCREMENT,
    hero_id INTEGER NOT NULL REFERENCES Heroes(hero_id) ON DELETE CASCADE,
    ability_id INTEGER NOT NULL REFERENCES Abilities(ability_id) ON DELETE CASCADE,
    synergy_winrate REAL NOT NULL,
    synergy_increase REAL,
    is_op INTEGER DEFAULT 0,
    UNIQUE (hero_id, ability_id)
  );
  CREATE INDEX IF NOT EXISTS idx_hero_synergy_hero ON HeroAbilitySynergies (hero_id);
  CREATE INDEX IF NOT EXISTS idx_hero_synergy_ability ON HeroAbilitySynergies (ability_id);

  CREATE TABLE IF NOT EXISTS AbilityTriplets (
    triplet_id INTEGER PRIMARY KEY AUTOINCREMENT,
    ability_id_one INTEGER NOT NULL REFERENCES Abilities(ability_id) ON DELETE CASCADE,
    ability_id_two INTEGER NOT NULL REFERENCES Abilities(ability_id) ON DELETE CASCADE,
    ability_id_three INTEGER NOT NULL REFERENCES Abilities(ability_id) ON DELETE CASCADE,
    synergy_winrate REAL NOT NULL,
    synergy_increase REAL,
    num_picks INTEGER,
    is_op INTEGER DEFAULT 0,
    UNIQUE (ability_id_one, ability_id_two, ability_id_three)
  );
  CREATE INDEX IF NOT EXISTS idx_triplet_a1 ON AbilityTriplets (ability_id_one);
  CREATE INDEX IF NOT EXISTS idx_triplet_a2 ON AbilityTriplets (ability_id_two);
  CREATE INDEX IF NOT EXISTS idx_triplet_a3 ON AbilityTriplets (ability_id_three);

  CREATE TABLE IF NOT EXISTS HeroAbilityTriplets (
    triplet_id INTEGER PRIMARY KEY AUTOINCREMENT,
    hero_id INTEGER NOT NULL REFERENCES Heroes(hero_id) ON DELETE CASCADE,
    ability_id_one INTEGER NOT NULL REFERENCES Abilities(ability_id) ON DELETE CASCADE,
    ability_id_two INTEGER NOT NULL REFERENCES Abilities(ability_id) ON DELETE CASCADE,
    synergy_winrate REAL NOT NULL,
    synergy_increase REAL,
    num_picks INTEGER,
    is_op INTEGER DEFAULT 0,
    UNIQUE (hero_id, ability_id_one, ability_id_two)
  );
  CREATE INDEX IF NOT EXISTS idx_hero_triplet_hero ON HeroAbilityTriplets (hero_id);
  CREATE INDEX IF NOT EXISTS idx_hero_triplet_a1 ON HeroAbilityTriplets (ability_id_one);
  CREATE INDEX IF NOT EXISTS idx_hero_triplet_a2 ON HeroAbilityTriplets (ability_id_two);

  CREATE TABLE IF NOT EXISTS Metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  INSERT OR IGNORE INTO Metadata (key, value) VALUES ('last_successful_scrape_date', NULL);
`
