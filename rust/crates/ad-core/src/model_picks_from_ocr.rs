//! Card-OCR-driven hero model attribution and in-place timeline marker reconciliation.
//!
//! Mirrors `src/core/domain/model-picks-from-ocr.ts`.

use std::collections::{HashMap, HashSet};

use crate::{
    hero_identification::is_unidentified_model,
    own_row_detection::hero_name_token,
    pick_attribution::{PickEvent, PickKind},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelAssignment {
    pub pool_hero_order: u8,
    pub player_index: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolModelRef {
    pub hero_order: u8,
    pub hero_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OcrHeroRead {
    pub name: String,
    pub similarity: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalModelAnchor {
    pub hero_name: String,
    pub row: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelCorrection {
    pub pool_hero_order: u8,
    pub from_row: u8,
    pub to_row: u8,
    pub from_model: Option<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelMarkerUpdate {
    pub timeline: Vec<PickEvent>,
    pub added: Vec<PickEvent>,
    pub corrected: Vec<ModelCorrection>,
    pub dropped: usize,
}

/// Resolves pool hero model assignments from player-card OCR reads, sorted by `pool_hero_order`.
pub fn resolve_model_assignments(
    pool_models: &[PoolModelRef],
    ocr_by_row: &HashMap<u8, OcrHeroRead>,
    local: Option<&LocalModelAnchor>,
) -> Vec<ModelAssignment> {
    let mut order_by_token: HashMap<String, Option<u8>> = HashMap::new();
    for model in pool_models {
        let Some(name) = model.hero_name.as_deref() else {
            continue;
        };
        if is_unidentified_model(Some(name)) {
            continue;
        }
        let token = hero_name_token(name);
        order_by_token
            .entry(token)
            .and_modify(|e| *e = None)
            .or_insert(Some(model.hero_order));
    }

    let unidentified: Vec<&PoolModelRef> = pool_models
        .iter()
        .filter(|m| is_unidentified_model(m.hero_name.as_deref()))
        .collect();
    let off_pool_order = if unidentified.len() == 1 {
        Some(unidentified[0].hero_order)
    } else {
        None
    };

    let order_of = |hero_name: &str| -> Option<u8> {
        let token = hero_name_token(hero_name);
        match order_by_token.get(&token) {
            Some(&entry) => entry,
            None => off_pool_order,
        }
    };

    let local_order = local.and_then(|l| order_of(&l.hero_name));
    let local_row = if local_order.is_some() {
        local.map(|l| l.row)
    } else {
        None
    };

    let mut best: HashMap<u8, (u8, f64)> = HashMap::new();
    for (&row, read) in ocr_by_row {
        let Some(order) = order_of(&read.name) else {
            continue;
        };
        if Some(order) == local_order || Some(row) == local_row {
            continue;
        }
        match best.get(&order) {
            Some(&(_, prev_sim)) if read.similarity <= prev_sim => {}
            _ => {
                best.insert(order, (row, read.similarity));
            }
        }
    }
    if let (Some(order), Some(row)) = (local_order, local_row) {
        best.insert(order, (row, f64::INFINITY));
    }

    let mut assignments: Vec<ModelAssignment> = best
        .into_iter()
        .map(|(pool_hero_order, (player_index, _))| ModelAssignment {
            pool_hero_order,
            player_index,
        })
        .collect();
    assignments.sort_by_key(|a| a.pool_hero_order);
    assignments
}

/// Reconciles `PickKind::Model` markers in `timeline` in place without disturbing `PickKind::Ability` picks.
pub fn reconcile_model_markers(
    timeline: &[PickEvent],
    assignments: &[ModelAssignment],
    clock_time: Option<i64>,
    seen_at_s: Option<f64>,
) -> ModelMarkerUpdate {
    let model_by_row: HashMap<u8, u8> = assignments
        .iter()
        .map(|a| (a.player_index, a.pool_hero_order))
        .collect();
    let row_by_model: HashMap<u8, u8> = assignments
        .iter()
        .map(|a| (a.pool_hero_order, a.player_index))
        .collect();

    let mut claimed_rows: HashSet<u8> = HashSet::new();
    for ev in timeline {
        if ev.kind == PickKind::Model && model_by_row.contains_key(&ev.player_index) {
            claimed_rows.insert(ev.player_index);
        }
    }

    let mut corrected: Vec<ModelCorrection> = Vec::new();
    let mut kept_rows: HashSet<u8> = HashSet::new();
    let mut dropped: usize = 0;
    let mut next: Vec<PickEvent> = Vec::with_capacity(timeline.len());

    for ev in timeline {
        if ev.kind != PickKind::Model {
            next.push(ev.clone());
            continue;
        }
        let mut row = ev.player_index;
        let mut model = model_by_row.get(&row).copied();
        if model.is_none() {
            if let Some(prev_model) = ev.pool_hero_order {
                if let Some(&new_row) = row_by_model.get(&prev_model) {
                    if !claimed_rows.contains(&new_row) && !kept_rows.contains(&new_row) {
                        row = new_row;
                        model = Some(prev_model);
                    }
                }
            }
        }
        let Some(assigned_model) = model else {
            dropped += 1;
            continue;
        };
        if kept_rows.contains(&row) {
            dropped += 1;
            continue;
        }
        kept_rows.insert(row);
        if row != ev.player_index || Some(assigned_model) != ev.pool_hero_order {
            corrected.push(ModelCorrection {
                pool_hero_order: assigned_model,
                from_row: ev.player_index,
                to_row: row,
                from_model: ev.pool_hero_order,
            });
        }
        let mut moved = ev.clone();
        moved.player_index = row;
        moved.pool_hero_order = Some(assigned_model);
        if row != ev.player_index {
            moved.seen_at_s = seen_at_s;
        }
        next.push(moved);
    }

    let added: Vec<PickEvent> = assignments
        .iter()
        .filter(|a| !kept_rows.contains(&a.player_index))
        .map(|a| PickEvent {
            seq: 0,
            player_index: a.player_index,
            ability_name: None,
            kind: PickKind::Model,
            pool_hero_order: Some(a.pool_hero_order),
            clock_time,
            box_group: None,
            seen_at_s,
            vacated: false,
        })
        .collect();

    ModelMarkerUpdate {
        timeline: next,
        added,
        corrected,
        dropped,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attributes_models_with_single_unidentified_fallback_and_local_anchor() {
        let pool = vec![
            PoolModelRef {
                hero_order: 0,
                hero_name: Some("axe".into()),
            },
            PoolModelRef {
                hero_order: 1,
                hero_name: Some("unknown_model_1".into()),
            },
            PoolModelRef {
                hero_order: 2,
                hero_name: Some("puck".into()),
            },
        ];
        let ocr = HashMap::from([
            (0u8, OcrHeroRead { name: "axe".into(), similarity: 0.70 }),
            (3u8, OcrHeroRead { name: "axe".into(), similarity: 0.95 }),
            (4u8, OcrHeroRead { name: "lion".into(), similarity: 0.92 }),
            (6u8, OcrHeroRead { name: "axe".into(), similarity: 1.00 }),
        ]);
        let local = LocalModelAnchor {
            hero_name: "puck".into(),
            row: 6,
        };

        let assigned = resolve_model_assignments(&pool, &ocr, Some(&local));
        assert_eq!(
            assigned,
            vec![
                ModelAssignment { pool_hero_order: 0, player_index: 3 },
                ModelAssignment { pool_hero_order: 1, player_index: 4 },
                ModelAssignment { pool_hero_order: 2, player_index: 6 },
            ]
        );
    }

    #[test]
    fn reconciles_relabelled_and_moved_markers_in_place() {
        let initial = vec![PickEvent {
            seq: 0,
            player_index: 1,
            ability_name: None,
            kind: PickKind::Model,
            pool_hero_order: Some(0),
            clock_time: Some(-10),
            box_group: None,
            seen_at_s: Some(12.0),
            vacated: false,
        }];
        let next_assigns = vec![
            ModelAssignment { pool_hero_order: 0, player_index: 4 },
            ModelAssignment { pool_hero_order: 2, player_index: 5 },
        ];
        let upd = reconcile_model_markers(&initial, &next_assigns, Some(-15), Some(20.0));
        assert_eq!(upd.dropped, 0);
        assert_eq!(upd.corrected.len(), 1);
        assert_eq!(upd.timeline[0].player_index, 4);
        assert_eq!(upd.timeline[0].seen_at_s, Some(20.0));
        assert_eq!(upd.added.len(), 1);
        assert_eq!(upd.added[0].player_index, 5);
        assert_eq!(upd.added[0].pool_hero_order, Some(2));
    }
}
