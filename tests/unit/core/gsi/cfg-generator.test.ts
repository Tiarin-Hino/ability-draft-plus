import { describe, it, expect } from 'vitest'
import { buildGsiCfg, parseGsiCfgPort, GSI_CFG_FILE_NAME } from '@core/gsi/cfg-generator'

describe('buildGsiCfg', () => {
  it('targets the stream server /gsi endpoint on the given port', () => {
    const cfg = buildGsiCfg(58873)
    expect(cfg).toContain('"uri"           "http://127.0.0.1:58873/gsi"')
  })

  it('enables the data sections the board needs', () => {
    const cfg = buildGsiCfg(58873)
    for (const section of ['provider', 'map', 'player', 'hero', 'allplayers']) {
      expect(cfg).toMatch(new RegExp(`"${section}"\\s+"1"`))
    }
  })

  it('matches the expected file shape', () => {
    expect(buildGsiCfg(60000)).toMatchInlineSnapshot(`
      ""Ability Draft Plus GSI"
      {
          "uri"           "http://127.0.0.1:60000/gsi"
          "timeout"       "5.0"
          "buffer"        "0.1"
          "throttle"      "0.5"
          "heartbeat"     "10.0"
          "data"
          {
              "provider"      "1"
              "map"           "1"
              "player"        "1"
              "hero"          "1"
              "abilities"     "1"
              "draft"         "1"
              "allplayers"    "1"
          }
      }
      "
    `)
  })

  it('exports the canonical cfg file name', () => {
    expect(GSI_CFG_FILE_NAME).toBe('gamestate_integration_adplus.cfg')
  })
})

describe('parseGsiCfgPort', () => {
  it('round-trips the port through buildGsiCfg', () => {
    expect(parseGsiCfgPort(buildGsiCfg(58873))).toBe(58873)
    expect(parseGsiCfgPort(buildGsiCfg(1024))).toBe(1024)
    expect(parseGsiCfgPort(buildGsiCfg(65535))).toBe(65535)
  })

  it('tolerates hand-edited whitespace, host, and case', () => {
    const cfg = `"My GSI"\n{\n  "uri" "HTTP://localhost:58891/gsi"\n}\n`
    expect(parseGsiCfgPort(cfg)).toBe(58891)
  })

  it('returns null when the uri line is missing', () => {
    expect(parseGsiCfgPort('')).toBeNull()
    expect(parseGsiCfgPort('"timeout" "5.0"')).toBeNull()
  })

  it('returns null when the uri has no port', () => {
    expect(parseGsiCfgPort('"uri"  "http://127.0.0.1/gsi"')).toBeNull()
  })

  it('returns null for out-of-range ports', () => {
    expect(parseGsiCfgPort('"uri"  "http://127.0.0.1:99999/gsi"')).toBeNull()
  })
})
