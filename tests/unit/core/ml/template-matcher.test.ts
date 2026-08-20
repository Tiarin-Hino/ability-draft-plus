import { describe, it, expect } from 'vitest'
import {
  computePixelStats,
  makeIconTemplate,
  matchPickSlot,
  matchPickSlotScoped,
} from '@core/ml/template-matcher'
import type { IconTemplate } from '@core/ml/template-matcher'
import {
  PICK_TEMPLATE_COMPARE_SIZE,
  PICK_TEMPLATE_EMPTY_STD,
  PICK_TEMPLATE_MIN_NCC,
} from '@shared/constants/thresholds'

const VEC_LENGTH = PICK_TEMPLATE_COMPARE_SIZE * PICK_TEMPLATE_COMPARE_SIZE * 3

/** Deterministic pseudo-random icon pattern — distinct per seed. */
function makePattern(seed: number): Uint8Array {
  const vec = new Uint8Array(VEC_LENGTH)
  let state = seed * 2654435761 + 1
  for (let i = 0; i < vec.length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    vec[i] = state % 256
  }
  return vec
}

/** Simulates the game's rendering: darken + slight uniform noise. */
function gameRender(icon: Uint8Array, brightness = 0.8, noise = 10): Uint8Array {
  const vec = new Uint8Array(icon.length)
  let state = 42
  for (let i = 0; i < icon.length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    const jitter = (state % (noise * 2 + 1)) - noise
    vec[i] = Math.max(0, Math.min(255, Math.round(icon[i] * brightness + jitter)))
  }
  return vec
}

function makeTemplates(count: number): IconTemplate[] {
  return Array.from({ length: count }, (_, i) =>
    makeIconTemplate(`ability_${i}`, makePattern(i)),
  )
}

describe('computePixelStats', () => {
  it('computes mean and std of a uniform vector', () => {
    const stats = computePixelStats(new Uint8Array(VEC_LENGTH).fill(37))
    expect(stats.mean).toBe(37)
    expect(stats.std).toBe(0)
  })

  it('computes std of an alternating vector', () => {
    const vec = new Uint8Array(VEC_LENGTH)
    for (let i = 0; i < vec.length; i++) vec[i] = i % 2 === 0 ? 0 : 200
    const stats = computePixelStats(vec)
    expect(stats.mean).toBe(100)
    expect(stats.std).toBe(100)
  })
})

