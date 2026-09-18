#!/usr/bin/env node
// Builds dist/catalog-<hash>.json + catalog-manifest.json + build-report.json from
// dotaconstants. Usage:
//   node build-catalog.mjs                 # master, no lore
//   node build-catalog.mjs --ref <sha|tag> # pin the upstream ref
//   node build-catalog.mjs --lore          # include ability lore (+~100 KB)
//   node build-catalog.mjs --slice demo    # also write dist/catalog-demo.json (12 heroes)
//   node build-catalog.mjs --from-dir <d>  # offline: read the 4 JSON files from a folder
//   node build-catalog.mjs --base-url <u>  # manifest URL base (default tiarinhino.com)
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FILES, fetchSources, resolveCommit } from './sources.mjs'
import { buildCatalog, sliceCatalog } from './transform.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const DIST = resolve(__dirname, 'dist')
const DEFAULT_BASE_URL = 'https://tiarinhino.com/data/twitch'

/** Demo slice heroes — mirrors the stream SPA's demo roster (src/renderer/stream/src/demo.ts). */
export const DEMO_HEROES = [
  'pudge',
  'lich',
  'sand_king',
  'crystal_maiden',
  'zuus',
  'sven',
  'lina',
  'axe',
  'juggernaut',
  'witch_doctor',
  'tidehunter',
  'bristleback',
]

function parseArgs(argv) {
  const args = { ref: 'master', lore: false, slice: null, fromDir: null, baseUrl: DEFAULT_BASE_URL }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ref') args.ref = argv[++i]
    else if (a === '--lore') args.lore = true
    else if (a === '--slice') args.slice = argv[++i]
    else if (a === '--from-dir') args.fromDir = argv[++i]
    else if (a === '--base-url') args.baseUrl = argv[++i]
  }
  return args
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const classNames = readJson(resolve(REPO_ROOT, 'resources/model/class_names.json'))
  const heroMeta = readJson(resolve(REPO_ROOT, 'resources/data/hero_meta.json'))
  const allowedMissing = readJson(resolve(__dirname, 'allowed-missing.json'))

  let sources
  let commit
  if (args.fromDir) {
    sources = Object.fromEntries(FILES.map((f) => [f, readJson(resolve(args.fromDir, `${f}.json`))]))
    commit = `local:${args.fromDir}`
  } else {
    console.log(`Fetching dotaconstants@${args.ref}…`)
    ;[sources, commit] = await Promise.all([fetchSources(args.ref), resolveCommit(args.ref)])
  }

  const { catalog, report } = buildCatalog({
    classNames: Array.isArray(classNames) ? classNames : Object.keys(classNames),
    windrunHeroNames: Object.keys(heroMeta),
    abilities: sources.abilities,
    heroAbilities: sources.hero_abilities,
    heroes: sources.heroes,
    aghs: sources.aghs_desc,
    commit,
    builtAt: new Date().toISOString(),
    includeLore: args.lore,
    allowedMissing,
  })

  const body = JSON.stringify(catalog)
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 10)
  mkdirSync(DIST, { recursive: true })
  const fileName = `catalog-${hash}.json`
  writeFileSync(resolve(DIST, fileName), body)
  const manifest = {
    schema: 1,
    hash,
    url: `${args.baseUrl.replace(/\/+$/, '')}/${fileName}`,
    builtAt: catalog.builtAt,
    commit,
    bytes: Buffer.byteLength(body, 'utf8'),
  }
  writeFileSync(resolve(DIST, 'catalog-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(resolve(DIST, 'build-report.json'), JSON.stringify(report, null, 2) + '\n')

  if (args.slice === 'demo') {
    const demo = sliceCatalog(catalog, DEMO_HEROES)
    writeFileSync(resolve(DIST, 'catalog-demo.json'), JSON.stringify(demo))
  }

  console.log(`Wrote ${fileName} (${(manifest.bytes / 1024).toFixed(0)} KB)`)
  console.log(
    `abilities=${report.abilityCount} heroes=${report.heroCount} aghsAttached=${report.aghs.attached}`,
  )
  if (report.missingAbilities.length > 0) {
    console.warn(`Missing abilities (not in allowed-missing.json): ${report.missingAbilities.join(', ')}`)
  }
  if (report.unresolvedAliases.length > 0) {
    console.warn(`Unresolved Windrun hero aliases: ${report.unresolvedAliases.join(', ')}`)
  }
  if (report.aghs.unmatched.length > 0) {
    console.warn(`Aghs entries kept hero-level only: ${report.aghs.unmatched.length}`)
  }
  if (report.missingAbilities.length > 0 || report.unresolvedAliases.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
