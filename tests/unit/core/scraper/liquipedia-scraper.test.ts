import { describe, it, expect } from 'vitest'
import {
  parseAbilitiesFromHtml,
  heroNameToPageTitle,
} from '@core/scraper/liquipedia-scraper'

// Fixture mirrors the real structure of Liquipedia hero pages (verified against the
// live Spectre page): spellcard IDs are DISPLAY names, hotkeys include non-R ultimates
// (Haunt on F) and hotkeyed sub-abilities (Reality on D).
function spellcard(id: string | null, hotkey: string | null): string {
  const idAttr = id ? ` id="${id}"` : ''
  const hotkeyDiv = hotkey
    ? `<div title="Default Hotkey"><span>${hotkey}</span></div>`
    : ''
  return `<div class="spellcard-wrapper"${idAttr}>${hotkeyDiv}</div>`
}

const SPECTRE_LIKE_HTML = [
  spellcard('Desolate', null), // innate — no hotkey
  spellcard('Hero_Model', null), // non-ability card
  spellcard(null, null), // wrapper without id
  spellcard('Spectral_Dagger', 'Q'),
  spellcard('Shadow_Step', 'W'),
  spellcard('Dispersion', 'E'),
  spellcard('Haunt', 'F'), // ultimate NOT on R
  spellcard('Reality', 'D'), // hotkeyed sub-ability
].join('\n')

describe('parseAbilitiesFromHtml', () => {
  it('maps Q/W/E hotkeys to ability_order 1/2/3 with display names', () => {
    const result = parseAbilitiesFromHtml(SPECTRE_LIKE_HTML)

    expect(result).toContainEqual({
      abilityDisplayName: 'Spectral Dagger',
      abilityOrder: 1,
      isUltimateCandidate: false,
    })
    expect(result).toContainEqual({
      abilityDisplayName: 'Shadow Step',
      abilityOrder: 2,
      isUltimateCandidate: false,
    })
    expect(result).toContainEqual({
      abilityDisplayName: 'Dispersion',
      abilityOrder: 3,
      isUltimateCandidate: false,
    })
  })

  it('marks any non-Q/W/E hotkey as an ultimate candidate', () => {
    const result = parseAbilitiesFromHtml(SPECTRE_LIKE_HTML)

    // Both the real ultimate (F) and the sub-ability (D) are candidates here;
    // applyLiquipediaMeta filters candidates against Windrun's is_ultimate.
    expect(result).toContainEqual({
      abilityDisplayName: 'Haunt',
      abilityOrder: 0,
      isUltimateCandidate: true,
    })
    expect(result).toContainEqual({
      abilityDisplayName: 'Reality',
      abilityOrder: 0,
      isUltimateCandidate: true,
    })
  })

  it('skips cards without a hotkey or without an id', () => {
    const result = parseAbilitiesFromHtml(SPECTRE_LIKE_HTML)

    expect(result).toHaveLength(5)
    const names = result.map((r) => r.abilityDisplayName)
    expect(names).not.toContain('Desolate')
    expect(names).not.toContain('Hero Model')
  })

  it('maps R hotkeys as ultimate candidates too', () => {
    const result = parseAbilitiesFromHtml(spellcard('Mana_Void', 'R'))

    expect(result).toEqual([
      { abilityDisplayName: 'Mana Void', abilityOrder: 0, isUltimateCandidate: true },
    ])
  })

  it('returns empty array for HTML without spellcards', () => {
    expect(parseAbilitiesFromHtml('<div><p>No abilities here</p></div>')).toEqual([])
  })
})

describe('heroNameToPageTitle', () => {
  it('preserves natural casing of display-name-derived page names', () => {
    // Title-casing these produced real page misses (Queen_Of_Pain → 0 abilities)
    expect(heroNameToPageTitle('Queen_of_Pain')).toBe('Queen_of_Pain')
    expect(heroNameToPageTitle('Keeper_of_the_Light')).toBe('Keeper_of_the_Light')
    expect(heroNameToPageTitle('Death_Prophet')).toBe('Death_Prophet')
  })

  it('maps Outworld Devourer to the Liquipedia page name Outworld_Destroyer', () => {
    expect(heroNameToPageTitle('Outworld_Devourer')).toBe('Outworld_Destroyer')
    expect(heroNameToPageTitle('outworld_destroyer')).toBe('Outworld_Destroyer')
  })

  it('matches overrides from display names with punctuation', () => {
    expect(heroNameToPageTitle('Anti-Mage')).toBe('Anti-Mage')
    expect(heroNameToPageTitle("Nature's_Prophet")).toBe("Nature's_Prophet")
  })

  it('matches overrides from internal snake_case names', () => {
    expect(heroNameToPageTitle('anti_mage')).toBe('Anti-Mage')
    expect(heroNameToPageTitle('queen_of_pain')).toBe('Queen_of_Pain')
    expect(heroNameToPageTitle('natures_prophet')).toBe("Nature's_Prophet")
  })

  it('title-cases plain internal snake_case names word by word', () => {
    expect(heroNameToPageTitle('ursa')).toBe('Ursa')
    expect(heroNameToPageTitle('death_prophet')).toBe('Death_Prophet')
  })
})
