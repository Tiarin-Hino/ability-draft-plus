import { describe, it, expect } from 'vitest'
import { mergeRetriedPoolSlots, unresolvedPoolSlots } from '@core/domain/pool-retry'
import type { PoolCache } from '@core/domain/pool-retry'
import type { ScanResult } from '@shared/types'

function slot(
  x: number,
  y: number,
  name: string | null,
  isUltimate = false,
): ScanResult {
  return {
    name,
    confidence: name ? 0.99 : 0.4,
    hero_order: 0,
    ability_order: 1,
    is_ultimate: isUltimate,
    coord: { x, y, width: 50, height: 50, hero_order: 0 },
  }
}

const cache: PoolCache = {
  ultimates: [slot(10, 10, 'axe_culling_blade', true), slot(20, 10, null, true)],
  standard: [slot(10, 50, 'axe_berserkers_call'), slot(20, 50, null)],
}

describe('unresolvedPoolSlots', () => {
  it('returns only the Unknown entries', () => {
    const un = unresolvedPoolSlots(cache)
    expect(un).toHaveLength(2)
    expect(un.map((s) => s.coord.x)).toEqual([20, 20])
  })
})

describe('mergeRetriedPoolSlots', () => {
  it('fills Unknown slots and reports what resolved', () => {
    const { cache: merged, resolved } = mergeRetriedPoolSlots(cache, [
      slot(20, 10, 'ursa_enrage', true),
      slot(20, 50, 'spirit_breaker_bulldoze'),
    ])
    expect(resolved.sort()).toEqual(['spirit_breaker_bulldoze', 'ursa_enrage'])
    expect(merged.ultimates[1].name).toBe('ursa_enrage')
    expect(merged.standard[1].name).toBe('spirit_breaker_bulldoze')
    expect(unresolvedPoolSlots(merged)).toHaveLength(0)
  })

  it('never overwrites an already-known slot', () => {
    // A slot whose ability was drafted reads differently now — it must keep
    // the name the initial scan gave it.
    const { cache: merged, resolved } = mergeRetriedPoolSlots(cache, [
      slot(10, 10, 'wrong_ability', true),
    ])
    expect(merged.ultimates[0].name).toBe('axe_culling_blade')
    expect(resolved).toEqual([])
  })

  it('ignores retries that resolved to nothing', () => {
    const { cache: merged, resolved } = mergeRetriedPoolSlots(cache, [
      slot(20, 10, null, true),
    ])
    expect(resolved).toEqual([])
    expect(merged).toBe(cache)
  })

  it('leaves the cache untouched when nothing matches', () => {
    const { cache: merged } = mergeRetriedPoolSlots(cache, [slot(99, 99, 'x')])
    expect(merged.ultimates[1].name).toBeNull()
  })
})
