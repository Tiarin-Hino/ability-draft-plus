// Runtime-agnostic request/response + storage contracts so the router is a pure
// function testable without AWS. handler.ts adapts API Gateway (HTTP API v2) events,
// scripts/dev-server.ts adapts node:http.

export interface EbsRequest {
  method: string
  /** Path WITHOUT the deployment prefix (/twitch is stripped by the adapter/router). */
  path: string
  /** Header names lowercased. */
  headers: Record<string, string>
  query: Record<string, string>
  body: string | null
}

export interface EbsResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export interface PairRecord {
  code: string
  channelId: string
  expiresAt: number
  used: boolean
}

export interface TokenRecord {
  channelId: string
  /** sha256(channelToken), hex. */
  tokenHash: string
  pairedAt: number
  appVersion: string
  channelName: string | null
  lastPublishAt: number
}

export interface CompactRecord {
  channelId: string
  draftId: string
  rev: number
  phase: string
  /** JSON of the TwitchCompactState exactly as relayed to viewers. */
  body: string
  updatedAt: number
}

export interface RichRecord {
  channelId: string
  draftId: string
  rr: number
  body: string
  updatedAt: number
}

export interface EbsStore {
  putPair(record: PairRecord): Promise<void>
  /** Atomically mark a valid, unexpired, unused code as used; null otherwise. */
  consumePair(code: string, now: number): Promise<PairRecord | null>
  putToken(record: TokenRecord): Promise<void>
  getToken(channelId: string): Promise<TokenRecord | null>
  deleteToken(channelId: string): Promise<void>
  /** Atomically claim a publish slot; false when one was claimed within minIntervalMs. */
  claimPublishSlot(channelId: string, now: number, minIntervalMs: number): Promise<boolean>
  getCompact(channelId: string): Promise<CompactRecord | null>
  putCompact(record: CompactRecord, ttlS: number): Promise<void>
  getRich(channelId: string): Promise<RichRecord | null>
  putRich(record: RichRecord, ttlS: number): Promise<void>
  deleteChannelState(channelId: string): Promise<void>
}

export interface EbsSecrets {
  /** Extension secret as issued by Twitch (base64). */
  extensionSecret: string
  clientId: string
  /** Twitch user id of the extension owner (required in EBS-signed JWTs). */
  ownerId: string
  /** Optional: enables channel display-name lookup via client credentials. */
  clientSecret?: string
}

export type LogLevel = 'info' | 'warn' | 'error'

export interface EbsDeps {
  store: EbsStore
  secrets: EbsSecrets
  /** Relay a compact message to the channel's viewers; true on success. */
  sendPubSub(channelId: string, message: string): Promise<boolean>
  /** Best effort; null when unavailable. */
  lookupChannelName(channelId: string): Promise<string | null>
  now(): number
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void
}
