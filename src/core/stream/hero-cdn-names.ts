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

/** Derived-prefix → correct CDN name, for heroes where prefix derivation misfires. */
export const HERO_CDN_NAME_OVERRIDES: Readonly<Record<string, string>> = {}

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
