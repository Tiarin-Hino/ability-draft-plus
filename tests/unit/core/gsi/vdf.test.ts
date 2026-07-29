import { describe, it, expect } from 'vitest'
import { parseLibraryFolders } from '@core/gsi/vdf'

const MODERN_VDF = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"label"		""
		"contentid"		"123"
		"apps"
		{
			"228980"		"1234"
		}
	}
	"1"
	{
		"path"		"D:\\\\SteamLibrary"
		"label"		""
		"apps"
		{
			"570"		"40000000000"
			"730"		"30000000000"
		}
	}
}
`

const OLD_FLAT_VDF = `"LibraryFolders"
{
	"TimeNextStatsReport"		"1600000000"
	"ContentStatsID"		"-1234"
	"1"		"D:\\\\Games\\\\Steam"
}
`

describe('parseLibraryFolders', () => {
  it('parses the modern nested format with app ids', () => {
    const libraries = parseLibraryFolders(MODERN_VDF)
    expect(libraries).toHaveLength(2)
    expect(libraries[0].path).toBe('C:\\Program Files (x86)\\Steam')
    expect(libraries[0].appIds).toEqual(['228980'])
    expect(libraries[1].path).toBe('D:\\SteamLibrary')
    expect(libraries[1].appIds).toContain('570')
  })

  it('parses the old flat format (paths only)', () => {
    const libraries = parseLibraryFolders(OLD_FLAT_VDF)
    expect(libraries).toHaveLength(1)
    expect(libraries[0].path).toBe('D:\\Games\\Steam')
    expect(libraries[0].appIds).toEqual([])
  })

  it('returns empty for unrelated content', () => {
    expect(parseLibraryFolders('')).toEqual([])
    expect(parseLibraryFolders('"foo"\n{\n}\n')).toEqual([])
  })
})
