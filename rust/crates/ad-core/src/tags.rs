//! 42-tag vocabulary (39 curated + 3 mechanical) and hero metadata loaders.
//!
//! Mirrors `src/core/domain/ability-tags.ts`.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
};

use serde::Deserialize;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AbilityTag {
    HardCc,
    SoftCc,
    SetupCc,
    Aoe,
    Nuke,
    Waveclear,
    FarmTool,
    Steroid,
    SustainSelf,
    SaveAlly,
    TeamAura,
    Mobility,
    Initiation,
    Summon,
    TeamfightUlt,
    PassiveValue,
    MeleeOnly,
    RangedOnly,
    GrantsRanged,
    GoodWithRearm,
    ManaHungry,
    Channeled,
    GoodShard,
    GoodAghanims,
    SkillPointSink,
    DebuffDispellable,
    DebuffStrongOnly,
    BkbPiercing,
    RepositionEnemy,
    RepositionAlly,
    Knockback,
    DispelSelf,
    DispelAlly,
    PurgeEnemy,
    SpellSteroid,
    AmpPhysical,
    AmpMagical,
    AmpAll,
    GoodDeny,
    PickAsap,
}

impl AbilityTag {
    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "hard_cc" => Some(Self::HardCc),
            "soft_cc" => Some(Self::SoftCc),
            "setup_cc" => Some(Self::SetupCc),
            "aoe" => Some(Self::Aoe),
            "nuke" => Some(Self::Nuke),
            "waveclear" => Some(Self::Waveclear),
            "farm_tool" => Some(Self::FarmTool),
            "steroid" => Some(Self::Steroid),
            "sustain_self" => Some(Self::SustainSelf),
            "save_ally" => Some(Self::SaveAlly),
            "team_aura" => Some(Self::TeamAura),
            "mobility" => Some(Self::Mobility),
            "initiation" => Some(Self::Initiation),
            "summon" => Some(Self::Summon),
            "teamfight_ult" => Some(Self::TeamfightUlt),
            "passive_value" => Some(Self::PassiveValue),
            "melee_only" => Some(Self::MeleeOnly),
            "ranged_only" => Some(Self::RangedOnly),
            "grants_ranged" => Some(Self::GrantsRanged),
            "good_with_rearm" => Some(Self::GoodWithRearm),
            "mana_hungry" => Some(Self::ManaHungry),
            "channeled" => Some(Self::Channeled),
            "good_shard" => Some(Self::GoodShard),
            "good_aghanims" => Some(Self::GoodAghanims),
            "skill_point_sink" => Some(Self::SkillPointSink),
            "debuff_dispellable" => Some(Self::DebuffDispellable),
            "debuff_strong_only" => Some(Self::DebuffStrongOnly),
            "bkb_piercing" => Some(Self::BkbPiercing),
            "reposition_enemy" => Some(Self::RepositionEnemy),
            "reposition_ally" => Some(Self::RepositionAlly),
            "knockback" => Some(Self::Knockback),
            "dispel_self" => Some(Self::DispelSelf),
            "dispel_ally" => Some(Self::DispelAlly),
            "purge_enemy" => Some(Self::PurgeEnemy),
            "spell_steroid" => Some(Self::SpellSteroid),
            "amp_physical" => Some(Self::AmpPhysical),
            "amp_magical" => Some(Self::AmpMagical),
            "amp_all" => Some(Self::AmpAll),
            "good_deny" => Some(Self::GoodDeny),
            "pick_asap" => Some(Self::PickAsap),
            _ => None,
        }
    }

    pub fn is_mechanical(self) -> bool {
        matches!(
            self,
            Self::DebuffDispellable | Self::DebuffStrongOnly | Self::BkbPiercing
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HeroTag {
    RcTalents,
    CasterTalents,
    TankTalents,
    UtilityTalents,
    InnateOffense,
    InnateTank,
    InnateTeam,
}

impl HeroTag {
    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "rc_talents" => Some(Self::RcTalents),
            "caster_talents" => Some(Self::CasterTalents),
            "tank_talents" => Some(Self::TankTalents),
            "utility_talents" => Some(Self::UtilityTalents),
            "innate_offense" => Some(Self::InnateOffense),
            "innate_tank" => Some(Self::InnateTank),
            "innate_team" => Some(Self::InnateTeam),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpgradeKind {
    Shard,
    Scepter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeroAttackType {
    Melee,
    Ranged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeroPrimaryAttr {
    Str,
    Agi,
    Int,
    All,
}

#[derive(Debug, Clone, Default)]
pub struct AbilityTagEntry {
    pub tags: HashSet<AbilityTag>,
    pub role_must: HashSet<u8>,
    pub role_avoid: HashSet<u8>,
    pub requires: Vec<String>,
    pub combos: Vec<String>,
    pub via_upgrade: HashMap<AbilityTag, UpgradeKind>,
    pub with: HashMap<AbilityTag, Vec<String>>,
}

#[derive(Debug, Clone, Default)]
pub struct HeroMeta {
    pub attack_type: Option<HeroAttackType>,
    pub primary_attr: Option<HeroPrimaryAttr>,
    pub base_str: Option<f64>,
    pub base_agi: Option<f64>,
    pub base_int: Option<f64>,
    pub str_gain: Option<f64>,
    pub agi_gain: Option<f64>,
    pub int_gain: Option<f64>,
    pub attack_range: Option<f64>,
    pub attack_rate: Option<f64>,
    pub projectile_speed: Option<f64>,
    pub move_speed: Option<f64>,
    pub base_armor: Option<f64>,
    pub base_health: Option<f64>,
    pub tags: HashSet<HeroTag>,
    pub role_must: HashSet<u8>,
    pub role_avoid: HashSet<u8>,
}

#[derive(Debug, Clone, Default)]
pub struct TagsDataset {
    pub abilities: HashMap<String, AbilityTagEntry>,
    pub heroes: HashMap<String, HeroMeta>,
    pub dropped_tags: Vec<String>,
}

#[derive(Debug, Error)]
pub enum TagsError {
    #[error("io error reading tags dataset: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error parsing tags dataset: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Deserialize)]
struct RawAbilityTagsFile {
    abilities: HashMap<String, RawAbilityEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAbilityEntry {
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    role_must: Vec<u8>,
    #[serde(default)]
    role_avoid: Vec<u8>,
    #[serde(default)]
    requires: Vec<String>,
    #[serde(default)]
    combos: Vec<String>,
    #[serde(default)]
    via_upgrade: HashMap<String, String>,
    #[serde(default)]
    with: HashMap<String, Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawHeroMetaEntry {
    attack_type: Option<String>,
    primary_attr: Option<String>,
    base_str: Option<f64>,
    base_agi: Option<f64>,
    base_int: Option<f64>,
    str_gain: Option<f64>,
    agi_gain: Option<f64>,
    int_gain: Option<f64>,
    attack_range: Option<f64>,
    attack_rate: Option<f64>,
    projectile_speed: Option<f64>,
    move_speed: Option<f64>,
    base_armor: Option<f64>,
    base_health: Option<f64>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    role_must: Vec<u8>,
    #[serde(default)]
    role_avoid: Vec<u8>,
}

impl TagsDataset {
    pub fn load(ability_tags_path: &Path, hero_meta_path: &Path) -> Result<Self, TagsError> {
        let raw_abilities: RawAbilityTagsFile =
            serde_json::from_str(&fs::read_to_string(ability_tags_path)?)?;
        let raw_heroes: HashMap<String, RawHeroMetaEntry> =
            serde_json::from_str(&fs::read_to_string(hero_meta_path)?)?;

        let mut abilities = HashMap::with_capacity(raw_abilities.abilities.len());
        let mut dropped = HashSet::new();

        for (name, raw) in raw_abilities.abilities {
            let mut tags = HashSet::new();
            for t in raw.tags {
                if let Some(parsed) = AbilityTag::from_str_opt(&t) {
                    tags.insert(parsed);
                } else {
                    dropped.insert(t);
                }
            }
            let role_must = raw
                .role_must
                .into_iter()
                .filter(|&p| (1..=5).contains(&p))
                .collect();
            let role_avoid = raw
                .role_avoid
                .into_iter()
                .filter(|&p| (1..=5).contains(&p))
                .collect();

            let mut via_upgrade = HashMap::new();
            for (tag_str, kind_str) in raw.via_upgrade {
                if let Some(tag) = AbilityTag::from_str_opt(&tag_str) {
                    if tags.contains(&tag) {
                        match kind_str.as_str() {
                            "shard" => {
                                via_upgrade.insert(tag, UpgradeKind::Shard);
                            }
                            "scepter" => {
                                via_upgrade.insert(tag, UpgradeKind::Scepter);
                            }
                            _ => {}
                        }
                    }
                }
            }

            let mut with = HashMap::new();
            for (tag_str, deps) in raw.with {
                if let Some(tag) = AbilityTag::from_str_opt(&tag_str) {
                    if tags.contains(&tag) && !deps.is_empty() {
                        with.insert(tag, deps);
                    }
                }
            }

            abilities.insert(
                name,
                AbilityTagEntry {
                    tags,
                    role_must,
                    role_avoid,
                    requires: raw.requires,
                    combos: raw.combos,
                    via_upgrade,
                    with,
                },
            );
        }

        let mut heroes = HashMap::with_capacity(raw_heroes.len());
        for (name, raw) in raw_heroes {
            let attack_type = match raw.attack_type.as_deref() {
                Some("Melee") => Some(HeroAttackType::Melee),
                Some("Ranged") => Some(HeroAttackType::Ranged),
                _ => None,
            };
            let primary_attr = match raw.primary_attr.as_deref() {
                Some("str") => Some(HeroPrimaryAttr::Str),
                Some("agi") => Some(HeroPrimaryAttr::Agi),
                Some("int") => Some(HeroPrimaryAttr::Int),
                Some("all") => Some(HeroPrimaryAttr::All),
                _ => None,
            };
            let tags = raw
                .tags
                .iter()
                .filter_map(|t| HeroTag::from_str_opt(t))
                .collect();
            let role_must = raw
                .role_must
                .into_iter()
                .filter(|&p| (1..=5).contains(&p))
                .collect();
            let role_avoid = raw
                .role_avoid
                .into_iter()
                .filter(|&p| (1..=5).contains(&p))
                .collect();

            heroes.insert(
                name,
                HeroMeta {
                    attack_type,
                    primary_attr,
                    base_str: raw.base_str,
                    base_agi: raw.base_agi,
                    base_int: raw.base_int,
                    str_gain: raw.str_gain,
                    agi_gain: raw.agi_gain,
                    int_gain: raw.int_gain,
                    attack_range: raw.attack_range,
                    attack_rate: raw.attack_rate,
                    projectile_speed: raw.projectile_speed,
                    move_speed: raw.move_speed,
                    base_armor: raw.base_armor,
                    base_health: raw.base_health,
                    tags,
                    role_must,
                    role_avoid,
                },
            );
        }

        let mut dropped_tags: Vec<String> = dropped.into_iter().collect();
        dropped_tags.sort();

        Ok(Self {
            abilities,
            heroes,
            dropped_tags,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn loads_real_ability_tags_and_hero_meta_with_zero_dropped_tags() {
        let data_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../resources/data");
        let dataset = TagsDataset::load(
            &data_dir.join("ability_tags.json"),
            &data_dir.join("hero_meta.json"),
        )
        .expect("load tags dataset");

        assert!(
            dataset.dropped_tags.is_empty(),
            "unexpected dropped tags: {:?}",
            dataset.dropped_tags
        );
        assert!(dataset.abilities.len() >= 500);
        assert_eq!(dataset.heroes.len(), 127);

        let shield = &dataset.abilities["abaddon_aphotic_shield"];
        assert!(shield.tags.contains(&AbilityTag::Aoe));
        assert!(AbilityTag::BkbPiercing.is_mechanical());

        let abaddon = &dataset.heroes["abaddon"];
        assert_eq!(abaddon.attack_type, Some(HeroAttackType::Melee));
        assert_eq!(abaddon.primary_attr, Some(HeroPrimaryAttr::All));
    }
}
