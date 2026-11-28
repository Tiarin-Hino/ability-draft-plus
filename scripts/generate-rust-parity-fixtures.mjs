#!/usr/bin/env node
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const entrySource = `
import {
  normalizeWinrate,
  normalizePickOrder,
  calculateConsolidatedScore,
  calculatePersonalizedScore,
} from './src/core/domain/scoring.ts'
import { computeShiftAxes } from './src/core/domain/shift-axes.ts'
import { computeRoleScore } from './src/core/domain/role-scoring.ts'
import { determineTopTierEntities } from './src/core/domain/top-tier.ts'
import {
  buildTurnSchedule,
  countdownTargetRow,
  isRoundBreak,
  isPreviewClock,
  classifyHeroSelectionReentry,
} from './src/core/gsi/draft-clock.ts'
import { parseGsiPayload, gsiSnapshotMode } from './src/core/gsi/parser.ts'

export function generateParityGolden() {
  const scoringCases = [
    { winrate: null, pickRate: null, personal: null },
    { winrate: 0.55, pickRate: 12.3, personal: null },
    { winrate: 0.0, pickRate: 50.0, personal: null },
    { winrate: 1.0, pickRate: 1.0, personal: null },
    { winrate: 0.48, pickRate: 0.2, personal: null },
    { winrate: 0.61, pickRate: 85.0, personal: null },
    { winrate: 0.50, pickRate: 25.5, personal: { games: 0, winrate: 0.90, avgPickPosition: 1.0 } },
    { winrate: 0.50, pickRate: 25.5, personal: { games: 20, winrate: 0.70, avgPickPosition: 1.0 } },
    { winrate: 0.52, pickRate: 15.0, personal: { games: 5, winrate: 0.40, avgPickPosition: null } },
    { winrate: null, pickRate: null, personal: { games: 10, winrate: 0.65, avgPickPosition: 5.0 } },
  ].map((c) => {
    const score = c.personal
      ? calculatePersonalizedScore(c.winrate, c.pickRate, c.personal)
      : calculatePersonalizedScore(c.winrate, c.pickRate)
    return {
      input: c,
      normalizedWinrate: normalizeWinrate(c.winrate),
      normalizedPickOrder: normalizePickOrder(c.pickRate),
      consolidatedScore: calculateConsolidatedScore(c.winrate, c.pickRate),
      personalized: {
        consolidatedScore: score.consolidatedScore,
        personalGames: score.personalGames ?? null,
        personalWinrate: score.personalWinrate ?? null,
        personalScoreDelta: score.personalScoreDelta ?? null,
      },
    }
  })

  const shiftRows = [
    { name: 'low', killsShift: 0.0, deathsShift: null, kaShift: -0.5, gpmShift: -1.0, xpmShift: 0.0, dmgShift: null, healingShift: 0.0 },
    { name: 'tie_a', killsShift: 1.0, deathsShift: null, kaShift: 0.2, gpmShift: 0.5, xpmShift: 0.0, dmgShift: null, healingShift: 0.0 },
    { name: 'tie_b', killsShift: 1.0, deathsShift: null, kaShift: 0.2, gpmShift: 0.5, xpmShift: 0.0, dmgShift: null, healingShift: 0.0 },
    { name: 'high_heal', killsShift: 2.0, deathsShift: null, kaShift: 1.4, gpmShift: 1.2, xpmShift: 0.8, dmgShift: null, healingShift: 3.1 },
    { name: 'null_row', killsShift: null, deathsShift: null, kaShift: null, gpmShift: null, xpmShift: null, dmgShift: null, healingShift: null },
  ]
  const shiftAxesMap = computeShiftAxes(shiftRows)
  const shiftAxes = Object.fromEntries(shiftAxesMap.entries())

  const roleCases = [
    {
      name: 'null_context_off',
      axes: shiftAxes['tie_a'],
      positions: [],
      myPickCount: 0,
      teamGreed: null,
      candidateTags: ['nuke'],
      roleMust: [],
      myPickTags: [],
      poolHasHardCc: true,
    },
    {
      name: 'pos5_via_nuke_and_stun_suppression',
      axes: shiftAxes['low'],
      positions: [5],
      myPickCount: 0,
      teamGreed: null,
      candidateTags: ['nuke', 'soft_cc'],
      roleMust: [],
      myPickTags: [],
      poolHasHardCc: true,
    },
    {
      name: 'pos5_soft_cc_when_no_hard_cc_in_pool',
      axes: shiftAxes['low'],
      positions: [5],
      myPickCount: 1,
      teamGreed: 0.4,
      candidateTags: ['soft_cc'],
      roleMust: [],
      myPickTags: [],
      poolHasHardCc: false,
    },
    {
      name: 'pos1_curated_with_mana_budget_excess',
      axes: shiftAxes['high_heal'],
      positions: [1, 2],
      myPickCount: 3,
      teamGreed: 0.6,
      candidateTags: ['steroid', 'mana_hungry'],
      roleMust: [1],
      myPickTags: [['nuke', 'mana_hungry'], ['mobility', 'mana_hungry']],
      poolHasHardCc: true,
    },
  ].map((rc) => {
    const ctx =
      rc.positions.length === 0
        ? null
        : {
            mode: 'fixed',
            effectivePositions: rc.positions,
            myPickCount: rc.myPickCount,
            teamGreed: rc.teamGreed,
            teammates: [],
            estimatedPositions: new Map(),
          }
    const res = computeRoleScore(rc.axes, ctx, {
      candidateTags: new Set(rc.candidateTags),
      candidateRoleMust: rc.roleMust.length ? new Set(rc.roleMust) : undefined,
      myPickTags: rc.myPickTags.map((t) => new Set(t)),
      poolHasHardCc: rc.poolHasHardCc,
    })
    return {
      input: rc,
      output: res
        ? {
            delta: res.delta,
            bestPosition: res.bestPosition,
            reasons: res.reasons,
            curated: res.curated ?? false,
          }
        : null,
    }
  })

  const topTierEntities = [
    { internalName: 'synergy_std', displayName: 'Syn Std', entityType: 'ability', heroOrder: 0, abilityOrder: 1, consolidatedScore: 0.30, winrate: 0.5, pickRate: 25, isUltimateFromCoordSource: false, isUltimateFromDb: false, isGeneralTopTier: false, isSynergySuggestionForMySpot: false, dbAbilityId: 1 },
    { internalName: 'synergy_ult', displayName: 'Syn Ult', entityType: 'ability', heroOrder: 0, abilityOrder: 0, consolidatedScore: 0.99, winrate: 0.6, pickRate: 5, isUltimateFromCoordSource: true, isUltimateFromDb: true, isGeneralTopTier: false, isSynergySuggestionForMySpot: false, dbAbilityId: 2 },
    { internalName: 'curated_low', displayName: 'Curated Low', entityType: 'ability', heroOrder: 1, abilityOrder: 1, consolidatedScore: 0.12, winrate: 0.45, pickRate: 40, isUltimateFromCoordSource: false, isUltimateFromDb: false, isGeneralTopTier: false, isSynergySuggestionForMySpot: false, roleCurated: true, dbAbilityId: 3 },
    { internalName: 'hero_curated', displayName: 'Hero Curated', entityType: 'hero', heroOrder: 2, abilityOrder: -1, consolidatedScore: 0.95, winrate: 0.58, pickRate: 4, isUltimateFromCoordSource: false, isUltimateFromDb: false, isGeneralTopTier: false, isSynergySuggestionForMySpot: false, roleCurated: true, dbHeroId: 10 },
    { internalName: 'pool_ult', displayName: 'Pool Ult', entityType: 'ability', heroOrder: 3, abilityOrder: 0, consolidatedScore: 0.98, winrate: 0.59, pickRate: 3, isUltimateFromCoordSource: true, isUltimateFromDb: true, isGeneralTopTier: false, isSynergySuggestionForMySpot: false, dbAbilityId: 4 },
    ...Array.from({ length: 12 }, (_, i) => ({
      internalName: 'std_' + i,
      displayName: 'Std ' + i,
      entityType: 'ability',
      heroOrder: i % 6,
      abilityOrder: 1,
      consolidatedScore: 0.5 + i * 0.02,
      winrate: 0.5,
      pickRate: 20 - i,
      isUltimateFromCoordSource: false,
      isUltimateFromDb: false,
      isGeneralTopTier: false,
      isSynergySuggestionForMySpot: false,
      dbAbilityId: 100 + i,
    })),
  ]
  const topTier = determineTopTierEntities(
    topTierEntities,
    10,
    true,
    new Set(['synergy_std', 'synergy_ult']),
  ).map((t) => ({
    internalName: t.internalName,
    entityType: t.entityType,
    isSynergySuggestionForMySpot: t.isSynergySuggestionForMySpot,
    isGeneralTopTier: t.isGeneralTopTier,
    isCuratedForRole: t.isCuratedForRole ?? false,
  }))

  const schedule = buildTurnSchedule()
  const draftClock = {
    schedule,
    countdownTarget: countdownTargetRow({ countdownS: 27.2, elapsedS: -13.0, schedule }),
    roundBreaks: [-10.0, 5.0, 72.0, 370.0].map((s) => ({ elapsedS: s, isBreak: isRoundBreak(s, schedule) })),
    previewClocks: [-59, -8, -7, 0].map((c) => ({ clockTime: c, isPreview: isPreviewClock(c) })),
    reentries: [
      classifyHeroSelectionReentry({ clockTime: -55, picksTracked: 0 }),
      classifyHeroSelectionReentry({ clockTime: -55, picksTracked: 3 }),
      classifyHeroSelectionReentry({ clockTime: 10, picksTracked: 0 }),
    ],
  }

  const gsiPayloads = [
    {
      map: { matchid: '8012345678', game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION', clock_time: -42 },
      player: { name: 'Tiarin', accountid: '45008415', team_name: 'dire', team_slot: 2 },
      hero: { name: 'npc_dota_hero_crystal_maiden' },
    },
    {
      map: { matchid: '9001', game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION', clock_time: 12 },
      player: {
        team2: {
          player0: { name: 'RadB', accountid: '10', team_slot: 3 },
          player1: { name: 'RadA', accountid: '11', team_slot: 0 },
        },
        team3: {
          player5: { name: 'DireA', accountid: '20', team_slot: 1 },
        },
      },
      hero: {
        team2: {
          player0: { name: 'npc_dota_hero_zuus' },
          player1: { name: 'npc_dota_hero_axe' },
        },
        team3: {
          player5: { name: 'npc_dota_hero_puck' },
        },
      },
    },
  ].map((raw) => {
    const snap = parseGsiPayload(raw)
    return {
      raw,
      parsed: {
        matchId: snap.matchId,
        gamePhase: snap.gamePhase,
        clockTime: snap.clockTime,
        mode: gsiSnapshotMode(snap),
        localSlotIndex: snap.localPlayer?.slotIndex ?? null,
        localHeroNpcName: snap.localHeroNpcName,
        players: snap.players.map((p) => ({
          slotIndex: p.slotIndex,
          name: p.name,
          accountId: p.accountId,
          heroNpcName: p.heroNpcName,
        })),
      },
    }
  })

  return {
    scoringCases,
    shiftRows,
    shiftAxes,
    roleCases,
    topTierEntities,
    topTier,
    draftClock,
    gsiPayloads,
  }
}
`

const res = await build({
  stdin: {
    contents: entrySource,
    resolveDir: repoRoot,
    sourcefile: 'parity-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  alias: {
    '@core': path.join(repoRoot, 'src/core'),
    '@shared': path.join(repoRoot, 'src/shared'),
  },
})

const tmpModule = path.join(tmpdir(), `ad-parity-${Date.now()}.mjs`)
await writeFile(tmpModule, res.outputFiles[0].text, 'utf8')
const { generateParityGolden } = await import(pathToFileURL(tmpModule).href)
const golden = generateParityGolden()

const outPath = path.join(repoRoot, 'rust/crates/ad-core/tests/fixtures/parity_golden.json')
await mkdir(path.dirname(outPath), { recursive: true })
await writeFile(outPath, JSON.stringify(golden, null, 2) + '\n', 'utf8')
console.log(`Wrote parity golden fixtures to ${outPath}`)
