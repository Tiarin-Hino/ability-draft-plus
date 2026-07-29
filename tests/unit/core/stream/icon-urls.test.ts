import { describe, it, expect } from 'vitest'
import {
  abilityCdnUrl,
  abilityIconPath,
  heroCdnUrl,
  heroIconPath,
  isSafeIconName,
  resolveAbilityIconName,
  ABILITY_ICON_NAME_OVERRIDES,
} from '@core/stream/icon-urls'

describe('icon-urls', () => {
  it('builds ability CDN URLs from internal names', () => {
    expect(abilityCdnUrl('abaddon_aphotic_shield')).toBe(
      'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/abilities/abaddon_aphotic_shield.png',
    )
  })

  it('builds server-relative ability icon paths', () => {
    expect(abilityIconPath('abaddon_aphotic_shield')).toBe(
      '/icons/abilities/abaddon_aphotic_shield.png',
    )
  })

  it('builds hero CDN URLs and paths from valve short names', () => {
    expect(heroCdnUrl('drow_ranger')).toBe(
      'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/drow_ranger.png',
    )
    expect(heroIconPath('wisp')).toBe('/icons/heroes/wisp.png')
  })

  it('applies overrides in both URL and path derivation', () => {
    for (const [legacy, current] of Object.entries(ABILITY_ICON_NAME_OVERRIDES)) {
      expect(resolveAbilityIconName(legacy)).toBe(current)
      expect(abilityCdnUrl(legacy)).toContain(`/${current}.png`)
      expect(abilityIconPath(legacy)).toBe(`/icons/abilities/${current}.png`)
    }
  })

  it('accepts every ML class name as a safe icon name', async () => {
    const { default: classNames } = await import(
      '../../../../resources/model/class_names.json'
    )
    for (const name of classNames as string[]) {
      expect(isSafeIconName(name), `unsafe class name: ${name}`).toBe(true)
    }
  })

  it('rejects path-traversal and unexpected characters', () => {
    expect(isSafeIconName('../etc/passwd')).toBe(false)
    expect(isSafeIconName('name.png')).toBe(false)
    expect(isSafeIconName('Name')).toBe(false)
    expect(isSafeIconName('a b')).toBe(false)
    expect(isSafeIconName('')).toBe(false)
  })
})
