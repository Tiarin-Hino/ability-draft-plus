import { describe, it, expect } from 'vitest'
import { signExternalJwt, signTwitchJwt, verifyTwitchJwt } from '../src/twitch-jwt.js'

const SECRET = Buffer.from('unit-test-secret-value').toString('base64')
const NOW = Date.UTC(2026, 8, 2, 12, 0, 0)

describe('twitch-jwt', () => {
  it('round-trips claims through sign and verify', () => {
    const token = signTwitchJwt(
      { exp: Math.floor(NOW / 1000) + 60, channel_id: '123', role: 'broadcaster' },
      SECRET,
    )
    const claims = verifyTwitchJwt(token, SECRET, NOW)
    expect(claims?.channel_id).toBe('123')
    expect(claims?.role).toBe('broadcaster')
  })

  it('rejects tampered payloads and wrong secrets', () => {
    const token = signTwitchJwt({ exp: Math.floor(NOW / 1000) + 60, role: 'viewer' }, SECRET)
    const [header, , signature] = token.split('.')
    const forgedPayload = Buffer.from(JSON.stringify({ exp: Math.floor(NOW / 1000) + 60, role: 'broadcaster' })).toString('base64url')
    expect(verifyTwitchJwt(`${header}.${forgedPayload}.${signature}`, SECRET, NOW)).toBeNull()
    expect(verifyTwitchJwt(token, Buffer.from('other').toString('base64'), NOW)).toBeNull()
    expect(verifyTwitchJwt('not.a.jwt.at.all', SECRET, NOW)).toBeNull()
    expect(verifyTwitchJwt('garbage', SECRET, NOW)).toBeNull()
  })

  it('rejects expired tokens', () => {
    const token = signTwitchJwt({ exp: Math.floor(NOW / 1000) - 1, role: 'viewer' }, SECRET)
    expect(verifyTwitchJwt(token, SECRET, NOW)).toBeNull()
  })

  it('signs external JWTs with the send:broadcast permission', () => {
    const token = signExternalJwt({ channelId: '123', ownerId: '999', ttlS: 60 }, SECRET, NOW)
    const claims = verifyTwitchJwt(token, SECRET, NOW)
    expect(claims).toMatchObject({
      role: 'external',
      user_id: '999',
      channel_id: '123',
      pubsub_perms: { send: ['broadcast'] },
    })
    expect(claims?.exp).toBe(Math.floor(NOW / 1000) + 60)
  })
})
