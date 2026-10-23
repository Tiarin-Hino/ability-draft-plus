import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { load } from 'cheerio'
import { expect, it } from 'vitest'
import { Tooltip } from '../../../../src/renderer/overlay/src/components/Tooltip'
import zhCN from '../../../../src/renderer/overlay/src/locales/zh-CN/overlay.json'
import type { EnrichedScanSlot } from '../../../../src/shared/types'

it('shows mana pressure separately from already-covered abilities', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: zhCN } } })
  const slot: EnrichedScanSlot = {
    name: 'test_ability',
    displayName: 'Test ability',
    confidence: 1,
    hero_order: 0,
    ability_order: 1,
    is_ultimate: false,
    coord: { x: 0, y: 0, width: 64, height: 64, hero_order: 0 },
    winrate: 0.5,
    pickRate: 20,
    consolidatedScore: 0.5,
    isGeneralTopTier: false,
    isSynergySuggestionForMySpot: false,
    isUltimateFromDb: false,
    highWinrateCombinations: [],
    lowWinrateCombinations: [],
    strongHeroSynergies: [],
    weakHeroSynergies: [],
    roleReasons: ['duplicate:mana_budget', 'duplicate:hard_cc'],
  }
  const html = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(Tooltip, { data: { type: 'ability', slot }, anchorRect: null }),
    ),
  )
  const chips = load(html)('.tooltip-role-chip')
    .map((_, el) => load(el).text())
    .get()
  expect(chips).toMatchInlineSnapshot(`
    [
      "高耗蓝技能过多——魔法消耗压力较大",
      "已有能力：硬控制",
    ]
  `)
})
