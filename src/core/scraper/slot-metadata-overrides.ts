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
}
