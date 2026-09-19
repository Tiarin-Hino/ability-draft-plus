import { abilityCdnUrl, heroCdnUrl, itemCdnUrl } from '@core/stream/icon-urls'

// Official Valve CDN art (declared image domain in the Twitch dev console:
// cdn.cloudflare.steamstatic.com). Pure helpers re-exported from the app's core.
export { abilityCdnUrl, heroCdnUrl, itemCdnUrl }

/** Player-card portrait crop focus, by CDN name (mirrors picks/portrait-focus.ts). */
const PORTRAIT_FOCUS: Record<string, number> = {
  jakiro: 24,
  alchemist: 66,
  grimstroke: 62,
  templar_assassin: 60,
  lina: 30,
  ogre_magi: 30,
  magnataur: 32,
  luna: 36,
  dark_seer: 40,
  abaddon: 40,
}

export function portraitObjectPosition(cdnName: string | null): string {
  const focus = cdnName ? PORTRAIT_FOCUS[cdnName] : undefined
  return focus !== undefined ? `${focus}% center` : 'center'
}
