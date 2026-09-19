import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import type {
  CompactRecord,
  EbsStore,
  PairRecord,
  RichRecord,
  TokenRecord,
} from './types.js'

// Single-table layout (pk/sk, TTL attribute `ttl`):
//   PAIR#<code>    / PAIR     pairing codes (TTL = expiry)
//   CHANNEL#<id>   / TOKEN    channel token hash + publish bookkeeping
//   CHANNEL#<id>   / COMPACT  latest compact state (small, written ~1/s while drafting)
//   CHANNEL#<id>   / RICH     latest rich state (tens of KB, written once per draft)
// COMPACT and RICH are separate items so the frequent compact writes stay cheap.

const PAIR_TTL_GRACE_S = 60

interface Item {
  pk: string
  sk: string
  [key: string]: unknown
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'ConditionalCheckFailedException'
  )
}

export function createDynamoStore(tableName: string, client?: DynamoDBClient): EbsStore {
  const doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  })

  async function get(pk: string, sk: string): Promise<Item | null> {
    const result = await doc.send(new GetCommand({ TableName: tableName, Key: { pk, sk } }))
    return (result.Item as Item | undefined) ?? null
  }

  return {
    async putPair(record: PairRecord) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: `PAIR#${record.code}`,
            sk: 'PAIR',
            channelId: record.channelId,
            expiresAt: record.expiresAt,
            used: record.used,
            ttl: Math.floor(record.expiresAt / 1000) + PAIR_TTL_GRACE_S,
          },
        }),
      )
    },

    async consumePair(code, now) {
      try {
        const result = await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: `PAIR#${code}`, sk: 'PAIR' },
            ConditionExpression: 'attribute_exists(pk) AND used = :no AND expiresAt > :now',
            UpdateExpression: 'SET used = :yes',
            ExpressionAttributeValues: { ':no': false, ':yes': true, ':now': now },
            ReturnValues: 'ALL_NEW',
          }),
        )
        const item = result.Attributes as Item | undefined
        if (!item) return null
        return {
          code,
          channelId: String(item.channelId),
          expiresAt: Number(item.expiresAt),
          used: true,
        }
      } catch (error) {
        if (isConditionalCheckFailed(error)) return null
        throw error
      }
    },

    async putToken(record: TokenRecord) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: `CHANNEL#${record.channelId}`,
            sk: 'TOKEN',
            tokenHash: record.tokenHash,
            pairedAt: record.pairedAt,
            appVersion: record.appVersion,
            channelName: record.channelName,
            lastPublishAt: record.lastPublishAt,
          },
        }),
      )
    },

    async getToken(channelId) {
      const item = await get(`CHANNEL#${channelId}`, 'TOKEN')
      if (!item) return null
      return {
        channelId,
        tokenHash: String(item.tokenHash),
        pairedAt: Number(item.pairedAt),
        appVersion: String(item.appVersion ?? ''),
        channelName: typeof item.channelName === 'string' ? item.channelName : null,
        lastPublishAt: Number(item.lastPublishAt ?? 0),
      }
    },

    async deleteToken(channelId) {
      await doc.send(
        new DeleteCommand({ TableName: tableName, Key: { pk: `CHANNEL#${channelId}`, sk: 'TOKEN' } }),
      )
    },

    async claimPublishSlot(channelId, now, minIntervalMs) {
      try {
        await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: `CHANNEL#${channelId}`, sk: 'TOKEN' },
            ConditionExpression:
              'attribute_exists(pk) AND (attribute_not_exists(lastPublishAt) OR lastPublishAt <= :threshold)',
            UpdateExpression: 'SET lastPublishAt = :now',
            ExpressionAttributeValues: { ':threshold': now - minIntervalMs, ':now': now },
          }),
        )
        return true
      } catch (error) {
        if (isConditionalCheckFailed(error)) return false
        throw error
      }
    },

    async getCompact(channelId) {
      const item = await get(`CHANNEL#${channelId}`, 'COMPACT')
      if (!item) return null
      return {
        channelId,
        draftId: String(item.draftId),
        rev: Number(item.rev),
        phase: String(item.phase),
        body: String(item.body),
        updatedAt: Number(item.updatedAt),
      }
    },

    async putCompact(record: CompactRecord, ttlS) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: `CHANNEL#${record.channelId}`,
            sk: 'COMPACT',
            draftId: record.draftId,
            rev: record.rev,
            phase: record.phase,
            body: record.body,
            updatedAt: record.updatedAt,
            ttl: Math.floor(record.updatedAt / 1000) + ttlS,
          },
        }),
      )
    },

    async getRich(channelId) {
      const item = await get(`CHANNEL#${channelId}`, 'RICH')
      if (!item) return null
      return {
        channelId,
        draftId: String(item.draftId),
        rr: Number(item.rr),
        body: String(item.body),
        updatedAt: Number(item.updatedAt),
      }
    },

    async putRich(record: RichRecord, ttlS) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: `CHANNEL#${record.channelId}`,
            sk: 'RICH',
            draftId: record.draftId,
            rr: record.rr,
            body: record.body,
            updatedAt: record.updatedAt,
            ttl: Math.floor(record.updatedAt / 1000) + ttlS,
          },
        }),
      )
    },

    async deleteChannelState(channelId) {
      await Promise.all(
        ['COMPACT', 'RICH'].map((sk) =>
          doc.send(new DeleteCommand({ TableName: tableName, Key: { pk: `CHANNEL#${channelId}`, sk } })),
        ),
      )
    },
  }
}
