// Stream-delay buffer: PubSub messages arrive ~instantly while the viewer's video lags by
// hlsLatencyBroadcaster seconds. Each compact carries the app's send time (t); we hold it
// until t + latency has passed on the viewer's clock so the board matches the video.
// Ordering key is (draft id, rev); a late-join snapshot (applyImmediately) drops anything
// older than itself.

export interface Delayable {
  d: string
  r: number
  t: number
}

export interface DelayBufferOptions {
  /** Messages older than this (viewer clock) are applied at once — clock-skew guard. */
  maxAgeMs?: number
  /** Latency clamp in seconds. */
  latencyClamp?: [number, number]
}

export interface DelayBuffer<T extends Delayable> {
  push(message: T): void
  /** Messages due at nowMs given the latency, oldest first; marks them applied. */
  drain(nowMs: number, latencySec: number): T[]
  /** Late-join snapshot: apply now and discard anything not newer. */
  applyImmediately(message: T): T
  size(): number
  /** Time (ms) until the next message is due, or null when empty. */
  nextDueIn(nowMs: number, latencySec: number): number | null
}

export function createDelayBuffer<T extends Delayable>(
  options: DelayBufferOptions = {},
): DelayBuffer<T> {
  const maxAgeMs = options.maxAgeMs ?? 120_000
  const [minLatency, maxLatency] = options.latencyClamp ?? [0, 30]
  let queue: T[] = []
  let lastApplied: { d: string; r: number } | null = null

  const isNewer = (message: Delayable): boolean =>
    lastApplied === null || message.d !== lastApplied.d || message.r > lastApplied.r

  const clampLatency = (latencySec: number): number =>
    Math.min(maxLatency, Math.max(minLatency, Number.isFinite(latencySec) ? latencySec : 0))

  const dueAt = (message: T, latencySec: number): number =>
    message.t + clampLatency(latencySec) * 1000

  return {
    push(message) {
      if (!isNewer(message)) return
      const index = queue.findIndex((m) => m.d === message.d && m.r === message.r)
      if (index >= 0) queue[index] = message
      else queue.push(message)
      queue.sort((a, b) => a.t - b.t || a.r - b.r)
    },

    drain(nowMs, latencySec) {
      const due: T[] = []
      const rest: T[] = []
      for (const message of queue) {
        const tooOld = nowMs - message.t > maxAgeMs
        if (tooOld || dueAt(message, latencySec) <= nowMs) due.push(message)
        else rest.push(message)
      }
      queue = rest
      const applied: T[] = []
      for (const message of due) {
        if (!isNewer(message)) continue
        lastApplied = { d: message.d, r: message.r }
        applied.push(message)
      }
      return applied
    },

    applyImmediately(message) {
      lastApplied = { d: message.d, r: message.r }
      queue = queue.filter((m) => isNewer(m))
      return message
    },

    size() {
      return queue.length
    },

    nextDueIn(nowMs, latencySec) {
      if (queue.length === 0) return null
      return Math.max(0, dueAt(queue[0], latencySec) - nowMs)
    },
  }
}
