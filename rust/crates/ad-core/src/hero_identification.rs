//! Identifies pool hero models from their `ability_order == 2` defining ability.
//!
//! Mirrors `src/core/domain/hero-identification.ts`.

use std::collections::HashMap;

use crate::layout::SlotCoordinate;

pub const UNKNOWN_MODEL_PREFIX: &str = "unknown_model_";

pub fn is_unidentified_model(hero_name: Option<&str>) -> bool {
    match hero_name {
        None => true,
        Some(name) => name.starts_with(UNKNOWN_MODEL_PREFIX),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HeroRecord {
    pub hero_id: i64,
    pub name: String,
    pub display_name: String,
    pub winrate: Option<f64>,
    pub pick_rate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HeroDefiningAbility {
    pub name: Option<String>,
    pub confidence: f64,
    pub hero_order: u8,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IdentifiedHeroModel {
    pub hero_order: u8,
    pub hero_name: String,
    pub hero_display_name: String,
    pub db_hero_id: Option<i64>,
    pub winrate: Option<f64>,
    pub pick_rate: Option<f64>,
    pub identification_confidence: f64,
}

/// Identifies each pool hero model in `model_coords` order, falling back to
/// `unknown_model_{hero_order}` / `"Unknown Hero"` when its defining ability is missing.
pub fn identify_hero_models(
    defining_abilities: &[HeroDefiningAbility],
    model_coords: &[SlotCoordinate],
    ability_to_hero_id: &HashMap<String, i64>,
    heroes_by_id: &HashMap<i64, HeroRecord>,
) -> Vec<IdentifiedHeroModel> {
    let mut identified_map: HashMap<u8, IdentifiedHeroModel> = HashMap::new();

    for ability in defining_abilities {
        let Some(ability_name) = ability.name.as_deref() else {
            continue;
        };
        let Some(&hero_id) = ability_to_hero_id.get(ability_name) else {
            continue;
        };
        let Some(hero) = heroes_by_id.get(&hero_id) else {
            continue;
        };

        identified_map.insert(
            ability.hero_order,
            IdentifiedHeroModel {
                hero_order: ability.hero_order,
                hero_name: hero.name.clone(),
                hero_display_name: hero.display_name.clone(),
                db_hero_id: Some(hero.hero_id),
                winrate: hero.winrate,
                pick_rate: hero.pick_rate,
                identification_confidence: ability.confidence,
            },
        );
    }

    model_coords
        .iter()
        .map(|coord| {
            identified_map.get(&coord.hero_order).cloned().unwrap_or_else(|| {
                IdentifiedHeroModel {
                    hero_order: coord.hero_order,
                    hero_name: format!("{UNKNOWN_MODEL_PREFIX}{}", coord.hero_order),
                    hero_display_name: "Unknown Hero".to_string(),
                    db_hero_id: None,
                    winrate: None,
                    pick_rate: None,
                    identification_confidence: 0.0,
                }
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coord(hero_order: u8) -> SlotCoordinate {
        SlotCoordinate {
            x: i32::from(hero_order) * 40,
            y: 100,
            width: Some(36),
            height: Some(36),
            hero_order,
            ability_order: None,
            is_ultimate: None,
        }
    }

    #[test]
    fn identifies_known_models_and_falls_back_on_unknown() {
        let heroes = HashMap::from([(
            2,
            HeroRecord {
                hero_id: 2,
                name: "axe".into(),
                display_name: "Axe".into(),
                winrate: Some(0.52),
                pick_rate: Some(14.5),
            },
        )]);
        let ab_to_hero = HashMap::from([("axe_battle_hunger".to_string(), 2)]);
        let defining = vec![
            HeroDefiningAbility {
                name: Some("axe_battle_hunger".into()),
                confidence: 0.99,
                hero_order: 0,
            },
            HeroDefiningAbility {
                name: None,
                confidence: 0.0,
                hero_order: 1,
            },
        ];

        let models = identify_hero_models(&defining, &[coord(0), coord(1)], &ab_to_hero, &heroes);
        assert_eq!(models.len(), 2);

        assert_eq!(models[0].hero_name, "axe");
        assert_eq!(models[0].hero_display_name, "Axe");
        assert_eq!(models[0].db_hero_id, Some(2));
        assert!(!is_unidentified_model(Some(&models[0].hero_name)));

        assert_eq!(models[1].hero_name, "unknown_model_1");
        assert_eq!(models[1].hero_display_name, "Unknown Hero");
        assert_eq!(models[1].db_hero_id, None);
        assert!(is_unidentified_model(Some(&models[1].hero_name)));
        assert!(is_unidentified_model(None));
    }
}
