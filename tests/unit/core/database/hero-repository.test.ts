import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHeroRepository, type HeroRepository } from '@core/database/repositories/hero-repository'
import { createTestDb, seedTestData, type TestDb } from './test-helpers'

describe('HeroRepository', () => {
  let testDb: TestDb
  let repo: HeroRepository

  beforeAll(async () => {
    testDb = await createTestDb()
    seedTestData(testDb.db)
    repo = createHeroRepository(testDb.db)
  })

  afterAll(() => {
    testDb.close()
  })

  describe('getAll', () => {
    it('returns all heroes with heroId, name, displayName', () => {
      const heroes = repo.getAll()
      expect(heroes).toHaveLength(4)
      expect(heroes[0]).toHaveProperty('heroId')
      expect(heroes[0]).toHaveProperty('name')
      expect(heroes[0]).toHaveProperty('displayName')
    })

    it('falls back displayName to name when displayName is null in getAll', () => {
      const heroes = repo.getAll()
      const invoker = heroes.find((h) => h.name === 'invoker')
      expect(invoker).toBeDefined()
      expect(invoker!.displayName).toBe('invoker')
    })
  })

  describe('getById', () => {
    it('returns full hero details for a valid ID', () => {
      const hero = repo.getById(1)
      expect(hero).not.toBeNull()
      expect(hero!.name).toBe('antimage')
      expect(hero!.displayName).toBe('Anti-Mage')
      expect(hero!.winrate).toBe(0.52)
      expect(hero!.highSkillWinrate).toBe(0.54)
      expect(hero!.pickRate).toBe(120)
      expect(hero!.hsPickRate).toBe(80)
      expect(hero!.windrunId).toBe(1)
    })

    it('returns null for unknown hero ID', () => {
      const hero = repo.getById(999)
      expect(hero).toBeNull()
    })

    it('falls back displayName to name when displayName is null', () => {
      const hero = repo.getById(4)
      expect(hero).not.toBeNull()
      expect(hero!.name).toBe('invoker')
      expect(hero!.displayName).toBe('invoker')
    })
  })

  describe('getByAbilityName', () => {
    it('returns hero details for a known ability name', () => {
      const hero = repo.getByAbilityName('antimage_mana_break')
      expect(hero).not.toBeNull()
      expect(hero!.heroId).toBe(1)
      expect(hero!.heroName).toBe('antimage')
      expect(hero!.heroDisplayName).toBe('Anti-Mage')
    })

    it('returns null for unknown ability name', () => {
      const hero = repo.getByAbilityName('nonexistent_ability')
      expect(hero).toBeNull()
    })

    it('returns null for empty string', () => {
      const hero = repo.getByAbilityName('')
      expect(hero).toBeNull()
    })
  })
})
