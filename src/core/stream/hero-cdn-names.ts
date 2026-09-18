// @DEV-GUIDE: Derives a hero's Valve CDN short name (e.g. "drow_ranger", "wisp") from the
// internal names of the abilities in that hero's pool row. Dota ability internal names are
// "<valve_hero_name>_<ability_name>" and the CDN portrait file is "<valve_hero_name>.png",
// so the longest common underscore-terminated prefix of a row's ability names IS the hero's
// CDN name. We derive rather than maintain a 126-entry hero table because Heroes.name in
// our DB stores Windrun's concatenated short names ("drowranger"), which do NOT match
// Valve's ("drow_ranger") — see src/core/scraper/data-transformer.ts.
//
// Derivation needs >= 2 recognized ability names: a single name cannot tell where the hero
// prefix ends and the ability name begins.
//
// A row is NOT necessarily homogeneous. Ability Draft excludes some abilities from the pool
// entirely (Rubick's ultimate never appears; a hero can be short one or two), and the empty
// slots are filled with RANDOM abilities from other heroes. So the derivation must survive
// foreign entries — intersecting all four names collapses to nothing the moment one differs
// (measured 2026-09-04: Outworld Destroyer's row carried a Batrider ability, derivation
// returned null, and the display-name fallback produced a 404 portrait and no Dota data).
//
// It must equally survive the opposite: three of Faceless Void's four abilities are
// "faceless_void_time_*", so the largest agreeing GROUP is not the hero either.
//
// Both are handled by voting per PAIR and crediting every ancestor of each shared prefix:
// the Void "time" pairs also agree on "faceless_void", and so does every other pair, so the
// hero prefix out-votes the sub-group. Most votes wins; among equals the longest wins (so
// "obsidian_destroyer" beats its own ancestor "obsidian"). Two unrelated prefixes tied at
// the top is genuine ambiguity — a hero with two pool abilities whose two fillers came from
// one other hero — and refuses rather than guessing.
// Verified against a captured 12-hero pool: 12/12, where the old rule scored 10/12.

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
  // Our hero data still carries the pre-rename display name, so the legacy slug
  // is the one this fallback actually receives (see liquipedia-scraper.ts).
  outworld_devourer: 'obsidian_destroyer',
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
/**
 * Shared prefix of two ability names, trimmed to the last full underscore segment:
 * "drow_ranger_frost_arrows" + "drow_ranger_gust" -> "drow_ranger". Null when they
 * share no complete segment (abilities from different heroes).
 */
function pairPrefix(a: string, b: string): string | null {
  let i = 0
  const max = Math.min(a.length, b.length)
  while (i < max && a[i] === b[i]) i++
  const shared = a.slice(0, i)
  const lastUnderscore = shared.lastIndexOf('_')
  return lastUnderscore <= 0 ? null : shared.slice(0, lastUnderscore)
}

/** "a_b_c" -> ["a_b_c", "a_b", "a"] */
function prefixAncestors(prefix: string): string[] {
  const out: string[] = []
  let current = prefix
  while (current.length > 0) {
    out.push(current)
    const cut = current.lastIndexOf('_')
    if (cut <= 0) break
    current = current.slice(0, cut)
  }
  return out
}

export function deriveHeroCdnName(
  abilityNames: Array<string | null>,
): string | null {
  const names = abilityNames.filter((n): n is string => n !== null && n.length > 0)
  if (names.length < 2) return null

  const votes = new Map<string, number>()
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const shared = pairPrefix(names[i], names[j])
      if (!shared) continue
      for (const ancestor of prefixAncestors(shared)) {
        votes.set(ancestor, (votes.get(ancestor) ?? 0) + 1)
      }
    }
  }
  if (votes.size === 0) return null

  const max = Math.max(...votes.values())
  const top = [...votes]
    .filter(([, count]) => count === max)
    .map(([prefix]) => prefix)
    .sort((a, b) => b.length - a.length)

  // Everything tied at the top must lie on ONE chain (a prefix and its own
  // ancestors); two unrelated prefixes tied is real ambiguity, not a hero.
  const derived = top[0]
  if (!top.every((p) => p === derived || derived.startsWith(`${p}_`))) return null

  return HERO_CDN_NAME_OVERRIDES[derived] ?? derived
}
