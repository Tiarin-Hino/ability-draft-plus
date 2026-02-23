import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createSynergyRepository, type SynergyRepository } from '@core/database/repositories/synergy-repository'
import { createTestDb, seedTestData, type TestDb } from './test-helpers'

describe('SynergyRepository', () => {
  let testDb: TestDb
  let repo: SynergyRepository

  beforeAll(async () => {
    testDb = await createTestDb()
    seedTestData(testDb.db)
    repo = createSynergyRepository(testDb.db)
  })

  afterAll(() => {
    testDb.close()
  })

  describe('getHighWinrateCombinations', () => {
    it('finds synergies when base is on base_ability_id side', () => {
      // mana_break(1) -> frostbite(6) is stored as base=1, synergy=6
      const pool = ['antimage_mana_break', 'crystal_maiden_frostbite']
      const result = repo.getHighWinrateCombinations('antimage_mana_break', pool)
      expect(result.length).toBeGreaterThanOrEqual(1)
      const frostbite = result.find((r) => r.partnerInternalName === 'crystal_maiden_frostbite')
      expect(frostbite).toBeDefined()
      expect(frostbite!.synergyWinrate).toBe(0.65)
    })

    it('finds synergies when base is on synergy_ability_id side (reverse)', () => {
      // frostbite(6) -> meat_hook(8) is stored as base=6, synergy=8
      // Looking up meat_hook against pool containing frostbite should find it
      const pool = ['pudge_meat_hook', 'crystal_maiden_frostbite']
      const result = repo.getHighWinrateCombinations('pudge_meat_hook', pool)
      const frostbite = result.find((r) => r.partnerInternalName === 'crystal_maiden_frostbite')
      expect(frostbite).toBeDefined()
      expect(frostbite!.synergyWinrate).toBe(0.56)
    })

    it('excludes same-hero ability pairs', () => {
      // mana_break(1) + blink(2) are both Anti-Mage abilities
      const pool = ['antimage_mana_break', 'antimage_blink', 'crystal_maiden_frostbite']
      const result = repo.getHighWinrateCombinations('antimage_mana_break', pool)
      const blink = result.find((r) => r.partnerInternalName === 'antimage_blink')
      expect(blink).toBeUndefined()
    })

    it('returns results sorted by synergy_winrate descending', () => {
      const pool = [
        'antimage_mana_break',
        'crystal_maiden_frostbite',
        'pudge_meat_hook',
        'crystal_maiden_crystal_nova',
      ]
      const result = repo.getHighWinrateCombinations('crystal_maiden_frostbite', pool)
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].synergyWinrate).toBeGreaterThanOrEqual(
          result[i].synergyWinrate,
        )
      }
    })

    it('returns empty for empty pool', () => {
      expect(repo.getHighWinrateCombinations('antimage_mana_break', [])).toEqual([])
    })

    it('returns empty for unknown base ability', () => {
      expect(repo.getHighWinrateCombinations('nonexistent', ['antimage_mana_break'])).toEqual([])
    })

    it('returns empty for empty base ability name', () => {
      expect(repo.getHighWinrateCombinations('', ['antimage_mana_break'])).toEqual([])
    })
  })

  describe('getOPCombinationsInPool', () => {
    it('returns OP pairs where both abilities are in the pool', () => {
      const pool = [
        'antimage_mana_break',
        'crystal_maiden_frostbite',
        'crystal_maiden_brilliance_aura',
        'invoker_quas',
      ]
      const result = repo.getOPCombinationsInPool(pool, 0.13)
      // mana_break + frostbite (0.15) and brilliance_aura + invoker_quas (0.18)
      expect(result.length).toBe(2)
    })

    it('excludes pairs where one ability is not in pool', () => {
      const pool = ['antimage_mana_break']
      const result = repo.getOPCombinationsInPool(pool, 0.13)
      expect(result.length).toBe(0)
    })

    it('returns empty for pool with fewer than 2 abilities', () => {
      expect(repo.getOPCombinationsInPool(['antimage_mana_break'], 0.13)).toEqual([])
    })
  })

  describe('getAllOPCombinations', () => {
    it('returns all pairs above threshold', () => {
      const result = repo.getAllOPCombinations(0.13)
      // synergy_increase >= 0.13: mana_break+frostbite (0.15) and brilliance_aura+invoker_quas (0.18)
      expect(result.length).toBe(2)
      expect(result.every((r) => r.ability1InternalName && r.ability2InternalName)).toBe(true)
    })

    it('returns more results with lower threshold', () => {
      const result = repo.getAllOPCombinations(0.03)
      // 0.03: includes blink+meat_hook (0.05), frostbite+meat_hook (0.03), plus the two 0.13+ ones
      // and mana_break+blink (0.1)
      expect(result.length).toBeGreaterThan(2)
    })
  })

  describe('getAllHeroSynergies', () => {
    it('returns hero-ability synergies above threshold', () => {
      const result = repo.getAllHeroSynergies(0.13)
      // Anti-Mage + Meat Hook (0.15)
      expect(result.length).toBe(1)
      expect(result[0].heroInternalName).toBe('antimage')
      expect(result[0].abilityInternalName).toBe('pudge_meat_hook')
    })

    it('returns more with lower threshold', () => {
      const result = repo.getAllHeroSynergies(0.05)
      // 0.05: Anti-Mage+Meat Hook (0.15), Anti-Mage+Crystal Nova (0.1), Pudge+Brilliance (0.06)
      expect(result.length).toBe(3)
    })
  })

  describe('getAllHeroAbilitySynergiesUnfiltered', () => {
    it('returns all hero-ability synergies without filtering', () => {
      const result = repo.getAllHeroAbilitySynergiesUnfiltered()
      // All 4 hero-ability synergies inserted in seed
      expect(result.length).toBe(4)
    })

    it('includes both positive and negative synergies', () => {
      const result = repo.getAllHeroAbilitySynergiesUnfiltered()
      const negative = result.filter((r) => r.synergyWinrate < 0.5)
      const positive = result.filter((r) => r.synergyWinrate >= 0.5)
      expect(negative.length).toBeGreaterThan(0)
      expect(positive.length).toBeGreaterThan(0)
    })

    it('uses display_name fallback for null values', () => {
      const result = repo.getAllHeroAbilitySynergiesUnfiltered()
      result.forEach((row) => {
        expect(row.heroDisplayName).toBeTruthy()
        expect(row.abilityDisplayName).toBeTruthy()
      })
    })
  })

  describe('getHeroSynergiesInPool', () => {
    it('filters to abilities in the pool', () => {
      const pool = ['pudge_meat_hook']
      const result = repo.getHeroSynergiesInPool(pool, 0.1)
      // Anti-Mage + Meat Hook (0.15 >= 0.1)
      expect(result.length).toBe(1)
      expect(result[0].abilityDisplayName).toBe('Meat Hook')
    })

    it('returns empty for empty pool', () => {
      expect(repo.getHeroSynergiesInPool([], 0.1)).toEqual([])
    })
  })

  describe('getAllTrapCombinations', () => {
    it('returns pairs with synergy_increase <= -threshold', () => {
      const result = repo.getAllTrapCombinations(0.05)
      // crystal_nova + rot has synergy_increase = -0.08, which is <= -0.05
      expect(result.length).toBe(1)
      expect(result[0].synergyWinrate).toBe(0.38)
    })

    it('returns empty when no pairs below threshold', () => {
      const result = repo.getAllTrapCombinations(0.5)
      expect(result.length).toBe(0)
    })
  })

  describe('getAllHeroTrapSynergies', () => {
    it('returns hero-ability synergies with synergy_increase <= -threshold', () => {
      const result = repo.getAllHeroTrapSynergies(0.05)
      // Crystal Maiden + Blink has synergy_increase = -0.1, which is <= -0.05
      expect(result.length).toBe(1)
      expect(result[0].heroInternalName).toBe('crystal_maiden')
      expect(result[0].abilityInternalName).toBe('antimage_blink')
    })
  })
})
