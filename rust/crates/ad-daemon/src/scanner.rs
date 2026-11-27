//! End-to-end draft board scan pipeline:
//! frame -> aspect-aware layout -> bilinear crop -> ONNX FP16 -> role/top-tier/synergies -> OverlaySnapshot.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
};

use ad_capture::{
    crop::{crop_and_resize_bilinear_rgb, rgb_u8_to_f32_batch},
    RawFrame,
};
use ad_core::{
    layout::{LayoutDatabase, SlotCoordinate},
    role_scoring::{compute_role_score, RoleContext, RoleTagInput},
    scoring::calculate_consolidated_score,
    shift_axes::{compute_shift_axes, AbilityShiftRow, ShiftAxes},
    tags::TagsDataset,
    top_tier::{determine_top_tier_entities, EntityType, ScoredEntity},
};
use ad_ml::{onnx::OnnxPoolClassifier, DEFAULT_POOL_CONFIDENCE_THRESHOLD, INPUT_SIZE};
use ad_protocol::{OverlaySnapshot, Rect, RoleMode, SlotHighlight, SynergyCombo, PROTOCOL_VERSION};
use anyhow::Context;

use crate::db::{AbilityRow, AdDatabase};

pub const DEFAULT_OP_THRESHOLD: f64 = 0.13;
pub const DEFAULT_TRAP_THRESHOLD: f64 = 0.05;
pub const MAX_COMBO_ENTRIES: usize = 15;

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub role_mode: RoleMode,
    pub role_fixed_positions: Vec<u8>,
    pub selected_spot_hero_order: Option<u8>,
    pub selected_model_hero_order: Option<u8>,
    pub dota_window: Option<Rect>,
}

#[derive(Debug, Clone)]
struct ResolvedSynergy {
    internal1: String,
    internal2: String,
    display1: String,
    display2: String,
    synergy_winrate: f64,
    synergy_increase: Option<f64>,
    is_op: bool,
}

pub struct ScanPipeline {
    layouts: LayoutDatabase,
    abilities_by_name: HashMap<String, AbilityRow>,
    active_class_names: HashSet<String>,
    shift_axes: HashMap<String, ShiftAxes>,
    synergies: Vec<ResolvedSynergy>,
    tags: Option<TagsDataset>,
    classifier: Mutex<Option<OnnxPoolClassifier>>,
    model_path: PathBuf,
    class_names_path: PathBuf,
}

impl ScanPipeline {
    pub fn from_resources_dir(resources_dir: &Path) -> anyhow::Result<Self> {
        let layouts = LayoutDatabase::from_file(
            &resources_dir.join("config/layout_coordinates.json"),
        )
        .context("failed to load layout_coordinates.json")?;

        let db = AdDatabase::open_immutable_readonly(&resources_dir.join("dota_ad_data.db"))
            .context("failed to open dota_ad_data.db")?;
        let abilities = db.load_abilities().context("failed to load abilities")?;
        let raw_synergies = db
            .load_ability_synergies()
            .context("failed to load ability synergies")?;

        let shift_rows: Vec<AbilityShiftRow> = abilities
            .iter()
            .map(|a| AbilityShiftRow {
                name: a.name.clone(),
                kills_shift: a.kills_shift,
                ka_shift: a.ka_shift,
                gpm_shift: a.gpm_shift,
                xpm_shift: a.xpm_shift,
                healing_shift: a.healing_shift,
            })
            .collect();
        let shift_axes = compute_shift_axes(&shift_rows);

        let mut by_id: HashMap<i64, (String, String)> = HashMap::with_capacity(abilities.len());
        let mut abilities_by_name = HashMap::with_capacity(abilities.len());
        let mut active_class_names = HashSet::with_capacity(abilities.len());
        for row in abilities {
            let display = row
                .display_name
                .clone()
                .unwrap_or_else(|| row.name.clone());
            by_id.insert(row.ability_id, (row.name.clone(), display));
            active_class_names.insert(row.name.clone());
            abilities_by_name.insert(row.name.clone(), row);
        }

        let mut seen_pairs: HashSet<(String, String)> = HashSet::new();
        let mut synergies = Vec::new();
        for syn in raw_synergies {
            let (Some((n1, d1)), Some((n2, d2))) = (
                by_id.get(&syn.base_ability_id),
                by_id.get(&syn.synergy_ability_id),
            ) else {
                continue;
            };
            if n1 == n2 {
                continue;
            }
            let key = if n1 <= n2 {
                (n1.clone(), n2.clone())
            } else {
                (n2.clone(), n1.clone())
            };
            if !seen_pairs.insert(key) {
                continue;
            }
            synergies.push(ResolvedSynergy {
                internal1: n1.clone(),
                internal2: n2.clone(),
                display1: d1.clone(),
                display2: d2.clone(),
                synergy_winrate: syn.synergy_winrate,
                synergy_increase: syn.synergy_increase,
                is_op: syn.is_op,
            });
        }

        let tags = TagsDataset::load(
            &resources_dir.join("data/ability_tags.json"),
            &resources_dir.join("data/hero_meta.json"),
        )
        .ok();

        Ok(Self {
            layouts,
            abilities_by_name,
            active_class_names,
            shift_axes,
            synergies,
            tags,
            classifier: Mutex::new(None),
            model_path: resources_dir.join("model/ability_classifier_fp16.onnx"),
            class_names_path: resources_dir.join("model/class_names.json"),
        })
    }

