// Pure transforms from dotaconstants JSON to the extension catalog. No I/O — importable by
// the build script and by the unit tests. Schema documented in
// twitch/frontend/src/data/catalog-types.ts (keep in sync).

/** Ability keys used by the app that differ from dotaconstants keys. Grows from the build report. */
export const CATALOG_NAME_OVERRIDES = {}

/** Windrun hero short names (hero_meta.json keys) whose flattened form is not the CDN name. */
export const WINDRUN_TO_CDN_OVERRIDES = {
  zeus: 'zuus',
  shadowfiend: 'nevermore',
  wraithking: 'skeleton_king',
  outworlddestroyer: 'obsidian_destroyer',
  outworlddevourer: 'obsidian_destroyer', // pre-rename name, still in our hero data
  io: 'wisp',
  necrophos: 'necrolyte',
  windranger: 'windrunner',
  treantprotector: 'treant',
  centaurwarrunner: 'centaur',
  lifestealer: 'life_stealer',
  magnus: 'magnataur',
  naturesprophet: 'furion',
  underlord: 'abyssal_underlord',
  timbersaw: 'shredder',
  clockwerk: 'rattletrap',
  doom: 'doom_bringer',
  vengefulspirit: 'vengefulspirit',
  queenofpain: 'queenofpain',
}

const NPC_PREFIX = 'npc_dota_hero_'

