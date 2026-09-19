import type {
  CompactRecord,
  EbsStore,
  PairRecord,
  RichRecord,
  TokenRecord,
} from './types.js'

/** In-memory store for tests and the local dev server (same semantics as DynamoDB). */
export function createMemoryStore(): EbsStore & { dump(): Record<string, unknown> } {
  const pairs = new Map<string, PairRecord>()
  const tokens = new Map<string, TokenRecord>()
  const compacts = new Map<string, CompactRecord>()
  const riches = new Map<string, RichRecord>()

  return {
    async putPair(record) {
      pairs.set(record.code, { ...record })
    },
    async consumePair(code, now) {
      const record = pairs.get(code)
      if (!record || record.used || record.expiresAt <= now) return null
      record.used = true
      return { ...record }
    },
    async putToken(record) {
      tokens.set(record.channelId, { ...record })
    },
    async getToken(channelId) {
      const record = tokens.get(channelId)
      return record ? { ...record } : null
    },
    async deleteToken(channelId) {
      tokens.delete(channelId)
    },
    async claimPublishSlot(channelId, now, minIntervalMs) {
      const record = tokens.get(channelId)
      if (!record) return false
      if (record.lastPublishAt > now - minIntervalMs) return false
      record.lastPublishAt = now
      return true
    },
    async getCompact(channelId) {
      const record = compacts.get(channelId)
      return record ? { ...record } : null
    },
    async putCompact(record) {
      compacts.set(record.channelId, { ...record })
    },
    async getRich(channelId) {
      const record = riches.get(channelId)
      return record ? { ...record } : null
    },
    async putRich(record) {
      riches.set(record.channelId, { ...record })
    },
    async deleteChannelState(channelId) {
      compacts.delete(channelId)
      riches.delete(channelId)
    },
    dump() {
      return {
        pairs: [...pairs.values()],
        tokens: [...tokens.values()].map((t) => ({ ...t, tokenHash: '<hidden>' })),
        compacts: [...compacts.keys()],
        riches: [...riches.keys()],
      }
    },
  }
}
