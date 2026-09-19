import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TwitchCompactState, TwitchRichState } from '@shared/types/twitch'
import { normalizePairCode, normalizePath, route } from '../src/router.js'
import { createMemoryStore } from '../src/store-memory.js'
import { signTwitchJwt } from '../src/twitch-jwt.js'
import type { EbsDeps, EbsRequest } from '../src/types.js'
import { MIN_PUBLISH_INTERVAL_MS, PAIR_CODE_TTL_MS } from '../src/limits.js'

const SECRET = Buffer.from('router-test-secret').toString('base64')

let clock = Date.UTC(2026, 8, 2, 12, 0, 0)
let deps: EbsDeps
let pubsub: ReturnType<typeof vi.fn>

function makeDeps(): EbsDeps {
  pubsub = vi.fn().mockResolvedValue(true)
  return {
    store: createMemoryStore(),
    secrets: { extensionSecret: SECRET, clientId: 'cid', ownerId: '42' },
    sendPubSub: pubsub as unknown as EbsDeps['sendPubSub'],
    lookupChannelName: async () => 'Streamer',
    now: () => clock,
    log: () => {},
  }
}

function req(
  method: string,
  path: string,
  init: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
): EbsRequest {
  return {
    method,
    path,
    headers: {
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.headers ?? {}),
    },
    query: {},
    body: init.body === undefined ? null : JSON.stringify(init.body),
  }
}

function broadcasterJwt(channelId: string, role = 'broadcaster'): string {
  return signTwitchJwt({ exp: Math.floor(clock / 1000) + 300, channel_id: channelId, role }, SECRET)
}

function compact(overrides: Partial<TwitchCompactState> = {}): TwitchCompactState {
  return { v: 1, d: 'draft1', p: 'drafting', r: 1, t: clock, rr: 1, ...overrides }
}

function rich(overrides: Partial<TwitchRichState> = {}): TwitchRichState {
  return {
    v: 1,
    d: 'draft1',
    rr: 1,
    t: clock,
    frame: { w: 1920, h: 1080, res: '1920x1080' },
    geometry: { pool: [], models: [], cards: [], picks: [] },
    abilities: [],
    heroes: [],
    pairs: [],
    heroPairs: [],
    thresholds: { op: 0.13, trap: 0.05 },
    playerNames: [],
    spectating: false,
    meta: { appVersion: '3.0.0', language: 'en' },
    ...overrides,
  }
}

async function pairChannel(channelId: string): Promise<string> {
  const start = await route(req('POST', '/twitch/pair/start', { token: broadcasterJwt(channelId) }), deps)
  expect(start.status).toBe(200)
  const { code } = JSON.parse(start.body) as { code: string }
  const complete = await route(
    req('POST', '/twitch/pair/complete', { body: { code, appVersion: '3.0.0' } }),
    deps,
  )
  expect(complete.status).toBe(200)
  return (JSON.parse(complete.body) as { channelToken: string }).channelToken
}

beforeEach(() => {
  clock = Date.UTC(2026, 8, 2, 12, 0, 0)
  deps = makeDeps()
})

describe('helpers', () => {
  it('normalizes paths and pairing codes', () => {
    expect(normalizePath('/twitch/pair/start')).toBe('/pair/start')
    expect(normalizePath('/pair/start/')).toBe('/pair/start')
    expect(normalizePath('/twitch')).toBe('/')
    expect(normalizePairCode('k7q4-m2zp')).toBe('K7Q4M2ZP')
    // O -> 0, I/L -> 1 (Crockford read-aloud tolerance)
    expect(normalizePairCode('K7O4 MIZL')).toBe('K704M1Z1')
  })
})

