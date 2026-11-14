import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
import { is } from 'drizzle-orm'
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js'
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from 'electron-log/main'

// @DEV-GUIDE: Manages the SQLite database via sql.js (WASM, no native modules) + Drizzle ORM.
// Database runs entirely in-memory for fast synchronous queries. Writes are explicit via persist().
//
// Lifecycle: initialize() loads the .db file from %APPDATA% into memory (or copies bundled seed
// on first run), creates Drizzle instance, runs CREATE TABLE IF NOT EXISTS for all tables,
// then creates six repositories (hero, ability, synergy, triplet, metadata, playerStats).
//
// Key gotcha: sql.js's run() returns the Database instance, NOT { changes: N }.
// Drizzle propagates this, so result.changes is always undefined. Use SELECT-before-UPDATE.
//
// persist() atomically writes the serialized DB via temp-file rename (use for bulk/shutdown).
// persistDebounced() coalesces frequent UI setting edits and writes asynchronously off the main loop.
// reload() replaces the in-memory DB from a Uint8Array (used by backup restore).

import * as schema from '@core/database/schema'
import { SCHEMA_SQL } from '@core/database/schema'
import {
  createHeroRepository,
  type HeroRepository,
} from '@core/database/repositories/hero-repository'
import {
  createAbilityRepository,
  type AbilityRepository,
} from '@core/database/repositories/ability-repository'
import {
  createSynergyRepository,
  type SynergyRepository,
} from '@core/database/repositories/synergy-repository'
import {
  createMetadataRepository,
  type MetadataRepository,
} from '@core/database/repositories/metadata-repository'
import {
  createTripletRepository,
  type TripletRepository,
} from '@core/database/repositories/triplet-repository'
import {
  createPlayerStatsRepository,
  type PlayerStatsRepository,
} from '@core/database/repositories/player-stats-repository'
import { DB_FILE_NAME } from '@shared/constants/database'

const logger = log.scope('database')

export interface DatabaseService {
  initialize(): Promise<void>
  getDb(): SQLJsDatabase
  heroes: HeroRepository
  abilities: AbilityRepository
  synergies: SynergyRepository
  triplets: TripletRepository
  metadata: MetadataRepository
  playerStats: PlayerStatsRepository
  persist(): void
  persistDebounced(delayMs?: number): void
  close(): void
  getDbPath(): string
  isFirstRun(): boolean
  reload(data: Uint8Array): void
}

export function createDatabaseService(): DatabaseService {
  const dbPath = path.join(app.getPath('userData'), DB_FILE_NAME)

  let SQL: SqlJsStatic
  let sqliteDb: SqlJsDatabase
  let drizzleDb: SQLJsDatabase
  let firstRun = false
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let asyncPersistChain: Promise<void> = Promise.resolve()
  let closed = false

  function clearPersistTimer(): void {
    if (persistTimer !== null) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
  }

  let heroRepo: HeroRepository
  let abilityRepo: AbilityRepository
  let synergyRepo: SynergyRepository
  let tripletRepo: TripletRepository
  let metadataRepo: MetadataRepository
  let playerStatsRepo: PlayerStatsRepository

  function initRepositories(): void {
    heroRepo = createHeroRepository(drizzleDb)
    abilityRepo = createAbilityRepository(drizzleDb)
    synergyRepo = createSynergyRepository(drizzleDb)
    tripletRepo = createTripletRepository(drizzleDb)
    metadataRepo = createMetadataRepository(drizzleDb)
    playerStatsRepo = createPlayerStatsRepository(drizzleDb)
  }

  async function initialize(): Promise<void> {
    logger.info('Initializing database...')

    // 1. Initialize sql.js WASM
    SQL = await initSqlJs()

    // 2. Load or create database
    if (fs.existsSync(dbPath)) {
      logger.info('Loading existing database', { path: dbPath })
      const fileBuffer = fs.readFileSync(dbPath)
      sqliteDb = new SQL.Database(fileBuffer)
    } else {
      // First run: try to copy bundled database from resources
      firstRun = true
      const bundledPath = getBundledDbPath()

      if (fs.existsSync(bundledPath)) {
        logger.info('First run: copying bundled database', {
          from: bundledPath,
          to: dbPath,
        })
        // Ensure userData directory exists
        const userDataDir = path.dirname(dbPath)
        if (!fs.existsSync(userDataDir)) {
          fs.mkdirSync(userDataDir, { recursive: true })
        }
        fs.copyFileSync(bundledPath, dbPath)
        const fileBuffer = fs.readFileSync(dbPath)
        sqliteDb = new SQL.Database(fileBuffer)
      } else {
        logger.warn('No bundled database found, creating empty database')
        sqliteDb = new SQL.Database()
      }
    }

    // 3. Enable foreign keys
    sqliteDb.run('PRAGMA foreign_keys = ON;')

    // 4. Ensure schema exists (safe for existing databases due to IF NOT EXISTS)
    sqliteDb.run(SCHEMA_SQL)

    // 4b. Run column migrations for existing databases that predate schema additions
    const migrationsApplied = runColumnMigrations(sqliteDb)

    // 5. Create Drizzle instance
    drizzleDb = drizzle(sqliteDb)

    // 6. Create repositories and deduplicate any seed/Windrun naming mismatches
    initRepositories()
    const deduped = heroRepo.deduplicateByDisplayName()
    if (deduped > 0) {
      logger.info(`Removed ${deduped} duplicate hero entries`)
    }

    // 7. Only write back to disk on first run, schema migration, or deduplication
    if (firstRun || migrationsApplied > 0 || deduped > 0) {
      persist()
    }

    logger.info('Database initialized successfully', {
      path: dbPath,
      firstRun,
      migrationsApplied,
    })
  }

  function persist(): void {
    clearPersistTimer()
    const data = sqliteDb.export()
    const buffer = Buffer.from(data)
    const tmpPath = `${dbPath}.sync.tmp`
    fs.writeFileSync(tmpPath, buffer)
    fs.renameSync(tmpPath, dbPath)
    logger.debug('Database persisted to disk', {
      path: dbPath,
      size: buffer.length,
    })
  }

  function persistDebounced(delayMs = 300): void {
    if (closed) return
    clearPersistTimer()
    persistTimer = setTimeout(() => {
      persistTimer = null
      if (closed || !sqliteDb) return
      const buffer = Buffer.from(sqliteDb.export())
      const tmpPath = `${dbPath}.tmp`
      asyncPersistChain = asyncPersistChain
        .then(async () => {
          if (closed) return
          await fs.promises.writeFile(tmpPath, buffer)
          if (closed) return
          await fs.promises.rename(tmpPath, dbPath)
          logger.debug('Database persisted asynchronously', {
            path: dbPath,
            size: buffer.length,
          })
        })
        .catch((err) => {
          logger.error('Async database persist failed', { error: err })
        })
    }, delayMs)
  }

  function close(): void {
    try {
      closed = true
      clearPersistTimer()
      persist()
      sqliteDb.close()
      logger.info('Database closed')
    } catch (err) {
      logger.error('Error closing database', { error: err })
    }
  }

  function reload(data: Uint8Array): void {
    clearPersistTimer()
    sqliteDb.close()
    sqliteDb = new SQL.Database(data)
    sqliteDb.run('PRAGMA foreign_keys = ON;')
    drizzleDb = drizzle(sqliteDb)
    initRepositories()
    logger.info('Database reloaded from new data')
  }

  return {
    initialize,
    getDb: () => drizzleDb,
    get heroes() {
      return heroRepo
    },
    get abilities() {
      return abilityRepo
    },
    get synergies() {
      return synergyRepo
    },
    get triplets() {
      return tripletRepo
    },
    get metadata() {
      return metadataRepo
    },
    get playerStats() {
      return playerStatsRepo
    },
    persist,
    persistDebounced,
    close,
    getDbPath: () => dbPath,
    isFirstRun: () => firstRun,
    reload,
  }
}

