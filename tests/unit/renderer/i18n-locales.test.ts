import { describe, expect, it } from 'vitest'

import enCommon from '../../../src/renderer/control-panel/src/locales/en/common.json'
import zhCNCommon from '../../../src/renderer/control-panel/src/locales/zh-CN/common.json'
import enDashboard from '../../../src/renderer/control-panel/src/locales/en/dashboard.json'
import zhCNDashboard from '../../../src/renderer/control-panel/src/locales/zh-CN/dashboard.json'
import enData from '../../../src/renderer/control-panel/src/locales/en/data.json'
import zhCNData from '../../../src/renderer/control-panel/src/locales/zh-CN/data.json'
import enFeedback from '../../../src/renderer/control-panel/src/locales/en/feedback.json'
import zhCNFeedback from '../../../src/renderer/control-panel/src/locales/zh-CN/feedback.json'
import enSettings from '../../../src/renderer/control-panel/src/locales/en/settings.json'
import zhCNSettings from '../../../src/renderer/control-panel/src/locales/zh-CN/settings.json'
import enStreaming from '../../../src/renderer/control-panel/src/locales/en/streaming.json'
import zhCNStreaming from '../../../src/renderer/control-panel/src/locales/zh-CN/streaming.json'
import enUpdate from '../../../src/renderer/control-panel/src/locales/en/update.json'
import zhCNUpdate from '../../../src/renderer/control-panel/src/locales/zh-CN/update.json'
import enOverlay from '../../../src/renderer/overlay/src/locales/en/overlay.json'
import zhCNOverlay from '../../../src/renderer/overlay/src/locales/zh-CN/overlay.json'
import enStream from '../../../src/renderer/stream/src/locales/en.json'
import zhCNStream from '../../../src/renderer/stream/src/locales/zh-CN.json'
import enPicks from '../../../src/renderer/picks/src/locales/en.json'
import zhCNPicks from '../../../src/renderer/picks/src/locales/zh-CN.json'

type LocaleTree = Record<string, unknown>

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

const localePairs: Array<[name: string, english: LocaleTree, chinese: LocaleTree]> = [
  ['control-panel/common', enCommon, zhCNCommon],
  ['control-panel/dashboard', enDashboard, zhCNDashboard],
  ['control-panel/data', enData, zhCNData],
  ['control-panel/feedback', enFeedback, zhCNFeedback],
  ['control-panel/settings', enSettings, zhCNSettings],
  ['control-panel/streaming', enStreaming, zhCNStreaming],
  ['control-panel/update', enUpdate, zhCNUpdate],
  ['overlay', enOverlay, zhCNOverlay],
  ['stream', enStream, zhCNStream],
  ['picks', enPicks, zhCNPicks],
]

describe('Simplified Chinese locale resources', () => {
  it.each(localePairs)('%s matches the English key and interpolation contract', (_, en, zhCN) => {
    const english = flattenLocale(en)
    const chinese = flattenLocale(zhCN)

    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort())
    for (const key of Object.keys(english)) {
      expect(chinese[key].trim(), `${key} should not be empty`).not.toBe('')
      expect(interpolationTokens(chinese[key]), `${key} interpolation tokens`).toEqual(
        interpolationTokens(english[key]),
      )
    }
  })
})
