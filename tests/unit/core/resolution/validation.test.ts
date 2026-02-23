import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validateCoordinates } from '@core/resolution/validation'
import type { LayoutCoordinatesConfig, ResolutionLayout } from '@shared/types'

const configPath = join(__dirname, '../../../../resources/config/layout_coordinates.json')
const config: LayoutCoordinatesConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
const baseLayout = config.resolutions['1920x1080']

function createValidLayout(): ResolutionLayout {
  return JSON.parse(JSON.stringify(baseLayout))
}

describe('validateCoordinates', () => {
  it('passes for valid 1080p layout', () => {
    const result = validateCoordinates(baseLayout, 1920, 1080)
    expect(result.passed).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('passes for all 7 existing resolutions', () => {
    const resolutionDims: Record<string, [number, number]> = {
      '1920x1080': [1920, 1080],
      '2560x1440': [2560, 1440],
      '3840x2160': [3840, 2160],
      '1366x767': [1366, 767],
      '3440x1440': [3440, 1440],
      '3840x1600': [3840, 1600],
      '1920x1200': [1920, 1200],
    }

    for (const [key, [w, h]] of Object.entries(resolutionDims)) {
      const layout = config.resolutions[key]
      if (!layout) continue
      const result = validateCoordinates(layout, w, h)
      expect(result.passed, `${key} should pass validation`).toBe(true)
    }
  })

  it('fails for negative coordinates', () => {
    const layout = createValidLayout()
    layout.ultimate_slots_coords[0].x = -10

    const result = validateCoordinates(layout, 1920, 1080)
    expect(result.passed).toBe(false)
    expect(result.errors.some((e) => e.includes('Negative'))).toBe(true)
  })

  it('fails for coordinates beyond screen width', () => {
    const layout = createValidLayout()
    layout.ultimate_slots_coords[0].x = 1900
    layout.ultimate_slots_coords[0].width = 50 // 1900 + 50 = 1950 > 1920

    const result = validateCoordinates(layout, 1920, 1080)
    expect(result.passed).toBe(false)
    expect(result.errors.some((e) => e.includes('width'))).toBe(true)
  })

  it('fails for coordinates beyond screen height', () => {
    const layout = createValidLayout()
    layout.ultimate_slots_coords[0].y = 1050
    layout.ultimate_slots_coords[0].height = 50 // 1050 + 50 = 1100 > 1080

    const result = validateCoordinates(layout, 1920, 1080)
    expect(result.passed).toBe(false)
    expect(result.errors.some((e) => e.includes('height'))).toBe(true)
  })

  it('fails for wrong number of ultimate slots', () => {
    const layout = createValidLayout()
    layout.ultimate_slots_coords = layout.ultimate_slots_coords.slice(0, 11) // 11 instead of 12

    const result = validateCoordinates(layout, 1920, 1080)
    expect(result.passed).toBe(false)
    expect(result.errors.some((e) => e.includes('Expected 12'))).toBe(true)
  })

  it('fails for wrong number of standard slots', () => {
    const layout = createValidLayout()
    layout.standard_slots_coords = layout.standard_slots_coords.slice(0, 35) // 35 instead of 36

    const result = validateCoordinates(layout, 1920, 1080)
    expect(result.passed).toBe(false)
    expect(result.errors.some((e) => e.includes('Expected 36'))).toBe(true)
  })

  it('passes when coordinates touch screen boundary exactly', () => {
    const layout = createValidLayout()
    // Set a slot to exactly touch the right edge
    layout.ultimate_slots_coords[0].x = 1870
    layout.ultimate_slots_coords[0].width = 50 // 1870 + 50 = 1920 = screenWidth

    const result = validateCoordinates(layout, 1920, 1080)
    // Should pass because <= screenWidth, not < screenWidth
    // Actually our check is > screenWidth, so exactly touching passes
    expect(result.errors.filter((e) => e.includes('ultimate_slots_coords[0]'))).toHaveLength(0)
  })
})
