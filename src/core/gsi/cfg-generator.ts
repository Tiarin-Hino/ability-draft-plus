// @DEV-GUIDE: Generates the gamestate_integration cfg Dota 2 reads on launch. The file
// must live in <dota>/game/dota/cfg/gamestate_integration/ (gsi-cfg-service handles
// discovery + writing) and Dota must be RESTARTED after it changes. The uri targets the
// stream server's /gsi route, so the cfg port must match the app's stream port —
// regenerate after changing the port. parseGsiCfgPort reads the port back out of an
// existing cfg so gsi-cfg-service can detect a cfg/server port mismatch (a silent GSI
// killer). Pure string builder + parser; snapshot-tested.
//
// The `items` block was added for the caster edition (inventory/backpack/neutral per
// player). Like every cfg change it only takes effect after Dota restarts, and an
// installed cfg written by an older build lacks it — gsi-cfg-service compares the
// installed file against this builder so the UI can prompt for a reinstall.

export const GSI_CFG_FILE_NAME = 'gamestate_integration_adplus.cfg'

/** True when an installed cfg predates a data block this build needs. */
export function isGsiCfgOutdated(cfg: string): boolean {
  return !/"items"\s+"1"/i.test(cfg)
}

/**
 * Extract the port pinned in a GSI cfg's uri line. Tolerates hand-edited whitespace and
 * any host/path — only the `:port` in the uri matters. Returns null if the uri line is
 * missing or carries no valid port.
 */
export function parseGsiCfgPort(cfg: string): number | null {
  const match = /"uri"\s+"https?:\/\/[^"]*:(\d+)/i.exec(cfg)
  if (!match) return null
  const port = Number(match[1])
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
}

export function buildGsiCfg(port: number): string {
  return `"Ability Draft Plus GSI"
{
    "uri"           "http://127.0.0.1:${port}/gsi"
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
        "items"         "1"
    }
}
`
}
