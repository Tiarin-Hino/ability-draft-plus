// Mirrors the output of twitch/catalog/transform.mjs (keep in sync).

export interface CatalogAbility {
  /** Display name. */
  n: string
  /** Description, plain text. */
  d: string
  /** Behaviour chips (e.g. "Unit Target", "Passive"). */
  b?: string[]
  /** Damage type. */
  dt?: string
  /** Pierces spell immunity. */
  bkb?: boolean
  disp?: string
  /** Target team / target type. */
  tt?: string[]
  ty?: string[]
  cd?: string
  mc?: string
  dmg?: string
  /** [header, value] rows. */
  at?: [string, string][]
  lore?: string
  innate?: true
  /** Scepter / Shard upgrade attached to THIS ability. */
  sc?: { d: string; newSkill?: boolean }
  sh?: { d: string; newSkill?: boolean }
  /** dotaconstants key when it differs from the catalog key. */
  src?: string
}

export interface CatalogHeroStats {
  str: number
  agi: number
  int: number
  strG: number
  agiG: number
  intG: number
  hp: number
  mp: number
  hpR: number
  mpR: number
  armor: number
  mr: number
  dmgMin: number
  dmgMax: number
  range: number
  proj: number
  bat: number
  atkRate: number
  ms: number
  turn: number
}

export interface CatalogAghsUpgrade {
  d: string
  /** Internal name of the upgraded ability; null for new-skill upgrades. */
  skill: string | null
  newSkill: boolean
}

export interface CatalogHero {
  id: number
  n: string
  attr: 'str' | 'agi' | 'int' | 'all' | string
  atk: string
  roles: string[]
  stats: CatalogHeroStats
  /** Draftable abilities under the app's keys. */
  abilities: string[]
  innate: string | null
  talents: Array<{ l: 1 | 2 | 3 | 4; n: string; name: string }>
  scepter: CatalogAghsUpgrade | null
  shard: CatalogAghsUpgrade | null
}

export interface Catalog {
  schema: 1
  builtAt: string
  source: { repo: string; commit: string }
  abilities: Record<string, CatalogAbility>
  heroes: Record<string, CatalogHero>
  aliases: { windrunToCdn: Record<string, string> }
}

export interface CatalogManifest {
  schema: 1
  hash: string
  url: string
  builtAt: string
  commit: string
  bytes?: number
}
