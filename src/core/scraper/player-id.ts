// @DEV-GUIDE: Parses user input for the linked Windrun profile into a steamID32
// (what Windrun's /players/{id} endpoints take). Accepted forms:
// - plain steamID32 digits          "45008415"
// - steamID64 digits                "76561198005274143" (offset-converted)
// - windrun/dotabuff/opendota URL   "https://windrun.io/players/45008415"
// - steamcommunity profile URL      "https://steamcommunity.com/profiles/7656119..."
// Pure TypeScript (core) — unit-tested without Electron.

/** steamID64 = steamID32 + this offset (Valve's individual-account base). */
const STEAM_ID64_OFFSET = 76561197960265728n

/** steamID32 is a uint32. */
const MAX_STEAM_ID32 = 0xffffffffn

function digitsToId32(digits: string): number | null {
  let value: bigint
  try {
    value = BigInt(digits)
  } catch {
    return null
  }
  if (value <= 0n) return null
  if (value >= STEAM_ID64_OFFSET) value -= STEAM_ID64_OFFSET
  if (value <= 0n || value > MAX_STEAM_ID32) return null
  return Number(value)
}

/**
 * Parse free-form profile input into a steamID32, or null when unparseable.
 */
export function parsePlayerIdInput(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return null

  if (/^\d+$/.test(trimmed)) {
    return digitsToId32(trimmed)
  }

  // URL-ish input: take the id from a /players/{id} or /profiles/{id} segment
  const match = trimmed.match(/\/(?:players|profiles)\/(\d+)/)
  if (match) {
    return digitsToId32(match[1])
  }

  return null
}
