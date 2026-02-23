import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from 'electron-log/main'

// @DEV-GUIDE: Manages the SQLite database via sql.js (WASM, no native modules) + Drizzle ORM.
// Database runs entirely in-memory for fast synchronous queries. Writes are explicit via persist().
//
// Lifecycle: initialize() loads the .db file from %APPDATA% into memory (or copies bundled seed
// on first run), creates Drizzle instance, runs CREATE TABLE IF NOT EXISTS for all tables,
// then creates five repositories (hero, ability, synergy, triplet, metadata).
//
// Key gotcha: sql.js's run() returns the Database instance, NOT { changes: N }.
// Drizzle propagates this, so result.changes is always undefined. Use SELECT-before-UPDATE.
//
// persist() serializes the entire in-memory DB to disk via sqliteDb.export() → fs.writeFileSync.
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
  persist(): void
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

  let heroRepo: HeroRepository
  let abilityRepo: AbilityRepository
  let synergyRepo: SynergyRepository
  let tripletRepo: TripletRepository
  let metadataRepo: MetadataRepository

  function initRepositories(): void {
    heroRepo = createHeroRepository(drizzleDb)
    abilityRepo = createAbilityRepository(drizzleDb)
    synergyRepo = createSynergyRepository(drizzleDb)
    tripletRepo = createTripletRepository(drizzleDb)
    metadataRepo = createMetadataRepository(drizzleDb)
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

    // 5. Create Drizzle instance
    drizzleDb = drizzle(sqliteDb, { schema })

    // 6. Persist (in case schema was just created for an empty DB)
    persist()

    // 7. Create repositories
    initRepositories()

    // 8. Clean up duplicate heroes from seed/Windrun name mismatch
    const deduped = heroRepo.deduplicateByDisplayName()
    if (deduped > 0) {
      logger.info(`Removed ${deduped} duplicate hero entries`)
      persist()
    }

    logger.info('Database initialized successfully', {
      path: dbPath,
      firstRun,
    })
  }

  function persist(): void {
    const data = sqliteDb.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(dbPath, buffer)
    logger.debug('Database persisted to disk', {
      path: dbPath,
      size: buffer.length,
    })
  }

  function close(): void {
    try {
      persist()
      sqliteDb.close()
      logger.info('Database closed')
    } catch (err) {
      logger.error('Error closing database', { error: err })
    }
  }

  function reload(data: Uint8Array): void {
    sqliteDb.close()
    sqliteDb = new SQL.Database(data)
    sqliteDb.run('PRAGMA foreign_keys = ON;')
    drizzleDb = drizzle(sqliteDb, { schema })
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
    persist,
    close,
    getDbPath: () => dbPath,
    isFirstRun: () => firstRun,
    reload,
  }
}

// @DEV-GUIDE: In dev mode, bundled DB is at <project>/resources/. In production (packaged),
// it's at process.resourcesPath (Electron's asar-extracted resources folder).
function getBundledDbPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, DB_FILE_NAME)
  }
  return path.join(app.getAppPath(), 'resources', DB_FILE_NAME)
}
