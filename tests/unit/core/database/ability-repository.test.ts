import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAbilityRepository, type AbilityRepository } from '@core/database/repositories/ability-repository'
import { createTestDb, seedTestData, type TestDb } from './test-helpers'

describe('AbilityRepository', () => {
  let testDb: TestDb
  let repo: AbilityRepository

  beforeAll(async () => {
    testDb = await createTestDb()
    seedTestData(testDb.db)
    repo = createAbilityRepository(testDb.db)
  })

  afterAll(() => {
    testDb.close()
  })

  describe('getDetails', () => {
    it('returns a Map keyed by ability name', () => {
      const result = repo.getDetails(['antimage_mana_break', 'antimage_blink'])
      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(2)
      expect(result.has('antimage_mana_break')).toBe(true)
      expect(result.has('antimage_blink')).toBe(true)
    })

    it('returns correct ability details', () => {
      const result = repo.getDetails(['antimage_mana_break'])
      const ability = result.get('antimage_mana_break')
      expect(ability).toBeDefined()
      expect(ability!.displayName).toBe('Mana Break')
      expect(ability!.winrate).toBe(0.55)
      expect(ability!.highSkillWinrate).toBe(0.57)
      expect(ability!.pickRate).toBe(100)
      expect(ability!.isUltimate).toBe(false)
      expect(ability!.abilityOrder).toBe(1)
      expect(ability!.heroId).toBe(1)
    })

    it('falls back displayName to internal name when null', () => {
      const result = repo.getDetails(['invoker_quas'])
      const ability = result.get('invoker_quas')
      expect(ability).toBeDefined()
      expect(ability!.displayName).toBe('invoker_quas')
    })

    it('returns empty Map for empty input array', () => {
      const result = repo.getDetails([])
      expect(result.size).toBe(0)
    })

    it('ignores unknown ability names', () => {
      const result = repo.getDetails(['antimage_mana_break', 'nonexistent'])
      expect(result.size).toBe(1)
      expect(result.has('antimage_mana_break')).toBe(true)
    })
  })

  describe('getByHeroId', () => {
    it('returns abilities sorted by ability_order', () => {
      const result = repo.getByHeroId(1)
      expect(result).toHaveLength(4)
      expect(result[0].name).toBe('antimage_mana_break')
      expect(result[0].abilityOrder).toBe(1)
      expect(result[1].name).toBe('antimage_blink')
      expect(result[1].abilityOrder).toBe(2)
      expect(result[2].name).toBe('antimage_counterspell')
      expect(result[2].abilityOrder).toBe(3)
      expect(result[3].name).toBe('antimage_mana_void')
      expect(result[3].abilityOrder).toBe(4)
      expect(result[3].isUltimate).toBe(true)
    })

    it('returns empty array for unknown hero ID', () => {
      const result = repo.getByHeroId(999)
      expect(result).toHaveLength(0)
    })

    it('returns correct displayName fallback', () => {
      const result = repo.getByHeroId(4)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('invoker_quas')
      expect(result[0].displayName).toBe('invoker_quas')
    })
  })

  describe('getAllNames', () => {
    it('returns all ability names', () => {
      const names = repo.getAllNames()
      expect(names).toContain('antimage_mana_break')
      expect(names).toContain('antimage_blink')
      expect(names).toContain('invoker_quas')
      expect(names.length).toBeGreaterThan(0)
    })
  })

  describe('updateAbilityMeta', () => {
    it('updates abilityOrder and isUltimate for existing abilities', () => {
      const count = repo.updateAbilityMeta([
        { name: 'antimage_mana_break', abilityOrder: 10, isUltimate: true },
      ])
      expect(count).toBe(1)

      const details = repo.getDetails(['antimage_mana_break'])
      const ability = details.get('antimage_mana_break')
      expect(ability!.abilityOrder).toBe(10)
      expect(ability!.isUltimate).toBe(true)

      // Restore original values
      repo.updateAbilityMeta([
        { name: 'antimage_mana_break', abilityOrder: 1, isUltimate: false },
      ])
    })

    it('returns 0 for non-existent ability names', () => {
      const count = repo.updateAbilityMeta([
        { name: 'nonexistent_ability', abilityOrder: 1, isUltimate: false },
      ])
      expect(count).toBe(0)
    })

    it('handles empty updates array', () => {
      const count = repo.updateAbilityMeta([])
      expect(count).toBe(0)
    })
  })
})
