#!/usr/bin/env node
/**
 * Audits all 80 locale JSON files across 8 languages and 10 namespaces for:
 * 1. Key parity against English (`en`) — missing and extra keys
 * 2. Empty string values
 * 3. `{{token}}` interpolation parity
 * 4. Identical-to-English untranslated strings (informational unless `--strict-untranslated`)
 *
 * Pass `--scaffold` to copy missing keys from `en` into non-English files preserving key order.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../../..')

const args = new Set(process.argv.slice(2))
const SCAFFOLD = args.has('--scaffold')
const STRICT_UNTRANSLATED = args.has('--strict-untranslated')
const JSON_OUTPUT = args.has('--json')

function loadSupportedLanguages() {
  const defaultsPath = join(REPO_ROOT, 'src/shared/constants/defaults.ts')
  const src = readFileSync(defaultsPath, 'utf8')
  const match = src.match(/SUPPORTED_LANGUAGES\s*=\s*\[([\s\S]*?)\]/)
  if (!match) {
    return ['en', 'ru', 'zh-CN', 'es', 'pt-BR', 'uk', 'fil', 'fi']
  }
  const langs = Array.from(match[1].matchAll(/'([^']+)'/g), (m) => m[1])
  return langs.length > 0 ? langs : ['en', 'ru', 'zh-CN', 'es', 'pt-BR', 'uk', 'fil', 'fi']
}

const NAMESPACES = [
  ...['common', 'dashboard', 'data', 'feedback', 'settings', 'streaming', 'update'].map((ns) => ({
    name: `control-panel/${ns}`,
    pathFor: (lang) => join(REPO_ROOT, 'src/renderer/control-panel/src/locales', lang, `${ns}.json`),
  })),
  {
    name: 'overlay',
    pathFor: (lang) => join(REPO_ROOT, 'src/renderer/overlay/src/locales', lang, 'overlay.json'),
  },
  {
    name: 'stream',
    pathFor: (lang) => join(REPO_ROOT, 'src/renderer/stream/src/locales', `${lang}.json`),
  },
  {
    name: 'picks',
    pathFor: (lang) => join(REPO_ROOT, 'src/renderer/picks/src/locales', `${lang}.json`),
  },
]

// Short words, numbers, punctuation, brand names, and Dota terms intentionally identical across languages.
const EXACT_ALLOWLIST = new Set([
  'Ability Draft Plus',
  'ABILITY DRAFT',
  'Dota 2',
  'Windrun.io',
  'Twitch',
  'OBS',
  'Discord',
  'GitHub',
  'Ko-fi',
  'Liquipedia',
  'Radiant',
  'Dire',
  'DirectML',
  'ONNX',
  'GSI',
  'HUD',
  'FPS',
  'DEMO',
  'API',
  'ID',
  'OK',
  'OP',
  'v2',
  'Steam',
  'Scepter',
  'Shard',
  "Aghanim's",
  'Status',
  'Dashboard',
  'Streaming',
  'Overlay',
  'Auto',
  'Ctrl+Shift+S',
  'Ctrl+Shift+R',
])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function flattenLocale(value, prefix = '', result = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(child)) {
      flattenLocale(child, path, result)
    } else {
      result[path] = String(child)
    }
  }
  return result
}

function interpolationTokens(value) {
  return Array.from(value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g), (match) => match[1]).sort()
}

function scaffoldTree(enNode, targetNode) {
  if (!isPlainObject(enNode)) return targetNode
  const srcObj = isPlainObject(targetNode) ? targetNode : {}
  const next = {}
  let added = 0
  for (const [key, enVal] of Object.entries(enNode)) {
    if (!(key in srcObj)) {
      next[key] = structuredClone(enVal)
      added += isPlainObject(enVal) ? Object.keys(flattenLocale(enVal)).length : 1
    } else if (isPlainObject(enVal)) {
      const nested = scaffoldTree(enVal, srcObj[key])
      next[key] = nested.tree
      added += nested.added
    } else {
      next[key] = srcObj[key]
    }
  }
  // Preserve extra keys at the end so parity checks still flag them explicitly
  for (const [key, val] of Object.entries(srcObj)) {
    if (!(key in enNode)) {
      next[key] = val
    }
  }
  return { tree: next, added }
}

function isLikelyUntranslated(enVal, trVal) {
  if (enVal !== trVal) return false
  const trimmed = enVal.trim()
  if (trimmed.length <= 3) return false
  if (EXACT_ALLOWLIST.has(trimmed)) return false
  if (/^https?:\/\//i.test(trimmed)) return false
  if (/^[\d\s.%+\-–—:/()[\]{}#@*,]+$/.test(trimmed)) return false
  // Pure placeholder string like "{{count}}" or "{{a}} / {{b}}"
  const stripped = trimmed.replace(/{{\s*[^}]+\s*}}/g, '').replace(/[\d\s.%+\-–—:/()[\]{}#@*,]/g, '')
  if (stripped.length <= 2) return false
  return true
}

const languages = loadSupportedLanguages()
const nonEnglish = languages.filter((l) => l !== 'en')

const report = {
  languages,
  namespacesChecked: NAMESPACES.length,
  scaffoldedKeys: 0,
  errors: [],
  untranslatedByLang: Object.fromEntries(nonEnglish.map((l) => [l, { total: 0, byNs: {}, sampleKeys: [] }])),
}

for (const ns of NAMESPACES) {
  const enPath = ns.pathFor('en')
  if (!existsSync(enPath)) {
    report.errors.push({ lang: 'en', ns: ns.name, type: 'missing-file', detail: enPath })
    continue
  }
  const enTree = JSON.parse(readFileSync(enPath, 'utf8'))
  const enFlat = flattenLocale(enTree)
  const enKeys = Object.keys(enFlat)

  for (const lang of nonEnglish) {
    const trPath = ns.pathFor(lang)
    let trTree = existsSync(trPath) ? JSON.parse(readFileSync(trPath, 'utf8')) : {}

    if (SCAFFOLD) {
      const { tree, added } = scaffoldTree(enTree, trTree)
      if (added > 0 || !existsSync(trPath)) {
        writeFileSync(trPath, `${JSON.stringify(tree, null, 2)}\n`, 'utf8')
        trTree = tree
        report.scaffoldedKeys += added
      }
    } else if (!existsSync(trPath)) {
      report.errors.push({ lang, ns: ns.name, type: 'missing-file', detail: trPath })
      continue
    }

    const trFlat = flattenLocale(trTree)
    const trKeys = Object.keys(trFlat)
    const enKeySet = new Set(enKeys)
    const trKeySet = new Set(trKeys)

    for (const key of enKeys) {
      if (!trKeySet.has(key)) {
        report.errors.push({ lang, ns: ns.name, type: 'missing-key', key })
        continue
      }
      if (trFlat[key].trim() === '') {
        report.errors.push({ lang, ns: ns.name, type: 'empty-value', key })
        continue
      }
      const enTokens = interpolationTokens(enFlat[key])
      const trTokens = interpolationTokens(trFlat[key])
      if (JSON.stringify(enTokens) !== JSON.stringify(trTokens)) {
        report.errors.push({
          lang,
          ns: ns.name,
          type: 'interpolation-mismatch',
          key,
          expected: enTokens,
          actual: trTokens,
        })
      }
      if (isLikelyUntranslated(enFlat[key], trFlat[key])) {
        const bucket = report.untranslatedByLang[lang]
        bucket.total += 1
        bucket.byNs[ns.name] = (bucket.byNs[ns.name] ?? 0) + 1
        if (bucket.sampleKeys.length < 10) {
          bucket.sampleKeys.push(`${ns.name}:${key}`)
        }
      }
    }

    for (const key of trKeys) {
      if (!enKeySet.has(key)) {
        report.errors.push({ lang, ns: ns.name, type: 'extra-key', key })
      }
    }
  }
}

const totalUntranslated = Object.values(report.untranslatedByLang).reduce((sum, b) => sum + b.total, 0)
const failed = report.errors.length > 0 || (STRICT_UNTRANSLATED && totalUntranslated > 0)

if (JSON_OUTPUT) {
  console.log(JSON.stringify({ ...report, totalUntranslated, passed: !failed }, null, 2))
} else {
  console.log(`i18n Audit: ${languages.length} languages x ${NAMESPACES.length} namespaces`)
  if (SCAFFOLD) {
    console.log(`Scaffolded ${report.scaffoldedKeys} missing key(s) from English.`)
  }
  if (report.errors.length === 0) {
    console.log('Parity check: PASS (0 missing, 0 extra, 0 empty, 0 interpolation mismatches)')
  } else {
    console.error(`Parity check: FAIL (${report.errors.length} structural errors)`)
    for (const err of report.errors.slice(0, 30)) {
      console.error(`  - [${err.lang}] ${err.ns} (${err.type}): ${err.key ?? err.detail}`)
    }
  }
  console.log('\nIdentical-to-English (likely untranslated) summary:')
  for (const lang of nonEnglish) {
    const b = report.untranslatedByLang[lang]
    const nsDetails = Object.entries(b.byNs)
      .map(([ns, count]) => `${ns}=${count}`)
      .join(', ')
    console.log(`  ${lang.padEnd(6)} ${String(b.total).padStart(3)} key(s)${nsDetails ? ` [${nsDetails}]` : ''}`)
  }
  console.log(`Total likely untranslated strings: ${totalUntranslated}`)
}

process.exit(failed ? 1 : 0)
