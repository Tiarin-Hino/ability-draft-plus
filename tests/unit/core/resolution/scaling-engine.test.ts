import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  scaleCoordinates,
  isAutoScalable,
  parseResolution,
  getAspectFamily,
} from '@core/resolution/scaling-engine'
import type { LayoutCoordinatesConfig, ResolutionLayout, SlotCoordinate } from '@shared/types'

// Load the actual layout_coordinates.json for verification
const configPath = join(__dirname, '../../../../resources/config/layout_coordinates.json')
const config: LayoutCoordinatesConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
const baseLayout = config.resolutions['1920x1080']
const baseLayout1610 = config.resolutions['1920x1200']
const baseLayout219 = config.resolutions['3440x1440']

/**
 * Compare two layouts with a pixel tolerance.
 * Returns the maximum pixel delta found.
 */
function compareLayouts(
  actual: ResolutionLayout,
  expected: ResolutionLayout,
  tolerance: number,
): { maxDelta: number; failures: string[] } {
  let maxDelta = 0
  const failures: string[] = []

  function compareSlots(
    label: string,
    actualSlots: SlotCoordinate[],
    expectedSlots: SlotCoordinate[],
    compareDimensions: boolean,
  ) {
    // Sort by hero_order then x position to align corresponding slots.
    // We compare positions only — is_ultimate/ability_order are metadata that may
    // differ between resolutions' JSON mappings but don't affect coordinate accuracy.
    const sortKey = (s: SlotCoordinate) =>
      `${String(s.hero_order).padStart(2, '0')}-${String(s.x).padStart(5, '0')}-${String(s.y).padStart(5, '0')}`
    const sortedActual = [...actualSlots].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    const sortedExpected = [...expectedSlots].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))

    for (let i = 0; i < Math.min(sortedActual.length, sortedExpected.length); i++) {
      const a = sortedActual[i]
      const e = sortedExpected[i]

      const deltaX = Math.abs(a.x - e.x)
      const deltaY = Math.abs(a.y - e.y)
      maxDelta = Math.max(maxDelta, deltaX, deltaY)

      if (deltaX > tolerance || deltaY > tolerance) {
        failures.push(
          `${label}[${i}] h${e.hero_order}: position (${a.x},${a.y}) vs expected (${e.x},${e.y}), delta=(${deltaX},${deltaY})`,
        )
      }

      if (compareDimensions) {
        const deltaW = Math.abs(a.width - e.width)
        const deltaH = Math.abs(a.height - e.height)
        maxDelta = Math.max(maxDelta, deltaW, deltaH)

        if (deltaW > tolerance || deltaH > tolerance) {
          failures.push(
            `${label}[${i}] h${e.hero_order}: dims (${a.width}x${a.height}) vs expected (${e.width}x${e.height}), delta=(${deltaW},${deltaH})`,
          )
        }
      }
    }
  }

  compareSlots('ultimates', actual.ultimate_slots_coords, expected.ultimate_slots_coords, true)
  compareSlots('standards', actual.standard_slots_coords, expected.standard_slots_coords, true)
  if (actual.models_coords && expected.models_coords) {
    compareSlots('models', actual.models_coords, expected.models_coords, true)
  }
  if (actual.heroes_coords && expected.heroes_coords) {
    compareSlots('heroes', actual.heroes_coords, expected.heroes_coords, false)
  }
  if (actual.selected_abilities_coords && expected.selected_abilities_coords) {
    compareSlots('selected', actual.selected_abilities_coords, expected.selected_abilities_coords, false)
  }

  return { maxDelta, failures }
}

