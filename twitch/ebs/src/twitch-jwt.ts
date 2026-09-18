import { createHmac, timingSafeEqual } from 'node:crypto'

// Twitch extension JWTs: HS256, signed with the base64-decoded extension secret.
// Frontend-issued tokens (helper onAuthorized) carry role viewer|broadcaster|moderator
// plus channel_id/opaque_user_id; EBS-issued tokens use role 'external' and must name
// the extension owner's user id. Hand-rolled on node:crypto — no jsonwebtoken dependency
// in a Lambda that only ever verifies/signs one algorithm.

export interface TwitchJwtClaims {
  exp: number
  channel_id?: string
  role?: string
  user_id?: string
  opaque_user_id?: string
  pubsub_perms?: { send?: string[]; listen?: string[] }
  [key: string]: unknown
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

export function signTwitchJwt(claims: TwitchJwtClaims, extensionSecretB64: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify(claims))
  const signature = createHmac('sha256', Buffer.from(extensionSecretB64, 'base64'))
    .update(`${header}.${payload}`)
    .digest()
  return `${header}.${payload}.${b64url(signature)}`
}

/** Returns the claims when the signature is valid and the token is not expired. */
export function verifyTwitchJwt(
  token: string,
  extensionSecretB64: string,
  nowMs: number,
): TwitchJwtClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, signature] = parts
  try {
    const parsedHeader = JSON.parse(fromB64url(header).toString('utf8')) as { alg?: string }
    if (parsedHeader.alg !== 'HS256') return null
    const expected = createHmac('sha256', Buffer.from(extensionSecretB64, 'base64'))
      .update(`${header}.${payload}`)
      .digest()
    const actual = fromB64url(signature)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
    const claims = JSON.parse(fromB64url(payload).toString('utf8')) as TwitchJwtClaims
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs) return null
    return claims
  } catch {
    return null
  }
}

/** JWT the EBS presents to Helix to send PubSub messages into a channel. */
export function signExternalJwt(
  input: { channelId: string; ownerId: string; ttlS: number },
  extensionSecretB64: string,
  nowMs: number,
): string {
  return signTwitchJwt(
    {
      exp: Math.floor(nowMs / 1000) + input.ttlS,
      user_id: input.ownerId,
      role: 'external',
      channel_id: input.channelId,
      pubsub_perms: { send: ['broadcast'] },
    },
    extensionSecretB64,
  )
}
