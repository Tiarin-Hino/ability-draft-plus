//! Role-aware scoring layer and build-needs engine.
//!
//! Mirrors `src/core/domain/role-scoring.ts` and `src/shared/constants/thresholds.ts`.
//! When `RoleContext` is `None` or has empty `effective_positions`, `compute_role_score`
//! returns `None` so role-off scoring stays bit-identical to the global-only path.

use std::collections::{HashMap, HashSet};

use crate::{shift_axes::ShiftAxes, tags::AbilityTag};

pub const ROLE_GREED_WEIGHT: f64 = 0.16;
pub const ROLE_GREED_TAPER: [f64; 4] = [1.0, 0.85, 0.6, 0.4];
pub const ROLE_SHIFT_ACCENT_WEIGHT: f64 = 0.03;
pub const ROLE_TEAM_BALANCE_WEIGHT: f64 = 0.05;
pub const ROLE_ADJUSTMENT_CAP: f64 = 0.25;
pub const ROLE_CURATED_WEIGHT: f64 = 0.15;
pub const ROLE_ENABLING_ACCENT_FLOOR: f64 = 0.7;
pub const ROLE_NEED_WEIGHT: f64 = 0.08;
pub const ROLE_DUPLICATE_WEIGHT: f64 = 0.06;
pub const ROLE_TAG_ACCENT_WEIGHT: f64 = 0.05;
pub const MANA_HUNGRY_LIMIT: usize = 2;
pub const MANA_BUDGET_WEIGHT: f64 = 0.05;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShiftAccent {
    Killtaking,
    Playmaking,
    Enabling,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PositionTemplate {
    pub greed_target: f64,
    pub accent: Option<ShiftAccent>,
}

pub fn position_template(pos: u8) -> Option<PositionTemplate> {
    match pos {
        1 => Some(PositionTemplate {
            greed_target: 0.7,
            accent: None,
        }),
        2 => Some(PositionTemplate {
            greed_target: 0.4,
            accent: Some(ShiftAccent::Killtaking),
        }),
        3 => Some(PositionTemplate {
            greed_target: 0.1,
            accent: None,
        }),
        4 => Some(PositionTemplate {
            greed_target: -0.35,
            accent: Some(ShiftAccent::Playmaking),
        }),
        5 => Some(PositionTemplate {
            greed_target: -0.6,
            accent: Some(ShiftAccent::Enabling),
        }),
        _ => None,
    }
}

pub struct RoleNeed {
    pub key: &'static str,
    pub any_of: &'static [&'static [AbilityTag]],
    pub priority: f64,
}

pub fn position_needs(pos: u8) -> &'static [RoleNeed] {
    use AbilityTag::*;
    const POS1: &[RoleNeed] = &[
        RoleNeed { key: "steroid", any_of: &[&[Steroid]], priority: 1.0 },
        RoleNeed { key: "farm", any_of: &[&[FarmTool], &[Waveclear]], priority: 0.75 },
        RoleNeed {
            key: "survival",
            any_of: &[&[Mobility], &[SustainSelf], &[DispelSelf]],
            priority: 0.7,
        },
    ];
    const POS2: &[RoleNeed] = &[
        RoleNeed { key: "nuke", any_of: &[&[Nuke]], priority: 1.0 },
        RoleNeed { key: "kill_ult", any_of: &[&[TeamfightUlt], &[HardCc]], priority: 0.75 },
        RoleNeed { key: "mobility", any_of: &[&[Mobility]], priority: 0.5 },
    ];
    const POS3: &[RoleNeed] = &[
        RoleNeed { key: "aoe_cc", any_of: &[&[HardCc, Aoe]], priority: 0.75 },
        RoleNeed {
            key: "initiation",
            any_of: &[&[Initiation], &[RepositionEnemy]],
            priority: 0.6,
        },
        RoleNeed {
            key: "durability",
            any_of: &[&[SustainSelf], &[PassiveValue], &[DispelSelf]],
            priority: 0.4,
        },
    ];
    const POS4: &[RoleNeed] = &[
        RoleNeed { key: "hard_cc", any_of: &[&[HardCc]], priority: 1.0 },
        RoleNeed { key: "waveclear", any_of: &[&[Waveclear], &[Nuke]], priority: 0.75 },
        RoleNeed { key: "mobility", any_of: &[&[Mobility]], priority: 0.5 },
        RoleNeed { key: "catch", any_of: &[&[RepositionEnemy]], priority: 0.5 },
    ];
    const POS5: &[RoleNeed] = &[
        RoleNeed { key: "hard_cc", any_of: &[&[HardCc]], priority: 1.0 },
        RoleNeed { key: "waveclear", any_of: &[&[Waveclear], &[Nuke]], priority: 0.75 },
        RoleNeed {
            key: "save",
            any_of: &[&[SaveAlly], &[RepositionAlly], &[DispelAlly]],
            priority: 0.5,
        },
    ];
    match pos {
        1 => POS1,
        2 => POS2,
        3 => POS3,
        4 => POS4,
        5 => POS5,
        _ => &[],
    }
}