describe('pairing', () => {
  it('issues a code for a broadcaster JWT and refuses viewers', async () => {
    const ok = await route(req('POST', '/pair/start', { token: broadcasterJwt('123') }), deps)
    expect(ok.status).toBe(200)
    const body = JSON.parse(ok.body) as { code: string; expiresAt: number }
    expect(body.code).toMatch(/^[0-9A-Z]{8}$/)
    expect(body.expiresAt).toBe(clock + PAIR_CODE_TTL_MS)

    const viewer = await route(req('POST', '/pair/start', { token: broadcasterJwt('123', 'viewer') }), deps)
    expect(viewer.status).toBe(403)
    const none = await route(req('POST', '/pair/start'), deps)
    expect(none.status).toBe(401)
  })

  it('exchanges a code exactly once and stores a hashed token', async () => {
    const start = await route(req('POST', '/pair/start', { token: broadcasterJwt('123') }), deps)
    const { code } = JSON.parse(start.body) as { code: string }

    const first = await route(req('POST', '/pair/complete', { body: { code: code.toLowerCase(), appVersion: '3.0.0' } }), deps)
    expect(first.status).toBe(200)
    const data = JSON.parse(first.body) as { channelId: string; channelToken: string; channelName: string }
    expect(data.channelId).toBe('123')
    expect(data.channelName).toBe('Streamer')
    expect(data.channelToken).toMatch(/^[0-9a-f]{64}$/)
    const token = await deps.store.getToken('123')
    expect(token?.tokenHash).not.toBe(data.channelToken)

    const again = await route(req('POST', '/pair/complete', { body: { code } }), deps)
    expect(again.status).toBe(404)
  })

  it('rejects expired and malformed codes', async () => {
    const start = await route(req('POST', '/pair/start', { token: broadcasterJwt('123') }), deps)
    const { code } = JSON.parse(start.body) as { code: string }
    clock += PAIR_CODE_TTL_MS + 1
    expect((await route(req('POST', '/pair/complete', { body: { code } }), deps)).status).toBe(404)
    expect((await route(req('POST', '/pair/complete', { body: { code: 'AB' } }), deps)).status).toBe(404)
    expect((await route(req('POST', '/pair/complete', { body: 'x' }), deps)).status).toBe(400)
  })
})

