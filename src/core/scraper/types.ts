import type { MlModelGaps } from '@core/ml/staleness-detector'

// ── Windrun API response types ────────────────────────────────────────────────

export interface WindrunAbilityStat {
  abilityId: number
  numPicks: number
  avgPickPosition: number
  pickPosStdDev?: number
  wins: number
  ignored?: number
  ownerHero: number
  winrate: number
  pickRate: number
}

export interface WindrunAbilitiesResponse {
  data: {
    patches: { overall: string[] }
    abilityStats: WindrunAbilityStat[]
    abilityValuations?: Record<string, number>
  }
}

export interface WindrunHighSkillResponse {
  data: {
    allData: {
      patches: { overall: string[] }
      abilityStats: WindrunAbilityStat[]
      abilityValuations?: Record<string, number>
    }
    highSkillData: {
      patches: { overall: string[] }
      abilityStats: WindrunAbilityStat[]
      abilityValuations?: Record<string, number>
    }
  }
}

export interface WindrunHeroStats {
  winrate: number
  numPicks: number
}

export interface WindrunHeroesResponse {
  data: {
    patches: { overall: string[] }
    heroStats: Record<string, Record<string, WindrunHeroStats>>
  }
}

export interface WindrunPair {
  abilityIdOne: number
  abilityIdTwo: number
  numPicks: number
  wins?: number
  winrate: number
}

export interface WindrunPairsResponse {
  data: {
    patches?: { overall: string[] }
    abilityPairs?: WindrunPair[]
    abilityStats?: WindrunAbilityStat[]
  }
}

export interface WindrunTriplet {
  abilityIdOne: number
  abilityIdTwo: number
  abilityIdThree: number
  numPicks: number
  wins?: number
  winrate: number
}

export interface WindrunTripletsResponse {
  data: {
    patches?: { overall: string[] }
    abilityTriplets?: WindrunTriplet[]
  }
}

export interface WindrunStaticAbility {
  valveId: number
  englishName: string
  shortName: string
  ownerHeroId: number
  hasScepter: boolean
  hasShard: boolean
  isUltimate?: boolean
}

/** Static abilities response is an ARRAY, not a Record */
export interface WindrunStaticAbilitiesResponse {
  data: WindrunStaticAbility[]
}

export interface WindrunStaticHero {
  id: number
  englishName: string
  shortName: string
}

export interface WindrunStaticHeroesResponse {
  data: Record<string, WindrunStaticHero>
}

export interface WindrunPatchesResponse {
  data: string[]
}

// ── Transformer output types ─────────────────────────────────────────────────

export interface TransformedHero {
  name: string
  displayName: string
  winrate: number
  highSkillWinrate: number | null
  pickRate: number
  hsPickRate: number | null
  windrunId: number
}

export interface TransformedAbility {
  name: string
  displayName: string
  heroId: number | null
  heroName: string | null
  winrate: number
  highSkillWinrate: number | null
  pickRate: number
  hsPickRate: number | null
  isUltimate: boolean
}

export interface TransformedAbilitySynergy {
  ability1Name: string
  ability2Name: string
  synergyWinrate: number
  synergyIncrease: number
  numPicks: number
  isOp: boolean
}

export interface TransformedHeroAbilitySynergy {
  heroName: string
  abilityName: string
  synergyWinrate: number
  synergyIncrease: number
  numPicks: number
  isOp: boolean
}

export interface TransformedAbilityTriplet {
  ability1Name: string
  ability2Name: string
  ability3Name: string
  synergyWinrate: number
  synergyIncrease: number
  numPicks: number
  isOp: boolean
}

export interface TransformedHeroAbilityTriplet {
  heroName: string
  ability1Name: string
  ability2Name: string
  synergyWinrate: number
  synergyIncrease: number
  numPicks: number
  isOp: boolean
}

// ── Scraper progress ─────────────────────────────────────────────────────────

export interface ScraperProgress {
  phase: string
  message: string
  current?: number
  total?: number
}

// ── Orchestrator types ───────────────────────────────────────────────────────

export interface ScraperResult {
  success: boolean
  error?: string
  modelGaps?: MlModelGaps | null
}

export interface ScraperOptions {
  devMode?: boolean
  patch?: string
}
