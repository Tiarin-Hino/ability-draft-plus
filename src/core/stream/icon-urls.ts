// @DEV-GUIDE: Pure derivation of official icon locations for the streamer view.
// Two coordinate systems on purpose:
// - *CdnUrl():  where the MAIN process fetches the official art from (Valve's CDN).
// - *IconPath(): the server-relative path the stream SPA renders (<img src>), served by
//   the local icon cache route — the OBS browser source never talks to the CDN directly.
// Ability internal names (Abilities.name / class_names.json) map 1:1 onto Valve's CDN
// path convention. Renamed abilities whose legacy class name survives in our data get an
// entry in ABILITY_ICON_NAME_OVERRIDES (grown from icon-cache 404 logs — see Phase 3).

const VALVE_CDN_BASE =
  'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react'

/**
 * Legacy/renamed ability class name → current Valve CDN file name (without extension).
 * Populate from icon-cache 404 logs when a mismatch is found in the wild.
 */
export const ABILITY_ICON_NAME_OVERRIDES: Readonly<Record<string, string>> = {}

/** Resolve an ability internal name to the file name Valve's CDN uses. */
export function resolveAbilityIconName(abilityName: string): string {
  const override = ABILITY_ICON_NAME_OVERRIDES[abilityName]
  if (override) return override
  // Ability Draft variants (invoker_*_ad, kez_*_ad) share the base ability's art —
  // the CDN only knows the unsuffixed name.
  if (abilityName.endsWith('_ad')) return abilityName.slice(0, -3)
  return abilityName
}

/** Full CDN URL for an ability icon (main-process fetch side). */
export function abilityCdnUrl(abilityName: string): string {
  return `${VALVE_CDN_BASE}/abilities/${resolveAbilityIconName(abilityName)}.png`
}

/** Server-relative path for an ability icon (stream SPA side). */
export function abilityIconPath(abilityName: string): string {
  return `/icons/abilities/${resolveAbilityIconName(abilityName)}.png`
}

/** Full CDN URL for a hero portrait, keyed by the Valve short name (e.g. "drow_ranger"). */
export function heroCdnUrl(heroCdnName: string): string {
  return `${VALVE_CDN_BASE}/heroes/${heroCdnName}.png`
}

/** Server-relative path for a hero portrait (stream SPA side). */
export function heroIconPath(heroCdnName: string): string {
  return `/icons/heroes/${heroCdnName}.png`
}

/**
 * True when the name is safe to embed in a URL path segment. Ability names from the ML
 * class list are lowercase snake_case; anything else (corrupt scan data, injection via a
 * crafted payload) must not reach the icon route.
 */
export function isSafeIconName(name: string): boolean {
  return /^[a-z0-9_]+$/.test(name)
}
