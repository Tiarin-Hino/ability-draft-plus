import { describe, it, expect } from 'vitest'
import { matchModelTile } from '@core/ml/model-tile-matcher'
import { makeIconTemplate } from '@core/ml/template-matcher'
import type { IconTemplate } from '@core/ml/template-matcher'
import { MODEL_TILE_COMPARE_SIZE } from '@shared/constants/thresholds'

const VEC_LENGTH = MODEL_TILE_COMPARE_SIZE * MODEL_TILE_COMPARE_SIZE * 3

function makePattern(seed: number): Uint8Array {
  const vec = new Uint8Array(VEC_LENGTH)
  let state = seed * 2654435761 + 1
  for (let i = 0; i < vec.length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    vec[i] = state % 256
  }
  return vec
}

function gameRender(icon: Uint8Array, brightness = 0.85, noise = 8): Uint8Array {
  const vec = new Uint8Array(icon.length)
  let state = 7
  for (let i = 0; i < icon.length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    const jitter = (state % (noise * 2 + 1)) - noise
    vec[i] = Math.max(0, Math.min(255, Math.round(icon[i] * brightness + jitter)))
  }
  return vec
}

/** Library with multiple variants per hero (position-dependent renders). */
function makeLibrary(): IconTemplate[] {
  const lib: IconTemplate[] = []
  for (let hero = 0; hero < 6; hero++) {
    for (let variant = 0; variant < 3; variant++) {
      lib.push(
        makeIconTemplate(`hero_${hero}`, gameRender(makePattern(hero), 1 - variant * 0.05)),
      )
    }
  }
  return lib
}

describe('matchModelTile', () => {
  it('identifies a tile against the correct hero across variants', () => {
    const result = matchModelTile(gameRender(makePattern(3)), makeLibrary())
    expect(result.name).toBe('hero_3')
    expect(result.score).toBeGreaterThan(0.9)
  })

  it('computes the margin against the best OTHER hero, not a sibling variant', () => {
    // Two near-identical variants of the same hero must not margin-kill it
    const pattern = makePattern(1)
    const lib = [
      makeIconTemplate('hero_a', pattern),
      makeIconTemplate('hero_a', gameRender(pattern, 0.99, 1)),
      makeIconTemplate('hero_b', makePattern(2)),
    ]
    const result = matchModelTile(gameRender(pattern), lib)
    expect(result.name).toBe('hero_a')
    expect(result.secondName).toBe('hero_b')
    expect(result.margin).toBeGreaterThan(0.5)
  })

  it('returns null for a blank tile', () => {
    const result = matchModelTile(new Uint8Array(VEC_LENGTH).fill(10), makeLibrary())
    expect(result.name).toBeNull()
    expect(result.score).toBe(0)
  })

  it('rejects when two different heroes tie', () => {
    const pattern = makePattern(4)
    const lib = [
      makeIconTemplate('hero_x', pattern),
      makeIconTemplate('hero_y', pattern),
    ]
    const result = matchModelTile(gameRender(pattern), lib)
    expect(result.name).toBeNull()
    expect(result.bestName).not.toBeNull()
    expect(result.margin).not.toBeNull()
    expect(result.margin!).toBeLessThan(0.03)
  })
})
