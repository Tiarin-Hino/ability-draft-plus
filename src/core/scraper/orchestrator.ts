import type { WindrunApiClient } from './windrun-api-client'
import type { ScraperProgress, ScraperResult, ScraperOptions } from './types'
import {
  transformAbilitiesAndHeroes,
  transformPairs,
  transformTriplets,
  buildWinrateMap,
  buildAbilityLookup,
} from './data-transformer'
import { detectModelGaps } from '@core/ml/staleness-detector'
import type { HeroRepository } from '@core/database/repositories/hero-repository'
import type { AbilityRepository } from '@core/database/repositories/ability-repository'
import type { SynergyRepository } from '@core/database/repositories/synergy-repository'
import type { TripletRepository } from '@core/database/repositories/triplet-repository'
import type { MetadataRepository } from '@core/database/repositories/metadata-repository'

// @DEV-GUIDE: 3-phase scrape flow controller.
// Phase 1: Fetch static data + ability/hero stats from Windrun, transform, upsert into DB.
// Phase 2: Fetch ability pairs + triplets, calculate synergy_increase, bulk insert into DB.
// After success: records last_scrape_date, optionally runs ML staleness detection.
// Each phase has progress callbacks for the UI scraping page.
// Error in any phase stops the pipeline and returns { success: false, error }.
//
// Also exports performLiquipediaEnrichment() — a separate, much slower flow that fetches
// ability_order and is_ultimate from Liquipedia wiki pages (31s rate limit per request).
// Designed to be triggered independently from the main Windrun scrape.

export interface ScraperDeps {
  apiClient: WindrunApiClient
  heroes: HeroRepository
  abilities: AbilityRepository
  synergies: SynergyRepository
  triplets: TripletRepository
  metadata: MetadataRepository
  persist: () => void
  /** ML model class names for staleness detection. If provided, gap detection runs post-scrape. */
  classNames?: string[]
}

export interface LiquipediaDeps {
  abilities: AbilityRepository
  persist: () => void
  enrichFromLiquipedia: (
    heroNames: string[],
    onProgress: (msg: string) => void,
  ) => Promise<{ abilityName: string; abilityOrder: number; isUltimate: boolean }[]>
}

