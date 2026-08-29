import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeShiftAxes, type ShiftAxes } from '@core/domain/shift-axes'
import {
  resolveRoleContext,
  computeRoleScore,
  allRoleNeeds,
  type DraftPosition,
} from '@core/domain/role-scoring'
import { calculateConsolidatedScore } from '@core/domain/scoring'
import {
  parseAbilityTagsDataset,
  parseHeroMeta,
  isInertOnModel,
  type AbilityTag,
} from '@core/domain/ability-tags'
import {
  NEED_SCARCITY_REF,
  NEED_SCARCITY_MIN,
  NEED_SCARCITY_MAX,
} from '@shared/constants/thresholds'
import type { ScanResult } from '@shared/types'

// @DEV-GUIDE: DRAFT SIMULATION HARNESS — not a regular unit test. Replays real
// expert drafts from the gathered corpus (../ad_data_gather_script/draft_corpus)
// through the REAL scoring pipeline (shift axes, role context, needs engine,
// scarcity, taper, inert filter) and records, at every ability pick, where the
// expert's actual choice ranked in our suggestion ordering. Run explicitly:
//   DRAFT_SIM=1 npx vitest run tests/unit/core/domain/draft-simulation.test.ts
// Skipped (instantly green) in normal suite runs. Results land in
// draft_corpus/sim_results.json for analysis.

const RUN = process.env.DRAFT_SIM === '1'
const REPO = join(__dirname, '..', '..', '..', '..')
const CORPUS = join(REPO, '..', 'ad_data_gather_script', 'draft_corpus')
const NUM_DRAFTS = Number(process.env.DRAFT_SIM_COUNT ?? 10)

