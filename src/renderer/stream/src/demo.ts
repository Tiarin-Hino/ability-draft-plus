import type { StreamBoardState, StreamAbilitySlot } from '@shared/types/stream'

// @DEV-GUIDE: Demo board state for ?demo=1 — lets streamers build their OBS scene
// (position sources, check sponsor zones) without a live draft, and doubles as a
// design preview. Uses real ability/hero internal names so icons resolve through
// the local icon cache. Data is representative, not real statistics.

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

// A few picks to demonstrate grey-out, player rows, and scores
const PICKED: Array<{ player: number; name: string; display: string }> = [
  { player: 0, name: 'pudge_meat_hook', display: 'Meat Hook' },
  { player: 0, name: 'luna_moon_glaive', display: 'Moon Glaives' },
  { player: 3, name: 'kunkka_tidebringer', display: 'Tidebringer' },
  { player: 5, name: 'ursa_fury_swipes', display: 'Fury Swipes' },
  { player: 5, name: 'warlock_shadow_word', display: 'Shadow Word' },
  { player: 8, name: 'slark_essence_shift', display: 'Essence Shift' },
]

const PICKED_NAMES = new Set(PICKED.map((p) => p.name))

function slot(
  name: string,
  displayName: string,
  winrate: number,
  extra: Partial<StreamAbilitySlot> = {},
): StreamAbilitySlot {
  return {
    name,
    displayName,
    iconPath: `/icons/abilities/${name}.png`,
    winrate,
    // Plausible spread: stronger abilities go earlier
    pickPosition: Math.max(2, Math.round(46 - winrate * 70)),
    consolidatedScore: 0.5 + (winrate - 0.5),
    isTopTier: false,
    isUnknown: false,
    isPicked: PICKED_NAMES.has(name),
    ...extra,
  }
}

function titleCase(internal: string): string {
  return internal
    .split('_')
    .slice(1)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function buildDemoState(): StreamBoardState {
  const winrates = [
    0.52, 0.487, 0.51, 0.532, 0.495, 0.548, 0.472, 0.505, 0.518, 0.49, 0.525, 0.481,
  ]

  const heroes = HERO_SETS.map((hero, order) => ({
    heroOrder: order,
    heroDisplayName: hero.display,
    // A few models already drafted, mirroring a mid-draft board
    modelPicked: order % 4 === 2,
    portraitPath: `/icons/heroes/${hero.npc}.png`,
    standard: hero.abilities.map((name, i) =>
      slot(name, titleCase(name), winrates[(order + i) % winrates.length], {
        isTopTier: (order * 3 + i) % 11 === 0,
      }),
    ),
    ultimate: slot(hero.ultimate, titleCase(hero.ultimate), winrates[(order + 5) % winrates.length], {
      isTopTier: order % 5 === 0,
    }),
  }))

  const players = PLAYER_NAMES.map((playerName, playerIndex) => {
    const picks = PICKED.filter((p) => p.player === playerIndex).map((p) =>
      slot(p.name, p.display, 0.52, { isPicked: false }),
    )
    const model =
      playerIndex % 3 !== 1
        ? {
            npcName: HERO_SETS[(playerIndex * 7) % 12].npc,
            displayName: HERO_SETS[(playerIndex * 7) % 12].display,
            portraitPath: `/icons/heroes/${HERO_SETS[(playerIndex * 7) % 12].npc}.png`,
          }
        : null
    return {
      playerIndex,
      team: (playerIndex < 5 ? 'radiant' : 'dire') as 'radiant' | 'dire',
      playerName,
      model,
      picks,
      draftScore:
        picks.length > 0
          ? {
              score: 0.47 + playerIndex * 0.012,
              base: 0.5,
              synergyAdjustment: 0.02,
              confidence: (picks.length >= 2 ? 'medium' : 'low') as 'medium' | 'low',
            }
          : null,
    }
  })

  const comboRef = (name: string, display: string) => ({
    name,
    displayName: display,
    iconPath: `/icons/abilities/${name}.png`,
  })

  return {
    phase: 'drafting',
    heroes,
    players,
    panels: {
      topWinrateInPool: [
        slot('luna_eclipse', 'Eclipse', 0.548),
        slot('oracle_false_promise', 'False Promise', 0.542),
        slot('tidehunter_ravage', 'Ravage', 0.536),
        slot('sandking_epicenter', 'Epicenter', 0.531),
        slot('warlock_rain_of_chaos', 'Chaotic Offering', 0.527),
        slot('brewmaster_cinder_brew', 'Cinder Brew', 0.522),
      ],
      opCombos: [
        {
          ability1: comboRef('kunkka_x_marks_the_spot', 'X Marks the Spot'),
          ability2: comboRef('sandking_epicenter', 'Epicenter'),
          synergyWinrate: 0.63,
        },
        {
          ability1: comboRef('brewmaster_cinder_brew', 'Cinder Brew'),
          ability2: comboRef('lich_frost_shield', 'Frost Shield'),
          synergyWinrate: 0.605,
        },
        {
          ability1: comboRef('venomancer_plague_ward', 'Plague Ward'),
          ability2: comboRef('ursa_overpower', 'Overpower'),
          synergyWinrate: 0.588,
        },
      ],
      trapCombos: [
        {
          ability1: comboRef('slark_essence_shift', 'Essence Shift'),
          ability2: comboRef('lich_sinister_gaze', 'Sinister Gaze'),
          synergyWinrate: 0.41,
        },
        {
          ability1: comboRef('pudge_flesh_heap', 'Flesh Heap'),
          ability2: comboRef('oracle_fates_edict', "Fate's Edict"),
          synergyWinrate: 0.43,
        },
      ],
      topTier: [],
    },
    gsi: {
      connected: true,
      gamePhase: 'DOTA_GAMERULES_STATE_HERO_SELECTION',
      clockTime: -42,
      spectating: true,
      playerNames: PLAYER_NAMES,
      playerModels: players.map((p) =>
        p.model ? { npcName: p.model.npcName, displayName: p.model.displayName } : null,
      ),
    },
    pickFeed: PICKED.map((pick, i) => ({
      seq: i,
      playerIndex: pick.player,
      abilityName: pick.name,
      kind: 'ability' as const,
      clockTime: -60 + i * 8,
    })),
    meta: { language: 'en', appVersion: 'demo', updatedAt: 0 },
  }
}
