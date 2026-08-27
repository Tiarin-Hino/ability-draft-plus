import { describe, it, expect } from 'vitest'
import {
  resolveOwnRowFromOcr,
  heroNameToken,
} from '@core/domain/own-row-detection'

function ocr(byRow: Record<number, string>): Record<number, { name: string }> {
  return Object.fromEntries(
    Object.entries(byRow).map(([row, name]) => [row, { name }]),
  )
}

describe('heroNameToken', () => {
  it('strips underscores from GSI npc short names', () => {
    expect(heroNameToken('drow_ranger')).toBe('drowranger')
    expect(heroNameToken('vengefulspirit')).toBe('vengefulspirit')
    expect(heroNameToken('keeper_of_the_light')).toBe('keeperofthelight')
  })

  it('normalizes DB names that KEEP underscores (monkey_king)', () => {
    expect(heroNameToken('monkey_king')).toBe(heroNameToken('monkeyking'))
  })

  it('bridges the zuus/zeus npc divergence (only alias in the 127-hero DB)', () => {
    expect(heroNameToken('zuus')).toBe('zeus')
    expect(heroNameToken('zeus')).toBe('zeus')
  })

  it('leaves npc-based DB names alone (necrolyte, obsidiandestroyer)', () => {
    expect(heroNameToken('necrolyte')).toBe('necrolyte')
    expect(heroNameToken('obsidian_destroyer')).toBe('obsidiandestroyer')
  })
})

describe('resolveOwnRowFromOcr', () => {
  // The two live games that motivated this module (2026-08-25)
  it('resolves the dire game: drow_ranger on row 5', () => {
    expect(
      resolveOwnRowFromOcr({
        ocrHeroNamesByRow: ocr({
          0: 'gyrocopter',
          4: 'juggernaut',
          5: 'drowranger',
          6: 'enchantress',
          7: 'snapfire',
        }),
        localHeroNpcName: 'drow_ranger',
        teamHalfStart: 5,
      }),
    ).toBe(5)
  })

  it('resolves the radiant game: vengefulspirit on row 3', () => {
    expect(
      resolveOwnRowFromOcr({
        ocrHeroNamesByRow: ocr({ 3: 'vengefulspirit', 5: 'necrolyte', 6: 'rubick' }),
        localHeroNpcName: 'vengefulspirit',
        teamHalfStart: 0,
      }),
    ).toBe(3)
  })

  // The lobby game where the raw-strip comparison failed (2026-08-26)
  it('resolves Zeus through the zuus alias', () => {
    expect(
      resolveOwnRowFromOcr({
        ocrHeroNamesByRow: ocr({ 5: 'zeus', 6: 'enchantress' }),
        localHeroNpcName: 'zuus',
        teamHalfStart: 5,
      }),
    ).toBe(5)
  })

  it('resolves DB names with underscores (monkey_king)', () => {
    expect(
      resolveOwnRowFromOcr({
        ocrHeroNamesByRow: ocr({ 2: 'monkey_king' }),
        localHeroNpcName: 'monkey_king',
        teamHalfStart: 0,
      }),
    ).toBe(2)
  })

  it('returns null when the model has not been OCRd on any card yet', () => {
    expect(
      resolveOwnRowFromOcr({
        ocrHeroNamesByRow: ocr({ 0: 'gyrocopter' }),
        localHeroNpcName: 'drow_ranger',
        teamHalfStart: 5,
      }),
    ).toBeNull()
  })

  it('returns null when the OCR map is empty', () => {
    expect(
      resolveOwnRowFromOcr({
        ocrHeroNamesByRow: {},
        localHeroNpcName: 'drow_ranger',
        teamHalfStart: null,
      }),
    ).toBeNull()
  })

  it('refuses an ambiguous duplicate OCR read', () => {
    expect(
      resolveOwnRowFromOcr({
        ocrHeroNamesByRow: ocr({ 5: 'drowranger', 8: 'drowranger' }),
        localHeroNpcName: 'drow_ranger',
        teamHalfStart: 5,
      }),
    ).toBeNull()
  })

  it('vetoes a match outside the known team half (OCR misread guard)', () => {
    expect(
      resolveOwnRowFromOcr({
        ocrHeroNamesByRow: ocr({ 2: 'drowranger' }),
        localHeroNpcName: 'drow_ranger',
        teamHalfStart: 5,
      }),
    ).toBeNull()
  })

  it('accepts a match anywhere when the team half is unknown', () => {
    expect(
      resolveOwnRowFromOcr({
        ocrHeroNamesByRow: ocr({ 7: 'templarassassin' }),
        localHeroNpcName: 'templar_assassin',
        teamHalfStart: null,
      }),
    ).toBe(7)
  })

  it('ignores out-of-range rows', () => {
    expect(
      resolveOwnRowFromOcr({
        ocrHeroNamesByRow: ocr({ 11: 'drowranger' }),
        localHeroNpcName: 'drow_ranger',
        teamHalfStart: null,
      }),
    ).toBeNull()
  })
})
