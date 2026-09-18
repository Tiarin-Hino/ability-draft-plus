import { createServer } from 'node:http'
import { route, generatePairCode } from '../src/router.js'
import { createMemoryStore } from '../src/store-memory.js'
import { createChannelNameLookup, createPubSubSender } from '../src/twitch-helix.js'
import { signTwitchJwt } from '../src/twitch-jwt.js'
import { PAIR_CODE_TTL_MS } from '../src/limits.js'
import type { EbsDeps, EbsRequest, EbsSecrets, LogLevel } from '../src/types.js'

// Local EBS: `npm run dev` (port 8787). In-memory store; PubSub messages are logged
// unless TWITCH_EXT_SECRET / TWITCH_CLIENT_ID / TWITCH_OWNER_ID are set, in which case
// they go to Helix for real. Extra dev-only helpers (never deployed):
//   GET /dev/pair-code?channelId=123   -> issues a pairing code without a broadcaster JWT
//   GET /dev/jwt?channelId=123&role=broadcaster -> mints an extension JWT (dev secret)
//   GET /dev/dump                      -> store contents
// Point the desktop app at it with TWITCH_EBS_URL=http://127.0.0.1:8787/twitch in .env
// and the frontend with ?ebs=http://127.0.0.1:8787/twitch.

const PORT = Number(process.env.PORT ?? 8787)
const DEV_SECRET = Buffer.from('ability-draft-plus-dev-secret').toString('base64')

function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const stamp = new Date().toISOString()
  console.log(`${stamp} [${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`)
}

const secrets: EbsSecrets = {
  extensionSecret: process.env.TWITCH_EXT_SECRET ?? DEV_SECRET,
  clientId: process.env.TWITCH_CLIENT_ID ?? 'dev-client-id',
  ownerId: process.env.TWITCH_OWNER_ID ?? '0',
  ...(process.env.TWITCH_CLIENT_SECRET ? { clientSecret: process.env.TWITCH_CLIENT_SECRET } : {}),
}
const realHelix = Boolean(
  process.env.TWITCH_EXT_SECRET && process.env.TWITCH_CLIENT_ID && process.env.TWITCH_OWNER_ID,
)
const now = () => Date.now()
const store = createMemoryStore()

const deps: EbsDeps = {
  store,
  secrets,
  sendPubSub: realHelix
    ? createPubSubSender(secrets, log, now)
    : async (channelId, message) => {
        log('info', 'PubSub (logged, not sent)', {
          channelId,
          bytes: Buffer.byteLength(message, 'utf8'),
          preview: message.slice(0, 120),
        })
        return true
      },
  lookupChannelName: realHelix ? createChannelNameLookup(secrets, log, now) : async () => null,
  now,
  log,
}

async function devRoute(req: EbsRequest): Promise<{ status: number; body: unknown } | null> {
  if (req.path === '/dev/pair-code') {
    const channelId = req.query.channelId ?? '123'
    const code = generatePairCode()
    await store.putPair({ code, channelId, expiresAt: now() + PAIR_CODE_TTL_MS, used: false })
    return { status: 200, body: { code, channelId } }
  }
  if (req.path === '/dev/jwt') {
    const channelId = req.query.channelId ?? '123'
    const role = req.query.role ?? 'broadcaster'
    const token = signTwitchJwt(
      {
        exp: Math.floor(now() / 1000) + 3600,
        channel_id: channelId,
        role,
        opaque_user_id: `U${channelId}`,
        user_id: channelId,
        pubsub_perms: { listen: ['broadcast'] },
      },
      secrets.extensionSecret,
    )
    return { status: 200, body: { token } }
  }
  if (req.path === '/dev/dump') return { status: 200, body: store.dump() }
  return null
}

const server = createServer((incoming, outgoing) => {
  const chunks: Buffer[] = []
  incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
  incoming.on('end', () => {
    void (async () => {
      const url = new URL(incoming.url ?? '/', `http://127.0.0.1:${PORT}`)
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers[key.toLowerCase()] = value
      }
      const req: EbsRequest = {
        method: incoming.method ?? 'GET',
        path: url.pathname,
        headers,
        query: Object.fromEntries(url.searchParams.entries()),
        body: chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : null,
      }
      const dev = await devRoute(req)
      if (dev) {
        outgoing.writeHead(dev.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        })
        outgoing.end(JSON.stringify(dev.body))
        return
      }
      const response = await route(req, deps)
      log('info', `${req.method} ${req.path} -> ${response.status}`)
      outgoing.writeHead(response.status, response.headers)
      outgoing.end(response.body)
    })()
  })
})

server.listen(PORT, '127.0.0.1', () => {
  log('info', `EBS dev server listening on http://127.0.0.1:${PORT}/twitch`, {
    helix: realHelix ? 'real' : 'logged',
  })
})
