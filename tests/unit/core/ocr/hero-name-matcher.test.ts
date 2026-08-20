import { describe, it, expect } from 'vitest'
import {
  normalizeHeroText,
  matchHeroName,
} from '@core/ocr/hero-name-matcher'
import type { HeroNameCandidate } from '@core/ocr/hero-name-matcher'

const ROSTER: HeroNameCandidate[] = [
  { name: 'winter_wyvern', displayName: 'Winter Wyvern' },
  { name: 'zuus', displayName: 'Zeus' },
  { name: 'terrorblade', displayName: 'Terrorblade' },
  { name: 'templar_assassin', displayName: 'Templar Assassin' },
  { name: 'phantom_assassin', displayName: 'Phantom Assassin' },
  { name: 'beastmaster', displayName: 'Beastmaster' },
  { name: 'shadow_fiend', displayName: 'Shadow Fiend' },
  { name: 'shadow_demon', displayName: 'Shadow Demon' },
  { name: 'shadow_shaman', displayName: 'Shadow Shaman' },
  { name: 'axe', displayName: 'Axe' },
]

describe('normalizeHeroText', () => {
  it('uppercases and strips spacing, punctuation, and digits', () => {
    expect(normalizeHeroText('W I N T E R  W Y V E R N')).toBe('WINTERWYVERN')
    expect(normalizeHeroText('Templar-Assassin [2]')).toBe('TEMPLARASSASSIN')
  })
})

describe('matchHeroName', () => {
  it('matches exact spaced-capital reads', () => {
    const m = matchHeroName('W I N T E R  W Y V E R N', ROSTER)
    expect(m?.name).toBe('winter_wyvern')
    expect(m?.distance).toBe(0)
    expect(m?.similarity).toBe(1)
  })

  it('tolerates OCR character errors within the length budget', () => {
    // 2 errors on a 12-letter name
    expect(matchHeroName('WINTFR WYVERM', ROSTER)?.name).toBe('winter_wyvern')
    // 1 error on a short name
    expect(matchHeroName('ZEU5', ROSTER)?.name).toBe('zuus')
  })

  it('distinguishes similar names by closest distance', () => {
    expect(matchHeroName('SHADOW FIEND', ROSTER)?.name).toBe('shadow_fiend')
    expect(matchHeroName('SHADOW DEMON', ROSTER)?.name).toBe('shadow_demon')
    expect(matchHeroName('TEMPLAR ASSASSIN', ROSTER)?.name).toBe('templar_assassin')
  })

  it('rejects garbage, empty, and pre-pick card text', () => {
    expect(matchHeroName('NO HERO', ROSTER)).toBeNull()
    expect(matchHeroName('', ROSTER)).toBeNull()
    expect(matchHeroName('XQ', ROSTER)).toBeNull()
    expect(matchHeroName('QWERTYUIOPLKJHG', ROSTER)).toBeNull()
  })

  it('rejects ambiguous reads equidistant from two names', () => {
    // "SHADOW XEMON" is 1 from both DEMON... actually 1 from DEMON, 2 from FIEND
    expect(matchHeroName('SHADOW XEMON', ROSTER)?.name).toBe('shadow_demon')
    // Construct a true tie: distance 5 to both SHADOWFIEND/SHADOWDEMON via truncation
    expect(matchHeroName('SHADOW', ROSTER)).toBeNull()
  })
})