export function stripHtml(text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

function joinValues(value) {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map(String).join(' / ')
  return String(value)
}

function asArray(value) {
  if (value === undefined || value === null) return undefined
  return Array.isArray(value) ? value.map(String) : [String(value)]
}

/** Normalize a display name for matching (aghs skill names vs ability dnames). */
export function normalizeDisplayName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

export function cdnNameFromNpc(npcName) {
  return npcName.startsWith(NPC_PREFIX) ? npcName.slice(NPC_PREFIX.length) : npcName
}

/**
 * Resolve an app ability name (class_names.json entry) to a dotaconstants key:
 * exact -> strip `_ad` suffix -> overrides -> null.
 */
export function resolveAbilityKey(name, abilities, overrides = CATALOG_NAME_OVERRIDES) {
  if (abilities[name]) return name
  if (name.endsWith('_ad')) {
    const base = name.slice(0, -3)
    if (abilities[base]) return base
  }
  const override = overrides[name]
  if (override && abilities[override]) return override
  return null
}

export function buildAbilityEntry(raw, { includeLore = false } = {}) {
  const entry = {
    n: raw.dname ?? '',
    d: stripHtml(raw.desc ?? ''),
  }
  const behavior = asArray(raw.behavior)
  if (behavior) entry.b = behavior
  if (raw.dmg_type) entry.dt = String(raw.dmg_type)
  if (raw.bkbpierce !== undefined) entry.bkb = /^yes$/i.test(String(raw.bkbpierce))
  if (raw.dispellable) entry.disp = String(raw.dispellable)
  const targetTeam = asArray(raw.target_team)
  if (targetTeam) entry.tt = targetTeam
  const targetType = asArray(raw.target_type)
  if (targetType) entry.ty = targetType
  const cd = joinValues(raw.cd)
  if (cd) entry.cd = cd
  const mc = joinValues(raw.mc)
  if (mc) entry.mc = mc
  const dmg = joinValues(raw.dmg)
  if (dmg) entry.dmg = dmg
  if (Array.isArray(raw.attrib)) {
    const at = raw.attrib
      .filter((a) => a && !a.generated && a.header)
      .map((a) => [String(a.header).replace(/:\s*$/, ''), joinValues(a.value) ?? ''])
    if (at.length > 0) entry.at = at
  }
  if (includeLore && raw.lore) entry.lore = stripHtml(raw.lore)
  if (raw.is_innate) entry.innate = true
  return entry
}

function isTalent(name) {
  return name.startsWith('special_bonus')
}

function isHiddenFiller(name) {
  return name === 'generic_hidden' || name.endsWith('_empty') || name === ''
}

function humanizeTalent(name) {
  return name
    .replace(/^special_bonus_/, '')
    .replace(/^unique_/, '')
    .replace(/_/g, ' ')
}

/** dotaconstants leaves unresolved `{s:value}` template tokens in a few talent names. */
export function cleanTalentName(dname) {
  return String(dname)
    .replace(/\{s:[^}]*\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\+\s+/, '+')
    .trim()
}

/**
 * Build hero entries keyed by CDN name from hero_abilities.json + heroes.json, resolving
 * innates, draftable abilities and talent display names through abilities.json.
 */
export function buildHeroes(heroAbilities, heroes, abilities) {
  const heroByNpc = new Map(Object.values(heroes).map((h) => [h.name, h]))
  const out = {}
  const report = { missingHeroStats: [], talentsWithoutName: [] }

  for (const [npcName, kit] of Object.entries(heroAbilities)) {
    const cdn = cdnNameFromNpc(npcName)
    const hero = heroByNpc.get(npcName)
    if (!hero) {
      report.missingHeroStats.push(cdn)
      continue
    }
    const kitAbilities = Array.isArray(kit.abilities)
      ? kit.abilities.filter((name) => typeof name === 'string')
      : []
    let innate = null
    const draftable = []
    for (const name of kitAbilities) {
      if (isHiddenFiller(name) || isTalent(name)) continue
      const raw = abilities[name]
      if (!raw) continue
      if (raw.is_innate) {
        if (!innate) innate = name
        continue
      }
      if (!raw.dname) continue
      draftable.push(name)
    }

    const talents = (Array.isArray(kit.talents) ? kit.talents : [])
      .filter((t) => t && typeof t.name === 'string')
      .map((t) => {
        const raw = abilities[t.name]
        if (!raw?.dname) report.talentsWithoutName.push(t.name)
        return {
          l: Number(t.level),
          n: raw?.dname ? cleanTalentName(raw.dname) : humanizeTalent(t.name),
          name: t.name,
        }
      })
      .filter((t) => t.l >= 1 && t.l <= 4)

    out[cdn] = {
      id: Number(hero.id),
      n: hero.localized_name ?? cdn,
      attr: hero.primary_attr ?? 'all',
      atk: hero.attack_type ?? 'Melee',
      roles: Array.isArray(hero.roles) ? hero.roles : [],
      stats: {
        str: hero.base_str ?? 0,
        agi: hero.base_agi ?? 0,
        int: hero.base_int ?? 0,
        strG: hero.str_gain ?? 0,
        agiG: hero.agi_gain ?? 0,
        intG: hero.int_gain ?? 0,
        hp: hero.base_health ?? 0,
        mp: hero.base_mana ?? 0,
        hpR: hero.base_health_regen ?? 0,
        mpR: hero.base_mana_regen ?? 0,
        armor: hero.base_armor ?? 0,
        mr: hero.base_mr ?? 0,
        dmgMin: hero.base_attack_min ?? 0,
        dmgMax: hero.base_attack_max ?? 0,
        range: hero.attack_range ?? 0,
        proj: hero.projectile_speed ?? 0,
        bat: hero.base_attack_time ?? 0,
        atkRate: hero.attack_rate ?? 0,
        ms: hero.move_speed ?? 0,
        turn: hero.turn_rate ?? 0,
      },
      abilities: draftable,
      innate,
      talents,
      scepter: null,
      shard: null,
    }
  }
  return { heroes: out, report }
}

/**
 * Attach Scepter/Shard text to the matching ability (by display name within the hero's
 * kit + innate) and keep a hero-level copy. New-skill upgrades and unmatched names stay
 * hero-level only (skill = null).
 */
export function attachAghs(aghsRows, heroesOut, abilitiesOut, abilitiesRaw) {
  const report = { unmatched: [], attached: 0 }
  for (const row of aghsRows) {
    const cdn = cdnNameFromNpc(String(row.hero_name ?? ''))
    const hero = heroesOut[cdn]
    if (!hero) continue
    const kit = [...hero.abilities, ...(hero.innate ? [hero.innate] : [])]
    const byDisplay = new Map(
      kit.map((name) => [normalizeDisplayName(abilitiesRaw[name]?.dname ?? name), name]),
    )

    for (const [kind, key] of [
      ['scepter', 'sc'],
      ['shard', 'sh'],
    ]) {
      if (!row[`has_${kind}`]) continue
      const desc = stripHtml(row[`${kind}_desc`] ?? '')
      const newSkill = Boolean(row[`${kind}_new_skill`])
      const skillName = row[`${kind}_skill_name`]
      const matched = newSkill ? null : (byDisplay.get(normalizeDisplayName(skillName)) ?? null)
      hero[kind] = { d: desc, skill: matched, newSkill }
      if (matched) {
        if (!abilitiesOut[matched]) abilitiesOut[matched] = buildAbilityEntry(abilitiesRaw[matched])
        abilitiesOut[matched][key] = newSkill ? { d: desc, newSkill: true } : { d: desc }
        report.attached += 1
      } else if (!newSkill) {
        report.unmatched.push(`${cdn}:${kind}:${skillName}`)
      }
    }
  }
  return report
}

/** hero_meta.json keys (Windrun short names) -> CDN names. */
export function buildWindrunAliases(windrunNames, cdnNames, overrides = WINDRUN_TO_CDN_OVERRIDES) {
  const flatToCdn = new Map(cdnNames.map((cdn) => [cdn.replace(/_/g, ''), cdn]))
  const aliases = {}
  const unresolved = []
  for (const name of windrunNames) {
    const flat = name.replace(/_/g, '')
    const cdn = overrides[flat] ?? overrides[name] ?? flatToCdn.get(flat) ?? null
    if (cdn && cdnNames.includes(cdn)) aliases[name] = cdn
    else unresolved.push(name)
  }
  return { aliases, unresolved }
}

/**
 * Assemble the full catalog.
 * @param input.classNames app ability class names (resources/model/class_names.json)
 * @param input.windrunHeroNames hero_meta.json keys
 */
export function buildCatalog(input) {
  const {
    classNames,
    windrunHeroNames,
    abilities,
    heroAbilities,
    heroes,
    aghs,
    commit,
    builtAt,
    includeLore = false,
    allowedMissing = { abilities: {}, heroes: {} },
  } = input

  const abilitiesOut = {}
  const missingAbilities = []
  for (const name of classNames) {
    const key = resolveAbilityKey(name, abilities)
    if (!key) {
      if (!allowedMissing.abilities?.[name]) missingAbilities.push(name)
      continue
    }
    const entry = buildAbilityEntry(abilities[key], { includeLore })
    if (key !== name) entry.src = key
    abilitiesOut[name] = entry
  }

  const built = buildHeroes(heroAbilities, heroes, abilities)
  for (const hero of Object.values(built.heroes)) {
    if (hero.innate && !abilitiesOut[hero.innate]) {
      abilitiesOut[hero.innate] = buildAbilityEntry(abilities[hero.innate], { includeLore })
    }
    // The hero kit from dotaconstants includes sub-abilities (bane_nightmare_end,
    // rubick_hidden*) and base names of AD variants (invoker_sun_strike vs the app's
    // invoker_sun_strike_ad). Keep only what the app can draft, under the app's key.
    hero.abilities = hero.abilities
      .map((name) => (abilitiesOut[name] ? name : abilitiesOut[`${name}_ad`] ? `${name}_ad` : null))
      .filter((name) => name !== null)
  }
  const aghsReport = attachAghs(Array.isArray(aghs) ? aghs : [], built.heroes, abilitiesOut, abilities)
  const aliasResult = buildWindrunAliases(windrunHeroNames, Object.keys(built.heroes))
  const unresolvedAliases = aliasResult.unresolved.filter((n) => !allowedMissing.heroes?.[n])

  const catalog = {
    schema: 1,
    builtAt,
    source: { repo: 'odota/dotaconstants', commit },
    abilities: abilitiesOut,
    heroes: built.heroes,
    aliases: { windrunToCdn: aliasResult.aliases },
  }
  const report = {
    abilityCount: Object.keys(abilitiesOut).length,
    heroCount: Object.keys(built.heroes).length,
    missingAbilities,
    unresolvedAliases,
    aghs: aghsReport,
    missingHeroStats: built.report.missingHeroStats,
    talentsWithoutName: [...new Set(built.report.talentsWithoutName)],
  }
  return { catalog, report }
}

/** Demo slice: the given hero CDN names + their abilities/innates only. */
export function sliceCatalog(catalog, cdnNames) {
  const heroes = {}
  const abilities = {}
  for (const cdn of cdnNames) {
    const hero = catalog.heroes[cdn]
    if (!hero) continue
    heroes[cdn] = hero
    for (const name of [...hero.abilities, ...(hero.innate ? [hero.innate] : [])]) {
      if (catalog.abilities[name]) abilities[name] = catalog.abilities[name]
    }
  }
  const aliases = Object.fromEntries(
    Object.entries(catalog.aliases.windrunToCdn).filter(([, cdn]) => heroes[cdn]),
  )
  return { ...catalog, abilities, heroes, aliases: { windrunToCdn: aliases } }
}
