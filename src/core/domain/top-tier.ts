import { NUM_TOP_TIER_SUGGESTIONS } from '@shared/constants/thresholds'
import type { ScoredEntity, TopTierEntity } from './types'

// @DEV-GUIDE: Selects the top 10 recommended entities to highlight in the overlay.
// Two-tier priority: 1) Synergy suggestions (abilities pairing well with user's picks),
// 2) General top picks (highest consolidated score from remaining pool).
// If My Spot already has an ultimate, all ultimates are excluded from recommendations.

/**
 * Select the top-tier entities (max 10) from the scored pool.
 *
 * Rules:
 * 1. If mySpotHasUlt: filter out all ultimates from candidates AND synergy partners.
 * 2. Synergy suggestions (abilities in synergisticPartnersInPool) come first, sorted by score.
 * 3. If selectedModelId is set: general candidates are abilities-only (no hero models).
 * 4. Remaining slots filled with general top picks sorted by score desc.
 */
export function determineTopTierEntities(
  allScoredEntities: ScoredEntity[],
  selectedModelId: number | null,
  mySpotHasUlt: boolean,
  synergisticPartnersInPool: Set<string>,
): TopTierEntity[] {
  let entitiesToConsider = [...allScoredEntities]
  const finalTopTier: TopTierEntity[] = []

  let effectiveSynergyPartners = new Set(synergisticPartnersInPool)

  // Step 1: If My Spot already has an ultimate, exclude all ultimates
  if (mySpotHasUlt) {
    entitiesToConsider = entitiesToConsider.filter((entity) => {
      if (entity.entityType === 'ability') {
        return !entity.isUltimateFromCoordSource && !entity.isUltimateFromDb
      }
      return true
    })

    // Also remove ultimate synergy partners
    const nonUltimateSynergies = new Set<string>()
    for (const partnerName of effectiveSynergyPartners) {
      const partnerEntity = allScoredEntities.find(
        (e) => e.internalName === partnerName,
      )
      if (
        partnerEntity &&
        !partnerEntity.isUltimateFromCoordSource &&
        !partnerEntity.isUltimateFromDb
      ) {
        nonUltimateSynergies.add(partnerName)
      }
    }
    effectiveSynergyPartners = nonUltimateSynergies
  }

  // Step 2: Extract synergy suggestions first
  const synergySuggestions: TopTierEntity[] = []
  entitiesToConsider = entitiesToConsider.filter((entity) => {
    if (
      entity.entityType === 'ability' &&
      effectiveSynergyPartners.has(entity.internalName)
    ) {
      synergySuggestions.push({
        ...entity,
        isSynergySuggestionForMySpot: true,
        isGeneralTopTier: false,
      })
      return false
    }
    return true
  })
  synergySuggestions.sort((a, b) => b.consolidatedScore - a.consolidatedScore)
  finalTopTier.push(
    ...synergySuggestions.slice(0, NUM_TOP_TIER_SUGGESTIONS),
  )

  // Step 3: Fill remaining slots with general top picks
  const remainingSlots = NUM_TOP_TIER_SUGGESTIONS - finalTopTier.length
  if (remainingSlots > 0) {
    let generalCandidates = [...entitiesToConsider]

    // When a hero model is selected, only suggest abilities (not hero models) as general picks
    if (selectedModelId !== null) {
      generalCandidates = generalCandidates.filter(
        (e) => e.entityType === 'ability',
      )
    }

    const generalTopPicks = generalCandidates
      .sort((a, b) => b.consolidatedScore - a.consolidatedScore)
      .slice(0, remainingSlots)
      .map((entity) => ({
        ...entity,
        isSynergySuggestionForMySpot: false,
        isGeneralTopTier: true,
      }))

    finalTopTier.push(...generalTopPicks)
  }

  return finalTopTier
}
