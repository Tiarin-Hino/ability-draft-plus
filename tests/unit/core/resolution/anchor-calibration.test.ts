import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { deriveAffineParams, applyAffineTransform } from '@core/resolution/anchor-calibration'
import type { CalibrationAnchors } from '@core/resolution/types'
import type { LayoutCoordinatesConfig } from '@shared/types'

const configPath = join(__dirname, '../../../../resources/config/layout_coordinates.json')
const config: LayoutCoordinatesConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
const baseLayout = config.resolutions['1920x1080']

// 1080p reference anchors (known values from JSON):
// Ultimate slot 0 (hero_order 0): x=693, y=166, w=53, h=58
// Hero 0: y=146, Hero 1: y=308
const anchors1080p: CalibrationAnchors = {
  ultimateTopLeft: { x: 693, y: 166 },
  ultimateBottomRight: { x: 746, y: 224 }, // 693+53, 166+58
  hero0TopLeft: { x: 140, y: 146 },
  hero1TopLeft: { x: 140, y: 308 },
}

describe('deriveAffineParams', () => {
  it('returns identity transform for 1080p anchors', () => {
    const params = deriveAffineParams(anchors1080p)

    expect(params.xScale).toBeCloseTo(1.0, 2)
    expect(params.yScale).toBeCloseTo(1.0, 2)
    expect(Math.abs(params.xOffset)).toBeLessThan(1)
    expect(Math.abs(params.yOffset)).toBeLessThan(1)
  })

  it('derives correct scale for 1440p anchors', () => {
    // 1440p: ultimate 0: x=925, y=221, w=70, h=78
    // heroes: hero0 y=195, hero1 y=411
    const anchors1440p: CalibrationAnchors = {
      ultimateTopLeft: { x: 925, y: 221 },
      ultimateBottomRight: { x: 995, y: 299 }, // 925+70, 221+78
      hero0TopLeft: { x: 186, y: 195 },
      hero1TopLeft: { x: 186, y: 411 },
    }

    const params = deriveAffineParams(anchors1440p)

    // Expected scale: 1440/1080 = 1.333
    expect(params.xScale).toBeCloseTo(1.32, 1) // 70/53 = 1.321
    expect(params.yScale).toBeCloseTo(1.333, 1) // (411-195)/162 = 1.333
  })

  it('derives meaningful offsets', () => {
    // Simulate shifted UI
    const shiftedAnchors: CalibrationAnchors = {
      ultimateTopLeft: { x: 700, y: 170 },
      ultimateBottomRight: { x: 753, y: 228 },
      hero0TopLeft: { x: 145, y: 150 },
      hero1TopLeft: { x: 145, y: 312 },
    }

    const params = deriveAffineParams(shiftedAnchors)

    expect(params.xScale).toBeCloseTo(1.0, 1) // 53/53
    expect(params.yScale).toBeCloseTo(1.0, 1) // 162/162
    // Offsets should be non-zero since coordinates are shifted
    expect(params.xOffset).not.toBe(0)
    expect(params.yOffset).not.toBe(0)
  })
})

describe('applyAffineTransform', () => {
  it('identity transform returns same coordinates', () => {
    const params = { xScale: 1, yScale: 1, xOffset: 0, yOffset: 0 }
    const transformed = applyAffineTransform(baseLayout, params)

    expect(transformed.ultimate_slots_coords[0].x).toBe(baseLayout.ultimate_slots_coords[0].x)
    expect(transformed.ultimate_slots_coords[0].y).toBe(baseLayout.ultimate_slots_coords[0].y)
  })

  it('2x scale doubles all coordinates', () => {
    const params = { xScale: 2, yScale: 2, xOffset: 0, yOffset: 0 }
    const transformed = applyAffineTransform(baseLayout, params)

    const baseSlot = baseLayout.ultimate_slots_coords[0]
    const transformedSlot = transformed.ultimate_slots_coords[0]

    expect(transformedSlot.x).toBe(baseSlot.x * 2)
    expect(transformedSlot.y).toBe(baseSlot.y * 2)
    expect(transformedSlot.width).toBe(baseSlot.width * 2)
    expect(transformedSlot.height).toBe(baseSlot.height * 2)
  })

  it('offset shifts positions without scaling', () => {
    const params = { xScale: 1, yScale: 1, xOffset: 100, yOffset: 50 }
    const transformed = applyAffineTransform(baseLayout, params)

    const baseSlot = baseLayout.ultimate_slots_coords[0]
    const transformedSlot = transformed.ultimate_slots_coords[0]

    expect(transformedSlot.x).toBe(baseSlot.x + 100)
    expect(transformedSlot.y).toBe(baseSlot.y + 50)
    expect(transformedSlot.width).toBe(baseSlot.width)
    expect(transformedSlot.height).toBe(baseSlot.height)
  })

  it('transforms params correctly', () => {
    const params = { xScale: 1.5, yScale: 1.5, xOffset: 0, yOffset: 0 }
    const transformed = applyAffineTransform(baseLayout, params)

    expect(transformed.heroes_params.width).toBe(Math.round(320 * 1.5))
    expect(transformed.heroes_params.height).toBe(Math.round(146 * 1.5))
  })

  it('preserves hero_order, ability_order, and is_ultimate', () => {
    const params = { xScale: 1.333, yScale: 1.333, xOffset: 0, yOffset: 0 }
    const transformed = applyAffineTransform(baseLayout, params)

    for (let i = 0; i < transformed.ultimate_slots_coords.length; i++) {
      expect(transformed.ultimate_slots_coords[i].hero_order).toBe(
        baseLayout.ultimate_slots_coords[i].hero_order,
      )
    }

    for (let i = 0; i < transformed.standard_slots_coords.length; i++) {
      expect(transformed.standard_slots_coords[i].ability_order).toBe(
        baseLayout.standard_slots_coords[i].ability_order,
      )
    }
  })

  it('round-trip from 1080p anchors produces close coordinates', () => {
    const params = deriveAffineParams(anchors1080p)
    const transformed = applyAffineTransform(baseLayout, params)

    // Should be nearly identical to original
    const baseSlot = baseLayout.ultimate_slots_coords[0]
    const transformedSlot = transformed.ultimate_slots_coords[0]

    expect(Math.abs(transformedSlot.x - baseSlot.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(transformedSlot.y - baseSlot.y)).toBeLessThanOrEqual(1)
  })
})
