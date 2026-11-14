import { describe, it, expect } from 'vitest'
import { computeBoardPerspectiveStyle } from '../../../../src/core/resolution/visual-geometry'

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

  it('produces antisymmetric horizontal skew around board center on standard slots', () => {
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
    expect(center.rotateXDeg).toBe(7)
    expect(left.skewXDeg).toBeGreaterThan(0)
    expect(left.skewXDeg).toBe(-right.skewXDeg)
    expect(left.cssTransform).toContain('perspective(900px)')
    expect(left.cssTransform).toContain('rotateX(7deg)')
  })

  it('stays scale-invariant across 16:9, 16:10, and pillarboxed 21:9 viewports', () => {
    const base = computeBoardPerspectiveStyle(
      { x: 660 - 25, y: 500 - 25, width: 50, height: 50 },
      'model',
      1920,
      1080,
    )

    // 2560x1440 (16:9, scale = 1440/1080 = 4/3)
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

    // 3440x1440 (21:9 ultrawide, board centered around x = 1720 with same height scale)
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

    // 1920x1200 (16:10, scale = 1200/1080 = 10/9)
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

    expect(qhd.skewXDeg).toBe(base.skewXDeg)
    expect(ultrawide.skewXDeg).toBe(base.skewXDeg)
    expect(tenSixteen.skewXDeg).toBe(base.skewXDeg)
  })

  it('applies upper rack column slopes for ultimate slots', () => {
    const outerLeft = computeBoardPerspectiveStyle(
      { x: 660 - 25, y: 120, width: 50, height: 50 },
      'ultimate',
      1920,
      1080,
    )
    const outerRight = computeBoardPerspectiveStyle(
      { x: 1260 - 25, y: 120, width: 50, height: 50 },
      'ultimate',
      1920,
      1080,
    )
    expect(outerLeft.skewYDeg).toBeGreaterThan(2)
    expect(outerLeft.skewYDeg).toBe(-outerRight.skewYDeg)
    expect(outerLeft.cssTransform).toContain('skewY(')
  })

  it('guards invalid zero or negative viewports cleanly', () => {
    expect(
      computeBoardPerspectiveStyle({ x: 100, y: 100, width: 50, height: 50 }, 'standard', 0, 1080)
        .cssTransform,
    ).toBe('none')
  })
})
