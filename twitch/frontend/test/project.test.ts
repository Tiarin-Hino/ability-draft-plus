import { describe, it, expect } from 'vitest'
import { fitVideoRect, gameRect, parseResolution, projectTopBar, toPx } from '../src/geometry/project'
import { TOPBAR_1080P } from '../src/geometry/topbar-1080p'

describe('project', () => {
  it('fits 16:9 video into 16:9, 21:9 and 4:3 players', () => {
    expect(fitVideoRect({ w: 1920, h: 1080 }, 16 / 9)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    const ultrawide = fitVideoRect({ w: 2520, h: 1080 }, 16 / 9)
    expect(ultrawide).toEqual({ x: 300, y: 0, w: 1920, h: 1080 })
    const tall = fitVideoRect({ w: 1440, h: 1080 }, 16 / 9)
    expect(tall.w).toBe(1440)
    expect(tall.h).toBe(810)
    expect(tall.y).toBe(135)
  })

  it('applies the game-rect calibration and maps fractions to pixels', () => {
    const video = { x: 0, y: 0, w: 1920, h: 1080 }
    const game = gameRect(video, { x: 0.25, y: 0, w: 0.75, h: 1 })
    expect(game).toEqual({ x: 480, y: 0, w: 1440, h: 1080 })
    expect(toPx([0.5, 0.5, 0.1, 0.1], game)).toEqual({ x: 1200, y: 540, w: 144, h: 108 })
  })

  it('projects the top bar with a scale around its center', () => {
    const game = { x: 0, y: 0, w: 1920, h: 1080 }
    const plain = projectTopBar(TOPBAR_1080P, game, { dx: 0, dy: 0, scale: 1 })
    expect(plain).toHaveLength(10)
    expect(plain[0].x).toBeLessThan(plain[4].x)
    expect(plain[5].x).toBeGreaterThan(plain[4].x)
    const shifted = projectTopBar(TOPBAR_1080P, game, { dx: 0.01, dy: 0, scale: 1 })
    expect(shifted[0].x - plain[0].x).toBeCloseTo(19.2, 3)
  })

  it('parses resolutions', () => {
    expect(parseResolution('1920x1080')).toEqual({ w: 1920, h: 1080 })
    expect(parseResolution('auto')).toBeNull()
    expect(parseResolution(undefined)).toBeNull()
  })
})
