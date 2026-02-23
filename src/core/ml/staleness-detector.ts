// @DEV-GUIDE: Compares the ML model's class_names.json against the Windrun-scraped DB
// to detect drift. After each scrape, this identifies:
// - missingFromModel: New abilities in DB that the model can't classify (need retraining)
// - staleInModel: Abilities the model knows but no longer exist in Windrun data
// Filters out non-pickable abilities (talents, innates, shard-granted) since those
// never appear in the Ability Draft grid. Results shown in the app's ML status panel.

/**
 * Compares the ML model's known class names against abilities currently in the database
 * to detect which abilities the model can't recognize (new/reworked) and which model
 * entries are stale (removed/reworked).
 *
 * Filters out non-pickable abilities: talent bonuses, non-hero entities, and
 * caller-specified innate/shard abilities.
 */

export interface MlModelGaps {
  /** Abilities in the DB (from Windrun scrape) but NOT in class_names.json */
  missingFromModel: string[]
  /** Abilities in class_names.json but NOT in the DB */
  staleInModel: string[]
  /** ISO timestamp of when this gap report was generated */
  detectedAt: string
}

/** Prefixes of abilities that are never pickable in Ability Draft */
const IGNORED_PREFIXES = [
  'ad_special_bonus_',
  'special_bonus_',
]

/** Prefixes of non-hero entities whose abilities aren't pickable in AD */
const NON_HERO_ENTITY_PREFIXES = [
  'greevil_',
  'frostbitten_',
]

/** Specific abilities that are innate, shard-granted, or otherwise not pickable in AD */
const UNPICKABLE_ABILITIES = new Set([
  'ancient_apparition_death_rime',
  'hoodwink_sharpshooter_release',
  'jakiro_double_trouble',
  'monkey_king_primal_spring',
  'necrolyte_sadist_stop',
  'razor_dynamo',
  'rubick_hidden1',
  'slark_depth_shroud',
  'tiny_insurmountable',
])

/**
 * Check if an ability name is relevant for ML model comparison.
 * Filters out talent bonuses and non-hero entity abilities by prefix.
 */
export function isPickableAbility(name: string): boolean {
  if (UNPICKABLE_ABILITIES.has(name)) return false
  for (const prefix of IGNORED_PREFIXES) {
    if (name.startsWith(prefix)) return false
  }
  for (const prefix of NON_HERO_ENTITY_PREFIXES) {
    if (name.startsWith(prefix)) return false
  }
  return true
}

/**
 * Compare ML model class names against the abilities currently in the database.
 * Returns null if there are no gaps (perfect sync).
 *
 * @param classNames - Ability names from the ML model's class_names.json
 * @param dbAbilityNames - Ability names from the Windrun-scraped database
 * @param unpickableAbilities - Optional set of specific ability names to exclude
 *   (e.g. innate/shard-granted abilities that aren't pickable in AD)
 */
export function detectModelGaps(
  classNames: string[],
  dbAbilityNames: string[],
  unpickableAbilities?: Set<string>,
): MlModelGaps | null {
  const isRelevant = (name: string) =>
    isPickableAbility(name) && !unpickableAbilities?.has(name)

  const filteredClassNames = classNames.filter(isRelevant)
  const filteredDbNames = dbAbilityNames.filter(isRelevant)

  const classNameSet = new Set(filteredClassNames)
  const dbNameSet = new Set(filteredDbNames)

  const missingFromModel = filteredDbNames.filter((name) => !classNameSet.has(name)).sort()
  const staleInModel = filteredClassNames.filter((name) => !dbNameSet.has(name)).sort()

  if (missingFromModel.length === 0 && staleInModel.length === 0) {
    return null
  }

  return {
    missingFromModel,
    staleInModel,
    detectedAt: new Date().toISOString(),
  }
}
