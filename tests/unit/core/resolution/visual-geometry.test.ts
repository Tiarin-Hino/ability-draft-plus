import { describe, it, expect } from 'vitest'
import {
  computeBoardPerspectiveStyle,
  resolveLogicalOverlayViewport,
  resolveVisualSlotLayout,
} from '../../../../src/core/resolution/visual-geometry'

describe('computeBoardPerspectiveStyle', () => {
  it('returns identity for selected abilities and hero cards', () => {
    const selected = computeBoardPerspectiveStyle(
      { x: 220, y: 240, width: 54, height: 54 },
      'selected',
      1920,
      1080,
    )
    expect(selected).toEqual({
      skewXDeg: 0,
      skewYDeg: 0,
      rotateXDeg: 0,
      cssTransform: 'none',
    })

    const heroCard = computeBoardPerspectiveStyle(
      { x: 60, y: 150, width: 220, height: 120 },
      'heroCard',
      1920,
      1080,
    )
    expect(heroCard.cssTransform).toBe('none')
  })

  it('produces antisymmetric outward-bottom plinth skew on standard slots without rotateX blur', () => {
    const left = computeBoardPerspectiveStyle(
      { x: 660 - 25, y: 500, width: 50, height: 50 },
      'standard',
      1920,
      1080,
    )
    const right = computeBoardPerspectiveStyle(
      { x: 1260 - 25, y: 500, width: 50, height: 50 },
      'standard',
      1920,
      1080,
    )
    const center = computeBoardPerspectiveStyle(
      { x: 960 - 25, y: 500, width: 50, height: 50 },
      'standard',
      1920,
      1080,
    )

    expect(center.skewXDeg).toBe(0)
    expect(center.rotateXDeg).toBe(0)
    expect(center.cssTransform).toBe('none')
    expect(left.skewXDeg).toBeLessThan(0)
    expect(right.skewXDeg).toBeGreaterThan(0)
    expect(left.skewXDeg).toBe(-right.skewXDeg)
    expect(left.cssTransform).toContain('skewX(')
    expect(left.cssTransform).not.toContain('rotateX(')
  })

  it('stays scale-invariant across 16:9, 21:9, 16:10, and vertically letterboxed 4:3 viewports', () => {
    const base = computeBoardPerspectiveStyle(
      { x: 660 - 25, y: 500 - 25, width: 50, height: 50 },
      'model',
      1920,
      1080,
    )

    const scale1440 = 1440 / 1080
    const qhd = computeBoardPerspectiveStyle(
      {
        x: 1280 + (-300 - 25) * scale1440,
        y: (500 - 25) * scale1440,
        width: 50 * scale1440,
        height: 50 * scale1440,
      },
      'model',
      2560,
      1440,
    )

    const ultrawide = computeBoardPerspectiveStyle(
      {
        x: 1720 + (-300 - 25) * scale1440,
        y: (500 - 25) * scale1440,
        width: 50 * scale1440,
        height: 50 * scale1440,
      },
      'model',
      3440,
      1440,
    )

    const scale1200 = 1200 / 1080
    const tenSixteen = computeBoardPerspectiveStyle(
      {
        x: 960 + (-300 - 25) * scale1200,
        y: (500 - 25) * scale1200,
        width: 50 * scale1200,
        height: 50 * scale1200,
      },
      'model',
      1920,
      1200,
    )

    // 4:3 (1920x1440): 16:10 width clamp gives effectiveH = 1200, letterboxY = 120
    const fourThree = computeBoardPerspectiveStyle(
      {
        x: 960 + (-300 - 25) * scale1200,
        y: 120 + (500 - 25) * scale1200,
        width: 50 * scale1200,
        height: 50 * scale1200,
      },
      'model',
      1920,
      1440,
    )

    expect(qhd.skewXDeg).toBe(base.skewXDeg)
    expect(ultrawide.skewXDeg).toBe(base.skewXDeg)
    expect(tenSixteen.skewXDeg).toBe(base.skewXDeg)
    expect(fourThree.skewXDeg).toBe(base.skewXDeg)
  })

  it('keeps ultimate rows flat horizontally (skewY=0) with subtle inward keystone skewX', () => {
    const outerLeft = computeBoardPerspectiveStyle(
      { x: 690, y: 165.75, width: 57.75, height: 59.25 },
      'ultimate',
      1920,
      1080,
    )
    const outerRight = computeBoardPerspectiveStyle(
      { x: 1920 - 690 - 57.75, y: 165.75, width: 57.75, height: 59.25 },
      'ultimate',
      1920,
      1080,
    )
    expect(outerLeft.skewYDeg).toBe(0)
    expect(outerLeft.rotateXDeg).toBe(0)
    expect(outerLeft.skewXDeg).toBeGreaterThan(1)
    expect(outerLeft.skewXDeg).toBe(-outerRight.skewXDeg)
    expect(outerLeft.cssTransform).toContain('skewX(')
  })

  it('guards invalid zero or negative viewports cleanly', () => {
    expect(
      computeBoardPerspectiveStyle({ x: 100, y: 100, width: 50, height: 50 }, 'standard', 0, 1080)
        .cssTransform,
    ).toBe('none')
  })
})

