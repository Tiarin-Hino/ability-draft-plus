import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type {
  TwitchCompactState,
  TwitchPairCompleteRequest,
  TwitchPairCompleteResponse,
  TwitchPairStartResponse,
  TwitchProtocolVersion,
  TwitchPublishEnvelope,
  TwitchPublishErrorCode,
  TwitchPublishResponse,
  TwitchRichState,
  TwitchLiveState,
} from '@shared/types/twitch'
import {
  COMPACT_CACHE_S,
  MAX_BODY_BYTES,
  MAX_COMPACT_BYTES,
  MAX_RICH_BYTES,
  MIN_PUBLISH_INTERVAL_MS,
  PAIR_CODE_LENGTH,
  PAIR_CODE_TTL_MS,
  STATE_CACHE_S,
  STATE_TTL_S,
} from './limits.js'
import { verifyTwitchJwt } from './twitch-jwt.js'
import type { EbsDeps, EbsRequest, EbsResponse } from './types.js'

// Pure router: (request, deps) -> response. No AWS imports — handler.ts and the dev server
// adapt transports, store-*.ts adapt persistence. Routes (deployment prefix /twitch is
// stripped before dispatch):
//   POST /pair/start                 broadcaster JWT -> short pairing code
//   POST /pair/complete              code -> channel token (single use, 10 min)
//   POST /channels/{id}/publish      channel token: store compact (+rich), relay via PubSub
//   GET  /channels/{id}/state        rich state (ETag = draftId-rr)
//   GET  /channels/{id}/compact      latest compact (late joiners)
//   GET  /channels/{id}/status       pairing/publish status for the config page
//   POST /channels/{id}/unpair       channel token: revoke
// Protocol version is pinned here (type-checked against the shared literal type) so a
// mismatched app gets a clean 'version' refusal instead of undefined behaviour.