fn position_tag_accents(pos: u8) -> (&'static [AbilityTag], &'static [AbilityTag]) {
    use AbilityTag::*;
    match pos {
        1 => (&[PassiveValue, SustainSelf], &[SaveAlly]),
        2 => (&[Waveclear, SustainSelf, SpellSteroid], &[PassiveValue]),
        3 => (&[TeamAura, TeamfightUlt], &[]),
        4 => (
            &[
                SetupCc,
                Initiation,
                RepositionAlly,
                DispelAlly,
                AmpPhysical,
                AmpMagical,
                AmpAll,
            ],
            &[Steroid, FarmTool],
        ),
        5 => (
            &[
                TeamAura,
                RepositionAlly,
                DispelAlly,
                AmpPhysical,
                AmpMagical,
                AmpAll,
            ],
            &[Steroid, FarmTool],
        ),
        _ => (&[], &[]),
    }
}

#[derive(Debug, Clone)]
pub struct RoleContext {
    pub effective_positions: Vec<u8>,
    pub my_pick_count: usize,
    pub team_greed: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct RoleTagInput<'a> {
    pub candidate_tags: Option<&'a HashSet<AbilityTag>>,
    pub candidate_role_must: Option<&'a HashSet<u8>>,
    pub my_pick_tags: &'a [HashSet<AbilityTag>],
    pub need_scarcity: Option<&'a HashMap<String, f64>>,
    pub pool_has_hard_cc: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RoleScore {
    pub delta: f64,
    pub best_position: u8,
    pub reasons: Vec<String>,
    pub curated: bool,
}

fn tag_credit(tags: &HashSet<AbilityTag>, required: AbilityTag) -> f64 {
    if tags.contains(&required) {
        return 1.0;
    }
    if required == AbilityTag::HardCc && tags.contains(&AbilityTag::SoftCc) {
        return 0.5;
    }
    0.0
}

fn need_credit(tags: &HashSet<AbilityTag>, need: &RoleNeed) -> f64 {
    let mut best = 0.0f64;
    for req in need.any_of {
        let mut credit = 1.0f64;
        for &tag in *req {
            credit = credit.min(tag_credit(tags, tag));
        }
        best = best.max(credit);
    }
    best
}

fn tag_snake_name(tag: AbilityTag) -> &'static str {
    match tag {
        AbilityTag::HardCc => "hard_cc",
        AbilityTag::SoftCc => "soft_cc",
        AbilityTag::SetupCc => "setup_cc",
        AbilityTag::Aoe => "aoe",
        AbilityTag::Nuke => "nuke",
        AbilityTag::Waveclear => "waveclear",
        AbilityTag::FarmTool => "farm_tool",
        AbilityTag::Steroid => "steroid",
        AbilityTag::SustainSelf => "sustain_self",
        AbilityTag::SaveAlly => "save_ally",
        AbilityTag::TeamAura => "team_aura",
        AbilityTag::Mobility => "mobility",
        AbilityTag::Initiation => "initiation",
        AbilityTag::Summon => "summon",
        AbilityTag::TeamfightUlt => "teamfight_ult",
        AbilityTag::PassiveValue => "passive_value",
        AbilityTag::MeleeOnly => "melee_only",
        AbilityTag::RangedOnly => "ranged_only",
        AbilityTag::GrantsRanged => "grants_ranged",
        AbilityTag::GoodWithRearm => "good_with_rearm",
        AbilityTag::ManaHungry => "mana_hungry",
        AbilityTag::Channeled => "channeled",
        AbilityTag::GoodShard => "good_shard",
        AbilityTag::GoodAghanims => "good_aghanims",
        AbilityTag::SkillPointSink => "skill_point_sink",
        AbilityTag::DebuffDispellable => "debuff_dispellable",
        AbilityTag::DebuffStrongOnly => "debuff_strong_only",
        AbilityTag::BkbPiercing => "bkb_piercing",
        AbilityTag::RepositionEnemy => "reposition_enemy",
        AbilityTag::RepositionAlly => "reposition_ally",
        AbilityTag::Knockback => "knockback",
        AbilityTag::DispelSelf => "dispel_self",
        AbilityTag::DispelAlly => "dispel_ally",
        AbilityTag::PurgeEnemy => "purge_enemy",
        AbilityTag::SpellSteroid => "spell_steroid",
        AbilityTag::AmpPhysical => "amp_physical",
        AbilityTag::AmpMagical => "amp_magical",
        AbilityTag::AmpAll => "amp_all",
        AbilityTag::GoodDeny => "good_deny",
        AbilityTag::PickAsap => "pick_asap",
    }
}