describe('publish', () => {
  it('requires a valid channel token', async () => {
    const token = await pairChannel('123')
    const anon = await route(req('POST', '/channels/123/publish', { body: { v: 1, channelId: '123', compact: compact() } }), deps)
    expect(anon.status).toBe(401)
    const wrong = await route(
      req('POST', '/channels/123/publish', { token: 'f'.repeat(64), body: { v: 1, channelId: '123', compact: compact() } }),
      deps,
    )
    expect(wrong.status).toBe(401)
    const other = await route(
      req('POST', '/channels/124/publish', { token, body: { v: 1, channelId: '124', compact: compact() } }),
      deps,
    )
    expect(other.status).toBe(401)
  })

  it('stores compact + rich, relays via PubSub and serves them back', async () => {
    const token = await pairChannel('123')
    const res = await route(
      req('POST', '/channels/123/publish', { token, body: { v: 1, channelId: '123', compact: compact(), rich: rich() } }),
      deps,
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, r: 1, pubsub: 'sent' })
    expect(pubsub).toHaveBeenCalledTimes(1)
    expect(pubsub.mock.calls[0][0]).toBe('123')
    expect(JSON.parse(pubsub.mock.calls[0][1] as string)).toEqual(compact())

    const state = await route(req('GET', '/channels/123/state'), deps)
    expect(state.status).toBe(200)
    expect(state.headers.ETag).toBe('"draft1-1"')
    expect(JSON.parse(state.body).d).toBe('draft1')
    const notModified = await route(req('GET', '/channels/123/state', { headers: { 'if-none-match': '"draft1-1"' } }), deps)
    expect(notModified.status).toBe(304)

    const latest = await route(req('GET', '/channels/123/compact'), deps)
    expect(latest.status).toBe(200)
    const parsed = JSON.parse(latest.body) as { compact: TwitchCompactState; serverTs: number }
    expect(parsed.compact.d).toBe('draft1')
    expect(parsed.serverTs).toBe(clock)

    const status = await route(req('GET', '/channels/123/status'), deps)
    expect(JSON.parse(status.body)).toMatchObject({ paired: true, phase: 'drafting', channelName: 'Streamer' })
  })

  it('relays caster telemetry over PubSub without storing it', async () => {
    const token = await pairChannel('123')
    const live = {
      v: 1,
      kind: 'live',
      d: 'draft1',
      r: 7,
      t: clock,
      players: [null, null, null, null, [1051, 300, 365, 2, 0, 0, 0, 7, 2, 680, 0, 0, 760, 9, 0, 280, 0, ['blink']], null, null, null, null, null],
    }
    const res = await route(
      req('POST', '/channels/123/publish', { token, body: { v: 1, channelId: '123', live } }),
      deps,
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, r: 7, pubsub: 'sent' })
    expect(JSON.parse(pubsub.mock.calls[0][1] as string)).toEqual(live)

    // Telemetry is ephemeral: it must NOT become the stored draft state
    const latest = await route(req('GET', '/channels/123/compact'), deps)
    expect(latest.status).toBe(404)
  })

  it('rejects malformed telemetry', async () => {
    const token = await pairChannel('123')
    const bad = await route(
      req('POST', '/channels/123/publish', {
        token,
        body: { v: 1, channelId: '123', live: { v: 1, kind: 'live', d: 'x' } },
      }),
      deps,
    )
    expect(bad.status).toBe(400)
  })

  it('asks for rich when it is missing or outdated', async () => {
    const token = await pairChannel('123')
    const first = await route(
      req('POST', '/channels/123/publish', { token, body: { v: 1, channelId: '123', compact: compact() } }),
      deps,
    )
    expect(JSON.parse(first.body)).toMatchObject({ ok: true, needRich: true })

    clock += MIN_PUBLISH_INTERVAL_MS + 1
    await route(
      req('POST', '/channels/123/publish', { token, body: { v: 1, channelId: '123', compact: compact({ r: 2 }), rich: rich() } }),
      deps,
    )
    clock += MIN_PUBLISH_INTERVAL_MS + 1
    const newRev = await route(
      req('POST', '/channels/123/publish', { token, body: { v: 1, channelId: '123', compact: compact({ r: 3, rr: 2 }) } }),
      deps,
    )
    expect(JSON.parse(newRev.body)).toMatchObject({ ok: true, needRich: true })
  })

  it('enforces revision order, rate limits and sizes', async () => {
    const token = await pairChannel('123')
    const post = (c: TwitchCompactState, extra: Record<string, unknown> = {}) =>
      route(req('POST', '/channels/123/publish', { token, body: { v: 1, channelId: '123', compact: c, ...extra } }), deps)

    expect((await post(compact({ r: 5 }))).status).toBe(200)
    // Same rev again = restart republish: accepted, no PubSub
    const dup = await post(compact({ r: 5 }))
    expect(JSON.parse(dup.body)).toEqual({ ok: true, r: 5, pubsub: 'skipped', needRich: true })
    expect(pubsub).toHaveBeenCalledTimes(1)
    // Older rev for the same draft
    expect((await post(compact({ r: 4 }))).status).toBe(409)
    // Too soon
    const soon = await post(compact({ r: 6 }))
    expect(soon.status).toBe(429)
    expect(soon.headers['Retry-After']).toBe('1')
    clock += MIN_PUBLISH_INTERVAL_MS + 1
    expect((await post(compact({ r: 6 }))).status).toBe(200)
    // New draft id resets the ordering
    clock += MIN_PUBLISH_INTERVAL_MS + 1
    expect((await post(compact({ d: 'draft2', r: 0 }))).status).toBe(200)

    clock += MIN_PUBLISH_INTERVAL_MS + 1
    const big = compact({ d: 'draft2', r: 1, f: Array.from({ length: 2000 }, (_, i) => [i % 10, 'x'.repeat(30)]) })
    const tooLarge = await post(big)
    expect(tooLarge.status).toBe(413)
    expect(JSON.parse(tooLarge.body)).toEqual({ ok: false, error: 'too_large' })

    const version = await route(
      req('POST', '/channels/123/publish', { token, body: { v: 2, channelId: '123', compact: compact() } }),
      deps,
    )
    expect(JSON.parse(version.body)).toEqual({ ok: false, error: 'version' })
    const mismatch = await post(compact({ d: 'draft2', r: 2 }), { rich: rich({ d: 'other' }) })
    expect(mismatch.status).toBe(400)
  })

  it('reports PubSub failures without losing the stored state', async () => {
    const token = await pairChannel('123')
    pubsub.mockResolvedValueOnce(false)
    const res = await route(
      req('POST', '/channels/123/publish', { token, body: { v: 1, channelId: '123', compact: compact() } }),
      deps,
    )
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, pubsub: 'failed' })
    expect((await route(req('GET', '/channels/123/compact'), deps)).status).toBe(200)
  })
})

describe('unpair + misc', () => {
  it('revokes the token and clears state', async () => {
    const token = await pairChannel('123')
    await route(
      req('POST', '/channels/123/publish', { token, body: { v: 1, channelId: '123', compact: compact(), rich: rich() } }),
      deps,
    )
    const res = await route(req('POST', '/channels/123/unpair', { token }), deps)
    expect(res.status).toBe(204)
    expect((await route(req('GET', '/channels/123/compact'), deps)).status).toBe(404)
    expect((await route(req('GET', '/channels/123/state'), deps)).status).toBe(404)
    expect(JSON.parse((await route(req('GET', '/channels/123/status'), deps)).body).paired).toBe(false)
    expect((await route(req('POST', '/channels/123/unpair', { token }), deps)).status).toBe(401)
  })

  it('answers preflight, 404s unknown routes and rejects bad channel ids', async () => {
    const preflight = await route(req('OPTIONS', '/twitch/channels/123/state'), deps)
    expect(preflight.status).toBe(204)
    expect(preflight.headers['Access-Control-Allow-Origin']).toBe('*')
    expect((await route(req('GET', '/nope'), deps)).status).toBe(404)
    expect((await route(req('GET', '/channels/abc/state'), deps)).status).toBe(400)
  })
})
