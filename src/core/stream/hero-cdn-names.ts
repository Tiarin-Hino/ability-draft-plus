// @DEV-GUIDE: Derives a hero's Valve CDN short name (e.g. "drow_ranger", "wisp") from the
// internal names of the abilities in that hero's pool row. Dota ability internal names are
// "<valve_hero_name>_<ability_name>" and the CDN portrait file is "<valve_hero_name>.png",
// so the longest common underscore-terminated prefix of a row's ability names IS the hero's
// CDN name. We derive rather than maintain a 126-entry hero table because Heroes.name in
// our DB stores Windrun's concatenated short names ("drowranger"), which do NOT match
// Valve's ("drow_ranger") — see src/core/scraper/data-transformer.ts.
//
// Derivation needs >= 2 recognized ability names: a single name cannot tell where the hero
// prefix ends and the ability name begins. With 3–4 distinct abilities per row, prefix
// over-extension (all abilities sharing a word beyond the hero name) is practically
// impossible; if a real case surfaces, fix it in HERO_CDN_NAME_OVERRIDES.

/** Derived-prefix → correct CDN name, for heroes where the ability prefix differs
 * from the npc short name (e.g. sandking_burrowstrike but npc_dota_hero_sand_king).
 * beastmaster_summon: both summon abilities share the extra "summon" segment, so
 * a row where only those two are recognized over-extends the prefix (observed 404). */
export const HERO_CDN_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  sandking: 'sand_king',
  beastmaster_summon: 'beastmaster',
}

/** Display-name slug → CDN name, for heroes whose English display name diverges
 * from Valve's internal short name. Used by heroCdnNameFromDisplayName — the
 * fallback when ability-prefix derivation fails (unrecognized row tiles). */
const DISPLAY_SLUG_CDN_OVERRIDES: Readonly<Record<string, string>> = {
  anti_mage: 'antimage',
  centaur_warrunner: 'centaur',
  clockwerk: 'rattletrap',
  doom: 'doom_bringer',
  io: 'wisp',
  lifestealer: 'life_stealer',
  magnus: 'magnataur',
  natures_prophet: 'furion',
  necrophos: 'necrolyte',
  outworld_destroyer: 'obsidian_destroyer',
  queen_of_pain: 'queenofpain',
  shadow_fiend: 'nevermore',
  timbersaw: 'shredder',
  treant_protector: 'treant',
  underlord: 'abyssal_underlord',
  vengeful_spirit: 'vengefulspirit',
  windranger: 'windrunner',
  wraith_king: 'skeleton_king',
  zeus: 'zuus',
}

/**
 * CDN name from a hero's English display name ("Crystal Maiden" -> crystal_maiden,
 * "Outworld Destroyer" -> obsidian_destroyer). Fallback for rows where ability-
 * prefix derivation is impossible; identical to it for non-divergent names.
 */
export function heroCdnNameFromDisplayName(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return DISPLAY_SLUG_CDN_OVERRIDES[slug] ?? slug
}

/**
 * Derive the Valve CDN short name for a hero from its pool-row ability internal names.
 * Returns null when fewer than two recognized names are available or no common
 * underscore-terminated prefix exists.
 */
export function deriveHeroCdnName(
  abilityNames: Array<string | null>,
): string | null {
  const names = abilityNames.filter((n): n is string => n !== null && n.length > 0)
  if (names.length < 2) return null

  let prefix = names[0]
  for (const name of names.slice(1)) {
    let i = 0
    const max = Math.min(prefix.length, name.length)
    while (i < max && prefix[i] === name[i]) i++
    prefix = prefix.slice(0, i)
    if (prefix.length === 0) return null
  }

  // Trim to the last full underscore-separated segment: "drow_ranger_fro" -> "drow_ranger".
  // A prefix that is itself underscore-terminated ("wisp_") just loses the trailing "_".
  const lastUnderscore = prefix.lastIndexOf('_')
  if (lastUnderscore <= 0) return null
  const derived = prefix.slice(0, lastUnderscore)

  return HERO_CDN_NAME_OVERRIDES[derived] ?? derived
}
