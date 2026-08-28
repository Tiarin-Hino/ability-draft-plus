import { describe, it, expect } from 'vitest'
import { parsePlayerIdInput } from '@core/scraper/player-id'

describe('parsePlayerIdInput', () => {
  it('parses a plain steamID32', () => {
    expect(parsePlayerIdInput('45008415')).toBe(45008415)
  })

  it('parses a steamID64 by subtracting the offset', () => {
    // 45008415 + 76561197960265728
    expect(parsePlayerIdInput('76561198005274143')).toBe(45008415)
  })

  it('parses a windrun profile URL', () => {
    expect(parsePlayerIdInput('https://windrun.io/players/45008415')).toBe(45008415)
  })

  it('parses a windrun profile URL with trailing path segments', () => {
    expect(parsePlayerIdInput('https://windrun.io/players/45008415/matches')).toBe(
      45008415,
    )
  })

  it('parses a steamcommunity profile URL (id64)', () => {
    expect(
      parsePlayerIdInput('https://steamcommunity.com/profiles/76561198005274143'),
    ).toBe(45008415)
  })

  it('tolerates surrounding whitespace', () => {
    expect(parsePlayerIdInput('  45008415  ')).toBe(45008415)
  })

  it('rejects empty input', () => {
    expect(parsePlayerIdInput('')).toBeNull()
    expect(parsePlayerIdInput('   ')).toBeNull()
  })

  it('rejects non-numeric garbage', () => {
    expect(parsePlayerIdInput('tiarin hino')).toBeNull()
    expect(parsePlayerIdInput('https://windrun.io/ability-pairs')).toBeNull()
  })

  it('rejects zero and vanity-URL profiles', () => {
    expect(parsePlayerIdInput('0')).toBeNull()
    expect(parsePlayerIdInput('https://steamcommunity.com/id/somename')).toBeNull()
  })

  it('rejects an id64 whose id32 would overflow uint32', () => {
    // Offset + 2^32 + 1 — not an individual-account id
    expect(parsePlayerIdInput('76561202255233025')).toBeNull()
  })
})
