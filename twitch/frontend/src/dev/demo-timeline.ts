import type { TwitchCompactState, TwitchPhase, TwitchPlayerRow, TwitchPoolRow } from '@shared/types/twitch'
import { TWITCH_MODEL_PICKED_BIT } from '@shared/types/twitch'
import { useOverlayStore } from '../app/store'
import type { Catalog } from '../data/catalog-types'
import demoCatalog from './catalog-demo.json'
import { buildDemoFixture } from './fixtures'
import { getMockTwitch } from '../twitch/ext'

// ?demo=1|drafting  full mid-draft board        ?demo=ingame   in-game overlay
// ?demo=waiting     launcher only               ?demo=ended    finished badge
// ?demo=timeline    replays the picks one by one (8 s apart) through the mock helper,
//                   so the delay buffer visibly holds each message for `latency` seconds.

const TIMELINE_STEP_MS = 8_000

/**
 * The overlay is transparent because it composites over the stream. Opened
 * standalone there is no video, so ?demo=1 rendered as a BLANK WHITE PAGE with
 * 60 invisible hit regions — the exact URL an extension reviewer is given, and
 * indistinguishable from a broken extension.
 *
 * A screenshot behind it was the obvious fix and the wrong one: a photo of one
 * draft under the data of another disagrees with itself, so the panel named an
 * ability the tile beneath it did not show and the picked-markers sat between
 * tiles. `demoBoard` instead draws the pool the demo actually describes through
 * the same rects as the hit regions, which cannot drift. This only supplies the
 * dark ground it sits on.
 */
function paintDemoGround(): void {
  document.documentElement.style.background = '#0e0e10'
}

/** Compact states revealing the feed one event at a time (pure). */
export function timelineSteps(full: TwitchCompactState): TwitchCompactState[] {
  if (!full.pool || !full.players || !full.f) return [full]
  const steps: TwitchCompactState[] = []
  for (let n = 0; n <= full.f.length; n++) {
    const feed = full.f.slice(0, n)
    const pool: TwitchPoolRow[] = full.pool.map((row) => [row[0], [...row[1]], 0])
    const players: TwitchPlayerRow[] = full.players.map((row) => {
      const copy: TwitchPlayerRow = [row[0], [null, null, null, null], row[2]]
      if (row.length > 3 && row[3] !== undefined) copy.push(row[3])
      return copy
    })
    // Models are revealed with their marker; picks with their event
    for (const [playerIndex, ref] of feed) {
      const player = players[playerIndex]
      if (!player) continue
      if (ref === -1) {
        const model = full.players[playerIndex][0]
        if (typeof model === 'number' && pool[model]) pool[model][2] |= TWITCH_MODEL_PICKED_BIT
        continue
      }
      if (typeof ref === 'number') pool[Math.floor(ref / 4)][2] |= 1 << ref % 4
      const original: TwitchPlayerRow[1] = full.players[playerIndex][1]
      const box = original.findIndex((p: TwitchPlayerRow[1][number]) => p === ref)
      if (box >= 0) player[1][box] = ref
    }
    // Models not revealed yet: hide them from player rows
    for (const [playerIndex, player] of players.entries()) {
      const revealed = feed.some(([p, ref]) => p === playerIndex && ref === -1)
      if (!revealed) player[0] = null
    }
    steps.push({ ...full, pool, players, f: feed, r: n, t: Date.now() })
  }
  return steps
}

export function startDemo(mode: string): void {
  const store = useOverlayStore.getState()
  store.setCatalog(demoCatalog as unknown as Catalog, 'ready')
  const mock = getMockTwitch()
  const phase: TwitchPhase =
    mode === 'ingame' ? 'ingame' : mode === 'waiting' ? 'waiting' : mode === 'ended' ? 'ended' : 'drafting'
  const fixture = buildDemoFixture(phase)
  store.setRich(fixture.rich)
  paintDemoGround()
  // ingame/ended draw over the in-game top bar, not the draft screen — a pool
  // board behind those would put a draft where the gameplay belongs.
  store.setDemoBoard(phase === 'drafting')

  mock?.onContext((context) => {
    store.setContext({
      latencySec: context.hlsLatencyBroadcaster ?? 0,
      videoRes: { w: 1920, h: 1080 },
      theme: context.theme ?? 'dark',
    })
  })
  mock?.onAuthorized((auth) => store.setAuth(auth))

  if (mode !== 'timeline') {
    store.applyCompact(fixture.compact)
    // Caster telemetry exists only in game, same as the real thing
    if (phase === 'ingame') store.applyLive(fixture.live)
    return
  }

  // Timeline: feed the real delay path (mock helper -> buffer) like production would
  const steps = timelineSteps(fixture.compact)
  let i = 0
  const emitNext = () => {
    if (!mock || i >= steps.length) return
    const step = { ...steps[i], t: Date.now() }
    i += 1
    mock.emit(JSON.stringify(step))
    window.setTimeout(emitNext, TIMELINE_STEP_MS)
  }
  // Late-join style first frame, then the buffered replay
  store.applyCompact({ ...steps[0], t: Date.now() })
  i = 1
  window.setTimeout(emitNext, 1_000)
  const buffer: TwitchCompactState[] = []
  mock?.listen('broadcast', (_t, _c, message) => {
    buffer.push(JSON.parse(message) as TwitchCompactState)
  })
  window.setInterval(() => {
    const latency = useOverlayStore.getState().context.latencySec
    const now = Date.now()
    while (buffer.length > 0 && buffer[0].t + latency * 1000 <= now) {
      useOverlayStore.getState().applyCompact(buffer.shift() as TwitchCompactState)
    }
  }, 250)
}
