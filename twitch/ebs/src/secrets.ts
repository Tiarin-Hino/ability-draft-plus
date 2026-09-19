import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import type { EbsSecrets } from './types.js'

// Secrets: environment first (local dev / tests), else SSM SecureStrings under
// SSM_PREFIX (default /twitch-ext): secret, client-id, owner-id, client-secret (optional).
// Cached for 10 minutes per Lambda container.

const CACHE_TTL_MS = 10 * 60 * 1000
let cached: { value: EbsSecrets; at: number } | null = null

function fromEnv(): EbsSecrets | null {
  const extensionSecret = process.env.TWITCH_EXT_SECRET
  const clientId = process.env.TWITCH_CLIENT_ID
  const ownerId = process.env.TWITCH_OWNER_ID
  if (!extensionSecret || !clientId || !ownerId) return null
  return {
    extensionSecret,
    clientId,
    ownerId,
    ...(process.env.TWITCH_CLIENT_SECRET ? { clientSecret: process.env.TWITCH_CLIENT_SECRET } : {}),
  }
}

export async function loadSecrets(client?: SSMClient): Promise<EbsSecrets> {
  const env = fromEnv()
  if (env) return env
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value

  const prefix = process.env.SSM_PREFIX ?? '/twitch-ext'
  const ssm = client ?? new SSMClient({})
  const read = async (name: string, optional = false): Promise<string | undefined> => {
    try {
      const result = await ssm.send(
        new GetParameterCommand({ Name: `${prefix}/${name}`, WithDecryption: true }),
      )
      return result.Parameter?.Value
    } catch (error) {
      if (optional) return undefined
      throw error
    }
  }

  const [extensionSecret, clientId, ownerId, clientSecret] = await Promise.all([
    read('secret'),
    read('client-id'),
    read('owner-id'),
    read('client-secret', true),
  ])
  if (!extensionSecret || !clientId || !ownerId) {
    throw new Error(`Missing SSM parameters under ${prefix} (secret, client-id, owner-id)`)
  }
  const value: EbsSecrets = { extensionSecret, clientId, ownerId, ...(clientSecret ? { clientSecret } : {}) }
  cached = { value, at: Date.now() }
  return value
}
