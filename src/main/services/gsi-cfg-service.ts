import { join } from 'path'
import { promises as fs } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import log from 'electron-log/main'
import { buildGsiCfg, parseGsiCfgPort, GSI_CFG_FILE_NAME } from '@core/gsi/cfg-generator'
import { parseLibraryFolders } from '@core/gsi/vdf'

// @DEV-GUIDE: Writes the GSI cfg into Dota's cfg folder so the game POSTs state to the
// stream server. Discovery chain (all read-only until writeCfg):
//   1. reg query HKCU\Software\Valve\Steam /v SteamPath (built-in reg.exe, no new deps)
//   2. <steam>/steamapps/libraryfolders.vdf -> library containing app 570
//   3. <library>/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/
// If any step fails the caller falls back to a folder picker (the streaming page's GSI
// card) and passes the chosen "dota 2 beta" folder as overrideDotaDir.
// Dota reads the cfg at launch — the user must restart Dota after writing/changing it,
// and the cfg pins the port: rewrite it whenever the stream port changes. detect() also
// parses the port out of an existing cfg (cfgPort) so the GSI card can warn when the
// cfg and the stream port disagree — a mismatch silently kills GSI with no symptom.

const logger = log.scope('gsi-cfg')

const execFileAsync = promisify(execFile)
const DOTA_APP_ID = '570'
const DOTA_DIR_NAME = 'dota 2 beta'

export interface GsiCfgStatus {
  dotaPath: string | null
  cfgPath: string | null
  cfgExists: boolean
  /** Port pinned in the existing cfg's uri; null if the cfg is absent or unparseable. */
  cfgPort: number | null
}

export interface GsiCfgService {
  detect(): Promise<GsiCfgStatus>
  /** Write (or overwrite) the cfg for the given port. overrideDotaDir = the "dota 2 beta" folder. */
  writeCfg(
    port: number,
    overrideDotaDir?: string,
  ): Promise<{ success: boolean; path?: string; errorKey?: string }>
}

async function querySteamPath(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg', [
      'query',
      'HKCU\\Software\\Valve\\Steam',
      '/v',
      'SteamPath',
    ])
    const match = /SteamPath\s+REG_SZ\s+(.+)/.exec(stdout)
    return match ? match[1].trim().replace(/\//g, '\\') : null
  } catch (error) {
    logger.warn('Steam registry lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function findDotaDir(): Promise<string | null> {
  const steamPath = await querySteamPath()
  if (!steamPath) return null

  const candidates: string[] = []
  try {
    const vdf = await fs.readFile(join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf-8')
    const libraries = parseLibraryFolders(vdf)
    // Libraries listing app 570 first, then all libraries, then the Steam root
    candidates.push(
      ...libraries.filter((l) => l.appIds.includes(DOTA_APP_ID)).map((l) => l.path),
      ...libraries.map((l) => l.path),
    )
  } catch {
    // vdf missing/unreadable — fall through to the Steam root
  }
  candidates.push(steamPath)

  for (const library of candidates) {
    const dotaDir = join(library, 'steamapps', 'common', DOTA_DIR_NAME)
    try {
      await fs.access(dotaDir)
      return dotaDir
    } catch {
      // not in this library
    }
  }
  return null
}

function cfgDirFor(dotaDir: string): string {
  return join(dotaDir, 'game', 'dota', 'cfg', 'gamestate_integration')
}

export function createGsiCfgService(): GsiCfgService {
  return {
    async detect(): Promise<GsiCfgStatus> {
      const dotaPath = await findDotaDir()
      if (!dotaPath) return { dotaPath: null, cfgPath: null, cfgExists: false, cfgPort: null }
      const cfgPath = join(cfgDirFor(dotaPath), GSI_CFG_FILE_NAME)
      let cfgExists = false
      let cfgPort: number | null = null
      try {
        cfgPort = parseGsiCfgPort(await fs.readFile(cfgPath, 'utf-8'))
        cfgExists = true
      } catch {
        // not written yet
      }
      return { dotaPath, cfgPath, cfgExists, cfgPort }
    },

    async writeCfg(port, overrideDotaDir) {
      const dotaDir = overrideDotaDir ?? (await findDotaDir())
      if (!dotaDir) {
        return { success: false, errorKey: 'gsi.errorDotaNotFound' }
      }
      const cfgDir = cfgDirFor(dotaDir)
      const cfgPath = join(cfgDir, GSI_CFG_FILE_NAME)
      try {
        await fs.mkdir(cfgDir, { recursive: true })
        await fs.writeFile(cfgPath, buildGsiCfg(port), 'utf-8')
        logger.info('GSI cfg written', { cfgPath, port })
        return { success: true, path: cfgPath }
      } catch (error) {
        logger.error('Failed to write GSI cfg', {
          cfgPath,
          error: error instanceof Error ? error.message : String(error),
        })
        return { success: false, errorKey: 'gsi.errorWriteFailed' }
      }
    },
  }
}
