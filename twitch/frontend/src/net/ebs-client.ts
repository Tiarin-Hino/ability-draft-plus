import type {
  TwitchCompactState,
  TwitchPairStartResponse,
  TwitchRichState,
} from '@shared/types/twitch'

// Viewer/config-page side of the EBS. Every call is a plain fetch to the routes in
// twitch/ebs/src/router.ts. The Twitch helper JWT rides along as bearer where available
// (pair/start requires the broadcaster's; the GETs are public).

const TIMEOUT_MS = 8_000

export interface ChannelStatus {
  paired: boolean
  pairedAt: number | null
  appVersion: string | null
  channelName: string | null
  lastPublishAt: number | null
  phase: string | null
  updatedAt: number | null
}

export interface EbsClient {
  readonly baseUrl: string
  getCompact(channelId: string): Promise<{ compact: TwitchCompactState; serverTs: number } | null>
  getState(
    channelId: string,
    etag?: string,
  ): Promise<{ state: TwitchRichState; etag: string } | 'not-modified' | null>
  pairStart(jwt: string): Promise<TwitchPairStartResponse>
  getStatus(channelId: string): Promise<ChannelStatus>
}

export function createEbsClient(baseUrl: string, fetchImpl: typeof fetch = fetch): EbsClient {
  const root = baseUrl.replace(/\/+$/, '')

  return {
    baseUrl: root,

    async getCompact(channelId) {
      const response = await fetchImpl(`${root}/channels/${channelId}/compact`, {
        cache: 'no-cache',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`compact HTTP ${response.status}`)
      return (await response.json()) as { compact: TwitchCompactState; serverTs: number }
    },

    async getState(channelId, etag) {
      const response = await fetchImpl(`${root}/channels/${channelId}/state`, {
        headers: etag ? { 'If-None-Match': etag } : {},
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (response.status === 304) return 'not-modified'
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`state HTTP ${response.status}`)
      return {
        state: (await response.json()) as TwitchRichState,
        etag: response.headers.get('ETag') ?? '',
      }
    },

    async pairStart(jwt) {
      const response = await fetchImpl(`${root}/pair/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`pair/start HTTP ${response.status}`)
      return (await response.json()) as TwitchPairStartResponse
    },

    async getStatus(channelId) {
      const response = await fetchImpl(`${root}/channels/${channelId}/status`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`status HTTP ${response.status}`)
      return (await response.json()) as ChannelStatus
    },
  }
}
