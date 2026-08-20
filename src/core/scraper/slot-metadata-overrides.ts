// @DEV-GUIDE: Hand-curated slot metadata (ability_order / is_ultimate) for abilities
// neither scraper can get right, applied AFTER every Windrun scrape and after Liquipedia
// enrichment — these entries are authoritative and win over both sources.
// When they are needed: Liquipedia's spellcards only expose Q/W/E hotkeys reliably;
// passives (no hotkey), non-QWER hotkeys (D/F), and stale rows that predate a kit
// rework fall through and keep wrong or NULL ability_order. Verify each entry in-game
// before adding it, and DELETE entries once the scrapers produce the right value on
// their own (e.g. after a Liquipedia page fix) — every entry here shadows the scrapers.
// Slot convention: ability_order 0 = ultimate, 1-3 = Q/W/E.

export interface SlotMetadataOverride {
  abilityOrder: number
  isUltimate: boolean
}

export const SLOT_METADATA_OVERRIDES: Readonly<Record<string, SlotMetadataOverride>> = {
  // Wrong in old Windrun-era data; verified in-game 2026-07: Healing Ward is W.
  juggernaut_healing_ward: { abilityOrder: 2, isUltimate: false },
  // Feast of Souls — hotkey D on Liquipedia, undetectable. Verified in-game: W slot.
  nevermore_frenzy: { abilityOrder: 2, isUltimate: false },
  // Presence of the Dark Lord — passive, no hotkey. Verified in-game: E slot
  // (old data had it at W before Feast of Souls took that slot).
  nevermore_dark_lord: { abilityOrder: 3, isUltimate: false },
  // Passive (no hotkey on Liquipedia); replaced Blur in the E slot.
  phantom_assassin_immaterial: { abilityOrder: 3, isUltimate: false },
  // 7.39 additions shipped by Windrun with ownerHeroId: null and never enriched
  // (rows had no hero linkage, so Liquipedia matching skipped them entirely).
  dragon_knight_wyrms_wrath: { abilityOrder: 3, isUltimate: false },
  venomancer_snakebite: { abilityOrder: 2, isUltimate: false },
  tinker_deploy_turrets: { abilityOrder: 3, isUltimate: false },
  // Luna: scraped data has Lunar Orbit at W and Moon Glaive at E — the game
  // renders them the other way round. Verified 2026-08-19 against a real draft
  // board: the W-column pool slot's art NCC-matches the official Moon Glaive
  // icon at 0.847 (Lunar Orbit: 0.040). The classifier was right and the
  // METADATA was wrong, which silently mislabels crops the gather script takes
  // for these two classes.
  luna_moon_glaive: { abilityOrder: 2, isUltimate: false },
  luna_lunar_orbit: { abilityOrder: 3, isUltimate: false },
  // Troll Warlord (confirmed in-game 2026-08-19): BOTH Whirling Axes variants
  // share the W slot (the one random slot in his kit — melee/ranged form), Q is
  // Fervor and E is Berserker's Rage. Scraped data had Berserker's Rage with no
  // slot at all and pushed whirling_axes_melee down to E, which made every E-slot
  // scan of his row read as a "misread".
  troll_warlord_whirling_axes_melee: { abilityOrder: 2, isUltimate: false },
  troll_warlord_whirling_axes_ranged: { abilityOrder: 2, isUltimate: false },
  troll_warlord_berserkers_rage: { abilityOrder: 3, isUltimate: false },
  // Scraped with NO slot at all (passives/innates Liquipedia exposes no hotkey
  // for), which left these heroes with a hole in their kit and the ability
  // unpredictable. All three confirmed in-game 2026-08-19 as stable pool
  // abilities filling the hero's missing slot.
  night_stalker_midnight_feast: { abilityOrder: 3, isUltimate: false },
  obsidian_destroyer_objurgation: { abilityOrder: 3, isUltimate: false },
  skeleton_king_bone_guard: { abilityOrder: 2, isUltimate: false },
}
