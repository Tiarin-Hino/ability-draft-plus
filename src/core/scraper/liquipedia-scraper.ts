// @DEV-GUIDE: Dev-mode only Liquipedia HTML parser for ability_order and is_ultimate metadata.
// Windrun.io provides winrates/synergies but NOT ability ordering within a hero's kit.
// Liquipedia's MediaWiki API returns rendered HTML with .spellcard-wrapper elements.
// Each card has a hotkey (Q/W/E/R) mapped to ability_order (1/2/3/0).
// Rate limited to 1 request per 31 seconds — a full scrape of ~130 heroes takes ~67 minutes.
// Only needed when Liquipedia data is stale; not part of the normal user flow.

/**
 * @fileoverview Dev-mode scraper that fetches ability metadata (ability_order, is_ultimate)
 * from Liquipedia's MediaWiki API. TypeScript port of the v1 Liquipedia scraper.
 *
 * Uses `action=parse` endpoint which returns rendered HTML for a wiki page.
 * Liquipedia rate-limits this endpoint aggressively: one request per ~30 seconds.
 *
 * Pure TypeScript - no Electron imports. Intended to run in main process only during dev.
 */

import * as cheerio from 'cheerio'

// ── Constants ───────────────────────────────────────────────────────────────────

const LIQUIPEDIA_API_BASE = 'https://liquipedia.net/dota2/api.php'
const FETCH_TIMEOUT_MS = 30_000
const API_REQUEST_DELAY_MS = 31_000

const USER_AGENT =
  'Dota2AbilityDraftPlusOverlay/2.0 (https://github.com/tiarin-hino/ability-draft-plus; dev@example.com)'

/**
 * Maps keyboard hotkeys to ability ordering metadata.
 * Q/W/E are standard abilities (order 1-3), R is the ultimate (order 0).
 */
const HOTKEY_MAPPING: Record<string, { abilityOrder: number; isUltimate: boolean }> = {
  Q: { abilityOrder: 1, isUltimate: false },
  W: { abilityOrder: 2, isUltimate: false },
  E: { abilityOrder: 3, isUltimate: false },
  R: { abilityOrder: 0, isUltimate: true },
}

/**
 * Special-case hero name mappings from internal snake_case names to Liquipedia page titles.
 * Most heroes can be derived algorithmically, but these have punctuation or casing quirks
 * that the simple title-case + underscore replacement cannot handle.
 */
const HERO_NAME_OVERRIDES: Record<string, string> = {
  anti_mage: 'Anti-Mage',
  natures_prophet: "Nature's_Prophet",
  shadow_fiend: 'Shadow_Fiend',
  queen_of_pain: 'Queen_of_Pain',
  keeper_of_the_light: 'Keeper_of_the_Light',
  spirit_breaker: 'Spirit_Breaker',
  legion_commander: 'Legion_Commander',
  outworld_destroyer: 'Outworld_Destroyer',
  treant_protector: 'Treant_Protector',
  ogre_magi: 'Ogre_Magi',
  phantom_assassin: 'Phantom_Assassin',
  phantom_lancer: 'Phantom_Lancer',
  ember_spirit: 'Ember_Spirit',
  earth_spirit: 'Earth_Spirit',
  storm_spirit: 'Storm_Spirit',
  vengeful_spirit: 'Vengeful_Spirit',
  lone_druid: 'Lone_Druid',
  dark_seer: 'Dark_Seer',
  dark_willow: 'Dark_Willow',
  witch_doctor: 'Witch_Doctor',
  shadow_demon: 'Shadow_Demon',
  shadow_shaman: 'Shadow_Shaman',
  sand_king: 'Sand_King',
  wraith_king: 'Wraith_King',
  monkey_king: 'Monkey_King',
  chaos_knight: 'Chaos_Knight',
  night_stalker: 'Night_Stalker',
  ancient_apparition: 'Ancient_Apparition',
  dragon_knight: 'Dragon_Knight',
  drow_ranger: 'Drow_Ranger',
  faceless_void: 'Faceless_Void',
  crystal_maiden: 'Crystal_Maiden',
  bounty_hunter: 'Bounty_Hunter',
  skywrath_mage: 'Skywrath_Mage',
  winter_wyvern: 'Winter_Wyvern',
  troll_warlord: 'Troll_Warlord',
  centaur_warrunner: 'Centaur_Warrunner',
  naga_siren: 'Naga_Siren',
  templar_assassin: 'Templar_Assassin',
  void_spirit: 'Void_Spirit',
  primal_beast: 'Primal_Beast',
  blood_seeker: 'Bloodseeker',
}

// ── Public Interface ────────────────────────────────────────────────────────────

export interface LiquipediaAbilityUpdate {
  abilityName: string
  abilityOrder: number
  isUltimate: boolean
}

// ── Core Logic ──────────────────────────────────────────────────────────────────