export const PROTOCOL_VERSION: TwitchProtocolVersion = 1
const PATH_PREFIX = '/twitch'
const PHASES = new Set(['waiting', 'drafting', 'ingame', 'ended'])
/** Crockford base32 — no I/L/O/U, so codes survive being read aloud. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match',
  'Access-Control-Max-Age': '86400',
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): EbsResponse {
  return {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
    body: JSON.stringify(body),
  }
}

function refuse(status: number, error: TwitchPublishErrorCode, headers?: Record<string, string>): EbsResponse {
  const body: TwitchPublishResponse = { ok: false, error }
  return json(status, body, headers)
}

function bearer(req: EbsRequest): string | null {
  const value = req.headers.authorization
  if (!value) return null
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match ? match[1] : null
}

function parseBody<T>(req: EbsRequest): T | null {
  if (!req.body) return null
  if (Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) return null
  try {
    return JSON.parse(req.body) as T
  } catch {
    return null
  }
}

export function normalizePath(path: string): string {
  let out = path.split('?')[0]
  if (out.startsWith(PATH_PREFIX + '/') || out === PATH_PREFIX) out = out.slice(PATH_PREFIX.length)
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out || '/'
}

export function generatePairCode(): string {
  let code = ''
  for (let i = 0; i < PAIR_CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return code
}

export function normalizePairCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isChannelId(value: string): boolean {
  return /^\d{1,20}$/.test(value)
}

async function authenticateChannel(
  req: EbsRequest,
  channelId: string,
  deps: EbsDeps,
): Promise<boolean> {
  const token = bearer(req)
  if (!token) return false
  const record = await deps.store.getToken(channelId)
  if (!record) return false
  const expected = Buffer.from(record.tokenHash, 'hex')
  const actual = Buffer.from(sha256Hex(token), 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async function pairStart(req: EbsRequest, deps: EbsDeps): Promise<EbsResponse> {
  const token = bearer(req)
  if (!token) return json(401, { error: 'unauthorized' })
  const claims = verifyTwitchJwt(token, deps.secrets.extensionSecret, deps.now())
  if (!claims || claims.role !== 'broadcaster' || typeof claims.channel_id !== 'string') {
    return json(403, { error: 'forbidden' })
  }
  const code = generatePairCode()
  const expiresAt = deps.now() + PAIR_CODE_TTL_MS
  await deps.store.putPair({ code, channelId: claims.channel_id, expiresAt, used: false })
  deps.log('info', 'Pairing code issued', { channelId: claims.channel_id })
  const body: TwitchPairStartResponse = { code, expiresAt }
  return json(200, body)
}

async function pairComplete(req: EbsRequest, deps: EbsDeps): Promise<EbsResponse> {
  const body = parseBody<Partial<TwitchPairCompleteRequest>>(req)
  if (!body || typeof body.code !== 'string') return json(400, { error: 'bad_request' })
  const code = normalizePairCode(body.code)
  if (code.length !== PAIR_CODE_LENGTH) return json(404, { error: 'invalid_code' })
  const pair = await deps.store.consumePair(code, deps.now())
  if (!pair) return json(404, { error: 'invalid_code' })

  const channelToken = randomBytes(32).toString('hex')
  const channelName = await deps.lookupChannelName(pair.channelId)
  await deps.store.putToken({
    channelId: pair.channelId,
    tokenHash: sha256Hex(channelToken),
    pairedAt: deps.now(),
    appVersion: typeof body.appVersion === 'string' ? body.appVersion.slice(0, 32) : '',
    channelName,
    lastPublishAt: 0,
  })
  deps.log('info', 'Channel paired', { channelId: pair.channelId })
  const response: TwitchPairCompleteResponse = { channelId: pair.channelId, channelToken, channelName }
  return json(200, response)
}

function validateCompact(value: unknown, channelId: string): TwitchCompactState | null {
  if (typeof value !== 'object' || value === null) return null
  const c = value as Partial<TwitchCompactState>
  if (c.v !== PROTOCOL_VERSION) return null
  if (typeof c.d !== 'string' || c.d.length === 0 || c.d.length > 32) return null
  if (typeof c.p !== 'string' || !PHASES.has(c.p)) return null
  if (typeof c.r !== 'number' || !Number.isInteger(c.r) || c.r < 0) return null
  if (typeof c.t !== 'number' || typeof c.rr !== 'number') return null
  void channelId
  return c as TwitchCompactState
}

async function publish(req: EbsRequest, channelId: string, deps: EbsDeps): Promise<EbsResponse> {
  if (!(await authenticateChannel(req, channelId, deps))) return refuse(401, 'unauthorized')

  const envelope = parseBody<Partial<TwitchPublishEnvelope>>(req)
  if (!envelope || typeof envelope !== 'object') return refuse(400, 'bad_request')
  if (envelope.v !== PROTOCOL_VERSION) return refuse(400, 'version')
  if (envelope.channelId !== channelId) return refuse(400, 'bad_request')

  // Caster telemetry: a fire-and-forget relay, handled before the draft path.
  // It is NOT stored — it is worthless the moment it is superseded (a two second
  // old net worth helps nobody), so late joiners simply wait for the next tick
  // rather than being served a stale one from DynamoDB.
  if (envelope.live !== undefined) {
    const live = envelope.live as Partial<TwitchLiveState>
    if (
      !live ||
      live.v !== PROTOCOL_VERSION ||
      live.kind !== 'live' ||
      typeof live.d !== 'string' ||
      typeof live.r !== 'number' ||
      !Array.isArray(live.players)
    ) {
      return refuse(400, 'bad_request')
    }
    const liveJson = JSON.stringify(live)
    if (Buffer.byteLength(liveJson, 'utf8') > MAX_COMPACT_BYTES) return refuse(413, 'too_large')
    const claimed = await deps.store.claimPublishSlot(
      channelId,
      deps.now(),
      MIN_PUBLISH_INTERVAL_MS,
    )
    if (!claimed) return refuse(429, 'rate_limited', { 'Retry-After': '1' })
    const sent = await deps.sendPubSub(channelId, liveJson)
    return json(200, { ok: true, r: live.r, pubsub: sent ? 'sent' : 'failed' })
  }

  const compact = validateCompact(envelope.compact, channelId)
  if (!compact) return refuse(400, 'bad_request')

  const compactJson = JSON.stringify(compact)
  if (Buffer.byteLength(compactJson, 'utf8') > MAX_COMPACT_BYTES) return refuse(413, 'too_large')

  let rich: TwitchRichState | null = null
  let richJson = ''
  if (envelope.rich !== undefined) {
    const r = envelope.rich as Partial<TwitchRichState>
    if (!r || r.v !== PROTOCOL_VERSION || r.d !== compact.d || typeof r.rr !== 'number') {
      return refuse(400, 'bad_request')
    }
    richJson = JSON.stringify(r)
    if (Buffer.byteLength(richJson, 'utf8') > MAX_RICH_BYTES) return refuse(413, 'too_large')
    rich = r as TwitchRichState
  }

  const now = deps.now()
  const stored = await deps.store.getCompact(channelId)
  const duplicate = stored !== null && stored.draftId === compact.d && stored.rev === compact.r
  if (stored && stored.draftId === compact.d && compact.r < stored.rev) return refuse(409, 'stale')

  if (!duplicate) {
    const claimed = await deps.store.claimPublishSlot(channelId, now, MIN_PUBLISH_INTERVAL_MS)
    if (!claimed) return refuse(429, 'rate_limited', { 'Retry-After': '1' })
  }

  await deps.store.putCompact(
    { channelId, draftId: compact.d, rev: compact.r, phase: compact.p, body: compactJson, updatedAt: now },
    STATE_TTL_S,
  )
  if (rich) {
    await deps.store.putRich(
      { channelId, draftId: rich.d, rr: rich.rr, body: richJson, updatedAt: now },
      STATE_TTL_S,
    )
  }

  let pubsub: 'sent' | 'skipped' | 'failed' = 'skipped'
  if (!duplicate) {
    pubsub = (await deps.sendPubSub(channelId, compactJson)) ? 'sent' : 'failed'
  }

  const storedRich = rich ? null : await deps.store.getRich(channelId)
  const needRich =
    !rich && (storedRich === null || storedRich.draftId !== compact.d || storedRich.rr !== compact.rr)

  const response: TwitchPublishResponse = {
    ok: true,
    r: compact.r,
    pubsub,
    ...(needRich ? { needRich: true } : {}),
  }
  return json(200, response)
}

async function getState(req: EbsRequest, channelId: string, deps: EbsDeps): Promise<EbsResponse> {
  const rich = await deps.store.getRich(channelId)
  if (!rich) return json(404, { error: 'none' }, { 'Cache-Control': 'no-store' })
  const etag = `"${rich.draftId}-${rich.rr}"`
  const headers = { ETag: etag, 'Cache-Control': `public, max-age=${STATE_CACHE_S}` }
  if (req.headers['if-none-match'] === etag) {
    return { status: 304, headers: { ...CORS_HEADERS, ...headers }, body: '' }
  }
  return {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers },
    body: rich.body,
  }
}

async function getCompact(channelId: string, deps: EbsDeps): Promise<EbsResponse> {
  const compact = await deps.store.getCompact(channelId)
  if (!compact) return json(404, { error: 'none' }, { 'Cache-Control': 'no-store' })
  return {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${COMPACT_CACHE_S}`,
    },
    body: `{"compact":${compact.body},"serverTs":${deps.now()}}`,
  }
}

async function getStatus(channelId: string, deps: EbsDeps): Promise<EbsResponse> {
  const token = await deps.store.getToken(channelId)
  const compact = token ? await deps.store.getCompact(channelId) : null
  return json(
    200,
    {
      paired: token !== null,
      pairedAt: token?.pairedAt ?? null,
      appVersion: token?.appVersion ?? null,
      channelName: token?.channelName ?? null,
      lastPublishAt: token?.lastPublishAt || null,
      phase: compact?.phase ?? null,
      updatedAt: compact?.updatedAt ?? null,
    },
    { 'Cache-Control': 'no-store' },
  )
}

async function unpair(req: EbsRequest, channelId: string, deps: EbsDeps): Promise<EbsResponse> {
  if (!(await authenticateChannel(req, channelId, deps))) return refuse(401, 'unauthorized')
  await deps.store.deleteToken(channelId)
  await deps.store.deleteChannelState(channelId)
  deps.log('info', 'Channel unpaired', { channelId })
  return { status: 204, headers: { ...CORS_HEADERS }, body: '' }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function route(req: EbsRequest, deps: EbsDeps): Promise<EbsResponse> {
  const method = req.method.toUpperCase()
  const path = normalizePath(req.path)

  if (method === 'OPTIONS') return { status: 204, headers: { ...CORS_HEADERS }, body: '' }

  try {
    if (path === '/pair/start' && method === 'POST') return await pairStart(req, deps)
    if (path === '/pair/complete' && method === 'POST') return await pairComplete(req, deps)

    const channel = /^\/channels\/([^/]+)\/(publish|state|compact|status|unpair)$/.exec(path)
    if (channel) {
      const [, channelId, action] = channel
      if (!isChannelId(channelId)) return json(400, { error: 'bad_request' })
      if (action === 'publish' && method === 'POST') return await publish(req, channelId, deps)
      if (action === 'state' && method === 'GET') return await getState(req, channelId, deps)
      if (action === 'compact' && method === 'GET') return await getCompact(channelId, deps)
      if (action === 'status' && method === 'GET') return await getStatus(channelId, deps)
      if (action === 'unpair' && method === 'POST') return await unpair(req, channelId, deps)
    }
    return json(404, { error: 'not_found' })
  } catch (error) {
    deps.log('error', 'Unhandled route error', {
      path,
      method,
      error: error instanceof Error ? error.message : String(error),
    })
    return json(500, { error: 'internal' })
  }
}
