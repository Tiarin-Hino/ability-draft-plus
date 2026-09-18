import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Runs against the LAST BUILT catalog (dist/). Skips with a message when nothing was built
// (`npm run build` first); CI always builds before testing.

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../../..')
const DIST = resolve(__dirname, '../dist')

const manifestPath = resolve(DIST, 'catalog-manifest.json')
const built = existsSync(manifestPath)

const read = (p) => JSON.parse(readFileSync(p, 'utf-8'))

describe.skipIf(!built)('built catalog covers the app data', () => {
  const manifest = built ? read(manifestPath) : null
  const catalog = built ? read(resolve(DIST, `catalog-${manifest.hash}.json`)) : null
  const allowed = read(resolve(__dirname, '../allowed-missing.json'))
  const classNames = read(resolve(ROOT, 'resources/model/class_names.json'))
  const heroMeta = read(resolve(ROOT, 'resources/data/hero_meta.json'))

  it('has an entry for every ability class name (or an explicit exception)', () => {
    const names = Array.isArray(classNames) ? classNames : Object.keys(classNames)
    const missing = names.filter((n) => !catalog.abilities[n] && !allowed.abilities[n])
    expect(missing).toEqual([])
  })

  it('aliases every Windrun hero name to an existing hero', () => {
    const unresolved = Object.keys(heroMeta).filter(
      (n) => !allowed.heroes[n] && !catalog.heroes[catalog.aliases.windrunToCdn[n]],
    )
    expect(unresolved).toEqual([])
  })

  it('gives every hero a usable kit, talents and resolvable innate', () => {
    for (const [cdn, hero] of Object.entries(catalog.heroes)) {
      // Some heroes contribute fewer abilities to the AD pool (Morphling: 2)
      expect(hero.abilities.length, `${cdn} abilities`).toBeGreaterThanOrEqual(2)
      expect(hero.talents.length, `${cdn} talents`).toBe(8)
      if (hero.innate) expect(catalog.abilities[hero.innate], `${cdn} innate`).toBeDefined()
      for (const name of hero.abilities) {
        expect(catalog.abilities[name]?.n ?? catalog.abilities[name], `${cdn}/${name}`).toBeDefined()
      }
    }
  })

  it('stays within the size budget without lore', () => {
    expect(manifest.bytes).toBeLessThan(1_200_000)
  })
})

if (!built) {
  it.skip('catalog not built — run `npm run build` in twitch/catalog first', () => {})
}
