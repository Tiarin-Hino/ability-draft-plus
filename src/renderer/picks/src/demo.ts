import type { PicksAbility, PicksViewState } from '@shared/types/stream'

// @DEV-GUIDE: Demo snapshot for the setup page and ?demo=1 — a COMPLETE drafted board
// (the picks strips' primary state), so streamers tune spacing/alignment against the
// densest layout they will broadcast. Real internal names so icons resolve through the
// local icon cache; the cross-hero ability mixes are Ability-Draft-plausible, not real.

const HERO_SETS: Array<{
  npc: string
  display: string
  abilities: [string, string, string]
  ultimate: string
}> = [
  { npc: 'pudge', display: 'Pudge', abilities: ['pudge_meat_hook', 'pudge_rot', 'pudge_flesh_heap'], ultimate: 'pudge_dismember' },
  { npc: 'lich', display: 'Lich', abilities: ['lich_frost_nova', 'lich_frost_shield', 'lich_sinister_gaze'], ultimate: 'lich_chain_frost' },
  { npc: 'sand_king', display: 'Sand King', abilities: ['sandking_burrowstrike', 'sandking_sand_storm', 'sandking_scorpion_strike'], ultimate: 'sandking_epicenter' },
  { npc: 'oracle', display: 'Oracle', abilities: ['oracle_fortunes_end', 'oracle_fates_edict', 'oracle_purifying_flames'], ultimate: 'oracle_false_promise' },
  { npc: 'kunkka', display: 'Kunkka', abilities: ['kunkka_torrent', 'kunkka_tidebringer', 'kunkka_x_marks_the_spot'], ultimate: 'kunkka_ghostship' },
  { npc: 'luna', display: 'Luna', abilities: ['luna_lucent_beam', 'luna_moon_glaive', 'luna_lunar_orbit'], ultimate: 'luna_eclipse' },
  { npc: 'slark', display: 'Slark', abilities: ['slark_dark_pact', 'slark_pounce', 'slark_essence_shift'], ultimate: 'slark_shadow_dance' },
  { npc: 'venomancer', display: 'Venomancer', abilities: ['venomancer_venomous_gale', 'venomancer_poison_sting', 'venomancer_plague_ward'], ultimate: 'venomancer_noxious_plague' },
  { npc: 'tidehunter', display: 'Tidehunter', abilities: ['tidehunter_gush', 'tidehunter_kraken_shell', 'tidehunter_anchor_smash'], ultimate: 'tidehunter_ravage' },
  { npc: 'brewmaster', display: 'Brewmaster', abilities: ['brewmaster_thunder_clap', 'brewmaster_cinder_brew', 'brewmaster_drunken_brawler'], ultimate: 'brewmaster_primal_split' },
  { npc: 'ursa', display: 'Ursa', abilities: ['ursa_earthshock', 'ursa_overpower', 'ursa_fury_swipes'], ultimate: 'ursa_enrage' },
  { npc: 'warlock', display: 'Warlock', abilities: ['warlock_fatal_bonds', 'warlock_shadow_word', 'warlock_upheaval'], ultimate: 'warlock_rain_of_chaos' },
]

const PLAYER_NAMES = [
  'Aurora', 'Blitz', 'Cinder', 'Drifter', 'Ember',
  'Frost', 'Gale', 'Havoc', 'Iris', 'Jolt',
]

function titleCase(internal: string): string {
  return internal
    .split('_')
    .slice(1)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function ability(name: string): PicksAbility {
  return {
    name,
    displayName: titleCase(name),
    iconPath: `/icons/abilities/${name}.png`,
    isUnknown: false,
  }
}

export function buildDemoPicksState(): PicksViewState {
  return {
    players: PLAYER_NAMES.map((playerName, playerIndex) => {
      const hero = HERO_SETS[playerIndex]
      return {
        playerIndex,
        team: (playerIndex < 5 ? 'radiant' : 'dire') as 'radiant' | 'dire',
        playerName,
        heroDisplayName: hero.display,
        portraitPath: `/icons/heroes/${hero.npc}.png`,
        picks: [
          ability(HERO_SETS[(playerIndex + 1) % 12].abilities[0]),
          ability(HERO_SETS[(playerIndex + 2) % 12].abilities[1]),
          ability(HERO_SETS[(playerIndex + 3) % 12].abilities[2]),
          ability(HERO_SETS[(playerIndex + 5) % 12].ultimate),
        ],
      }
    }),
    meta: { language: 'en', appVersion: 'demo', updatedAt: 0 },
  }
}