fn need_credit_with_via(
    tags: &HashSet<AbilityTag>,
    need: &RoleNeed,
    pool_has_hard_cc: bool,
) -> (f64, Option<&'static str>) {
    let mut best = 0.0f64;
    let mut best_req: Option<&[AbilityTag]> = None;

    for req in need.any_of {
        let mut credit = 1.0f64;
        for &tag in *req {
            let mut c = tag_credit(tags, tag);
            if c == 0.5 && pool_has_hard_cc {
                c = 0.0;
            }
            credit = credit.min(c);
        }
        if credit > best {
            best = credit;
            best_req = Some(*req);
        }
    }

    let via = match best_req {
        Some([single]) if tag_snake_name(*single) != need.key => Some(tag_snake_name(*single)),
        _ => None,
    };
    (best, via)
}

fn needs_adjustment(pos: u8, tag_input: &RoleTagInput<'_>) -> (f64, Vec<String>) {
    let Some(candidate) = tag_input.candidate_tags else {
        return (0.0, Vec::new());
    };

    let mut adj = 0.0;
    let mut reasons = Vec::new();
    let mut duplicate_key: Option<&'static str> = None;

    for need in position_needs(pos) {
        let (cand_credit, via) =
            need_credit_with_via(candidate, need, tag_input.pool_has_hard_cc);
        if cand_credit == 0.0 {
            continue;
        }
        let coverage: f64 = tag_input
            .my_pick_tags
            .iter()
            .map(|t| need_credit(t, need))
            .sum();
        if coverage < 1.0 {
            let scarcity = tag_input
                .need_scarcity
                .and_then(|m| m.get(need.key).copied())
                .unwrap_or(1.0);
            adj += ROLE_NEED_WEIGHT * need.priority * scarcity * cand_credit;
            if cand_credit < 1.0 {
                reasons.push(format!("partial:{}", need.key));
            } else if let Some(via_tag) = via {
                reasons.push(format!("covers:{}:{via_tag}", need.key));
            } else {
                reasons.push(format!("covers:{}", need.key));
            }
        } else if coverage >= 2.0 && duplicate_key.is_none() {
            duplicate_key = Some(need.key);
        }
    }

    if reasons.is_empty() {
        if let Some(dup) = duplicate_key {
            adj -= ROLE_DUPLICATE_WEIGHT;
            reasons.push(format!("duplicate:{dup}"));
        }
    }

    if candidate.contains(&AbilityTag::ManaHungry)
        && tag_input
            .my_pick_tags
            .iter()
            .filter(|t| t.contains(&AbilityTag::ManaHungry))
            .count()
            >= MANA_HUNGRY_LIMIT
    {
        adj -= MANA_BUDGET_WEIGHT;
        reasons.push("duplicate:mana_budget".to_string());
    }

    (adj, reasons)
}

fn tag_accent_adjustment(pos: u8, candidate: Option<&HashSet<AbilityTag>>) -> f64 {
    let Some(tags) = candidate else {
        return 0.0;
    };
    let (plus, minus) = position_tag_accents(pos);
    let mut adj = 0.0;
    for tag in plus {
        if tags.contains(tag) {
            adj += ROLE_TAG_ACCENT_WEIGHT;
        }
    }
    for tag in minus {
        if tags.contains(tag) {
            adj -= ROLE_TAG_ACCENT_WEIGHT;
        }
    }
    adj
}