/**
 * Fetches ability metadata (ability_order, is_ultimate) for the given heroes
 * from Liquipedia's wiki API.
 *
 * @param heroNames - Internal hero names (snake_case), e.g. ["ursa", "anti_mage"]
 * @param onProgress - Callback invoked with human-readable status messages
 * @returns Array of ability updates found across all heroes
 */
export async function enrichFromLiquipedia(
  heroNames: string[],
  onProgress: (msg: string) => void,
): Promise<LiquipediaAbilityUpdate[]> {
  const allUpdates: LiquipediaAbilityUpdate[] = []

  onProgress(`Starting Liquipedia scrape for ${heroNames.length} heroes...`)

  for (let i = 0; i < heroNames.length; i++) {
    const heroName = heroNames[i]
    const pageTitle = heroNameToPageTitle(heroName)

    onProgress(
      `[${i + 1}/${heroNames.length}] Fetching Liquipedia data for "${pageTitle}"...`,
    )

    try {
      const updates = await fetchHeroAbilities(pageTitle)
      allUpdates.push(...updates)
      onProgress(
        `[${i + 1}/${heroNames.length}] Found ${updates.length} abilities for "${pageTitle}"`,
      )
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      onProgress(
        `[${i + 1}/${heroNames.length}] Failed to fetch "${pageTitle}": ${message}. Skipping.`,
      )
    }

    // Respect Liquipedia rate limit: wait 31s between requests (skip after last hero)
    if (i < heroNames.length - 1) {
      onProgress(
        `Waiting ${API_REQUEST_DELAY_MS / 1000}s before next request (Liquipedia rate limit)...`,
      )
      await delay(API_REQUEST_DELAY_MS)
    }
  }

  onProgress(
    `Liquipedia scrape complete. Found ${allUpdates.length} ability updates across ${heroNames.length} heroes.`,
  )

  return allUpdates
}

// ── Internal Helpers ────────────────────────────────────────────────────────────

/**
 * Fetches and parses a single hero's Liquipedia page, returning ability metadata.
 */
async function fetchHeroAbilities(pageTitle: string): Promise<LiquipediaAbilityUpdate[]> {
  const url = `${LIQUIPEDIA_API_BASE}?action=parse&page=${encodeURIComponent(pageTitle)}&format=json`

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Encoding': 'gzip',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }

  const json = (await response.json()) as LiquipediaParseResponse

  if (!json.parse?.text?.['*']) {
    throw new Error('No parsed HTML content in API response')
  }

  const htmlContent = json.parse.text['*']
  return parseAbilitiesFromHtml(htmlContent)
}

/**
 * Parses ability cards from Liquipedia's rendered HTML.
 *
 * Liquipedia renders each ability as a `.spellcard-wrapper` element with an ID
 * matching the ability name (underscores for spaces, no periods). Inside each
 * wrapper, a `div[title="Default Hotkey"] span` contains the hotkey character.
 */
function parseAbilitiesFromHtml(html: string): LiquipediaAbilityUpdate[] {
  const $ = cheerio.load(html)
  const updates: LiquipediaAbilityUpdate[] = []

  $('.spellcard-wrapper').each((_index, element) => {
    const wrapper = $(element)
    const id = wrapper.attr('id')
    if (!id) return

    // The ID is the ability name with underscores for spaces (no periods)
    // Convert back to display name: underscores → spaces
    const abilityName = id.replace(/_/g, ' ')

    // Find the hotkey character
    const hotkeySpan = wrapper.find('div[title="Default Hotkey"] span').first()
    const hotkeyChar = hotkeySpan.text().trim().toUpperCase()

    if (!hotkeyChar || !(hotkeyChar in HOTKEY_MAPPING)) {
      return // Skip abilities without Q/W/E/R hotkeys (innates, Aghs/Shard, etc.)
    }

    const mapping = HOTKEY_MAPPING[hotkeyChar]
    updates.push({
      abilityName,
      abilityOrder: mapping.abilityOrder,
      isUltimate: mapping.isUltimate,
    })
  })

  return updates
}

/**
 * Converts an internal hero name (snake_case) to a Liquipedia page title.
 *
 * Examples:
 *   "ursa"           → "Ursa"
 *   "anti_mage"      → "Anti-Mage"     (special case)
 *   "crystal_maiden"  → "Crystal_Maiden"
 *   "natures_prophet" → "Nature's_Prophet" (special case)
 */
function heroNameToPageTitle(internalName: string): string {
  // Check overrides first
  if (internalName in HERO_NAME_OVERRIDES) {
    return HERO_NAME_OVERRIDES[internalName]
  }

  // Default: replace underscores with spaces, title-case each word, then join with underscores
  return internalName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('_')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── API Response Types (internal) ───────────────────────────────────────────────

interface LiquipediaParseResponse {
  parse?: {
    title?: string
    text?: {
      '*'?: string
    }
  }
}
