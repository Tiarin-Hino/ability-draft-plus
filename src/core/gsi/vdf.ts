// @DEV-GUIDE: Minimal parser for the two Valve VDF reads Steam discovery needs
// (gsi-cfg-service): the library folder paths and each library's installed app ids
// from steamapps/libraryfolders.vdf. NOT a general VDF parser — it works line-wise
// on "key" "value" pairs, which is stable in libraryfolders.vdf across Steam versions.

const KEY_VALUE_RE = /^\s*"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"\s*$/

export interface SteamLibrary {
  path: string
  appIds: string[]
}

/**
 * Extract library folders (path + installed app ids) from libraryfolders.vdf content.
 * Tolerates both the modern nested format and older flat "1" "D:\\Games" entries.
 */
export function parseLibraryFolders(vdf: string): SteamLibrary[] {
  const libraries: SteamLibrary[] = []
  let current: SteamLibrary | null = null
  let inApps = false

  for (const line of vdf.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '"apps"') {
      inApps = true
      continue
    }
    if (trimmed === '}') {
      if (inApps) inApps = false
      continue
    }

    const match = KEY_VALUE_RE.exec(line)
    if (!match) continue
    const key = match[1]
    const value = match[2].replace(/\\\\/g, '\\')

    if (key === 'path') {
      current = { path: value, appIds: [] }
      libraries.push(current)
    } else if (inApps && current && /^\d+$/.test(key)) {
      current.appIds.push(key)
    } else if (/^\d+$/.test(key) && value.includes('\\') && !inApps) {
      // Old flat format: "1" "D:\\SteamLibrary"
      libraries.push({ path: value, appIds: [] })
    }
  }

  return libraries
}
