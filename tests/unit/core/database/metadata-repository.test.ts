import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createMetadataRepository, type MetadataRepository } from '@core/database/repositories/metadata-repository'
import { createTestDb, seedTestData, type TestDb } from './test-helpers'
import { DEFAULT_SETTINGS } from '@shared/constants/defaults'

describe('MetadataRepository', () => {
  let testDb: TestDb
  let repo: MetadataRepository

  beforeAll(async () => {
    testDb = await createTestDb()
    seedTestData(testDb.db)
    repo = createMetadataRepository(testDb.db)
  })

  afterAll(() => {
    testDb.close()
  })

  describe('get/set', () => {
    it('round-trips a value', () => {
      repo.set('test_key', 'test_value')
      expect(repo.get('test_key')).toBe('test_value')
    })

    it('returns null for non-existent key', () => {
      expect(repo.get('nonexistent_key')).toBeNull()
    })

    it('overwrites existing value', () => {
      repo.set('overwrite_key', 'first')
      repo.set('overwrite_key', 'second')
      expect(repo.get('overwrite_key')).toBe('second')
    })
  })

  describe('getSettings', () => {
    it('returns defaults when no settings are stored', async () => {
      // Create a fresh DB with no settings
      const freshDb = await createTestDb()
      const freshRepo = createMetadataRepository(freshDb.db)

      const settings = freshRepo.getSettings()
      expect(settings.opThreshold).toBe(DEFAULT_SETTINGS.opThreshold)
      expect(settings.trapThreshold).toBe(DEFAULT_SETTINGS.trapThreshold)
      expect(settings.language).toBe(DEFAULT_SETTINGS.language)

      freshDb.close()
    })

    it('returns stored settings when available', () => {
      repo.setSettings({
        opThreshold: 0.15,
        trapThreshold: 0.08,
        language: 'ru',
      })

      const settings = repo.getSettings()
      expect(settings.opThreshold).toBe(0.15)
      expect(settings.trapThreshold).toBe(0.08)
      expect(settings.language).toBe('ru')
    })
  })

  describe('setSettings', () => {
    it('handles partial updates', () => {
      repo.setSettings({ language: 'en' })
      const settings = repo.getSettings()
      // language should be updated, others should retain previous values
      expect(settings.language).toBe('en')
      expect(settings.opThreshold).toBe(0.15) // from previous test
    })

    it('handles partial updates without extra keys', () => {
      repo.setSettings({ opThreshold: 0.20 })
      const settings = repo.getSettings()
      expect(settings.opThreshold).toBe(0.20)
      expect(settings.language).toBe('en') // from previous test
    })

    it('round-trips the Simplified Chinese locale', () => {
      repo.setSettings({ language: 'zh-CN' })
      expect(repo.getSettings().language).toBe('zh-CN')
    })
  })

  describe('role settings', () => {
    it('defaults to mode off with no fixed positions', async () => {
      const freshDb = await createTestDb()
      const freshRepo = createMetadataRepository(freshDb.db)
      const settings = freshRepo.getSettings()
      expect(settings.roleMode).toBe('off')
      expect(settings.roleFixedPositions).toEqual([])
      freshDb.close()
    })

    it('round-trips mode and fixed positions', () => {
      repo.setSettings({ roleMode: 'fixed', roleFixedPositions: [4, 5] })
      const settings = repo.getSettings()
      expect(settings.roleMode).toBe('fixed')
      expect(settings.roleFixedPositions).toEqual([4, 5])
    })

    it('round-trips an empty position selection', () => {
      repo.setSettings({ roleFixedPositions: [] })
      expect(repo.getSettings().roleFixedPositions).toEqual([])
    })

    it('drops junk stored values instead of crashing', () => {
      repo.set('role_mode', 'nonsense')
      repo.set('role_fixed_positions', '0,3,7,x')
      const settings = repo.getSettings()
      expect(settings.roleMode).toBe('off')
      expect(settings.roleFixedPositions).toEqual([3])
    })
  })

  describe('getLastScrapeDate / setLastScrapeDate', () => {
    it('returns seeded scrape date', () => {
      expect(repo.getLastScrapeDate()).toBe('2024-11-15')
    })

    it('updates scrape date', () => {
      repo.setLastScrapeDate('2026-02-16')
      expect(repo.getLastScrapeDate()).toBe('2026-02-16')
    })

    it('returns null when key has null value', async () => {
      const freshDb = await createTestDb()
      const freshRepo = createMetadataRepository(freshDb.db)
      // SCHEMA_SQL inserts last_successful_scrape_date with NULL value
      expect(freshRepo.getLastScrapeDate()).toBeNull()
      freshDb.close()
    })
  })
})
