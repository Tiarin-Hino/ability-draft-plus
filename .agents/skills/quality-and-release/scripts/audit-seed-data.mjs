#!/usr/bin/env node
/**
 * Audits bundled seed data integrity across:
 *   - resources/dota_ad_data.db
 *   - resources/model/class_names.json
 *   - resources/data/ability_tags.json
 *   - resources/data/hero_meta.json
 *
 * Flags missing shift columns/data, heroes without an `ability_order = 2` (W-slot) anchor,
 * contaminated user-preference keys in seed Metadata, dead HeroAbilityTriplets bloat,
 * and drift between the DB, ML class list, tags, and hero metadata.
 *
 * Read-only by default; exits 1 only with `--strict` if critical readiness gaps exist.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import initSqlJs from 'sql.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../../..')

const args = new Set(process.argv.slice(2))
const STRICT = args.has('--strict')
const JSON_OUTPUT = args.has('--json')

const EXPECTED_SHIFT_COLS = [
  'kills_shift',
  'deaths_shift',
  'ka_shift',
  'gpm_shift',
  'xpm_shift',
  'dmg_shift',
  'healing_shift',
]

const EXPECTED_SEED_METADATA_KEYS = new Set([
  'last_successful_scrape_date',
  'last_scrape_date',
])

// Random-pool heroes (Invoker, Kez) legitimately lack a fixed ability_order=2 W slot on the board.
const RANDOM_POOL_HEROES = new Set(['invoker', 'kez'])

const IGNORED_UNPICKABLE_PREFIXES = ['ad_special_bonus_', 'special_bonus_', 'greevil_', 'frostbitten_']
const UNPICKABLE_ABILITIES = new Set([
  'ancient_apparition_death_rime',
  'hoodwink_sharpshooter_release',
  'jakiro_double_trouble',
  'monkey_king_primal_spring',
  'necrolyte_sadist_stop',
  'razor_dynamo',
  'rubick_hidden1',
  'slark_depth_shroud',
  'tiny_insurmountable',
])

function isPickableAbility(name) {
  if (UNPICKABLE_ABILITIES.has(name)) return false
  return !IGNORED_UNPICKABLE_PREFIXES.some((prefix) => name.startsWith(prefix))
}

function queryRows(db, sql) {
  const res = db.exec(sql)
  if (!res || res.length === 0) return []
  const { columns, values } = res[0]
  return values.map((row) => Object.fromEntries(columns.map((c, idx) => [c, row[idx]])))
}

function tableColumns(db, table) {
  return new Set(queryRows(db, `PRAGMA table_info(${table})`).map((r) => String(r.name)))
}

const dbPath = join(REPO_ROOT, 'resources/dota_ad_data.db')
const classNamesPath = join(REPO_ROOT, 'resources/model/class_names.json')
const tagsPath = join(REPO_ROOT, 'resources/data/ability_tags.json')
const heroMetaPath = join(REPO_ROOT, 'resources/data/hero_meta.json')

const SQL = await initSqlJs({
  locateFile: (file) => join(REPO_ROOT, 'node_modules/sql.js/dist', file),
})

const dbBytes = readFileSync(dbPath)
const db = new SQL.Database(dbBytes)

try {
  const tables = queryRows(
    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  ).map((r) => String(r.name))

  const rowCounts = {}
  for (const t of tables) {
    const countRows = queryRows(db, `SELECT COUNT(*) AS cnt FROM "${t}"`)
    rowCounts[t] = Number(countRows[0]?.cnt ?? 0)
  }

  const metadataRows = queryRows(db, 'SELECT key, value FROM Metadata ORDER BY key')
  const nonSeedMetadata = metadataRows.filter((r) => !EXPECTED_SEED_METADATA_KEYS.has(String(r.key)))

  const heroCols = tableColumns(db, 'Heroes')
  const abilityCols = tableColumns(db, 'Abilities')

  const missingHeroShiftCols = EXPECTED_SHIFT_COLS.filter((c) => !heroCols.has(c))
  const missingAbilityShiftCols = EXPECTED_SHIFT_COLS.filter((c) => !abilityCols.has(c))
  const hasAbilityWindrunId = abilityCols.has('windrun_id')
  const hasHeroWindrunId = heroCols.has('windrun_id')

  const populatedAbilityShifts =
    missingAbilityShiftCols.length === 0
      ? Number(queryRows(db, 'SELECT COUNT(*) AS cnt FROM Abilities WHERE gpm_shift IS NOT NULL')[0]?.cnt ?? 0)
      : 0
  const populatedHeroShifts =
    missingHeroShiftCols.length === 0
      ? Number(queryRows(db, 'SELECT COUNT(*) AS cnt FROM Heroes WHERE gpm_shift IS NOT NULL')[0]?.cnt ?? 0)
      : 0

  const heroesWithoutWSlot = queryRows(
    db,
    `SELECT h.hero_id, h.name, h.display_name
     FROM Heroes h
     LEFT JOIN Abilities a ON a.hero_id = h.hero_id AND a.ability_order = 2
     WHERE a.ability_id IS NULL
     ORDER BY h.name`,
  )

  const unexpectedHeroesWithoutWSlot = heroesWithoutWSlot.filter(
    (h) => !RANDOM_POOL_HEROES.has(String(h.name)),
  )

  const abilitiesMissingOrder = queryRows(
    db,
    `SELECT name, display_name FROM Abilities WHERE ability_order IS NULL ORDER BY name`,
  )

  const dbAbilityNames = new Set(queryRows(db, 'SELECT name FROM Abilities').map((r) => String(r.name)))
  const dbHeroNames = new Set(queryRows(db, 'SELECT name FROM Heroes').map((r) => String(r.name)))

  const classNames = existsSync(classNamesPath) ? JSON.parse(readFileSync(classNamesPath, 'utf8')) : []
  const classNameSet = new Set(classNames)

  const tagsJson = existsSync(tagsPath) ? JSON.parse(readFileSync(tagsPath, 'utf8')) : {}
  const tagAbilitySet = new Set(Object.keys(tagsJson.abilities ?? tagsJson))

  const heroMetaJson = existsSync(heroMetaPath) ? JSON.parse(readFileSync(heroMetaPath, 'utf8')) : {}
  const heroMetaSet = new Set(Object.keys(heroMetaJson.heroes ?? heroMetaJson))

  const missingFromModel = [...dbAbilityNames].filter((n) => isPickableAbility(n) && !classNameSet.has(n)).sort()
  const staleInModel = [...classNameSet].filter((n) => isPickableAbility(n) && !dbAbilityNames.has(n)).sort()
  const missingFromTags = [...dbAbilityNames].filter((n) => isPickableAbility(n) && !tagAbilitySet.has(n)).sort()
  const missingFromHeroMeta = [...dbHeroNames].filter((n) => !heroMetaSet.has(n)).sort()

  const issues = []
  if (missingAbilityShiftCols.length > 0 || missingHeroShiftCols.length > 0) {
    issues.push('Seed DB schema is missing /ability-shifts columns (role greed disabled until first scrape)')
  } else if (populatedAbilityShifts === 0) {
    issues.push('Seed DB has shift columns but 0 populated ability shift rows')
  }
  if (!hasAbilityWindrunId || !hasHeroWindrunId) {
    issues.push('Seed DB schema is missing windrun_id column(s)')
  }
  if (nonSeedMetadata.length > 0) {
    issues.push(
      `Seed DB ships ${nonSeedMetadata.length} user/dev Metadata key(s): ${nonSeedMetadata.map((r) => r.key).join(', ')}`,
    )
  }
  if (unexpectedHeroesWithoutWSlot.length > 0) {
    issues.push(
      `${unexpectedHeroesWithoutWSlot.length} non-random hero(es) lack ability_order=2 (${unexpectedHeroesWithoutWSlot.map((h) => h.name).join(', ')})`,
    )
  }
  if (missingFromModel.length > 0) {
    issues.push(`${missingFromModel.length} pickable DB abilities missing from resources/model/class_names.json`)
  }

  const summary = {
    dbSizeBytes: dbBytes.length,
    rowCounts,
    metadata: metadataRows,
    nonSeedMetadataKeys: nonSeedMetadata.map((r) => r.key),
    schemaChecks: {
      hasAbilityWindrunId,
      hasHeroWindrunId,
      missingAbilityShiftCols,
      missingHeroShiftCols,
      populatedAbilityShifts,
      populatedHeroShifts,
    },
    heroesWithoutWSlot: heroesWithoutWSlot.map((h) => h.name),
    unexpectedHeroesWithoutWSlot: unexpectedHeroesWithoutWSlot.map((h) => h.name),
    abilitiesMissingOrderCount: abilitiesMissingOrder.length,
    abilitiesMissingOrderSample: abilitiesMissingOrder.slice(0, 15).map((a) => a.name),
    artifactSync: {
      dbAbilities: dbAbilityNames.size,
      modelClasses: classNameSet.size,
      abilityTagsEntries: tagAbilitySet.size,
      dbHeroes: dbHeroNames.size,
      heroMetaEntries: heroMetaSet.size,
      missingFromModel,
      staleInModel,
      missingFromTagsCount: missingFromTags.length,
      missingFromTagsSample: missingFromTags.slice(0, 15),
      missingFromHeroMeta,
    },
    issues,
  }

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log(`Seed DB Audit: ${dbPath} (${(dbBytes.length / 1024).toFixed(1)} KB)`)
    console.log('Table row counts:')
    for (const [table, count] of Object.entries(rowCounts)) {
      console.log(`  - ${table.padEnd(22)} ${count}`)
    }
    console.log('\nMetadata entries:')
    for (const row of metadataRows) {
      const flag = EXPECTED_SEED_METADATA_KEYS.has(String(row.key)) ? '' : '  [USER/DEV SETTING IN SEED!]'
      console.log(`  - ${String(row.key).padEnd(34)} = ${String(row.value)}${flag}`)
    }
    console.log('\nSchema & Shift Readiness:')
    console.log(
      `  - windrun_id columns: Abilities=${hasAbilityWindrunId}, Heroes=${hasHeroWindrunId}`,
    )
    console.log(
      `  - Ability shift columns: ${missingAbilityShiftCols.length === 0 ? `present (${populatedAbilityShifts}/${rowCounts.Abilities ?? 0} populated)` : `MISSING (${missingAbilityShiftCols.length}/7)`}`,
    )
    console.log(
      `  - Hero shift columns:    ${missingHeroShiftCols.length === 0 ? `present (${populatedHeroShifts}/${rowCounts.Heroes ?? 0} populated)` : `MISSING (${missingHeroShiftCols.length}/7)`}`,
    )
    console.log(
      `  - Heroes without ability_order=2: ${heroesWithoutWSlot.length} (${heroesWithoutWSlot.map((h) => h.name).join(', ') || 'none'}) [unexpected: ${unexpectedHeroesWithoutWSlot.map((h) => h.name).join(', ') || 'none'}]`,
    )
    console.log(`  - Abilities with NULL ability_order: ${abilitiesMissingOrder.length}`)
    console.log('\nCross-Artifact Parity:')
    console.log(`  - Abilities: DB=${dbAbilityNames.size}, Model=${classNameSet.size}, Tags=${tagAbilitySet.size}`)
    console.log(`  - Heroes:    DB=${dbHeroNames.size}, HeroMeta=${heroMetaSet.size}`)
    console.log(`  - Pickable DB abilities missing from model: ${missingFromModel.length}${missingFromModel.length ? ` (${missingFromModel.join(', ')})` : ''}`)
    console.log(`  - Model classes stale vs DB:             ${staleInModel.length}${staleInModel.length ? ` (${staleInModel.join(', ')})` : ''}`)
    console.log(`  - Pickable DB abilities missing tags:    ${missingFromTags.length}`)
    console.log(`  - DB heroes missing from hero_meta.json: ${missingFromHeroMeta.length}${missingFromHeroMeta.length ? ` (${missingFromHeroMeta.join(', ')})` : ''}`)
    if (issues.length > 0) {
      console.log('\nDetected Issues:')
      for (const issue of issues) {
        console.log(`  [!] ${issue}`)
      }
    }
  }

  process.exit(STRICT && issues.length > 0 ? 1 : 0)
} finally {
  db.close()
}
