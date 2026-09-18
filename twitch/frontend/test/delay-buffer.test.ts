import { describe, it, expect } from 'vitest'
import { createDelayBuffer } from '../src/net/delay-buffer'

const msg = (d: string, r: number, t: number) => ({ d, r, t })

describe('delay-buffer', () => {
  it('holds messages until send time + latency has passed', () => {
    const buffer = createDelayBuffer()
    buffer.push(msg('a', 1, 1000))
    buffer.push(msg('a', 2, 3000))
    expect(buffer.drain(2500, 2)).toEqual([])
    expect(buffer.drain(3000, 2)).toEqual([msg('a', 1, 1000)])
    expect(buffer.nextDueIn(3000, 2)).toBe(2000)
    expect(buffer.drain(5000, 2)).toEqual([msg('a', 2, 3000)])
    expect(buffer.size()).toBe(0)
  })

  it('orders by time, dedupes revisions and drops non-newer messages', () => {
    const buffer = createDelayBuffer()
    buffer.push(msg('a', 2, 2000))
    buffer.push(msg('a', 1, 1000))
    buffer.push(msg('a', 2, 2100)) // replaces same rev
    expect(buffer.size()).toBe(2)
    const applied = buffer.drain(10_000, 0)
    expect(applied.map((m) => m.r)).toEqual([1, 2])
    expect(applied[1].t).toBe(2100)
    buffer.push(msg('a', 2, 2200))
    expect(buffer.size()).toBe(0)
  })

  it('late-join snapshot discards older buffered messages', () => {
    const buffer = createDelayBuffer()
    buffer.push(msg('a', 1, 1000))
    buffer.push(msg('a', 5, 5000))
    buffer.applyImmediately(msg('a', 3, 3000))
    expect(buffer.size()).toBe(1)
    expect(buffer.drain(10_000, 0)).toEqual([msg('a', 5, 5000)])
  })

  it('a new draft id is always newer', () => {
    const buffer = createDelayBuffer()
    buffer.applyImmediately(msg('a', 9, 9000))
    buffer.push(msg('b', 0, 9500))
    expect(buffer.drain(9500, 0)).toEqual([msg('b', 0, 9500)])
  })

  it('clamps latency and applies very old messages at once (clock skew guard)', () => {
    const buffer = createDelayBuffer({ maxAgeMs: 10_000, latencyClamp: [0, 5] })
    buffer.push(msg('a', 1, 0))
    buffer.push(msg('a', 2, 100_000))
    // latency 60 s clamps to 5 s: r1 is far older than maxAge -> applied; r2 not yet
    expect(buffer.drain(100_000, 60).map((m) => m.r)).toEqual([1])
    expect(buffer.drain(105_000, 60).map((m) => m.r)).toEqual([2])
  })
})
