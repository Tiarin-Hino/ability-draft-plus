import type {
  TwitchPairCompleteRequest,
  TwitchPairCompleteResponse,
  TwitchPublishEnvelope,
  TwitchPublishResponse,
} from '@shared/types/twitch'

// @DEV-GUIDE: Thin HTTPS client for the Twitch extension backend (twitch/ebs). Three
// calls, all JSON: pair-code exchange, publish (compact + optional rich), unpair.
// Transport failures (DNS, timeout, 5xx without a JSON body) THROW TwitchEbsError so the
// publisher can back off; protocol-level refusals (401/409/413/429 with an {ok:false}
// body) are RETURNED so the publisher can react per error code without try/catch soup.
// Node 22's global fetch; AbortSignal.timeout bounds every call.

export class TwitchEbsError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message)
    this.name = 'TwitchEbsError'
  }
}

export interface TwitchEbsClient {
  readonly baseUrl: string
  pairComplete(request: TwitchPairCompleteRequest): Promise<TwitchPairCompleteResponse>
  publish(
    token: string,
    envelope: TwitchPublishEnvelope,
    timeoutMs?: number,
  ): Promise<TwitchPublishResponse>
  unpair(token: string, channelId: string): Promise<void>
}

const DEFAULT_TIMEOUT_MS = 8_000

function isPublishResponse(value: unknown): value is TwitchPublishResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  )
}

export function createTwitchEbsClient(baseUrl: string): TwitchEbsClient {
  const root = baseUrl.replace(/\/+$/, '')

  async function request(
    path: string,
    init: { method: string; body?: unknown; token?: string; timeoutMs?: number },
  ): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    if (init.token) headers.Authorization = `Bearer ${init.token}`

    let response: Response
    try {
      response = await fetch(`${root}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      })
    } catch (error) {
      throw new TwitchEbsError(
        `EBS request failed: ${error instanceof Error ? error.message : String(error)}`,
        null,
      )
    }

    let json: unknown = null
    const text = await response.text()
    if (text.length > 0) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }
    return { status: response.status, json }
  }

  return {
    baseUrl: root,

    async pairComplete(body) {
      const { status, json } = await request('/pair/complete', { method: 'POST', body })
      if (status === 200 && json && typeof json === 'object') {
        const data = json as Partial<TwitchPairCompleteResponse>
        if (typeof data.channelId === 'string' && typeof data.channelToken === 'string') {
          return {
            channelId: data.channelId,
            channelToken: data.channelToken,
            channelName: typeof data.channelName === 'string' ? data.channelName : null,
          }
        }
      }
      throw new TwitchEbsError(`Pairing failed (HTTP ${status})`, status)
    },

    async publish(token, envelope, timeoutMs) {
      const { status, json } = await request(`/channels/${envelope.channelId}/publish`, {
        method: 'POST',
        body: envelope,
        token,
        timeoutMs,
      })
      if (isPublishResponse(json)) return json
      throw new TwitchEbsError(`Publish failed (HTTP ${status})`, status)
    },

    async unpair(token, channelId) {
      const { status } = await request(`/channels/${channelId}/unpair`, {
        method: 'POST',
        token,
      })
      if (status >= 500) throw new TwitchEbsError(`Unpair failed (HTTP ${status})`, status)
    },
  }
}
