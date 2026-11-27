//! Top-tier entity selector (max 10 highlights).
//!
//! Mirrors `src/core/domain/top-tier.ts`.

use std::collections::HashSet;

use crate::scoring::TOP_TIER_CAP;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityType {
    Ability,
    Hero,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScoredEntity {
    pub internal_name: String,
    pub entity_type: EntityType,
    pub consolidated_score: f64,
    pub is_ultimate_from_coord_source: bool,
    pub is_ultimate_from_db: bool,
    pub role_curated: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TopTierEntity {
    pub entity: ScoredEntity,
    pub is_synergy_suggestion_for_my_spot: bool,
    pub is_general_top_tier: bool,
    pub is_curated_for_role: bool,
}

pub fn determine_top_tier_entities(
    all_scored_entities: &[ScoredEntity],
    selected_model_id: Option<i64>,
    my_spot_has_ult: bool,
    synergistic_partners_in_pool: &HashSet<String>,
) -> Vec<TopTierEntity> {
    let mut entities_to_consider: Vec<ScoredEntity> = all_scored_entities.to_vec();
    let mut effective_synergies = synergistic_partners_in_pool.clone();

    if my_spot_has_ult {
        entities_to_consider.retain(|entity| {
            if entity.entity_type == EntityType::Ability {
                !entity.is_ultimate_from_coord_source && !entity.is_ultimate_from_db
            } else {
                true
            }
        });

        effective_synergies.retain(|partner_name| {
            all_scored_entities
                .iter()
                .find(|e| e.internal_name == *partner_name)
                .is_some_and(|e| !e.is_ultimate_from_coord_source && !e.is_ultimate_from_db)
        });
    }

    let mut final_top_tier: Vec<TopTierEntity> = Vec::with_capacity(TOP_TIER_CAP);

    // 1. Synergy suggestions
    let mut synergy_suggestions: Vec<TopTierEntity> = Vec::new();
    entities_to_consider.retain(|entity| {
        if entity.entity_type == EntityType::Ability
            && effective_synergies.contains(&entity.internal_name)
        {
            synergy_suggestions.push(TopTierEntity {
                entity: entity.clone(),
                is_synergy_suggestion_for_my_spot: true,
                is_general_top_tier: false,
                is_curated_for_role: false,
            });
            false
        } else {
            true
        }
    });
    synergy_suggestions.sort_by(|a, b| {
        b.entity
            .consolidated_score
            .total_cmp(&a.entity.consolidated_score)
    });
    final_top_tier.extend(synergy_suggestions.into_iter().take(TOP_TIER_CAP));

    // 2. Curated role must-picks
    let mut curated_suggestions: Vec<TopTierEntity> = Vec::new();
    entities_to_consider.retain(|entity| {
        if entity.role_curated
            && !(entity.entity_type == EntityType::Hero && selected_model_id.is_some())
        {
            curated_suggestions.push(TopTierEntity {
                entity: entity.clone(),
                is_synergy_suggestion_for_my_spot: false,
                is_general_top_tier: true,
                is_curated_for_role: true,
            });
            false
        } else {
            true
        }
    });
    curated_suggestions.sort_by(|a, b| {
        b.entity
            .consolidated_score
            .total_cmp(&a.entity.consolidated_score)
    });
    let remaining_after_synergy = TOP_TIER_CAP.saturating_sub(final_top_tier.len());
    final_top_tier.extend(curated_suggestions.into_iter().take(remaining_after_synergy));

    // 3. General top picks
    let remaining_slots = TOP_TIER_CAP.saturating_sub(final_top_tier.len());
    if remaining_slots > 0 {
        let mut general_candidates: Vec<ScoredEntity> = if selected_model_id.is_some() {
            entities_to_consider
                .into_iter()
                .filter(|e| e.entity_type == EntityType::Ability)
                .collect()
        } else {
            entities_to_consider
        };
        general_candidates.sort_by(|a, b| b.consolidated_score.total_cmp(&a.consolidated_score));
        final_top_tier.extend(general_candidates.into_iter().take(remaining_slots).map(
            |entity| TopTierEntity {
                entity,
                is_synergy_suggestion_for_my_spot: false,
                is_general_top_tier: true,
                is_curated_for_role: false,
            },
        ));
    }

    final_top_tier
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ability(name: &str, score: f64, ult: bool, curated: bool) -> ScoredEntity {
        ScoredEntity {
            internal_name: name.into(),
            entity_type: EntityType::Ability,
            consolidated_score: score,
            is_ultimate_from_coord_source: ult,
            is_ultimate_from_db: ult,
            role_curated: curated,
        }
    }

    #[test]
    fn enforces_priority_ult_exclusion_model_filter_and_cap_10() {
        let mut entities = vec![
            ability("synergy_std", 0.30, false, false),
            ability("synergy_ult", 0.99, true, false),
            ability("curated_low", 0.10, false, true),
            ScoredEntity {
                internal_name: "hero_curated".into(),
                entity_type: EntityType::Hero,
                consolidated_score: 0.95,
                is_ultimate_from_coord_source: false,
                is_ultimate_from_db: false,
                role_curated: true,
            },
            ability("pool_ult", 0.98, true, false),
        ];
        for i in 0..12 {
            entities.push(ability(&format!("std_{i}"), 0.5 + i as f64 * 0.02, false, false));
        }

        let synergies = HashSet::from(["synergy_std".to_string(), "synergy_ult".to_string()]);
        let top = determine_top_tier_entities(&entities, Some(1), true, &synergies);
        assert_eq!(top.len(), 10);
        assert_eq!(top[0].entity.internal_name, "synergy_std");
        assert!(top[0].is_synergy_suggestion_for_my_spot);
        assert_eq!(top[1].entity.internal_name, "curated_low");
        assert!(top[1].is_curated_for_role);
        assert!(top
            .iter()
            .all(|t| !t.entity.is_ultimate_from_db && t.entity.entity_type == EntityType::Ability));
    }
}