    pub fn layout_count(&self) -> usize {
        self.layouts.resolutions.len()
    }

    pub fn find_pool_combinations(
        &self,
        pool_names: &HashSet<String>,
    ) -> (Vec<SynergyCombo>, Vec<SynergyCombo>) {
        let mut op_list = Vec::new();
        let mut trap_list = Vec::new();

        for syn in &self.synergies {
            if !pool_names.contains(&syn.internal1) || !pool_names.contains(&syn.internal2) {
                continue;
            }
            let is_op = syn.is_op
                || syn
                    .synergy_increase
                    .is_some_and(|inc| inc >= DEFAULT_OP_THRESHOLD);
            let is_trap = !is_op
                && syn
                    .synergy_increase
                    .is_some_and(|inc| inc <= -DEFAULT_TRAP_THRESHOLD);

            if is_op {
                op_list.push(SynergyCombo {
                    ability1_name: syn.display1.clone(),
                    ability2_name: syn.display2.clone(),
                    synergy_winrate: syn.synergy_winrate,
                    synergy_increase: syn.synergy_increase,
                });
            } else if is_trap {
                trap_list.push(SynergyCombo {
                    ability1_name: syn.display1.clone(),
                    ability2_name: syn.display2.clone(),
                    synergy_winrate: syn.synergy_winrate,
                    synergy_increase: syn.synergy_increase,
                });
            }
        }

        op_list.sort_by(|a, b| b.synergy_winrate.total_cmp(&a.synergy_winrate));
        op_list.truncate(MAX_COMBO_ENTRIES);

        trap_list.sort_by(|a, b| a.synergy_winrate.total_cmp(&b.synergy_winrate));
        trap_list.truncate(MAX_COMBO_ENTRIES);

        (op_list, trap_list)
    }

