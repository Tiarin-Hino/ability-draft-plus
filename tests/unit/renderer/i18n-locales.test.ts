import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SUPPORTED_LANGUAGES } from '../../../src/shared/constants/defaults'

// Every non-English locale must mirror the English key structure and
// interpolation tokens exactly, for every renderer namespace. Reads the JSON
// from disk so adding a language to SUPPORTED_LANGUAGES automatically extends
// coverage - a missing file fails loudly here rather than at runtime.

type LocaleTree = Record<string, unknown>

const RENDERER_ROOT = join(__dirname, '../../../src/renderer')

/** name -> path builder for one language code. */
const NAMESPACES: Array<[name: string, pathFor: (lang: string) => string]> = [
  ...['common', 'dashboard', 'data', 'feedback', 'settings', 'streaming', 'update'].map(
    (ns): [string, (lang: string) => string] => [
      `control-panel/${ns}`,
      (lang) => join(RENDERER_ROOT, 'control-panel/src/locales', lang, `${ns}.json`),
    ],
  ),
  ['overlay', (lang) => join(RENDERER_ROOT, 'overlay/src/locales', lang, 'overlay.json')],
  ['stream', (lang) => join(RENDERER_ROOT, 'stream/src/locales', `${lang}.json`)],
  ['picks', (lang) => join(RENDERER_ROOT, 'picks/src/locales', `${lang}.json`)],
]

function loadLocale(path: string): LocaleTree {
  return JSON.parse(readFileSync(path, 'utf8')) as LocaleTree
}

function flattenLocale(
  value: LocaleTree,
  prefix = '',
  result: Record<string, string> = {},
): Record<string, string> {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      flattenLocale(child as LocaleTree, path, result)
    } else {
      result[path] = String(child)
    }
  }
  return result
}

function interpolationTokens(value: string): string[] {
  return Array.from(value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g), (match) => match[1]).sort()
}

const translatedLanguages = SUPPORTED_LANGUAGES.filter((lang) => lang !== 'en')

const cases = translatedLanguages.flatMap((lang) =>
  NAMESPACES.map(([name, pathFor]): [string, string, string, string] => [
    lang,
    name,
    pathFor('en'),
    pathFor(lang),
  ]),
)

describe('locale resources match the English contract', () => {
  it.each(cases)('%s %s matches English keys and interpolation', (_lang, _name, enPath, path) => {
    const english = flattenLocale(loadLocale(enPath))
    const translated = flattenLocale(loadLocale(path))

    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort())
    for (const key of Object.keys(english)) {
      expect(translated[key].trim(), `${key} should not be empty`).not.toBe('')
      expect(interpolationTokens(translated[key]), `${key} interpolation tokens`).toEqual(
        interpolationTokens(english[key]),
      )
    }
  })
})
