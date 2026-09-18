import { route } from './router.js'
import { loadSecrets } from './secrets.js'
import { createDynamoStore } from './store-dynamo.js'
import { createChannelNameLookup, createPubSubSender } from './twitch-helix.js'
import type { EbsDeps, EbsRequest, LogLevel } from './types.js'

// AWS Lambda entry (API Gateway HTTP API, payload format 2.0). Adapts the event to the
// pure router's request shape and builds the deps once per container.

interface HttpApiEvent {
  requestContext: { http: { method: string; path: string } }
  rawPath: string
  headers?: Record<string, string | undefined>
  queryStringParameters?: Record<string, string | undefined>
  body?: string
  isBase64Encoded?: boolean
}

interface HttpApiResult {
  statusCode: number
  headers: Record<string, string>
  body: string
}

function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const line = JSON.stringify({ level, message, ...data })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

let depsPromise: Promise<EbsDeps> | null = null

async function getDeps(): Promise<EbsDeps> {
  if (!depsPromise) {
    depsPromise = (async () => {
      const tableName = process.env.TABLE_NAME
      if (!tableName) throw new Error('TABLE_NAME is not set')
      const secrets = await loadSecrets()
      const now = () => Date.now()
      return {
        store: createDynamoStore(tableName),
        secrets,
        sendPubSub: createPubSubSender(secrets, log, now),
        lookupChannelName: createChannelNameLookup(secrets, log, now),
        now,
        log,
      }
    })().catch((error: unknown) => {
      depsPromise = null
      throw error
    })
  }
  return depsPromise
}

function toRequest(event: HttpApiEvent): EbsRequest {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (typeof value === 'string') headers[key.toLowerCase()] = value
  }
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(event.queryStringParameters ?? {})) {
    if (typeof value === 'string') query[key] = value
  }
  let body: string | null = null
  if (typeof event.body === 'string') {
    body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
  }
  return {
    method: event.requestContext.http.method,
    path: event.rawPath || event.requestContext.http.path,
    headers,
    query,
    body,
  }
}

export async function handler(event: HttpApiEvent): Promise<HttpApiResult> {
  const deps = await getDeps()
  const response = await route(toRequest(event), deps)
  return { statusCode: response.status, headers: response.headers, body: response.body }
}