// Generic schema-diff migration for existing user databases. CREATE TABLE IF NOT
// EXISTS won't modify existing tables, so every nullable column present in the
// Drizzle schema but absent from the live DB is added via ALTER TABLE. This is
// deliberately NOT a hand-curated list: 1.0-era databases lack several Heroes /
// Abilities columns (issue #77 — "table Heroes has no column named
// high_skill_winrate"), and any future nullable column addition is covered
// automatically. NOT NULL columns cannot be safely added to populated tables and
// are logged instead (none exist today beyond the always-present v1.0 baseline).
//
// A second pass normalizes historical data: early builds stored some numeric
// values as text (e.g. "52.9%"), which crashes renderer formatting
// ("val.toFixed is not a function") and silently corrupts scoring. Text values
// in REAL columns are CAST to their numeric prefix in place.
// Exported for unit testing.
export function runColumnMigrations(db: SqlJsDatabase): number {
  const tables: SQLiteTable[] = []
  for (const value of Object.values(schema)) {
    if (is(value, SQLiteTable)) tables.push(value)
  }
  let migrationsApplied = 0

  for (const table of tables) {
    const { name: tableName, columns } = getTableConfig(table)
    const result = db.exec(`PRAGMA table_info(${tableName})`)
    if (result.length === 0) continue // table doesn't exist yet (created by SCHEMA_SQL)
    const existing = new Set(result[0].values.map((row) => row[1] as string))

    for (const column of columns) {
      if (existing.has(column.name)) continue
      if (column.notNull || column.primary) {
        logger.warn(
          `Migration: cannot auto-add NOT NULL/primary column ${column.name} to ${tableName} — manual migration required`,
        )
        continue
      }
      logger.info(`Migration: adding column ${column.name} to ${tableName}`)
      db.run(`ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.getSQLType()}`)
      migrationsApplied++
    }

    // Normalize text-typed values lingering in REAL columns from early builds
    for (const column of columns) {
      if (column.getSQLType() !== 'real' || !existing.has(column.name)) continue
      db.run(
        `UPDATE ${tableName} SET ${column.name} = CAST(${column.name} AS REAL) WHERE typeof(${column.name}) = 'text'`,
      )
      const modified = db.getRowsModified()
      if (modified > 0) {
        migrationsApplied++
        logger.info(
          `Migration: normalized ${modified} text values in ${tableName}.${column.name} to REAL`,
        )
      }
    }
  }
  return migrationsApplied
}

// @DEV-GUIDE: In dev mode, bundled DB is at <project>/resources/. In production (packaged),
// it's at process.resourcesPath (Electron's asar-extracted resources folder).
function getBundledDbPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, DB_FILE_NAME)
  }
  return path.join(app.getAppPath(), 'resources', DB_FILE_NAME)
}