describe('scaleCoordinates', () => {
  it('scales 1080p to 1080p (identity)', () => {
    const scaled = scaleCoordinates(baseLayout, 1920, 1080)
    const { maxDelta } = compareLayouts(scaled, baseLayout, 0)
    expect(maxDelta).toBe(0)
  })

  it('scales 1080p to 2560x1440 within 5px tolerance', () => {
    const expected = config.resolutions['2560x1440']
    const scaled = scaleCoordinates(baseLayout, 2560, 1440)
    const { maxDelta, failures } = compareLayouts(scaled, expected, 5)
    expect(failures).toEqual([])
    expect(maxDelta).toBeLessThanOrEqual(5)
  })

  it('scales 1080p to 3840x2160 within 50px tolerance', () => {
    // 4K has non-uniform hero spacing in Dota 2's UI (first gap is 348px,
    // rest are 336px, vs expected uniform 324px from 2x scaling).
    // Ability slot positions are within ~6px, but hero positions drift up to 48px.
    // Auto-scaling is a reasonable approximation; preset takes priority.
    const expected = config.resolutions['3840x2160']
    const scaled = scaleCoordinates(baseLayout, 3840, 2160)
    const { maxDelta, failures } = compareLayouts(scaled, expected, 50)
    expect(failures).toEqual([])
    expect(maxDelta).toBeLessThanOrEqual(50)
  })

  it('scales 1080p to 1366x768 within 5px tolerance', () => {
    // 1366x768 is close to 16:9 but not exact (1.778 vs 1.779)
    const expected = config.resolutions['1366x767']
    if (!expected) return // Skip if not in config (may be labeled 1366x767)
    const scaled = scaleCoordinates(baseLayout, 1366, 767)
    const { maxDelta, failures } = compareLayouts(scaled, expected, 5)
    expect(failures).toEqual([])
    expect(maxDelta).toBeLessThanOrEqual(5)
  })

  it('scales 1080p to 3440x1440 (ultrawide) within 35px tolerance', () => {
    // Ultrawide resolutions have non-uniform hero spacing in Dota 2's UI:
    // heroes 0-2 match perfectly, but heroes 3-4 drift up to 32px.
    // Ability slot coordinates (the most important for ML scanning) are within 5px.
    // The 35px tolerance covers the hero position drift.
    const expected = config.resolutions['3440x1440']
    const scaled = scaleCoordinates(baseLayout, 3440, 1440)
    const { maxDelta, failures } = compareLayouts(scaled, expected, 35)
    expect(failures).toEqual([])
    expect(maxDelta).toBeLessThanOrEqual(35)
  })

  it('does NOT match 3840x1600 (uses non-standard Dota 2 layout)', () => {
    // 3840x1600 (24:10) uses a custom UI layout in Dota 2 that doesn't follow
    // the scaleFactor = height/1080 formula. It's kept as a bundled preset.
    const expected = config.resolutions['3840x1600']
    const scaled = scaleCoordinates(baseLayout, 3840, 1600)
    const { maxDelta } = compareLayouts(scaled, expected, 50)
    // maxDelta should be > 5, confirming auto-scaling doesn't work for this resolution
    expect(maxDelta).toBeGreaterThan(5)
  })

  it('produces non-negative coordinates for common resolutions', () => {
    const resolutions = [
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
      [1366, 768],
      [3440, 1440],
      [3840, 1600],
    ]

    for (const [w, h] of resolutions) {
      const scaled = scaleCoordinates(baseLayout, w, h)
      for (const slot of scaled.ultimate_slots_coords) {
        expect(slot.x).toBeGreaterThanOrEqual(0)
        expect(slot.y).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('scales params proportionally', () => {
    const scaled = scaleCoordinates(baseLayout, 2560, 1440)
    const factor = 1440 / 1080
    expect(scaled.heroes_params.width).toBe(Math.round(baseLayout.heroes_params.width * factor))
    expect(scaled.heroes_params.height).toBe(Math.round(baseLayout.heroes_params.height * factor))
  })

  it('preserves hero_order and ability_order', () => {
    const scaled = scaleCoordinates(baseLayout, 2560, 1440)
    const heroOrders = scaled.ultimate_slots_coords.map((s) => s.hero_order).sort((a, b) => a - b)
    expect(heroOrders).toContain(0)
    expect(heroOrders).toContain(10)
    expect(heroOrders).toContain(11)

    const abilityOrders = scaled.standard_slots_coords
      .filter((s) => s.ability_order !== undefined)
      .map((s) => s.ability_order)
    expect(abilityOrders).toContain(1)
    expect(abilityOrders).toContain(2)
    expect(abilityOrders).toContain(3)
  })

  it('applies horizontal offset for ultrawide', () => {
    const scaled = scaleCoordinates(baseLayout, 3440, 1440)
    const factor = 1440 / 1080
    const offset = (3440 - 1920 * factor) / 2

    // The first ultimate should have an X offset applied
    const baseX = baseLayout.ultimate_slots_coords[0].x
    const expectedX = Math.round(baseX * factor + offset)
    const actualX = scaled.ultimate_slots_coords[0].x
    expect(Math.abs(actualX - expectedX)).toBeLessThanOrEqual(1)
  })

  it('scales 1080p to 1600x900 within 5px tolerance', () => {
    const expected = config.resolutions['1600x900']
    const scaled = scaleCoordinates(baseLayout, 1600, 900)
    const { maxDelta, failures } = compareLayouts(scaled, expected, 5)
    expect(failures).toEqual([])
    expect(maxDelta).toBeLessThanOrEqual(5)
  })

  it('scales 3440x1440 to 3440x1440 (21:9 identity)', () => {
    const scaled = scaleCoordinates(baseLayout219, 3440, 1440, 3440, 1440)
    const { maxDelta } = compareLayouts(scaled, baseLayout219, 0)
    expect(maxDelta).toBe(0)
  })

  it('scales 3440x1440 to 2560x1080 (21:9 downscale)', () => {
    const scaled = scaleCoordinates(baseLayout219, 2560, 1080, 3440, 1440)
    for (const slot of scaled.ultimate_slots_coords) {
      expect(slot.x).toBeGreaterThanOrEqual(0)
      expect(slot.y).toBeGreaterThanOrEqual(0)
      expect(slot.x + slot.width).toBeLessThanOrEqual(2560)
      expect(slot.y + slot.height).toBeLessThanOrEqual(1080)
    }
  })

  it('scales 1920x1200 to 1920x1200 (16:10 identity)', () => {
    const scaled = scaleCoordinates(baseLayout1610, 1920, 1200, 1920, 1200)
    const { maxDelta } = compareLayouts(scaled, baseLayout1610, 0)
    expect(maxDelta).toBe(0)
  })

  it('scales 1920x1200 to 1680x1050 (16:10 downscale)', () => {
    const scaled = scaleCoordinates(baseLayout1610, 1680, 1050, 1920, 1200)
    // All coordinates should be non-negative and within bounds
    for (const slot of scaled.ultimate_slots_coords) {
      expect(slot.x).toBeGreaterThanOrEqual(0)
      expect(slot.y).toBeGreaterThanOrEqual(0)
      expect(slot.x + slot.width).toBeLessThanOrEqual(1680)
      expect(slot.y + slot.height).toBeLessThanOrEqual(1050)
    }
  })
})

describe('isAutoScalable', () => {
  it('returns true for 16:9 (1920x1080)', () => {
    expect(isAutoScalable(1920, 1080)).toBe(true)
  })

  it('returns true for 16:9 (2560x1440)', () => {
    expect(isAutoScalable(2560, 1440)).toBe(true)
  })

  it('returns true for 21:9 ultrawide (3440x1440)', () => {
    expect(isAutoScalable(3440, 1440)).toBe(true)
  })

  it('returns true for 32:9 super ultrawide (5120x1440)', () => {
    expect(isAutoScalable(5120, 1440)).toBe(true)
  })

  it('returns true for 16:10 (1920x1200)', () => {
    expect(isAutoScalable(1920, 1200)).toBe(true)
  })

  it('returns true for 16:10 (1680x1050)', () => {
    expect(isAutoScalable(1680, 1050)).toBe(true)
  })

  it('returns true for 4:3 (1024x768)', () => {
    expect(isAutoScalable(1024, 768)).toBe(true)
  })

  it('returns false for very narrow (1:1)', () => {
    expect(isAutoScalable(800, 800)).toBe(false)
  })
})

describe('getAspectFamily', () => {
  it('returns 16:9 for standard widescreen', () => {
    expect(getAspectFamily(1920, 1080)).toBe('16:9')
    expect(getAspectFamily(2560, 1440)).toBe('16:9')
    expect(getAspectFamily(1600, 900)).toBe('16:9')
  })

  it('returns 21:9 for ultrawide', () => {
    expect(getAspectFamily(3440, 1440)).toBe('21:9')
    expect(getAspectFamily(2560, 1080)).toBe('21:9')
    expect(getAspectFamily(5120, 1440)).toBe('21:9')
    expect(getAspectFamily(3840, 1600)).toBe('21:9')
  })

  it('returns 16:10 for 16:10 resolutions', () => {
    expect(getAspectFamily(1920, 1200)).toBe('16:10')
    expect(getAspectFamily(1680, 1050)).toBe('16:10')
    expect(getAspectFamily(1440, 900)).toBe('16:10')
  })

  it('returns 4:3 for 4:3 and 5:4 resolutions', () => {
    expect(getAspectFamily(1024, 768)).toBe('4:3')
    expect(getAspectFamily(1600, 1200)).toBe('4:3')
    expect(getAspectFamily(1280, 1024)).toBe('4:3') // 5:4
  })

  it('returns null for very narrow ratios', () => {
    expect(getAspectFamily(800, 800)).toBeNull() // 1:1
  })
})

describe('parseResolution', () => {
  it('parses valid resolution string', () => {
    expect(parseResolution('1920x1080')).toEqual({ width: 1920, height: 1080 })
  })

  it('parses ultrawide resolution', () => {
    expect(parseResolution('3440x1440')).toEqual({ width: 3440, height: 1440 })
  })

  it('returns null for invalid format', () => {
    expect(parseResolution('invalid')).toBeNull()
    expect(parseResolution('1920')).toBeNull()
    expect(parseResolution('1920x')).toBeNull()
    expect(parseResolution('')).toBeNull()
  })
})
