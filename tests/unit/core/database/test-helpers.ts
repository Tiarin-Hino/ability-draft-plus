import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js'
import * as schema from '@core/database/schema'
import { SCHEMA_SQL } from '@core/database/schema'

export interface TestDb {
  db: SQLJsDatabase
  sqlite: SqlJsDatabase
  close: () => void
}

export async function createTestDb(): Promise<TestDb> {
  const SQL = await initSqlJs()
  const sqlite = new SQL.Database()
  sqlite.run('PRAGMA foreign_keys = ON;')
  sqlite.run(SCHEMA_SQL)

  const db = drizzle(sqlite, { schema })

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  }
}

export function seedTestData(db: SQLJsDatabase): void {
  // Insert heroes
  db.insert(schema.heroes)
    .values([
      {
        name: 'antimage',
        displayName: 'Anti-Mage',
        winrate: 0.52,
        highSkillWinrate: 0.54,
        pickRate: 120,
        hsPickRate: 80,
        windrunId: 1,
      },
      {
        name: 'crystal_maiden',
        displayName: 'Crystal Maiden',
        winrate: 0.48,
        highSkillWinrate: 0.46,
        pickRate: 200,
        hsPickRate: 150,
        windrunId: 2,
      },
      {
        name: 'pudge',
        displayName: 'Pudge',
        winrate: 0.51,
        highSkillWinrate: 0.49,
        pickRate: 300,
        hsPickRate: 180,
        windrunId: 3,
      },
      {
        name: 'invoker',
        displayName: null,
        winrate: 0.5,
        highSkillWinrate: 0.55,
        pickRate: 250,
        hsPickRate: 200,
        windrunId: 4,
      },
    ])
    .run()

  // Insert abilities (heroId references are 1-based autoincrement)
  db.insert(schema.abilities)
    .values([
      // Anti-Mage abilities (heroId = 1)
      {
        name: 'antimage_mana_break',
        displayName: 'Mana Break',
        heroId: 1,
        winrate: 0.55,
        highSkillWinrate: 0.57,
        pickRate: 100,
        hsPickRate: 80,
        isUltimate: false,
        abilityOrder: 1,
      },
      {
        name: 'antimage_blink',
        displayName: 'Blink',
        heroId: 1,
        winrate: 0.6,
        highSkillWinrate: 0.62,
        pickRate: 90,
        hsPickRate: 75,
        isUltimate: false,
        abilityOrder: 2,
      },
      {
        name: 'antimage_counterspell',
        displayName: 'Counterspell',
        heroId: 1,
        winrate: 0.53,
        highSkillWinrate: 0.55,
        pickRate: 70,
        hsPickRate: 60,
        isUltimate: false,
        abilityOrder: 3,
      },
      {
        name: 'antimage_mana_void',
        displayName: 'Mana Void',
        heroId: 1,
        winrate: 0.58,
        highSkillWinrate: 0.6,
        pickRate: 85,
        hsPickRate: 70,
        isUltimate: true,
        abilityOrder: 4,
      },
      // Crystal Maiden abilities (heroId = 2)
      {
        name: 'crystal_maiden_crystal_nova',
        displayName: 'Crystal Nova',
        heroId: 2,
        winrate: 0.49,
        highSkillWinrate: 0.47,
        pickRate: 110,
        hsPickRate: 90,
        isUltimate: false,
        abilityOrder: 1,
      },
      {
        name: 'crystal_maiden_frostbite',
        displayName: 'Frostbite',
        heroId: 2,
        winrate: 0.5,
        highSkillWinrate: 0.48,
        pickRate: 95,
        hsPickRate: 80,
        isUltimate: false,
        abilityOrder: 2,
      },
      {
        name: 'crystal_maiden_brilliance_aura',
        displayName: 'Arcane Aura',
        heroId: 2,
        winrate: 0.52,
        highSkillWinrate: 0.5,
        pickRate: 130,
        hsPickRate: 100,
        isUltimate: false,
        abilityOrder: 3,
      },
      // Pudge abilities (heroId = 3)
      {
        name: 'pudge_meat_hook',
        displayName: 'Meat Hook',
        heroId: 3,
        winrate: 0.54,
        highSkillWinrate: 0.58,
        pickRate: 140,
        hsPickRate: 120,
        isUltimate: false,
        abilityOrder: 1,
      },
      {
        name: 'pudge_rot',
        displayName: 'Rot',
        heroId: 3,
        winrate: 0.47,
        highSkillWinrate: 0.45,
        pickRate: 60,
        hsPickRate: 40,
        isUltimate: false,
        abilityOrder: 2,
      },
      // Ability with null display_name (heroId = 4, invoker)
      {
        name: 'invoker_quas',
        displayName: null,
        heroId: 4,
        winrate: 0.51,
        highSkillWinrate: 0.53,
        pickRate: 80,
        hsPickRate: 70,
        isUltimate: false,
        abilityOrder: 1,
      },
    ])
    .run()

  // Insert ability synergies
  // abilityIds are 1-based autoincrement:
  // 1=antimage_mana_break, 2=antimage_blink, 3=antimage_counterspell,
  // 4=antimage_mana_void, 5=crystal_nova, 6=frostbite,
  // 7=brilliance_aura, 8=meat_hook, 9=rot, 10=invoker_quas
  db.insert(schema.abilitySynergies)
    .values([
      // OP synergy: mana_break + frostbite (cross-hero, positive)
      {
        baseAbilityId: 1,
        synergyAbilityId: 6,
        synergyWinrate: 0.65,
        synergyIncrease: 0.15,
        isOp: true,
      },
      // Moderate synergy: blink + meat_hook (cross-hero)
      {
        baseAbilityId: 2,
        synergyAbilityId: 8,
        synergyWinrate: 0.58,
        synergyIncrease: 0.05,
        isOp: false,
      },
      // Same-hero synergy: mana_break + blink (should be filtered in bidirectional query)
      {
        baseAbilityId: 1,
        synergyAbilityId: 2,
        synergyWinrate: 0.62,
        synergyIncrease: 0.1,
        isOp: false,
      },
      // Trap synergy: crystal_nova + rot (negative)
      {
        baseAbilityId: 5,
        synergyAbilityId: 9,
        synergyWinrate: 0.38,
        synergyIncrease: -0.08,
        isOp: false,
      },
      // Another OP: brilliance_aura + invoker_quas
      {
        baseAbilityId: 7,
        synergyAbilityId: 10,
        synergyWinrate: 0.68,
        synergyIncrease: 0.18,
        isOp: true,
      },
      // Reverse direction test: meat_hook + mana_break (stored with meat_hook as "synergy" side)
      // We already have mana_break(1) + frostbite(6). Let's add frostbite(6) + meat_hook(8)
      {
        baseAbilityId: 6,
        synergyAbilityId: 8,
        synergyWinrate: 0.56,
        synergyIncrease: 0.03,
        isOp: false,
      },
    ])
    .run()

  // Insert hero-ability synergies
  db.insert(schema.heroAbilitySynergies)
    .values([
      // Anti-Mage hero + Crystal Nova ability (positive)
      {
        heroId: 1,
        abilityId: 5,
        synergyWinrate: 0.6,
        synergyIncrease: 0.1,
        isOp: false,
      },
      // Anti-Mage hero + Meat Hook ability (OP)
      {
        heroId: 1,
        abilityId: 8,
        synergyWinrate: 0.67,
        synergyIncrease: 0.15,
        isOp: true,
      },
      // Crystal Maiden hero + Blink ability (negative/trap)
      {
        heroId: 2,
        abilityId: 2,
        synergyWinrate: 0.4,
        synergyIncrease: -0.1,
        isOp: false,
      },
      // Pudge hero + Brilliance Aura (positive)
      {
        heroId: 3,
        abilityId: 7,
        synergyWinrate: 0.58,
        synergyIncrease: 0.06,
        isOp: false,
      },
    ])
    .run()

  // Insert metadata
  db.insert(schema.metadata)
    .values({ key: 'last_successful_scrape_date', value: '2024-11-15' })
    .onConflictDoUpdate({
      target: schema.metadata.key,
      set: { value: '2024-11-15' },
    })
    .run()
}