describe('resolveLogicalOverlayViewport', () => {
  it('parses targetResolution and divides by scaleFactor cleanly (ignoring 2559 window shrink)', () => {
    expect(resolveLogicalOverlayViewport('2560x1440', 1, 2559, 1440)).toEqual({
      width: 2560,
      height: 1440,
    })
    expect(resolveLogicalOverlayViewport('2560x1440', 1.5, 1706, 960)).toEqual({
      width: 2560 / 1.5,
      height: 1440 / 1.5,
    })
  })

  it('falls back to window dimensions when targetResolution is missing or malformed', () => {
    expect(resolveLogicalOverlayViewport(null, 1, 1919, 1080)).toEqual({
      width: 1919,
      height: 1080,
    })
    expect(resolveLogicalOverlayViewport('invalid', 1, 1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
    })
  })
})

describe('resolveVisualSlotLayout', () => {
  it('projects calibrated 2560x1440 sockets and hero cards from canonical 1080p coordinates', () => {
    const selectedUlt = resolveVisualSlotLayout({
      fallback: { x: 281, y: 309, width: 87, height: 87 },
      category: 'selected',
      heroOrder: 0,
      isUltimate: true,
      viewportWidth: 2560,
      viewportHeight: 1440,
      layoutSource: 'preset',
    })
    expect(selectedUlt.bounds).toEqual({ x: 530, y: 315, width: 75, height: 75 })
    expect(selectedUlt.horizontalOverhangPx).toBe(0)

    const card5 = resolveVisualSlotLayout({
      fallback: { x: 1940, y: 195, width: 424, height: 195 },
      category: 'heroCard',
      heroOrder: 5,
      viewportWidth: 2560,
      viewportHeight: 1440,
      layoutSource: 'preset',
    })
    expect(card5.bounds).toEqual({ x: 1947, y: 195, width: 427, height: 202 })

    const ultLeft = resolveVisualSlotLayout({
      fallback: { x: 0, y: 0, width: 0, height: 0 },
      category: 'ultimate',
      heroOrder: 0,
      viewportWidth: 2560,
      viewportHeight: 1440,
      layoutSource: 'preset',
    })
    expect(ultLeft.bounds.y).toBe(219)
    expect(ultLeft.bounds.width).toBe(80)
    expect(ultLeft.bounds.height).toBe(82)
    expect(ultLeft.perspective.skewXDeg).toBeCloseTo(2.95, 1)

    const stdLeft = resolveVisualSlotLayout({
      fallback: { x: 0, y: 0, width: 0, height: 0 },
      category: 'standard',
      heroOrder: 2,
      abilityOrder: 3,
      viewportWidth: 2560,
      viewportHeight: 1440,
      layoutSource: 'preset',
    })
    const stdRight = resolveVisualSlotLayout({
      fallback: { x: 0, y: 0, width: 0, height: 0 },
      category: 'standard',
      heroOrder: 7,
      abilityOrder: 3,
      viewportWidth: 2560,
      viewportHeight: 1440,
      layoutSource: 'preset',
    })
    expect(stdLeft.bounds).toEqual({ x: 1170.5, y: 636, width: 75, height: 67 })
    expect(stdRight.bounds).toEqual({ x: 1534, y: 636, width: 75, height: 67 })
    expect(stdLeft.perspective.skewXDeg).toBeLessThan(0)
    expect(stdRight.perspective.skewXDeg).toBeGreaterThan(0)

    const box0 = resolveVisualSlotLayout({
      fallback: { x: 0, y: 0, width: 0, height: 0 },
      category: 'selected',
      heroOrder: 0,
      boxIndex: 0,
      viewportWidth: 2560,
      viewportHeight: 1440,
      layoutSource: 'preset',
    })
    const box3 = resolveVisualSlotLayout({
      fallback: { x: 0, y: 0, width: 0, height: 0 },
      category: 'selected',
      heroOrder: 0,
      boxIndex: 3,
      viewportWidth: 2560,
      viewportHeight: 1440,
      layoutSource: 'preset',
    })
    expect(box0.bounds).toEqual({ x: 287, y: 315, width: 75, height: 75 })
    expect(box3.bounds).toEqual(selectedUlt.bounds)

    const modelLeft = resolveVisualSlotLayout({
      fallback: { x: 836, y: 457, width: 65, height: 61 },
      category: 'model',
      heroOrder: 0,
      viewportWidth: 2560,
      viewportHeight: 1440,
      layoutSource: 'auto-scaled',
    })
    expect(modelLeft.bounds).toEqual({ x: 831, y: 457, width: 74, height: 62 })
    expect(modelLeft.perspective.skewXDeg).toBeLessThan(0)
    expect(modelLeft.horizontalOverhangPx).toBeGreaterThan(0)
  })

  it('centers 21:9 ultrawide and vertically letterboxes 4:3 from the same 1080p canonical truth', () => {
    const baseHero = resolveVisualSlotLayout({
      fallback: { x: 0, y: 0, width: 0, height: 0 },
      category: 'heroCard',
      heroOrder: 0,
      viewportWidth: 1920,
      viewportHeight: 1080,
    })
    const ultrawideHero = resolveVisualSlotLayout({
      fallback: { x: 0, y: 0, width: 0, height: 0 },
      category: 'heroCard',
      heroOrder: 0,
      viewportWidth: 3440,
      viewportHeight: 1440,
    })
    expect(ultrawideHero.bounds.x).toBeCloseTo(626, 1)
    expect(ultrawideHero.bounds.y).toBe(195)
    expect(baseHero.bounds.x).toBe(139.5)

    // 1920x1200 (16:10): scale = 1200/1080, letterboxY = 0
    const tenSixteenCard = resolveVisualSlotLayout({
      fallback: { x: 0, y: 0, width: 0, height: 0 },
      category: 'heroCard',
      heroOrder: 0,
      viewportWidth: 1920,
      viewportHeight: 1200,
    })
    // 1920x1440 (4:3): scale = 1200/1080, letterboxY = 120
    const fourThreeCard = resolveVisualSlotLayout({
      fallback: { x: 0, y: 0, width: 0, height: 0 },
      category: 'heroCard',
      heroOrder: 0,
      viewportWidth: 1920,
      viewportHeight: 1440,
    })
    expect(fourThreeCard.bounds.x).toBeCloseTo(tenSixteenCard.bounds.x, 5)
    expect(fourThreeCard.bounds.width).toBeCloseTo(tenSixteenCard.bounds.width, 5)
    expect(fourThreeCard.bounds.y - tenSixteenCard.bounds.y).toBeCloseTo(120, 5)

    // Panorama DP-rounded selected ability socket strips stay anchored to the card inner edge
    // at both 16:9 (1920x1080 -> 60px pitch) and 16:10 (1920x1200 -> 66px pitch).
    const fhdBox0 = resolveVisualSlotLayout({
      fallback: { x: 0, y: 0, width: 0, height: 0 },
      category: 'selected',
      heroOrder: 0,
      boxIndex: 0,
      viewportWidth: 1920,
      viewportHeight: 1080,
    })
    const fhdBox3 = resolveVisualSlotLayout({
      fallback: { x: 0, y: 0, width: 0, height: 0 },
      category: 'selected',
      heroOrder: 0,
      boxIndex: 3,
      viewportWidth: 1920,
      viewportHeight: 1080,
    })
    expect(fhdBox0.bounds).toEqual({ x: 218, y: 236.25, width: 56, height: 56 })
    expect(fhdBox3.bounds).toEqual({ x: 398, y: 236.25, width: 56, height: 56 })

    const wuxgaBox0 = resolveVisualSlotLayout({
      fallback: { x: 0, y: 0, width: 0, height: 0 },
      category: 'selected',
      heroOrder: 0,
      boxIndex: 0,
      viewportWidth: 1920,
      viewportHeight: 1200,
    })
    const wuxgaBox3 = resolveVisualSlotLayout({
      fallback: { x: 0, y: 0, width: 0, height: 0 },
      category: 'selected',
      heroOrder: 0,
      boxIndex: 3,
      viewportWidth: 1920,
      viewportHeight: 1200,
    })
    expect(wuxgaBox0.bounds).toEqual({ x: 138, y: 262.5, width: 62, height: 62 })
    expect(wuxgaBox3.bounds).toEqual({ x: 336, y: 262.5, width: 62, height: 62 })
  })

  it('preserves user fallback bounds verbatim when layoutSource is custom', () => {
    const customFallback = { x: 111, y: 222, width: 77, height: 88 }
    const custom = resolveVisualSlotLayout({
      fallback: customFallback,
      category: 'standard',
      heroOrder: 0,
      abilityOrder: 1,
      viewportWidth: 2560,
      viewportHeight: 1440,
      layoutSource: 'custom',
    })
    expect(custom.bounds).toEqual(customFallback)
    expect(custom.perspective.cssTransform).toContain('skewX(')
  })
})