pub fn compute_role_score(
    axes: Option<&ShiftAxes>,
    context: Option<&RoleContext>,
    tag_input: Option<&RoleTagInput<'_>>,
) -> Option<RoleScore> {
    let ctx = context?;
    if ctx.effective_positions.is_empty() {
        return None;
    }

    let greed = axes.map(|a| a.greed).unwrap_or(0.0);
    let taper = ROLE_GREED_TAPER[ctx.my_pick_count.min(ROLE_GREED_TAPER.len() - 1)];

    let mut best = f64::NEG_INFINITY;
    let mut best_pos = ctx.effective_positions[0];
    let mut best_reasons = Vec::new();

    for &pos in &ctx.effective_positions {
        let Some(template) = position_template(pos) else {
            continue;
        };
        let fit = 1.0 - (greed - template.greed_target).abs();
        let accent_val = match (template.accent, axes) {
            (Some(ShiftAccent::Killtaking), Some(a)) => a.killtaking,
            (Some(ShiftAccent::Playmaking), Some(a)) => a.playmaking,
            (Some(ShiftAccent::Enabling), Some(a))
                if a.enabling >= ROLE_ENABLING_ACCENT_FLOOR =>
            {
                a.enabling
            }
            _ => 0.0,
        };

        let (needs_adj, needs_reasons) = tag_input
            .map(|ti| needs_adjustment(pos, ti))
            .unwrap_or((0.0, Vec::new()));
        let accent_adj = tag_input
            .map(|ti| tag_accent_adjustment(pos, ti.candidate_tags))
            .unwrap_or(0.0);
        let curated_here = tag_input
            .and_then(|ti| ti.candidate_role_must)
            .is_some_and(|must| must.contains(&pos));

        let score = ROLE_GREED_WEIGHT * taper * fit
            + ROLE_SHIFT_ACCENT_WEIGHT * accent_val
            + needs_adj
            + accent_adj
            + if curated_here { ROLE_CURATED_WEIGHT } else { 0.0 };

        if score > best {
            best = score;
            best_pos = pos;
            best_reasons = if curated_here {
                let mut r = vec!["curated".to_string()];
                r.extend(needs_reasons);
                r
            } else {
                needs_reasons
            };
        }
    }

    if !best.is_finite() {
        return None;
    }

    let curated = tag_input
        .and_then(|ti| ti.candidate_role_must)
        .is_some_and(|must| ctx.effective_positions.iter().any(|p| must.contains(p)));

    let team_adj = ctx
        .team_greed
        .map(|tg| -ROLE_TEAM_BALANCE_WEIGHT * tg * greed)
        .unwrap_or(0.0);

    let delta = (best + team_adj).clamp(-ROLE_ADJUSTMENT_CAP, ROLE_ADJUSTMENT_CAP);
    Some(RoleScore {
        delta,
        best_position: best_pos,
        reasons: best_reasons,
        curated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_when_role_context_is_absent_or_empty() {
        let axes = ShiftAxes {
            greed: 0.7,
            ..Default::default()
        };
        assert!(compute_role_score(Some(&axes), None, None).is_none());
        let empty = RoleContext {
            effective_positions: vec![],
            my_pick_count: 0,
            team_greed: None,
        };
        assert!(compute_role_score(Some(&axes), Some(&empty), None).is_none());
    }

    #[test]
    fn scores_greed_unmet_need_with_via_and_suppresses_soft_cc_when_pool_has_stun() {
        let ctx = RoleContext {
            effective_positions: vec![5],
            my_pick_count: 0,
            team_greed: None,
        };
        let axes = ShiftAxes {
            greed: -0.6,
            ..Default::default()
        };

        // Nuke covering pos-5 waveclear via alternative tag
        let cand_tags = HashSet::from([AbilityTag::Nuke]);
        let ti = RoleTagInput {
            candidate_tags: Some(&cand_tags),
            candidate_role_must: None,
            my_pick_tags: &[],
            need_scarcity: None,
            pool_has_hard_cc: true,
        };
        let score = compute_role_score(Some(&axes), Some(&ctx), Some(&ti)).unwrap();
        assert_eq!(score.best_position, 5);
        assert!(score.reasons.contains(&"covers:waveclear:nuke".to_string()));

        // Soft CC suppressed when pool still holds a hard_cc
        let slow_tags = HashSet::from([AbilityTag::SoftCc]);
        let slow_with_pool_stun = RoleTagInput {
            candidate_tags: Some(&slow_tags),
            candidate_role_must: None,
            my_pick_tags: &[],
            need_scarcity: None,
            pool_has_hard_cc: true,
        };
        let s1 = compute_role_score(Some(&axes), Some(&ctx), Some(&slow_with_pool_stun)).unwrap();
        assert!(s1.reasons.is_empty());

        let slow_no_pool_stun = RoleTagInput {
            pool_has_hard_cc: false,
            ..slow_with_pool_stun
        };
        let s2 = compute_role_score(Some(&axes), Some(&ctx), Some(&slow_no_pool_stun)).unwrap();
        assert!(s2.reasons.contains(&"partial:hard_cc".to_string()));
    }
}