    fn ensure_classifier<'a>(
        &'a self,
        guard: &'a mut Option<OnnxPoolClassifier>,
    ) -> anyhow::Result<&'a mut OnnxPoolClassifier> {
        if guard.is_none() {
            let loaded = OnnxPoolClassifier::load(&self.model_path, &self.class_names_path)
                .map_err(|e| anyhow::anyhow!("ONNX init failed: {e}"))?;
            *guard = Some(loaded);
        }
        Ok(guard.as_mut().expect("classifier initialized"))
    }

    pub fn scan_frame(
        &self,
        frame: &RawFrame,
        options: &ScanOptions,
        sequence: u64,
    ) -> anyhow::Result<OverlaySnapshot> {
        let (layout, source) = self
            .layouts
            .resolve_layout(frame.width, frame.height)
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "unsupported game resolution: {}x{}",
                    frame.width,
                    frame.height
                )
            })?;

        let mut pool_coords: Vec<(&SlotCoordinate, bool)> = Vec::with_capacity(
            layout.ultimate_slots_coords.len() + layout.standard_slots_coords.len(),
        );
        for c in &layout.ultimate_slots_coords {
            pool_coords.push((c, true));
        }
        for c in &layout.standard_slots_coords {
            pool_coords.push((c, false));
        }

        let mut crops = Vec::with_capacity(pool_coords.len());
        let mut valid_indices = Vec::with_capacity(pool_coords.len());
        let mut slot_rects = Vec::with_capacity(pool_coords.len());

        for (idx, (coord, _is_ult)) in pool_coords.iter().enumerate() {
            let x = coord.x.max(0) as u32;
            let y = coord.y.max(0) as u32;
            let w = coord.width.unwrap_or(0).max(0) as u32;
            let h = coord.height.unwrap_or(0).max(0) as u32;
            slot_rects.push(Rect {
                x: coord.x,
                y: coord.y,
                width: w,
                height: h,
            });
            if w == 0 || h == 0 {
                continue;
            }
            if let Ok(rgb) =
                crop_and_resize_bilinear_rgb(frame, x, y, w, h, INPUT_SIZE, INPUT_SIZE)
            {
                crops.push(rgb);
                valid_indices.push(idx);
            }
        }

        let batch = rgb_u8_to_f32_batch(&crops);
        let preds = if crops.is_empty() {
            Vec::new()
        } else {
            let mut guard = self
                .classifier
                .lock()
                .map_err(|_| anyhow::anyhow!("classifier mutex poisoned"))?;
            let clf = self.ensure_classifier(&mut guard)?;
            clf.classify_batch(
                &batch,
                crops.len(),
                DEFAULT_POOL_CONFIDENCE_THRESHOLD,
                Some(&self.active_class_names),
            )
            .map_err(|e| anyhow::anyhow!("ONNX classification failed: {e}"))?
        };

        let mut recognized_by_slot: HashMap<usize, Option<String>> =
            HashMap::with_capacity(pool_coords.len());
        let mut pool_names = HashSet::new();
        for (&slot_idx, pred) in valid_indices.iter().zip(preds.iter()) {
            if let Some(name) = &pred.class_name {
                pool_names.insert(name.clone());
            }
            recognized_by_slot.insert(slot_idx, pred.class_name.clone());
        }

        let (op_combinations, trap_combinations) = self.find_pool_combinations(&pool_names);

        let role_ctx = if options.role_mode == RoleMode::Fixed
            && !options.role_fixed_positions.is_empty()
        {
            Some(RoleContext {
                effective_positions: options.role_fixed_positions.clone(),
                my_pick_count: 0,
                team_greed: None,
            })
        } else {
            None
        };

        let mut scored_entities = Vec::new();
        let mut slot_scores: HashMap<usize, (f64, Option<f64>, Option<f64>, String)> =
            HashMap::new();

        for (slot_idx, (_, is_ult)) in pool_coords.iter().enumerate() {
            let Some(Some(internal_name)) = recognized_by_slot.get(&slot_idx) else {
                continue;
            };
            let db_row = self.abilities_by_name.get(internal_name);
            let winrate = db_row.and_then(|r| r.winrate);
            let pick_rate = db_row.and_then(|r| r.pick_rate);
            let display_name = db_row
                .and_then(|r| r.display_name.clone())
                .unwrap_or_else(|| internal_name.clone());

            let base = calculate_consolidated_score(winrate, pick_rate);
            let tag_entry = self
                .tags
                .as_ref()
                .and_then(|ds| ds.abilities.get(internal_name));
            let empty_picks: [HashSet<ad_core::tags::AbilityTag>; 0] = [];
            let role_delta = compute_role_score(
                self.shift_axes.get(internal_name),
                role_ctx.as_ref(),
                tag_entry.map(|entry| RoleTagInput {
                    candidate_tags: Some(&entry.tags),
                    candidate_role_must: if entry.role_must.is_empty() {
                        None
                    } else {
                        Some(&entry.role_must)
                    },
                    my_pick_tags: &empty_picks,
                    need_scarcity: None,
                    pool_has_hard_cc: false,
                })
                .as_ref(),
            );
            let final_score = base + role_delta.as_ref().map(|r| r.delta).unwrap_or(0.0);
            let curated = role_delta.as_ref().is_some_and(|r| r.curated);

            scored_entities.push(ScoredEntity {
                internal_name: internal_name.clone(),
                entity_type: EntityType::Ability,
                consolidated_score: final_score,
                is_ultimate_from_coord_source: *is_ult,
                is_ultimate_from_db: db_row.is_some_and(|r| r.is_ultimate),
                role_curated: curated,
            });
            slot_scores.insert(slot_idx, (final_score, winrate, pick_rate, display_name));
        }

        let top_tier = determine_top_tier_entities(
            &scored_entities,
            options.selected_model_hero_order.map(i64::from),
            false,
            &HashSet::new(),
        );
        let mut rank_by_name: HashMap<String, (u8, bool, bool)> = HashMap::new();
        for (idx, item) in top_tier.into_iter().enumerate() {
            rank_by_name
                .entry(item.entity.internal_name)
                .or_insert((
                    (idx + 1) as u8,
                    item.is_general_top_tier,
                    item.is_synergy_suggestion_for_my_spot,
                ));
        }

        let mut slots = Vec::with_capacity(pool_coords.len());
        for (slot_idx, bounds) in slot_rects.into_iter().enumerate() {
            let internal_name = recognized_by_slot
                .get(&slot_idx)
                .and_then(|opt| opt.as_ref());
            if let (Some(name), Some((score, winrate, pick_rate, display_name))) =
                (internal_name, slot_scores.get(&slot_idx))
            {
                let (top_rank, is_top_tier, is_synergy_pick) = rank_by_name
                    .get(name)
                    .map(|&(rank, top, syn)| (Some(rank), top, syn))
                    .unwrap_or((None, false, false));
                slots.push(SlotHighlight {
                    slot_index: slot_idx,
                    bounds,
                    display_name: display_name.clone(),
                    is_unknown: false,
                    is_top_tier,
                    is_synergy_pick,
                    consolidated_score: Some(*score),
                    winrate: *winrate,
                    pick_rate: *pick_rate,
                    top_rank,
                });
            } else {
                slots.push(SlotHighlight {
                    slot_index: slot_idx,
                    bounds,
                    display_name: "Unknown".to_string(),
                    is_unknown: true,
                    is_top_tier: false,
                    is_synergy_pick: false,
                    consolidated_score: None,
                    winrate: None,
                    pick_rate: None,
                    top_rank: None,
                });
            }
        }

        Ok(OverlaySnapshot {
            protocol_version: PROTOCOL_VERSION,
            sequence,
            target_resolution: format!("{}x{}", frame.width, frame.height),
            resolution_source: source,
            scanning: false,
            slots,
            selected_spot_hero_order: options.selected_spot_hero_order,
            selected_model_hero_order: options.selected_model_hero_order,
            op_combinations,
            trap_combinations,
            role_mode: options.role_mode,
            role_fixed_positions: options.role_fixed_positions.clone(),
            dota_window: options.dota_window,
        })
    }

    pub fn scan_live_game(
        &self,
        options: &ScanOptions,
        sequence: u64,
    ) -> anyhow::Result<OverlaySnapshot> {
        let mut capturer = ad_capture::default_screen_capturer();
        let frame = capturer
            .capture_game_frame()
            .map_err(|e| anyhow::anyhow!("capture failed: {e}"))?;
        self.scan_frame(&frame, options, sequence)
    }
}

