import { describe, it, expect, afterEach } from 'vitest'
import type { Database as SqlJsDatabase } from 'sql.js'
import { createHeroRepository } from '@core/database/repositories/hero-repository'
import { createTestDb, seedTestData, type TestDb } from './test-helpers'

// drizzle-orm 0.45.2's sql.js driver prepared a statement in every typed
// `select().all()` and never freed it. sql.js statements live in the WASM heap
// until freed, so the app leaked one per query — and the stream server ran
// heroes.getAll() on every GSI update. A 5-hour diagnostic run (2026-09-18,
// 75 drafts) died with "out of memory" inside sql.js. Fixed by
// patches/drizzle-orm+0.45.2.patch (applied by patch-package on install).
// If this fails after a drizzle upgrade, the patch no longer applies: check
// whether the new release fixed `PreparedQuery.all` and re-create or drop it.

/** Counts statements that were prepared but never freed. */
function trackOpenStatements(sqlite: SqlJsDatabase): () => number {
  let open = 0
  const prepare = sqlite.prepare.bind(sqlite)
  sqlite.prepare = ((...args: Parameters<SqlJsDatabase['prepare']>) => {
    const stmt = prepare(...args)
    open++
    const free = stmt.free.bind(stmt)
    stmt.free = () => {
      open--
      return free()
    }
    return stmt
  }) as SqlJsDatabase['prepare']
  return () => open
}

describe('sql.js prepared statements', () => {
  let testDb: TestDb

  afterEach(() => testDb.close())

  it('a typed select frees every statement it prepares (drizzle patch)', async () => {
    testDb = await createTestDb()
    seedTestData(testDb.db)
    const openStatements = trackOpenStatements(testDb.sqlite)
    const heroes = createHeroRepository(testDb.db)

    for (let i = 0; i < 200; i++) heroes.getAll()

    expect(heroes.getAll().length).toBeGreaterThan(0)
    expect(openStatements()).toBe(0)
  })
})