export async function performFullScrape(
  deps: ScraperDeps,
  onProgress: (progress: ScraperProgress) => void,
  options: ScraperOptions = {},
): Promise<ScraperResult> {
  try {
    // ── Phase 1: Abilities & Heroes ────────────────────────────────────────
    onProgress({ phase: 'phase1', message: 'Fetching static data from Windrun...' })

    const [staticAbilitiesRes, staticHeroesRes] = await Promise.all([
      deps.apiClient.fetchStaticAbilities(),
      deps.apiClient.fetchStaticHeroes(),
    ])

    // Static abilities is an array — build a valveId-keyed lookup for fast access
    const abilityLookup = buildAbilityLookup(staticAbilitiesRes.data)
    const staticHeroes = staticHeroesRes.data

    onProgress({ phase: 'phase1', message: 'Fetching ability stats...' })

    const [abilitiesRes, hsRes] = await Promise.all([
      deps.apiClient.fetchAbilities(options.patch),
      deps.apiClient.fetchAbilityHighSkill(options.patch),
    ])

    const overallStats = abilitiesRes.data.abilityStats
    const hsStats = hsRes.data.highSkillData.abilityStats

    const positiveIds = overallStats.filter((s) => s.abilityId > 0).length
    const negativeIds = overallStats.filter((s) => s.abilityId < 0).length
    onProgress({
      phase: 'phase1',
      message: `Transforming... (stats: ${overallStats.length} total, ${positiveIds} abilities, ${negativeIds} heroes; lookup: ${abilityLookup.size} abilities, ${Object.keys(staticHeroes).length} heroes)`,
    })

    const { heroData, abilityData } = transformAbilitiesAndHeroes(
      overallStats,
      hsStats,
      abilityLookup,
      staticHeroes,
    )

    onProgress({
      phase: 'phase1',
      message: `Upserting ${heroData.length} heroes and ${abilityData.length} abilities...`,
    })

    const heroNameToIdMap = deps.heroes.upsertHeroes(heroData)
    deps.abilities.upsertAbilities(
      abilityData.map((a) => ({
        name: a.name,
        displayName: a.displayName,
        heroName: a.heroName,
        winrate: a.winrate,
        highSkillWinrate: a.highSkillWinrate,
        pickRate: a.pickRate,
        hsPickRate: a.hsPickRate,
        isUltimate: a.isUltimate,
      })),
      heroNameToIdMap,
    )
    deps.persist()

    // ── Phase 2: Pairs & Triplets ──────────────────────────────────────────
    onProgress({ phase: 'phase2', message: 'Fetching ability pairs and triplets...' })

    const [pairsRes, tripletsRes] = await Promise.all([
      deps.apiClient.fetchAbilityPairs(options.patch),
      deps.apiClient.fetchAbilityTriplets(options.patch),
    ])

    // Use the abilityStats from the pairs response for synergy_increase calculation
    // API may omit these fields — default to empty arrays
    const pairsAbilityStats = pairsRes.data.abilityStats ?? []
    const abilityWinrates = buildWinrateMap(
      pairsAbilityStats.length > 0 ? pairsAbilityStats : overallStats,
    )

    onProgress({ phase: 'phase2', message: 'Transforming pairs...' })

    const { abilityPairs, heroPairs } = transformPairs(
      pairsRes.data.abilityPairs ?? [],
      abilityWinrates,
      abilityLookup,
      staticHeroes,
    )

    const { abilityTriplets, heroTriplets } = transformTriplets(
      tripletsRes.data.abilityTriplets ?? [],
      abilityWinrates,
      abilityLookup,
      staticHeroes,
    )

    const abilityNameToIdMap = deps.abilities.getNameToIdMap()

    onProgress({
      phase: 'phase2',
      message: `Inserting ${abilityPairs.length} ability pairs, ${heroPairs.length} hero pairs, ${abilityTriplets.length} ability triplets, ${heroTriplets.length} hero triplets...`,
    })

    deps.synergies.clearAndInsertAbilitySynergies(
      abilityPairs.map((p) => ({
        ability1Name: p.ability1Name,
        ability2Name: p.ability2Name,
        synergyWinrate: p.synergyWinrate,
        synergyIncrease: p.synergyIncrease,
        isOp: p.isOp,
      })),
      abilityNameToIdMap,
    )

    deps.synergies.clearAndInsertHeroAbilitySynergies(
      heroPairs.map((p) => ({
        heroName: p.heroName,
        abilityName: p.abilityName,
        synergyWinrate: p.synergyWinrate,
        synergyIncrease: p.synergyIncrease,
        isOp: p.isOp,
      })),
      abilityNameToIdMap,
      heroNameToIdMap,
    )

    deps.triplets.clearAndInsertAbilityTriplets(
      abilityTriplets,
      abilityNameToIdMap,
    )

    deps.triplets.clearAndInsertHeroAbilityTriplets(
      heroTriplets,
      abilityNameToIdMap,
      heroNameToIdMap,
    )

    deps.persist()

    // ── Success ────────────────────────────────────────────────────────────
    const now = new Date().toISOString()
    deps.metadata.setLastScrapeDate(now)
    deps.persist()

    // ── Staleness detection ──────────────────────────────────────────────
    const modelGaps = deps.classNames?.length
      ? detectModelGaps(deps.classNames, deps.abilities.getAllNames())
      : undefined

    onProgress({ phase: 'done', message: 'Scrape completed successfully!' })
    return { success: true, modelGaps: modelGaps ?? null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    onProgress({ phase: 'error', message: `Scrape failed: ${message}` })
    return { success: false, error: message }
  }
}

/**
 * Separate Liquipedia enrichment — fetches ability_order and is_ultimate for
 * each hero's abilities. Rate-limited to 1 request per 31s (Liquipedia API policy).
 * Designed to be triggered independently from the main Windrun scrape.
 */
export async function performLiquipediaEnrichment(
  deps: LiquipediaDeps,
  heroDisplayNames: string[],
  onProgress: (progress: ScraperProgress) => void,
): Promise<ScraperResult> {
  try {
    onProgress({ phase: 'liquipedia', message: 'Starting Liquipedia enrichment...' })

    const heroPageNames = heroDisplayNames.map((name) => name.replace(/ /g, '_'))
    const updates = await deps.enrichFromLiquipedia(heroPageNames, (msg) => {
      onProgress({ phase: 'liquipedia', message: msg })
    })

    if (updates.length > 0) {
      onProgress({
        phase: 'liquipedia',
        message: `Applying ${updates.length} Liquipedia updates...`,
      })

      const applied = deps.abilities.updateAbilityMeta(
        updates.map((u) => ({
          name: u.abilityName,
          abilityOrder: u.abilityOrder,
          isUltimate: u.isUltimate,
        })),
      )

      onProgress({
        phase: 'liquipedia',
        message: `Applied ${applied} of ${updates.length} Liquipedia updates`,
      })

      deps.persist()
    }

    onProgress({ phase: 'done', message: 'Liquipedia enrichment completed!' })
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    onProgress({ phase: 'error', message: `Liquipedia enrichment failed: ${message}` })
    return { success: false, error: message }
  }
}