#[cfg(test)]
mod tests {
    use ad_capture::PixelFormat;
    use ad_protocol::ResolutionSource;

    use super::*;

    #[test]
    fn finds_op_and_trap_combinations_across_real_database() {
        let resources_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../resources");
        let pipeline =
            ScanPipeline::from_resources_dir(&resources_dir).expect("load ScanPipeline");
        let (ops, traps) = pipeline.find_pool_combinations(&pipeline.active_class_names);
        assert!(!ops.is_empty(), "expected real OP combinations in seed DB");
        assert!(!traps.is_empty(), "expected real Trap combinations in seed DB");
        assert!(ops.len() <= MAX_COMBO_ENTRIES);
        assert!(traps.len() <= MAX_COMBO_ENTRIES);
    }

    #[test]
    fn scans_synthetic_1920x1080_frame_into_48_pool_slot_highlights() {
        let resources_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../resources");
        let pipeline =
            ScanPipeline::from_resources_dir(&resources_dir).expect("load ScanPipeline");
        assert!(pipeline.layout_count() >= 20);

        let frame = RawFrame {
            width: 1920,
            height: 1080,
            format: PixelFormat::Bgra8,
            bytes: vec![64u8; 1920 * 1080 * 4],
        };
        let options = ScanOptions {
            role_mode: RoleMode::Fixed,
            role_fixed_positions: vec![1, 2],
            selected_spot_hero_order: None,
            selected_model_hero_order: None,
            dota_window: None,
        };

        let snapshot = pipeline
            .scan_frame(&frame, &options, 1)
            .expect("scan synthetic 1080p frame");
        assert_eq!(snapshot.target_resolution, "1920x1080");
        assert_eq!(snapshot.resolution_source, ResolutionSource::Preset);
        assert!(!snapshot.scanning);
        assert_eq!(snapshot.slots.len(), 48);
        assert_eq!(snapshot.role_mode, RoleMode::Fixed);
        assert_eq!(snapshot.role_fixed_positions, vec![1, 2]);
    }
}
