import type {
  WindrunAbilitiesResponse,
  WindrunHighSkillResponse,
  WindrunHeroesResponse,
  WindrunPairsResponse,
  WindrunTripletsResponse,
  WindrunStaticAbilitiesResponse,
  WindrunStaticHeroesResponse,
  WindrunPatchesResponse,
} from './types'

// @DEV-GUIDE: REST API client for Windrun.io (api.windrun.io/api/v2/).
// Endpoints: /static/abilities (array, NOT record -- build Map via valveId),
// /static/heroes (Record keyed by numeric string), /abilities, /ability-high-skill,
// /heroes, /ability-pairs, /ability-triplets, /static/patches.
// Negative abilityId in API responses = hero (e.g., -35 = hero 35).
// Response fields: valveId (not id), englishName (not name).
// abilityPairs/abilityTriplets fields may be omitted -- always use ?? [] fallbacks.
//
// CLIENT TAG: an optional per-client identifier the provider asks us to send with
// every request (CLIENT_TAG_PARAM). It is configuration, not code: the main process
// supplies it (main/services/api-config.ts) and it is never stored in this repo.
// Absent = requests go out without it, never an error.

const DEFAULT_BASE_URL = 'https://api.windrun.io/api/v2'
const TIMEOUT_MS = 30_000
/** Query param carrying the client tag (the value itself is NOT stored here). */
const CLIENT_TAG_PARAM = 'idf'

export interface WindrunApiClient {
  fetchStaticAbilities(): Promise<WindrunStaticAbilitiesResponse>
  fetchStaticHeroes(): Promise<WindrunStaticHeroesResponse>
  fetchPatches(): Promise<WindrunPatchesResponse>
  fetchAbilities(patch?: string): Promise<WindrunAbilitiesResponse>
  fetchAbilityHighSkill(patch?: string): Promise<WindrunHighSkillResponse>
  fetchHeroes(patch?: string): Promise<WindrunHeroesResponse>
  fetchAbilityPairs(patch?: string): Promise<WindrunPairsResponse>
  fetchAbilityTriplets(patch?: string): Promise<WindrunTripletsResponse>
}

export function createWindrunApiClient(
  baseUrl = DEFAULT_BASE_URL,
  clientTag?: string,
): WindrunApiClient {
  async function fetchJson<T>(path: string, patch?: string): Promise<T> {
    const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/')
    if (patch) url.searchParams.set('patch', patch)
    if (clientTag) url.searchParams.set(CLIENT_TAG_PARAM, clientTag)
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      // Never interpolate url here -- it carries the client tag
      throw new Error(`Windrun API error: ${response.status} ${response.statusText} for ${path}`)
    }
    return response.json() as Promise<T>
  }

  return {
    fetchStaticAbilities: () => fetchJson<WindrunStaticAbilitiesResponse>('static/abilities'),
    fetchStaticHeroes: () => fetchJson<WindrunStaticHeroesResponse>('static/heroes'),
    fetchPatches: () => fetchJson<WindrunPatchesResponse>('static/patches'),
    fetchAbilities: (patch?) => fetchJson<WindrunAbilitiesResponse>('abilities', patch),
    fetchAbilityHighSkill: (patch?) => fetchJson<WindrunHighSkillResponse>('ability-high-skill', patch),
    fetchHeroes: (patch?) => fetchJson<WindrunHeroesResponse>('heroes', patch),
    fetchAbilityPairs: (patch?) => fetchJson<WindrunPairsResponse>('ability-pairs', patch),
    fetchAbilityTriplets: (patch?) => fetchJson<WindrunTripletsResponse>('ability-triplets', patch),
  }
}
