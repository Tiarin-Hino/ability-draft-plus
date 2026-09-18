import { EXTERNAL_JWT_TTL_S } from './limits.js'
import { signExternalJwt } from './twitch-jwt.js'
import type { EbsSecrets, LogLevel } from './types.js'

// Helix calls the EBS makes: Send Extension PubSub Message (the relay) and, optionally,
// Get Users (channel display name for the app's pairing card). Both are plain fetch.

const HELIX_PUBSUB_URL = 'https://api.twitch.tv/helix/extensions/pubsub'
const HELIX_USERS_URL = 'https://api.twitch.tv/helix/users'
const OAUTH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const REQUEST_TIMEOUT_MS = 5_000

type Logger = (level: LogLevel, message: string, data?: Record<string, unknown>) => void

export function createPubSubSender(secrets: EbsSecrets, log: Logger, now: () => number) {
  return async (channelId: string, message: string): Promise<boolean> => {
    const jwt = signExternalJwt(
      { channelId, ownerId: secrets.ownerId, ttlS: EXTERNAL_JWT_TTL_S },
      secrets.extensionSecret,
      now(),
    )
    try {
      const response = await fetch(HELIX_PUBSUB_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Client-Id': secrets.clientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target: ['broadcast'],
          broadcaster_id: channelId,
          is_global_broadcast: false,
          message,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (response.status === 204) return true
      log('warn', 'Helix PubSub send refused', {
        channelId,
        status: response.status,
        body: (await response.text()).slice(0, 300),
      })
      return false
    } catch (error) {
      log('warn', 'Helix PubSub send failed', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }
}

/**
 * Channel display-name lookup through an app access token (client credentials).
 * Needs the extension's client secret; without it the lookup resolves to null and
 * the app shows "Channel <id>" instead.
 */
export function createChannelNameLookup(secrets: EbsSecrets, log: Logger, now: () => number) {
  let appToken: { value: string; expiresAt: number } | null = null

  async function getAppToken(): Promise<string | null> {
    if (!secrets.clientSecret) return null
    if (appToken && appToken.expiresAt > now() + 60_000) return appToken.value
    const params = new URLSearchParams({
      client_id: secrets.clientId,
      client_secret: secrets.clientSecret,
      grant_type: 'client_credentials',
    })
    const response = await fetch(`${OAUTH_TOKEN_URL}?${params.toString()}`, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      log('warn', 'Client-credentials token request failed', { status: response.status })
      return null
    }
    const data = (await response.json()) as { access_token?: string; expires_in?: number }
    if (!data.access_token) return null
    appToken = {
      value: data.access_token,
      expiresAt: now() + (data.expires_in ?? 3600) * 1000,
    }
    return appToken.value
  }

  return async (channelId: string): Promise<string | null> => {
    try {
      const token = await getAppToken()
      if (!token) return null
      const response = await fetch(`${HELIX_USERS_URL}?id=${encodeURIComponent(channelId)}`, {
        headers: { Authorization: `Bearer ${token}`, 'Client-Id': secrets.clientId },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) return null
      const data = (await response.json()) as { data?: Array<{ display_name?: string }> }
      return data.data?.[0]?.display_name ?? null
    } catch (error) {
      log('warn', 'Channel name lookup failed', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
}
