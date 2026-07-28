import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
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

})

// Separate DB instance: these tests mutate ability_order/is_ultimate
describe('AbilityRepository.applyLiquipediaMeta', () => {
  let testDb: TestDb
  let repo: AbilityRepository

  beforeEach(async () => {
    testDb = await createTestDb()
    seedTestData(testDb.db)
    repo = createAbilityRepository(testDb.db)
  })

  afterEach(() => {
    testDb.close()
  })

  it('applies Q/W/E updates matched by ability + hero display name', () => {
    const applied = repo.applyLiquipediaMeta([
      {
        heroDisplayName: 'Anti-Mage',
        abilityDisplayName: 'Mana Break',
        abilityOrder: 3,
        isUltimateCandidate: false,
      },
    ])

    expect(applied).toBe(1)
    const ability = repo.getDetails(['antimage_mana_break']).get('antimage_mana_break')
    expect(ability!.abilityOrder).toBe(3)
    expect(ability!.isUltimate).toBe(false)
  })

  it('applies an ultimate candidate when the DB row is an ultimate', () => {
    // antimage_mana_void is seeded with isUltimate: true, abilityOrder: 4
    const applied = repo.applyLiquipediaMeta([
      {
        heroDisplayName: 'Anti-Mage',
        abilityDisplayName: 'Mana Void',
        abilityOrder: 0,
        isUltimateCandidate: true,
      },
    ])

    expect(applied).toBe(1)
    const ability = repo.getDetails(['antimage_mana_void']).get('antimage_mana_void')
    expect(ability!.abilityOrder).toBe(0)
    expect(ability!.isUltimate).toBe(true)
  })

  it('skips an ultimate candidate when the DB row is NOT an ultimate', () => {
    // Simulates a hotkeyed sub-ability (e.g. Spectre's Reality on D)
    const applied = repo.applyLiquipediaMeta([
      {
        heroDisplayName: 'Anti-Mage',
        abilityDisplayName: 'Blink',
        abilityOrder: 0,
        isUltimateCandidate: true,
      },
    ])

    expect(applied).toBe(0)
    const ability = repo.getDetails(['antimage_blink']).get('antimage_blink')
    expect(ability!.abilityOrder).toBe(2) // unchanged from seed
    expect(ability!.isUltimate).toBe(false)
  })

  it('does not match the same ability display name under a different hero', () => {
    const applied = repo.applyLiquipediaMeta([
      {
        heroDisplayName: 'Pudge',
        abilityDisplayName: 'Mana Break',
        abilityOrder: 1,
        isUltimateCandidate: false,
      },
    ])

    expect(applied).toBe(0)
    const ability = repo.getDetails(['antimage_mana_break']).get('antimage_mana_break')
    expect(ability!.abilityOrder).toBe(1) // unchanged from seed
  })

  it('skips unknown display names and handles empty input', () => {
    expect(
      repo.applyLiquipediaMeta([
        {
          heroDisplayName: 'Anti-Mage',
          abilityDisplayName: 'Nonexistent Spell',
          abilityOrder: 1,
          isUltimateCandidate: false,
        },
      ]),
    ).toBe(0)
    expect(repo.applyLiquipediaMeta([])).toBe(0)
  })
})

// Separate DB instance: these tests mutate ability_order/is_ultimate
describe('AbilityRepository.setSlotMetadata', () => {
  let testDb: TestDb
  let repo: AbilityRepository

  beforeEach(async () => {
    testDb = await createTestDb()
    seedTestData(testDb.db)
    repo = createAbilityRepository(testDb.db)
  })

  afterEach(() => {
    testDb.close()
  })

  it('forces ability_order and is_ultimate by internal name', () => {
    const applied = repo.setSlotMetadata([
      { name: 'antimage_mana_break', abilityOrder: 3, isUltimate: false },
      { name: 'antimage_mana_void', abilityOrder: 0, isUltimate: true },
    ])

    expect(applied).toBe(2)
    const details = repo.getDetails(['antimage_mana_break', 'antimage_mana_void'])
    expect(details.get('antimage_mana_break')!.abilityOrder).toBe(3)
    expect(details.get('antimage_mana_void')!.abilityOrder).toBe(0)
    expect(details.get('antimage_mana_void')!.isUltimate).toBe(true)
  })

  it('overrides even rows that already hold a (wrong) value', () => {
    // Unlike Liquipedia candidates, overrides are authoritative — they must
    // correct rows like juggernaut_healing_ward that carry stale slot data
    repo.setSlotMetadata([{ name: 'antimage_blink', abilityOrder: 1, isUltimate: false }])
    const blink = repo.getDetails(['antimage_blink']).get('antimage_blink')
    expect(blink!.abilityOrder).toBe(1) // seed had 2
  })

  it('counts only names that exist and handles empty input', () => {
    const applied = repo.setSlotMetadata([
      { name: 'antimage_mana_break', abilityOrder: 1, isUltimate: false },
      { name: 'no_such_ability', abilityOrder: 2, isUltimate: false },
    ])
    expect(applied).toBe(1)
    expect(repo.setSlotMetadata([])).toBe(0)
  })
})

// Separate DB instance: these tests delete rows and would corrupt the shared fixture above
describe('AbilityRepository.deleteAbilitiesNotIn', () => {
  let testDb: TestDb
  let repo: AbilityRepository

  beforeEach(async () => {
    testDb = await createTestDb()
    seedTestData(testDb.db)
    repo = createAbilityRepository(testDb.db)
  })

  afterEach(() => {
    testDb.close()
  })

  it('deletes abilities not in keepNames and returns their names', () => {
    const keep = repo.getAllNames().filter((n) => n !== 'pudge_rot' && n !== 'invoker_quas')

    const deleted = repo.deleteAbilitiesNotIn(keep)

    expect(deleted.sort()).toEqual(['invoker_quas', 'pudge_rot'])
    const remaining = repo.getAllNames()
    expect(remaining).not.toContain('pudge_rot')
    expect(remaining).not.toContain('invoker_quas')
    expect(remaining).toContain('antimage_mana_break')
  })

  it('returns empty array when everything is kept', () => {
    const deleted = repo.deleteAbilitiesNotIn(repo.getAllNames())

    expect(deleted).toEqual([])
    expect(repo.getAllNames().length).toBeGreaterThan(0)
  })

  it('is a no-op for empty keepNames (never wipes the table)', () => {
    const before = repo.getAllNames().length

    const deleted = repo.deleteAbilitiesNotIn([])

    expect(deleted).toEqual([])
    expect(repo.getAllNames().length).toBe(before)
  })

  it('cascades deletion of dependent synergy rows', () => {
    // frostbite (abilityId 6) participates in seeded AbilitySynergies rows
    const keep = repo.getAllNames().filter((n) => n !== 'crystal_maiden_frostbite')

    repo.deleteAbilitiesNotIn(keep)

    const orphans = testDb.sqlite.exec(
      'SELECT COUNT(*) FROM AbilitySynergies WHERE base_ability_id = 6 OR synergy_ability_id = 6',
    )
    expect(orphans[0].values[0][0]).toBe(0)
  })
})