interface CorpusPlayer {
  side: 'radiant' | 'dire'
  abilities: number[]
  hero: number
  gpm: number | null
}
interface CorpusMatch {
  matchId: number
  source: string
  avgRating: number | null
  league?: { name?: string } | null
  radiantWin: boolean
  picks: Array<{ abilityId: number; pickOrder: number }>
  players: CorpusPlayer[]
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

;(RUN ? describe : describe.skip)('draft simulation vs expert picks', () => {
  it('replays corpus drafts through the real scoring pipeline', () => {
    // ── Load data ─────────────────────────────────────────────────────────
    const stats = loadJson<
      Record<
        string,
        { windrunId: number; winrate: number | null; pickRate: number | null; isUltimate: boolean }
      >
    >(join(CORPUS, 'ability_stats.json'))
    const shiftsRaw = loadJson<{
      data: { abilityShifts: Array<Record<string, number>> }
    }>(join(CORPUS, 'shifts.json'))
    const tagsParsed = parseAbilityTagsDataset(
      loadJson(join(REPO, 'resources', 'data', 'ability_tags.json')),
    )!
    const heroMeta = parseHeroMeta(
      loadJson(join(REPO, 'resources', 'data', 'hero_meta.json')),
    )!
    const staticAbilities = loadJson<{ data: Array<{ valveId: number; shortName: string }> }>(
      join(CORPUS, 'static_abilities.json'),
    )
    const heroShortById = new Map<number, string>()
    for (const [name, meta] of heroMeta) void name, meta // (heroMeta keyed by name)

    const nameById = new Map<number, string>()
    for (const [name, s] of Object.entries(stats)) nameById.set(s.windrunId, name)
    for (const a of staticAbilities.data) {
      if (!nameById.has(a.valveId)) nameById.set(a.valveId, a.shortName)
    }

    // Shift axes over the full DB pool (same construction as the scraper path)
    const shiftByWindrunId = new Map<number, Record<string, number>>()
    for (const s of shiftsRaw.data.abilityShifts) shiftByWindrunId.set(s.abilityId, s)
    const shiftRows = Object.entries(stats).map(([name, s]) => {
      const sh = shiftByWindrunId.get(s.windrunId)
      return {
        name,
        killsShift: sh?.killsShift ?? null,
        deathsShift: sh?.deathsShift ?? null,
        kaShift: sh?.killAssistShift ?? null,
        gpmShift: sh?.gpmShift ?? null,
        xpmShift: sh?.xpmShift ?? null,
        dmgShift: sh?.dmgShift ?? null,
        healingShift: sh?.healingShift ?? null,
      }
    })
    const axesByName = computeShiftAxes(shiftRows)

    // Hero internal names by windrun hero id (for model attack types)
    const heroIdByName = loadJson<Record<string, number>>(
      join(CORPUS, 'hero_ids.json'),
    )
    for (const [name, id] of Object.entries(heroIdByName)) heroShortById.set(id, name)

    // Pair synergies (windrun's curated set) — the app promotes pool abilities
    // that pair with the user's own picks ahead of general suggestions.
    const pairRows = loadJson<Array<[string, string, number]>>(
      join(CORPUS, 'ability_pairs.json'),
    )
    const partnersOf = new Map<string, Set<string>>()
    for (const [a, b] of pairRows) {
      if (!partnersOf.has(a)) partnersOf.set(a, new Set())
      if (!partnersOf.has(b)) partnersOf.set(b, new Set())
      partnersOf.get(a)!.add(b)
      partnersOf.get(b)!.add(a)
    }

    // ── Select eligible drafts: stable 4-ability builds, fully mappable ──
    const lines = readFileSync(join(CORPUS, 'drafts.jsonl'), 'utf8').split('\n')
    const eligible: CorpusMatch[] = []
    for (const line of lines) {
      if (!line.trim()) continue
      let m: CorpusMatch
      try {
        m = JSON.parse(line) as CorpusMatch
      } catch {
        continue
      }
      if ((m.players?.length ?? 0) !== 10 || (m.picks?.length ?? 0) !== 50) continue
      const stable = m.players.every((p) => {
        const pos = (p.abilities ?? []).filter((a) => a > 0)
        return pos.length === 4 && (p.abilities ?? []).filter((a) => a < 0).length === 1
      })
      if (!stable) continue
      const abilityPicks = m.picks.filter((p) => p.abilityId > 0)
      const mappable = abilityPicks.every((p) => {
        const name = nameById.get(p.abilityId)
        return name !== undefined && name in stats
      })
      if (!mappable) continue
      eligible.push(m)
    }
    // Selection: an explicit id list (DRAFT_SIM_IDS=path to a JSON array, e.g.
    // the OpenDota-confirmed solo-queue set) wins; otherwise prefer high-rated,
    // half league / half high-skill.
    let chosen: CorpusMatch[]
    if (process.env.DRAFT_SIM_IDS) {
      const ids = new Set(loadJson<number[]>(process.env.DRAFT_SIM_IDS))
      chosen = eligible.filter((m) => ids.has(m.matchId))
    } else {
      const byRating = (a: CorpusMatch, b: CorpusMatch) =>
        (b.avgRating ?? 0) - (a.avgRating ?? 0)
      const league = eligible.filter((m) => m.source === 'league').sort(byRating)
      const highskill = eligible.filter((m) => m.source === 'highskill').sort(byRating)
      chosen = [
        ...league.slice(0, Math.ceil(NUM_DRAFTS / 2)),
        ...highskill.slice(0, Math.floor(NUM_DRAFTS / 2)),
      ].slice(0, NUM_DRAFTS)
      expect(chosen.length).toBe(NUM_DRAFTS)
    }

    // ── Replay ────────────────────────────────────────────────────────────
    const results: object[] = []
    for (const match of chosen) {
      const picks = [...match.picks].sort((a, b) => a.pickOrder - b.pickOrder)
      const owner = new Map<number, number>()
      match.players.forEach((p, idx) => {
        for (const aid of p.abilities) owner.set(aid, idx)
      })
      // Farm rank within team -> fixed position 1-5
      const positionOf = new Map<number, DraftPosition>()
      for (const side of ['radiant', 'dire'] as const) {
        const idxs = match.players
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => p.side === side)
          .sort((a, b) => (b.p.gpm ?? 0) - (a.p.gpm ?? 0))
        idxs.forEach(({ i }, rank) => positionOf.set(i, (rank + 1) as DraftPosition))
      }

      const pool = new Set<number>(picks.filter((p) => p.abilityId > 0).map((p) => p.abilityId))
      const standardsOf = new Map<number, number[]>()
      const ultOf = new Map<number, number | null>()
      const modelOf = new Map<number, number | null>()
      match.players.forEach((_, i) => {
        standardsOf.set(i, [])
        ultOf.set(i, null)
        modelOf.set(i, null)
      })
      const selectedScans: ScanResult[] = []
      const scanStub = (name: string, heroOrder: number): ScanResult => ({
        name,
        confidence: 1,
        hero_order: heroOrder,
        ability_order: 0,
        is_ultimate: false,
        coord: { x: 0, y: 0, width: 0, height: 0, hero_order: heroOrder },
      })

      const pickRecords: object[] = []
      for (const pk of picks) {
        const pickerIdx = owner.get(pk.abilityId)
        if (pk.abilityId < 0) {
          const modelIdx = match.players.findIndex((p) => p.hero === -pk.abilityId)
          if (modelIdx >= 0) modelOf.set(modelIdx, -pk.abilityId)
          continue
        }
        if (pickerIdx === undefined) continue
        const position = positionOf.get(pickerIdx)!
        const actualName = nameById.get(pk.abilityId)!

        // Candidates under the ult rule
        const hasUlt = ultOf.get(pickerIdx) !== null
        const standards = standardsOf.get(pickerIdx)!
        const mustUlt = standards.length === 3 && !hasUlt
        const candidates = [...pool].filter((aid) => {
          const name = nameById.get(aid)
          if (name === undefined) return false
          const isUlt = stats[name].isUltimate
          if (hasUlt && isUlt) return false
          if (mustUlt && !isUlt) return false
          return true
        })

        // Role context via the real resolver
        const ctx = resolveRoleContext(
          { roleMode: 'fixed', roleFixedPositions: [position] },
          selectedScans,
          pickerIdx,
          axesByName,
        )
        // Scarcity over the remaining pool
        const poolTags = candidates
          .map((aid) => tagsParsed.tagsByAbility.get(nameById.get(aid)!))
          .filter((t): t is ReadonlySet<AbilityTag> => t !== undefined)
        const needScarcity = new Map<string, number>()
        for (const need of allRoleNeeds()) {
          const supply = poolTags.filter((tags) =>
            need.anyOf.some((req) => req.every((tag) => tags.has(tag))),
          ).length
          needScarcity.set(
            need.key,
            Math.max(
              NEED_SCARCITY_MIN,
              Math.min(NEED_SCARCITY_MAX, NEED_SCARCITY_REF / Math.max(1, supply)),
            ),
          )
        }
        const myPickTags = [...standards, ...(hasUlt ? [ultOf.get(pickerIdx)!] : [])]
          .map((aid) => tagsParsed.tagsByAbility.get(nameById.get(aid)!))
          .filter((t): t is ReadonlySet<AbilityTag> => t !== undefined)
        const myModelHero = modelOf.get(pickerIdx)
        const myAttackType =
          myModelHero !== null
            ? heroMeta.get(heroShortById.get(myModelHero) ?? '')?.attackType
            : undefined

        // Synergy-partner promotion (mirrors determineTopTierEntities):
        // pool abilities pairing with MY picks rank ahead of general picks
        const myNames = [...standards, ...(hasUlt ? [ultOf.get(pickerIdx)!] : [])]
          .map((aid) => nameById.get(aid)!)
        const myPartners = new Set<string>()
        for (const mine of myNames) {
          for (const partner of partnersOf.get(mine) ?? []) myPartners.add(partner)
        }

        // Score every candidate with the real pipeline
        const scored = candidates
          .map((aid) => {
            const name = nameById.get(aid)!
            const s = stats[name]
            const candidateTags = tagsParsed.tagsByAbility.get(name)
            if (isInertOnModel(candidateTags, myAttackType)) return null
            const base = calculateConsolidatedScore(s.winrate, s.pickRate)
            const role = computeRoleScore(axesByName.get(name), ctx, {
              candidateTags,
              myPickTags,
              needScarcity,
            })
            const score =
              role !== null ? Math.min(1, Math.max(0, base + role.delta)) : base
            return {
              aid,
              name,
              score,
              partner: myPartners.has(name),
              reasons: role?.reasons ?? [],
            }
          })
          .filter((c): c is NonNullable<typeof c> => c !== null)
          .sort(
            (a, b) =>
              Number(b.partner) - Number(a.partner) || b.score - a.score,
          )

        const actualRank = scored.findIndex((c) => c.aid === pk.abilityId) + 1
        const byScore = [...scored].sort((a, b) => b.score - a.score)
        const actualScoreRank = byScore.findIndex((c) => c.aid === pk.abilityId) + 1
        pickRecords.push({
          pickOrder: pk.pickOrder,
          picker: pickerIdx,
          position,
          myPickIndex: standards.length + (hasUlt ? 1 : 0) + 1,
          actual: actualName,
          actualRank: actualRank === 0 ? null : actualRank,
          actualScoreRank: actualScoreRank === 0 ? null : actualScoreRank,
          actualWasPartner: myPartners.has(actualName),
          candidates: scored.length,
          ourTop3: scored
            .slice(0, 3)
            .map((c) => ({ name: c.name, partner: c.partner, reasons: c.reasons })),
          actualReasons:
            scored.find((c) => c.aid === pk.abilityId)?.reasons ?? [],
        })

        // Apply the actual pick
        pool.delete(pk.abilityId)
        if (stats[actualName].isUltimate) ultOf.set(pickerIdx, pk.abilityId)
        else standards.push(pk.abilityId)
        selectedScans.push(scanStub(actualName, pickerIdx))
      }

      results.push({
        matchId: match.matchId,
        source: match.source,
        league: match.league?.name ?? null,
        avgRating: match.avgRating,
        radiantWin: match.radiantWin,
        positions: match.players.map((_, i) => positionOf.get(i)),
        picks: pickRecords,
      })
    }

    writeFileSync(
      join(CORPUS, 'sim_results.json'),
      JSON.stringify(results, null, 1),
      'utf8',
    )
    // eslint-disable-next-line no-console
    console.log(`Simulated ${results.length} drafts -> sim_results.json`)
    if (process.env.DRAFT_SIM_IDS) expect(results.length).toBeGreaterThan(0)
    else expect(results.length).toBe(NUM_DRAFTS)
  }, 120_000)
})