describe('matchPickSlot', () => {
  it('matches a brightness-shifted noisy crop to the right icon', () => {
    const templates = makeTemplates(20)
    const crop = gameRender(makePattern(7))
    const result = matchPickSlot(crop, templates)
    expect(result.name).toBe('ability_7')
    expect(result.isEmpty).toBe(false)
    expect(result.score).toBeGreaterThan(PICK_TEMPLATE_MIN_NCC)
  })

  it('detects an empty (uniform dark) slot without matching', () => {
    const crop = new Uint8Array(VEC_LENGTH).fill(8)
    const result = matchPickSlot(crop, makeTemplates(5))
    expect(result).toEqual({
      name: null,
      score: 0,
      isEmpty: true,
      bestName: null,
      secondName: null,
      margin: null,
    })
  })

  it('treats near-uniform noise below the empty threshold as empty', () => {
    const crop = new Uint8Array(VEC_LENGTH)
    for (let i = 0; i < crop.length; i++) {
      crop[i] = 10 + (i % 3 === 0 ? Math.floor(PICK_TEMPLATE_EMPTY_STD) - 4 : 0)
    }
    expect(computePixelStats(crop).std).toBeLessThan(PICK_TEMPLATE_EMPTY_STD)
    const result = matchPickSlot(crop, makeTemplates(5))
    expect(result.isEmpty).toBe(true)
    expect(result.name).toBeNull()
  })

  it('scopes matching to candidate names', () => {
    const templates = makeTemplates(20)
    const crop = gameRender(makePattern(7))
    const scoped = matchPickSlot(crop, templates, new Set(['ability_3', 'ability_7']))
    expect(scoped.name).toBe('ability_7')
    // Scoping away the true icon must not produce a confident false match
    const wrongScope = matchPickSlot(crop, templates, new Set(['ability_3', 'ability_4']))
    expect(wrongScope.name).toBeNull()
  })

  it('falls back to all templates when no candidate has a template', () => {
    const templates = makeTemplates(20)
    const crop = gameRender(makePattern(7))
    const result = matchPickSlot(crop, templates, new Set(['not_cached_yet']))
    expect(result.name).toBe('ability_7')
  })

  it('rejects when two near-identical templates tie (margin gate)', () => {
    const pattern = makePattern(1)
    const templates = [
      makeIconTemplate('twin_a', pattern),
      makeIconTemplate('twin_b', pattern),
    ]
    const result = matchPickSlot(gameRender(pattern), templates)
    expect(result.name).toBeNull()
    expect(result.isEmpty).toBe(false)
    expect(result.score).toBeGreaterThan(PICK_TEMPLATE_MIN_NCC)
    // Rejection diagnostics: what would have matched, and who ran it closest
    expect(result.bestName).toBe('twin_a')
    expect(result.secondName).toBe('twin_b')
    expect(result.margin).not.toBeNull()
    expect(result.margin!).toBeLessThan(0.02)
  })

  it('reports the winning margin on accepted matches', () => {
    const templates = makeTemplates(20)
    const result = matchPickSlot(gameRender(makePattern(7)), templates)
    expect(result.name).toBe('ability_7')
    expect(result.bestName).toBe('ability_7')
    expect(result.margin).not.toBeNull()
    expect(result.margin!).toBeGreaterThan(0)
  })

  it('reports a null margin for a single-template scope', () => {
    const result = matchPickSlot(gameRender(makePattern(0)), makeTemplates(1))
    expect(result.name).toBe('ability_0')
    expect(result.margin).toBeNull()
  })

  it('rejects a crop that resembles no template', () => {
    // Smooth gradient — structurally unlike the pseudo-random templates
    const crop = new Uint8Array(VEC_LENGTH)
    for (let i = 0; i < crop.length; i++) crop[i] = Math.floor((i / crop.length) * 255)
    const result = matchPickSlot(crop, makeTemplates(20))
    expect(result.name).toBeNull()
    expect(result.isEmpty).toBe(false)
  })

  it('accepts a single-template scope with no runner-up', () => {
    const templates = makeTemplates(1)
    const result = matchPickSlot(gameRender(makePattern(0)), templates)
    expect(result.name).toBe('ability_0')
  })

  it('skips templates with mismatched vector length or zero variance', () => {
    const templates: IconTemplate[] = [
      makeIconTemplate('short', makePattern(2).slice(0, 100)),
      makeIconTemplate('flat', new Uint8Array(VEC_LENGTH).fill(50)),
      makeIconTemplate('real', makePattern(3)),
    ]
    const result = matchPickSlot(gameRender(makePattern(3)), templates)
    expect(result.name).toBe('real')
  })
})

describe('matchPickSlotScoped', () => {
  const FALLBACK = 0.85

  it('uses the scoped result when it is accepted', () => {
    const templates = makeTemplates(20)
    const crop = gameRender(makePattern(7))
    const r = matchPickSlotScoped(crop, templates, new Set(['ability_7']), FALLBACK)
    expect(r.name).toBe('ability_7')
  })

  it('recovers a pick whose ability is missing from the candidate set', () => {
    // ability_7 was never added to the pool candidates (pool scan missed it):
    // the scoped match must fail, and the unrestricted retry must find it.
    const templates = makeTemplates(20)
    const crop = gameRender(makePattern(7), 1, 0) // clean render -> high NCC
    const scopedOnly = matchPickSlot(crop, templates, new Set(['ability_3', 'ability_4']))
    expect(scopedOnly.name).toBeNull()

    const r = matchPickSlotScoped(
      crop,
      templates,
      new Set(['ability_3', 'ability_4']),
      FALLBACK,
    )
    expect(r.name).toBe('ability_7')
    expect(r.score).toBeGreaterThanOrEqual(FALLBACK)
  })

  it('does NOT fall back on a mediocre unrestricted match', () => {
    // Heavily degraded crop: the true icon still wins unrestricted but well
    // below the strict fallback bar, so the slot must stay Unknown.
    const templates = makeTemplates(20)
    const crop = gameRender(makePattern(7), 0.35, 90)
    const wide = matchPickSlot(crop, templates)
    expect(wide.score).toBeLessThan(FALLBACK)

    const r = matchPickSlotScoped(crop, templates, new Set(['ability_3']), FALLBACK)
    expect(r.name).toBeNull()
  })

  it('leaves empty slots alone', () => {
    const crop = new Uint8Array(VEC_LENGTH).fill(8)
    const r = matchPickSlotScoped(crop, makeTemplates(5), new Set(['ability_1']), FALLBACK)
    expect(r.isEmpty).toBe(true)
    expect(r.name).toBeNull()
  })
})
