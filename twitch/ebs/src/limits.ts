// Hard limits of the EBS. The PubSub cap is Twitch's; everything else is ours.
export const MAX_COMPACT_BYTES = 5_120
export const MAX_RICH_BYTES = 131_072
export const MAX_BODY_BYTES = 160_000
/** Minimum gap between accepted publishes per channel (the app sends at >= 1.5 s). */
export const MIN_PUBLISH_INTERVAL_MS = 900
export const PAIR_CODE_TTL_MS = 10 * 60 * 1000
export const PAIR_CODE_LENGTH = 8
/** DynamoDB TTL for draft state items. */
export const STATE_TTL_S = 6 * 60 * 60
export const EXTERNAL_JWT_TTL_S = 60
/** Cache-Control max-age for the two viewer GETs. */
export const STATE_CACHE_S = 30
export const COMPACT_CACHE_S = 2
