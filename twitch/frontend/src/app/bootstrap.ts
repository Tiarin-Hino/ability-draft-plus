import type { TwitchCompactState, TwitchLiveState } from '@shared/types/twitch'
import { DEFAULT_TWITCH_EBS_URL } from '@shared/constants/defaults'
import { useOverlayStore } from './store'
import { createDelayBuffer } from '../net/delay-buffer'
import { createEbsClient, type EbsClient } from '../net/ebs-client'
import { loadCatalog, safeLocalStorage } from '../net/catalog-loader'
import { parseResolution } from '../geometry/project'
import { parseBroadcasterConfig } from '../twitch/config-service'
import { createMockExt, getTwitch, hasRealTwitch, installMockTwitch, type TwitchExt } from '../twitch/ext'

// Wires Twitch helper -> delay buffer -> store, plus the EBS fetches (late-join compact,
// rich per draft) and the catalog load. ?demo=<mode> swaps everything for fixtures.
// ?ebs=<url> and ?catalog=<manifest url> override the endpoints in dev.

export const DEFAULT_CATALOG_MANIFEST_URL = 'https://tiarinhino.com/data/twitch/catalog-manifest.json'
const TICK_MS = 250
const STALE_AFTER_MS = 90_000

export function readParams(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}

export function resolveEbsUrl(params: URLSearchParams): string {
  return params.get('ebs') ?? import.meta.env.VITE_EBS_URL ?? DEFAULT_TWITCH_EBS_URL
}

/**
 * One PubSub channel carries two message kinds. The board state has no `kind`
 * (it predates the caster edition and must stay byte-compatible), so telemetry
 * is identified by its discriminator and anything unrecognised is ignored —
 * which is exactly how an older viewer safely skips a message it never knew.
 */
function parseMessage(
  message: string,
): { compact: TwitchCompactState } | { live: TwitchLiveState } | null {
  try {
    const value = JSON.parse(message) as Partial<TwitchCompactState & TwitchLiveState>
    if (!value || value.v !== 1 || typeof value.d !== 'string' || typeof value.r !== 'number') {
      return null
    }
    if (value.kind === 'live') {
      return Array.isArray(value.players) ? { live: value as TwitchLiveState } : null
    }
    return { compact: value as unknown as TwitchCompactState }
  } catch {
    // ignore malformed
  }
  return null
}

export function startOverlay(): void {
  const params = readParams()
  const demo = params.get('demo')
  if (demo) {
    installMockTwitch(createMockExt({ latencySec: Number(params.get('latency') ?? 2) }))
    // Demo code (fixtures + catalog slice) is a separate chunk — never loaded on Twitch
    void import('../dev/demo-timeline').then((m) => m.startDemo(demo))
    return
  }
  const ebs = createEbsClient(resolveEbsUrl(params))
  const manifestUrl =
    params.get('catalog') ?? import.meta.env.VITE_CATALOG_MANIFEST_URL ?? DEFAULT_CATALOG_MANIFEST_URL
  connect(getTwitch(), ebs, manifestUrl)
}

export function connect(twitch: TwitchExt, ebs: EbsClient, manifestUrl: string): () => void {
  const store = useOverlayStore
  const buffer = createDelayBuffer<TwitchCompactState>()
  const liveBuffer = createDelayBuffer<TwitchLiveState>()
  const inFlightRich = new Set<string>()
  let lastMessageAt = 0
  let channelId: string | null = null

  store.getState().setCatalog(null, 'loading')
  void loadCatalog({ manifestUrl, storage: safeLocalStorage() })
    .then((catalog) => store.getState().setCatalog(catalog, 'ready'))
    .catch(() => store.getState().setCatalog(null, 'error'))

  const applyConfig = () =>
    store.getState().setConfig(parseBroadcasterConfig(twitch.configuration.broadcaster?.content))
  applyConfig()
  twitch.configuration.onChanged(applyConfig)

  twitch.onContext((context) => {
    store.getState().setContext({
      latencySec: typeof context.hlsLatencyBroadcaster === 'number' ? context.hlsLatencyBroadcaster : store.getState().context.latencySec,
      videoRes: parseResolution(context.videoResolution) ?? store.getState().context.videoRes,
      theme: context.theme ?? store.getState().context.theme,
      language: context.language ?? store.getState().context.language,
    })
  })

  const ensureRich = (compact: TwitchCompactState): void => {
    if (!channelId || !compact.pool) return
    const have = store.getState().rich[compact.d]
    if (have && have.rr === compact.rr) return
    const key = `${compact.d}:${compact.rr}`
    if (inFlightRich.has(key)) return
    inFlightRich.add(key)
    void ebs
      .getState(channelId)
      .then((result) => {
        if (result && result !== 'not-modified') store.getState().setRich(result.state)
      })
      .catch(() => undefined)
      .finally(() => inFlightRich.delete(key))
  }

  const apply = (compact: TwitchCompactState): void => {
    store.getState().applyCompact(compact)
    ensureRich(compact)
  }

  twitch.onAuthorized((auth) => {
    channelId = auth.channelId
    store.getState().setAuth(auth)
    void ebs
      .getCompact(auth.channelId)
      .then((result) => {
        if (result) {
          lastMessageAt = Date.now()
          apply(buffer.applyImmediately(result.compact))
        } else if (store.getState().connection === 'init') {
          store.getState().setConnection('offline')
        }
      })
      .catch(() => {
        if (store.getState().connection === 'init') store.getState().setConnection('offline')
      })
  })

  const onBroadcast = (_target: string, _contentType: string, message: string): void => {
    const parsed = parseMessage(message)
    if (!parsed) return
    lastMessageAt = Date.now()
    // Telemetry rides the SAME delay buffer, keyed the same way, so it stays in
    // sync with the board the viewer is watching rather than running ahead of
    // the video by the broadcaster's HLS latency.
    if ('live' in parsed) liveBuffer.push(parsed.live)
    else buffer.push(parsed.compact)
  }
  twitch.listen('broadcast', onBroadcast)

  const timer = window.setInterval(() => {
    const now = Date.now()
    const latency = store.getState().context.latencySec
    for (const compact of buffer.drain(now, latency)) apply(compact)
    for (const live of liveBuffer.drain(now, latency)) store.getState().applyLive(live)
    const state = store.getState()
    // Silence only means "signal lost" while the board is meant to be CHANGING.
    // During a game the draft board is a finished snapshot and the app sends
    // nothing unless it is a caster streaming telemetry, so flagging that as
    // lost signal told every playing streamer their extension had broken
    // 90 seconds into every match (observed 2026-09-04).
    if (
      state.connection === 'live' &&
      state.compact &&
      state.compact.p === 'drafting' &&
      lastMessageAt > 0 &&
      now - lastMessageAt > STALE_AFTER_MS &&
      buffer.size() === 0
    ) {
      state.setConnection('stale')
    }
  }, TICK_MS)

  return () => {
    window.clearInterval(timer)
    twitch.unlisten('broadcast', onBroadcast)
  }
}

export { hasRealTwitch }
