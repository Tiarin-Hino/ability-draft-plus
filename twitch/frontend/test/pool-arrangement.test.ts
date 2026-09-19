import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { STD_PAIRS, ULT_ROWS } from '../src/geometry/pool-arrangement'

// Re-derives the canonical arrangement from the shipped 1080p layout preset so the
// constants can never silently diverge from the game screen the app scans.

interface Coord {
  x: number
  y: number
  hero_order: number
  ability_order?: number
}

const layout = JSON.parse(
  readFileSync(resolve(__dirname, '../../../resources/config/layout_coordinates.json'), 'utf-8'),
).resolutions['1920x1080'] as {
  ultimate_slots_coords: Coord[]
  standard_slots_coords: Coord[]
}

function groupByRow(coords: Coord[]): Coord[][] {
  const rows = new Map<number, Coord[]>()
  for (const c of coords) {
    const key = Math.round(c.y / 10)
    rows.set(key, [...(rows.get(key) ?? []), c])
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row.sort((a, b) => a.x - b.x))
}

describe('pool arrangement', () => {
  it('ULT_ROWS matches the layout', () => {
    const rows = groupByRow(layout.ultimate_slots_coords).map((row) => row.map((c) => c.hero_order))
    expect(rows).toEqual(ULT_ROWS.map((r) => [...r]))
  })

  it('STD_PAIRS matches the layout', () => {
    const pairs = groupByRow(layout.standard_slots_coords).map((row) => {
      const left = row.filter((c) => c.x < 960).map((c) => c.hero_order)
      const right = row.filter((c) => c.x >= 960).map((c) => c.hero_order)
      return [new Set(left).values().next().value, new Set(right).values().next().value]
    })
    expect(pairs).toEqual(STD_PAIRS.map((p) => [...p]))
  })
})
