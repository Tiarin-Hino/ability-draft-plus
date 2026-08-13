import { describe, it, expect } from 'vitest'
import {
  detectModelPicks,
  meanAbsDiff,
} from '@core/domain/model-pick-detection'
import type { ModelTileCapture } from '@core/domain/model-pick-detection'

function tile(heroOrder: number, fill: number, length = 27): ModelTileCapture {
  return { heroOrder, tile: new Uint8Array(length).fill(fill) }
}

describe('meanAbsDiff', () => {
  it('is 0 for identical tiles', () => {
    expect(meanAbsDiff(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(0)
  })

  it('averages per-byte differences', () => {
    expect(meanAbsDiff(new Uint8Array([0, 0]), new Uint8Array([10, 30]))).toBe(20)
  })

  it('treats length mismatches as maximally different', () => {
    expect(meanAbsDiff(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(Infinity)
    expect(meanAbsDiff(new Uint8Array(0), new Uint8Array(0))).toBe(Infinity)
  })
})

describe('detectModelPicks', () => {
  const baselines = [tile(0, 100), tile(1, 100), tile(2, 100)]

  it('does not commit a change on first sight (pending confirmation)', () => {
    const result = detectModelPicks({
      baselines,
      current: [tile(0, 100), tile(1, 200), tile(2, 100)],
      pending: [],
      picked: [],
    })
    expect(result.picked).toEqual([])
    expect(result.newlyPicked).toEqual([])
    expect(result.pending).toEqual([1])
  })

  it('commits a change persisting across two consecutive scans', () => {
    const result = detectModelPicks({
      baselines,
      current: [tile(0, 100), tile(1, 200), tile(2, 100)],
      pending: [1],
      picked: [],
    })
    expect(result.picked).toEqual([1])
    expect(result.newlyPicked).toEqual([1])
    expect(result.pending).toEqual([])
  })

  it('clears a pending entry whose tile reads unchanged again (tooltip flicker)', () => {
    const result = detectModelPicks({
      baselines,
      current: [tile(0, 100), tile(1, 100), tile(2, 100)],
      pending: [1],
      picked: [],
    })
    expect(result.picked).toEqual([])
    expect(result.pending).toEqual([])
  })

  it('never un-picks and skips diffing already-picked tiles', () => {
    const result = detectModelPicks({
      baselines,
      // Tile 1 back to baseline-identical — stays picked regardless
      current: [tile(0, 100), tile(1, 100), tile(2, 100)],
      pending: [],
      picked: [1],
    })
    expect(result.picked).toEqual([1])
    expect(result.newlyPicked).toEqual([])
  })

  it('tracks multiple simultaneous changes independently', () => {
    const result = detectModelPicks({
      baselines,
      current: [tile(0, 200), tile(1, 200), tile(2, 100)],
      pending: [0],
      picked: [],
    })
    // 0 was pending -> commits; 1 is fresh -> pending
    expect(result.picked).toEqual([0])
    expect(result.pending).toEqual([1])
  })

  it('respects the diff threshold', () => {
    const result = detectModelPicks({
      baselines,
      current: [tile(0, 105), tile(1, 100), tile(2, 100)],
      pending: [],
      picked: [],
      threshold: 10,
    })
    // diff of 5 is below threshold — capture noise, not a pick
    expect(result.pending).toEqual([])
  })

  it('ignores current tiles with no baseline (layout drift safety)', () => {
    const result = detectModelPicks({
      baselines: [tile(0, 100)],
      current: [tile(0, 100), tile(7, 250)],
      pending: [],
      picked: [],
    })
    expect(result.pending).toEqual([])
  })
})
