// @DEV-GUIDE: Generates the gamestate_integration cfg Dota 2 reads on launch. The file
// must live in <dota>/game/dota/cfg/gamestate_integration/ (gsi-cfg-service handles
// discovery + writing) and Dota must be RESTARTED after it changes. The uri targets the
// stream server's /gsi route, so the cfg port must match the app's stream port —
// regenerate after changing the port. Pure string builder; snapshot-tested.

export const GSI_CFG_FILE_NAME = 'gamestate_integration_adplus.cfg'

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
        "allplayers"    "1"
    }
}
`
}
