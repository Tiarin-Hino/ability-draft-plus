//! End-to-end draft board scan pipeline:
//! frame -> aspect-aware layout -> bilinear crop -> ONNX FP16 + pick NCC + 3-pass card OCR
//! -> model attribution + own-row detection -> role/top-tier/synergies -> OverlaySnapshot.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::File,
    io::{BufReader, Cursor},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use ad_capture::{
    crop::{
        crop_and_resize_bilinear_rgb, crop_inset_and_resize_bilinear_rgb, rgb_u8_to_f32_batch,
    },
    PixelFormat, RawFrame,
};
use ad_core::{
    hero_identification::{
        identify_hero_models, is_unidentified_model, HeroDefiningAbility, HeroRecord,
        IdentifiedHeroModel,
    },
    layout::{LayoutDatabase, ResolutionLayout, SlotCoordinate},
    model_picks_from_ocr::{
        reconcile_model_markers, resolve_model_assignments, LocalModelAnchor, OcrHeroRead,
        PoolModelRef,
    },
    own_row_detection::resolve_own_row_from_ocr,
    pick_attribution::{reconcile_ability_picks, CardSlotReading, PickEvent, PickKind},
    role_scoring::{compute_role_score, RoleContext, RoleTagInput},
    scoring::calculate_consolidated_score,
    shift_axes::{compute_shift_axes, AbilityShiftRow, ShiftAxes},
    tags::{AbilityTag, TagsDataset},
    top_tier::{determine_top_tier_entities, EntityType, ScoredEntity},
};
use ad_ml::{
    card_ocr::{
        compute_strip_signature, extract_hero_name_strip_rgba, recognize_card_hero_name,
        strip_pixels_changed, OCR_STRIP_DIFF_THRESHOLD, OCR_STRIP_TARGET_WIDTH,
    },
    default_ocr_engine,
    hero_matcher::HeroNameCandidate,
    onnx::OnnxPoolClassifier,
    template_matcher::{make_icon_template, match_pick_slot_scoped, IconTemplate},
    OcrEngine, DEFAULT_POOL_CONFIDENCE_THRESHOLD, INPUT_SIZE, PICK_TEMPLATE_COMPARE_SIZE,
    PICK_TEMPLATE_CROP_INSET_RATIO, PICK_TEMPLATE_FALLBACK_MIN_NCC,
};
use ad_protocol::{
    HeroModelHighlight, OverlaySnapshot, PickedAbilitySlot, PlayerSpotHighlight, Rect,
    ResolutionSource, RoleMode, SlotHighlight, SynergyCombo, PROTOCOL_VERSION,
};
use anyhow::Context;

use crate::db::{AbilityRow, AdDatabase};

pub const DEFAULT_OP_THRESHOLD: f64 = 0.13;
pub const DEFAULT_TRAP_THRESHOLD: f64 = 0.05;
pub const MAX_COMBO_ENTRIES: usize = 15;
pub const POOL_RETRY_MAX_ATTEMPTS: u8 = 3;

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub role_mode: RoleMode,
    pub role_fixed_positions: Vec<u8>,
    pub selected_spot_hero_order: Option<u8>,
    pub selected_model_hero_order: Option<u8>,
    pub auto_rescan_enabled: bool,
    pub dota_window: Option<Rect>,
    pub gsi_local_hero: Option<String>,
    pub gsi_team_half_start: Option<u8>,
    pub gsi_connected: bool,
    pub game_phase: Option<String>,
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

#[derive(Debug, Clone)]
struct ResolvedHeroSynergy {
    hero_id: i64,
    ability_name: String,
    synergy_increase: Option<f64>,
    is_op: bool,
}

#[derive(Debug, Clone)]
struct PoolSlotMeta {
    bounds: Rect,
    is_ult: bool,
}

#[derive(Debug, Clone)]
struct CachedFrameAnalysis {
    target_resolution: String,
    resolution_source: ResolutionSource,
    pool_slots: Vec<PoolSlotMeta>,
    recognized_by_slot: HashMap<usize, Option<String>>,
    pool_names: HashSet<String>,
    identified_models: Vec<(Rect, IdentifiedHeroModel)>,
    hero_spots: Vec<(u8, Rect)>,
    picked_abilities: Vec<PickedAbilitySlot>,
    op_combinations: Vec<SynergyCombo>,
    trap_combinations: Vec<SynergyCombo>,
}

#[derive(Default)]
struct DraftSessionState {
    timeline: Vec<PickEvent>,
    last_analysis: Option<CachedFrameAnalysis>,
    ocr_strip_sigs: HashMap<u8, Vec<u8>>,
    ocr_hero_names_by_row: HashMap<u8, OcrHeroRead>,
    pool_slot_cache: HashMap<usize, (String, f64)>,
    pool_retry_counts: HashMap<usize, u8>,
}

pub struct ScanPipeline {
    layouts: LayoutDatabase,
    abilities_by_name: HashMap<String, AbilityRow>,
    ability_to_hero_id: HashMap<String, i64>,
    heroes_by_id: HashMap<i64, HeroRecord>,
    heroes_display_by_name: HashMap<String, String>,
    full_hero_roster: Vec<HeroNameCandidate>,
    active_class_names: HashSet<String>,
    shift_axes: HashMap<String, ShiftAxes>,
    synergies: Vec<ResolvedSynergy>,
    hero_synergies: Vec<ResolvedHeroSynergy>,
    tags: Option<TagsDataset>,
    pick_templates: Vec<IconTemplate>,
    classifier: Mutex<Option<OnnxPoolClassifier>>,
    ocr_engine: Mutex<Option<Box<dyn OcrEngine>>>,
    ocr_init_attempted: AtomicBool,
    session: Mutex<DraftSessionState>,
    model_path: PathBuf,
    class_names_path: PathBuf,
}

fn decode_png_rgba_from_reader<R: std::io::BufRead + std::io::Seek>(
    reader_in: R,
) -> Option<(Vec<u8>, u32, u32)> {
    let mut decoder = png::Decoder::new(reader_in);
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0u8; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;

    let mut rgba = vec![0u8; (info.width as usize) * (info.height as usize) * 4];
    match info.color_type {
        png::ColorType::Rgba => {
            let needed = rgba.len();
            if buf.len() < needed {
                return None;
            }
            rgba.copy_from_slice(&buf[..needed]);
        }
        png::ColorType::Rgb => {
            let pixels = (info.width as usize) * (info.height as usize);
            if buf.len() < pixels * 3 {
                return None;
            }
            for i in 0..pixels {
                rgba[i * 4] = buf[i * 3];
                rgba[i * 4 + 1] = buf[i * 3 + 1];
                rgba[i * 4 + 2] = buf[i * 3 + 2];
                rgba[i * 4 + 3] = 255;
            }
        }
        _ => return None,
    }
    Some((rgba, info.width, info.height))
}

fn load_png_template(path: &Path) -> Option<IconTemplate> {
    let stem = path.file_stem()?.to_str()?.to_string();
    let file = File::open(path).ok()?;
    let (rgba, width, height) = decode_png_rgba_from_reader(BufReader::new(file))?;

    let raw = RawFrame {
        width,
        height,
        format: PixelFormat::Rgba8,
        bytes: rgba,
    };
    let vec = crop_inset_and_resize_bilinear_rgb(
        &raw,
        0,
        0,
        width,
        height,
        PICK_TEMPLATE_CROP_INSET_RATIO,
        PICK_TEMPLATE_COMPARE_SIZE,
    )
    .ok()?;
    Some(make_icon_template(stem, vec))
}

fn load_pick_templates_from_dir(dir: &Path) -> Vec<IconTemplate> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let expected_rgb_len =
        (PICK_TEMPLATE_COMPARE_SIZE as usize) * (PICK_TEMPLATE_COMPARE_SIZE as usize) * 3;
    let mut templates = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        match path.extension().and_then(|e| e.to_str()) {
            Some("png") => {
                if let Some(tpl) = load_png_template(&path) {
                    templates.push(tpl);
                }
            }
            Some("rgb") => {
                if let (Some(stem), Ok(bytes)) = (
                    path.file_stem().and_then(|s| s.to_str()),
                    std::fs::read(&path),
                ) {
                    if bytes.len() == expected_rgb_len {
                        templates.push(make_icon_template(stem, bytes));
                    }
                }
            }
            _ => {}
        }
    }
    templates
}

impl ScanPipeline {
    pub fn from_resources_dir(resources_dir: &Path) -> anyhow::Result<Self> {
        let layouts = LayoutDatabase::from_file(
            &resources_dir.join("config/layout_coordinates.json"),
        )
        .context("failed to load layout_coordinates.json")?;

        let db = AdDatabase::open_immutable_readonly(&resources_dir.join("dota_ad_data.db"))
            .context("failed to open dota_ad_data.db")?;
        let heroes = db.load_heroes().context("failed to load heroes")?;
        let abilities = db.load_abilities().context("failed to load abilities")?;
        let raw_synergies = db
            .load_ability_synergies()
            .context("failed to load ability synergies")?;
        let raw_hero_synergies = db
            .load_hero_ability_synergies()
            .context("failed to load hero ability synergies")?;

        let mut heroes_by_id = HashMap::with_capacity(heroes.len());
        let mut heroes_display_by_name = HashMap::with_capacity(heroes.len());
        let mut full_hero_roster = Vec::with_capacity(heroes.len());
        for hero in heroes {
            let display_name = hero.display_name.unwrap_or_else(|| hero.name.clone());
            full_hero_roster.push(HeroNameCandidate {
                name: hero.name.clone(),
                display_name: display_name.clone(),
            });
            heroes_display_by_name.insert(hero.name.clone(), display_name.clone());
            heroes_by_id.insert(
                hero.hero_id,
                HeroRecord {
                    hero_id: hero.hero_id,
                    name: hero.name,
                    display_name,
                    winrate: hero.winrate,
                    pick_rate: hero.pick_rate,
                },
            );
        }

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
        let mut ability_to_hero_id = HashMap::with_capacity(abilities.len());
        let mut active_class_names = HashSet::with_capacity(abilities.len());
        for row in abilities {
            let display = row
                .display_name
                .clone()
                .unwrap_or_else(|| row.name.clone());
            by_id.insert(row.ability_id, (row.name.clone(), display));
            active_class_names.insert(row.name.clone());
            if let Some(hero_id) = row.hero_id {
                ability_to_hero_id.insert(row.name.clone(), hero_id);
            }
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

        let mut hero_synergies = Vec::new();
        for hs in raw_hero_synergies {
            let Some((ability_name, _)) = by_id.get(&hs.ability_id) else {
                continue;
            };
            hero_synergies.push(ResolvedHeroSynergy {
                hero_id: hs.hero_id,
                ability_name: ability_name.clone(),
                synergy_increase: hs.synergy_increase,
                is_op: hs.is_op,
            });
        }

        let tags = TagsDataset::load(
            &resources_dir.join("data/ability_tags.json"),
            &resources_dir.join("data/hero_meta.json"),
        )
        .ok();

fn discover_icon_cache_dir(resources_dir: &Path) -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("AD_ICON_CACHE_DIR").map(PathBuf::from) {
        if dir.is_dir() {
            return Some(dir);
        }
    }

    let mut candidates = Vec::new();
    #[cfg(target_os = "windows")]
    if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
        candidates.push(appdata.join("ability-draft-plus/stream-icons/abilities"));
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home.join("Library/Application Support/ability-draft-plus/stream-icons/abilities"));
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from) {
            candidates.push(xdg.join("ability-draft-plus/stream-icons/abilities"));
        }
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            candidates.push(home.join(".config/ability-draft-plus/stream-icons/abilities"));
        }
    }
    candidates.push(resources_dir.join("stream-icons/abilities"));

    candidates.into_iter().find(|dir| dir.is_dir())
}

        let pick_templates = discover_icon_cache_dir(resources_dir)
            .map(|dir| load_pick_templates_from_dir(&dir))
            .unwrap_or_default();

        Ok(Self {
            layouts,
            abilities_by_name,
            ability_to_hero_id,
            heroes_by_id,
            heroes_display_by_name,
            full_hero_roster,
            active_class_names,
            shift_axes,
            synergies,
            hero_synergies,
            tags,
            pick_templates,
            classifier: Mutex::new(None),
            ocr_engine: Mutex::new(None),
            ocr_init_attempted: AtomicBool::new(false),
            session: Mutex::new(DraftSessionState::default()),
            model_path: resources_dir.join("model/ability_classifier_fp16.onnx"),
            class_names_path: resources_dir.join("model/class_names.json"),
        })
    }

    pub fn layout_count(&self) -> usize {
        self.layouts.resolutions.len()
    }

    pub fn pick_template_count(&self) -> usize {
        self.pick_templates.len()
    }

    fn infer_dynamic_positions(&self, my_picks: &[String]) -> Vec<u8> {
        if my_picks.is_empty() {
            return Vec::new();
        }
        let mut pos_scores: Vec<(u8, f64)> = Vec::with_capacity(5);
        for pos in 1..=5u8 {
            let ctx = RoleContext {
                effective_positions: vec![pos],
                my_pick_count: 0,
                team_greed: None,
            };
            let mut sum = 0.0;
            for name in my_picks {
                let tag_entry = self
                    .tags
                    .as_ref()
                    .and_then(|ds| ds.abilities.get(name));
                let delta = compute_role_score(
                    self.shift_axes.get(name),
                    Some(&ctx),
                    tag_entry
                        .map(|entry| RoleTagInput {
                            candidate_tags: Some(&entry.tags),
                            candidate_role_must: if entry.role_must.is_empty() {
                                None
                            } else {
                                Some(&entry.role_must)
                            },
                            my_pick_tags: &[],
                            need_scarcity: None,
                            pool_has_hard_cc: false,
                        })
                        .as_ref(),
                )
                .map(|r| r.delta)
                .unwrap_or(0.0);
                sum += delta;
            }
            pos_scores.push((pos, sum / (my_picks.len() as f64)));
        }
        let best = pos_scores
            .iter()
            .map(|&(_, s)| s)
            .fold(f64::NEG_INFINITY, f64::max);
        pos_scores.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        let mut chosen: Vec<u8> = pos_scores
            .into_iter()
            .filter(|&(_, s)| s >= best - 0.02)
            .take(2)
            .map(|(p, _)| p)
            .collect();
        chosen.sort_unstable();
        chosen
    }

    pub fn reset_session(&self) {
        if let Ok(mut guard) = self.session.lock() {
            *guard = DraftSessionState::default();
        }
    }

    pub fn rescore_cached(
        &self,
        options: &ScanOptions,
        sequence: u64,
    ) -> Option<OverlaySnapshot> {
        let guard = self.session.lock().ok()?;
        let analysis = guard.last_analysis.as_ref()?;
        Some(self.build_snapshot(
            analysis,
            &guard.timeline,
            &guard.ocr_hero_names_by_row,
            options,
            sequence,
        ))
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

    fn run_card_ocr_updates(
        &self,
        frame: &RawFrame,
        hero_spots: &[(u8, Rect)],
        identified_models: &[(Rect, IdentifiedHeroModel)],
        strip_sigs: &mut HashMap<u8, Vec<u8>>,
        ocr_reads: &mut HashMap<u8, OcrHeroRead>,
    ) {
        if !self.ocr_init_attempted.swap(true, Ordering::Relaxed) {
            if let Ok(engine) = default_ocr_engine() {
                if let Ok(mut guard) = self.ocr_engine.lock() {
                    *guard = Some(engine);
                }
            }
        }
        let Ok(mut engine_guard) = self.ocr_engine.lock() else {
            return;
        };
        let Some(engine) = engine_guard.as_mut() else {
            return;
        };

        let pool_candidates: Vec<HeroNameCandidate> = identified_models
            .iter()
            .filter(|(_, m)| !is_unidentified_model(Some(&m.hero_name)))
            .map(|(_, m)| HeroNameCandidate {
                name: m.hero_name.clone(),
                display_name: m.hero_display_name.clone(),
            })
            .collect();

        let is_bgra = frame.format == PixelFormat::Bgra8;
        for &(row, rect) in hero_spots {
            let Some((strip, sw, sh)) = extract_hero_name_strip_rgba(
                &frame.bytes,
                frame.width,
                frame.height,
                is_bgra,
                [
                    rect.x.max(0) as u32,
                    rect.y.max(0) as u32,
                    rect.width,
                    rect.height,
                ],
                OCR_STRIP_TARGET_WIDTH,
            ) else {
                continue;
            };

            let sig = compute_strip_signature(&strip, sw, sh);
            if !strip_pixels_changed(strip_sigs.get(&row).map(Vec::as_slice), &sig, OCR_STRIP_DIFF_THRESHOLD) {
                continue;
            }
            strip_sigs.insert(row, sig);

            let outcome = recognize_card_hero_name(
                engine.as_mut(),
                &strip,
                sw,
                sh,
                &pool_candidates,
                &self.full_hero_roster,
            );
            if let Some(hero) = outcome.hero {
                ocr_reads.insert(
                    row,
                    OcrHeroRead {
                        name: hero.name,
                        similarity: hero.similarity,
                    },
                );
            }
        }
    }

    fn scan_picked_slots(
        &self,
        frame: &RawFrame,
        layout: &ResolutionLayout,
        pool_std_names: &HashSet<String>,
        pool_ult_names: &HashSet<String>,
    ) -> (Vec<CardSlotReading>, Vec<PickedAbilitySlot>) {
        let mut readings = Vec::with_capacity(layout.selected_abilities_coords.len());
        let mut picked_slots = Vec::with_capacity(layout.selected_abilities_coords.len());
        let mut box_counters: BTreeMap<(u8, bool), u8> = BTreeMap::new();

        let slot_w = layout.selected_abilities_params.width.max(0) as u32;
        let slot_h = layout.selected_abilities_params.height.max(0) as u32;

        for coord in &layout.selected_abilities_coords {
            let is_ult = coord.is_ultimate.unwrap_or(false);
            let box_index_entry = box_counters.entry((coord.hero_order, is_ult)).or_insert(0);
            let box_index = *box_index_entry;
            *box_index_entry = box_index_entry.saturating_add(1);

            let mut matched_name: Option<String> = None;
            let mut matched_conf = 0.0f64;
            let mut rejected = false;

            if !self.pick_templates.is_empty() && slot_w > 0 && slot_h > 0 {
                let x = coord.x.max(0) as u32;
                let y = coord.y.max(0) as u32;
                if let Ok(rgb) = crop_inset_and_resize_bilinear_rgb(
                    frame,
                    x,
                    y,
                    slot_w,
                    slot_h,
                    PICK_TEMPLATE_CROP_INSET_RATIO,
                    PICK_TEMPLATE_COMPARE_SIZE,
                ) {
                    let scope = if is_ult {
                        pool_ult_names
                    } else {
                        pool_std_names
                    };
                    let res = match_pick_slot_scoped(
                        &rgb,
                        &self.pick_templates,
                        if scope.is_empty() { None } else { Some(scope) },
                        f64::from(PICK_TEMPLATE_FALLBACK_MIN_NCC),
                    );
                    if let Some(name) = res.name {
                        matched_name = Some(name);
                        matched_conf = res.score;
                    } else if !res.is_empty {
                        matched_conf = res.score.max(0.0);
                        rejected = true;
                    }
                }
            }

            let display_name = matched_name
                .as_deref()
                .and_then(|n| self.abilities_by_name.get(n))
                .and_then(|row| row.display_name.clone())
                .or_else(|| matched_name.clone())
                .unwrap_or_default();

            readings.push(CardSlotReading {
                hero_order: coord.hero_order,
                is_ultimate: is_ult,
                name: matched_name.clone(),
                confidence: matched_conf,
                has_rejected_match: rejected,
            });
            picked_slots.push(PickedAbilitySlot {
                hero_order: coord.hero_order,
                box_index,
                is_ultimate: is_ult,
                ability_name: matched_name,
                display_name,
            });
        }

        (readings, picked_slots)
    }

    fn collect_synergy_partners(
        &self,
        pool_names: &HashSet<String>,
        my_picks: &[String],
        my_model_db_id: Option<i64>,
    ) -> HashSet<String> {
        let mut partners = HashSet::new();
        let my_pick_set: HashSet<&str> = my_picks.iter().map(String::as_str).collect();

        for syn in &self.synergies {
            let is_strong = syn.is_op
                || syn
                    .synergy_increase
                    .is_some_and(|inc| inc >= DEFAULT_OP_THRESHOLD);
            if !is_strong {
                continue;
            }
            if my_pick_set.contains(syn.internal1.as_str())
                && pool_names.contains(&syn.internal2)
                && !my_pick_set.contains(syn.internal2.as_str())
            {
                partners.insert(syn.internal2.clone());
            } else if my_pick_set.contains(syn.internal2.as_str())
                && pool_names.contains(&syn.internal1)
                && !my_pick_set.contains(syn.internal1.as_str())
            {
                partners.insert(syn.internal1.clone());
            }
        }

        if let Some(hero_id) = my_model_db_id {
            for hs in &self.hero_synergies {
                if hs.hero_id != hero_id {
                    continue;
                }
                let is_strong = hs.is_op
                    || hs
                        .synergy_increase
                        .is_some_and(|inc| inc >= DEFAULT_OP_THRESHOLD);
                if is_strong && pool_names.contains(&hs.ability_name) {
                    partners.insert(hs.ability_name.clone());
                }
            }
        }

        partners
    }

    fn build_snapshot(
        &self,
        analysis: &CachedFrameAnalysis,
        timeline: &[PickEvent],
        ocr_reads: &HashMap<u8, OcrHeroRead>,
        options: &ScanOptions,
        sequence: u64,
    ) -> OverlaySnapshot {
        let ocr_name_map: HashMap<u8, String> = ocr_reads
            .iter()
            .map(|(&row, read)| (row, read.name.clone()))
            .collect();
        let effective_spot_order = options.selected_spot_hero_order.or_else(|| {
            options
                .gsi_local_hero
                .as_deref()
                .and_then(|hero| resolve_own_row_from_ocr(&ocr_name_map, hero, options.gsi_team_half_start))
        });

        let mut my_picks: Vec<String> = Vec::new();
        let mut my_spot_has_ult = false;
        if let Some(spot_order) = effective_spot_order {
            for slot in &analysis.picked_abilities {
                if slot.hero_order == spot_order {
                    if let Some(name) = &slot.ability_name {
                        if !my_picks.contains(name) {
                            my_picks.push(name.clone());
                        }
                        if slot.is_ultimate {
                            my_spot_has_ult = true;
                        }
                    }
                }
            }
            for ev in timeline {
                if ev.player_index == spot_order && ev.kind == PickKind::Ability {
                    if let Some(name) = &ev.ability_name {
                        if !my_picks.contains(name) {
                            my_picks.push(name.clone());
                        }
                        if self.abilities_by_name.get(name).is_some_and(|r| r.is_ultimate) {
                            my_spot_has_ult = true;
                        }
                    }
                }
            }
        }

        let selected_model_db_id = options.selected_model_hero_order.and_then(|order| {
            analysis
                .identified_models
                .iter()
                .find(|(_, m)| m.hero_order == order)
                .and_then(|(_, m)| m.db_hero_id)
        });
        let selected_model_filter_id =
            selected_model_db_id.or_else(|| options.selected_model_hero_order.map(i64::from));

        let synergistic_partners = self.collect_synergy_partners(
            &analysis.pool_names,
            &my_picks,
            selected_model_db_id,
        );

        let my_pick_tags: Vec<HashSet<AbilityTag>> = my_picks
            .iter()
            .filter_map(|name| self.tags.as_ref().and_then(|ds| ds.abilities.get(name)))
            .map(|entry| entry.tags.clone())
            .collect();

        let pool_has_hard_cc = self.tags.as_ref().is_some_and(|ds| {
            analysis.pool_names.iter().any(|name| {
                ds.abilities
                    .get(name)
                    .is_some_and(|e| e.tags.contains(&AbilityTag::HardCc))
            })
        });

        let effective_positions = if options.role_mode == RoleMode::Fixed {
            options.role_fixed_positions.clone()
        } else if options.role_mode == RoleMode::Dynamic {
            self.infer_dynamic_positions(&my_picks)
        } else {
            Vec::new()
        };

        let role_ctx = if effective_positions.is_empty() {
            None
        } else {
            Some(RoleContext {
                effective_positions,
                my_pick_count: my_picks.len(),
                team_greed: None,
            })
        };

        let mut scored_entities =
            Vec::with_capacity(analysis.pool_slots.len() + analysis.identified_models.len());
        let mut slot_scores: HashMap<usize, (f64, Option<f64>, Option<f64>, String)> =
            HashMap::new();

        for (slot_idx, slot_meta) in analysis.pool_slots.iter().enumerate() {
            let Some(Some(internal_name)) = analysis.recognized_by_slot.get(&slot_idx) else {
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
            let role_delta = compute_role_score(
                self.shift_axes.get(internal_name),
                role_ctx.as_ref(),
                tag_entry
                    .map(|entry| RoleTagInput {
                        candidate_tags: Some(&entry.tags),
                        candidate_role_must: if entry.role_must.is_empty() {
                            None
                        } else {
                            Some(&entry.role_must)
                        },
                        my_pick_tags: &my_pick_tags,
                        need_scarcity: None,
                        pool_has_hard_cc,
                    })
                    .as_ref(),
            );
            let final_score = base + role_delta.as_ref().map(|r| r.delta).unwrap_or(0.0);
            let curated = role_delta.as_ref().is_some_and(|r| r.curated);

            scored_entities.push(ScoredEntity {
                internal_name: internal_name.clone(),
                entity_type: EntityType::Ability,
                consolidated_score: final_score,
                is_ultimate_from_coord_source: slot_meta.is_ult,
                is_ultimate_from_db: db_row.is_some_and(|r| r.is_ultimate),
                role_curated: curated,
            });
            slot_scores.insert(slot_idx, (final_score, winrate, pick_rate, display_name));
        }

        let mut model_scores: HashMap<String, f64> = HashMap::new();
        for (_, model) in &analysis.identified_models {
            if is_unidentified_model(Some(&model.hero_name)) {
                continue;
            }
            let score = calculate_consolidated_score(model.winrate, model.pick_rate);
            model_scores.insert(model.hero_name.clone(), score);
            scored_entities.push(ScoredEntity {
                internal_name: model.hero_name.clone(),
                entity_type: EntityType::Hero,
                consolidated_score: score,
                is_ultimate_from_coord_source: false,
                is_ultimate_from_db: false,
                role_curated: false,
            });
        }

        let top_tier = determine_top_tier_entities(
            &scored_entities,
            selected_model_filter_id,
            my_spot_has_ult,
            &synergistic_partners,
        );
        let mut rank_by_key: HashMap<(bool, String), (u8, bool, bool)> = HashMap::new();
        for (idx, item) in top_tier.into_iter().enumerate() {
            let is_hero = item.entity.entity_type == EntityType::Hero;
            rank_by_key
                .entry((is_hero, item.entity.internal_name))
                .or_insert((
                    (idx + 1) as u8,
                    item.is_general_top_tier,
                    item.is_synergy_suggestion_for_my_spot,
                ));
        }

        let mut slots = Vec::with_capacity(analysis.pool_slots.len());
        for (slot_idx, slot_meta) in analysis.pool_slots.iter().enumerate() {
            let internal_name = analysis
                .recognized_by_slot
                .get(&slot_idx)
                .and_then(|opt| opt.as_ref());
            if let (Some(name), Some((score, winrate, pick_rate, display_name))) =
                (internal_name, slot_scores.get(&slot_idx))
            {
                let (top_rank, is_top_tier, is_synergy_pick) = rank_by_key
                    .get(&(false, name.clone()))
                    .map(|&(rank, top, syn)| (Some(rank), top, syn))
                    .unwrap_or((None, false, false));
                slots.push(SlotHighlight {
                    slot_index: slot_idx,
                    bounds: slot_meta.bounds,
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
                    bounds: slot_meta.bounds,
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

        let hero_models = analysis
            .identified_models
            .iter()
            .map(|(bounds, model)| {
                let unknown = is_unidentified_model(Some(&model.hero_name));
                let is_my_model = options.selected_model_hero_order == Some(model.hero_order);
                let (top_rank, is_top_tier) = if unknown {
                    (None, false)
                } else {
                    rank_by_key
                        .get(&(true, model.hero_name.clone()))
                        .map(|&(rank, top, _)| (Some(rank), top))
                        .unwrap_or((None, false))
                };
                HeroModelHighlight {
                    hero_order: model.hero_order,
                    bounds: *bounds,
                    db_hero_id: model.db_hero_id,
                    hero_name: model.hero_name.clone(),
                    display_name: model.hero_display_name.clone(),
                    is_unknown: unknown,
                    is_top_tier,
                    is_my_model,
                    top_rank,
                    winrate: model.winrate,
                    pick_rate: model.pick_rate,
                    consolidated_score: model_scores.get(&model.hero_name).copied(),
                }
            })
            .collect();

        let hero_spots = analysis
            .hero_spots
            .iter()
            .map(|&(hero_order, bounds)| PlayerSpotHighlight {
                hero_order,
                bounds,
                is_my_spot: effective_spot_order == Some(hero_order),
                ocr_hero_name: ocr_reads.get(&hero_order).map(|r| {
                    self.heroes_display_by_name
                        .get(&r.name)
                        .cloned()
                        .unwrap_or_else(|| r.name.clone())
                }),
            })
            .collect();

        OverlaySnapshot {
            protocol_version: PROTOCOL_VERSION,
            sequence,
            target_resolution: analysis.target_resolution.clone(),
            resolution_source: analysis.resolution_source,
            scanning: false,
            slots,
            hero_models,
            hero_spots,
            picked_abilities: analysis.picked_abilities.clone(),
            selected_spot_hero_order: effective_spot_order,
            selected_model_hero_order: options.selected_model_hero_order,
            op_combinations: analysis.op_combinations.clone(),
            trap_combinations: analysis.trap_combinations.clone(),
            role_mode: options.role_mode,
            role_fixed_positions: options.role_fixed_positions.clone(),
            auto_rescan_enabled: options.auto_rescan_enabled,
            dota_window: options.dota_window,
            gsi_connected: options.gsi_connected,
            game_phase: options.game_phase.clone(),
            pick_templates_loaded: self.pick_templates.len(),
        }
    }

    pub fn scan_png_bytes(
        &self,
        png_bytes: &[u8],
        options: &ScanOptions,
        sequence: u64,
    ) -> anyhow::Result<OverlaySnapshot> {
        let (bytes, width, height) = decode_png_rgba_from_reader(Cursor::new(png_bytes))
            .ok_or_else(|| anyhow::anyhow!("invalid or unsupported PNG image"))?;
        let frame = RawFrame {
            width,
            height,
            format: PixelFormat::Rgba8,
            bytes,
        };
        self.scan_frame(&frame, options, sequence)
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

        let (cached_pool_slots, prev_retries) = {
            let guard = self
                .session
                .lock()
                .map_err(|_| anyhow::anyhow!("session mutex poisoned"))?;
            (guard.pool_slot_cache.clone(), guard.pool_retry_counts.clone())
        };

        let mut crops = Vec::with_capacity(pool_coords.len());
        let mut valid_indices = Vec::with_capacity(pool_coords.len());
        let mut pool_slots = Vec::with_capacity(pool_coords.len());
        let mut recognized_by_slot: HashMap<usize, Option<String>> =
            HashMap::with_capacity(pool_coords.len());
        let mut conf_by_slot: HashMap<usize, f64> = HashMap::with_capacity(pool_coords.len());

        for (idx, (coord, is_ult)) in pool_coords.iter().enumerate() {
            let x = coord.x.max(0) as u32;
            let y = coord.y.max(0) as u32;
            let w = coord.width.unwrap_or(0).max(0) as u32;
            let h = coord.height.unwrap_or(0).max(0) as u32;
            pool_slots.push(PoolSlotMeta {
                bounds: Rect {
                    x: coord.x,
                    y: coord.y,
                    width: w,
                    height: h,
                },
                is_ult: *is_ult,
            });
            if let Some((cached_name, cached_conf)) = cached_pool_slots.get(&idx) {
                recognized_by_slot.insert(idx, Some(cached_name.clone()));
                conf_by_slot.insert(idx, *cached_conf);
                continue;
            }
            if prev_retries.get(&idx).copied().unwrap_or(0) >= POOL_RETRY_MAX_ATTEMPTS {
                recognized_by_slot.insert(idx, None);
                conf_by_slot.insert(idx, 0.0);
                continue;
            }
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

        let mut newly_recognized: Vec<(usize, String, f64)> = Vec::new();
        let mut newly_missed: Vec<usize> = Vec::new();
        for (&slot_idx, pred) in valid_indices.iter().zip(preds.iter()) {
            let conf = f64::from(pred.confidence);
            conf_by_slot.insert(slot_idx, conf);
            recognized_by_slot.insert(slot_idx, pred.class_name.clone());
            if let Some(name) = &pred.class_name {
                newly_recognized.push((slot_idx, name.clone(), conf));
            } else {
                newly_missed.push(slot_idx);
            }
        }

        let mut pool_names = HashSet::new();
        let mut pool_std_names = HashSet::new();
        let mut pool_ult_names = HashSet::new();
        for (slot_idx, maybe_name) in &recognized_by_slot {
            if let Some(name) = maybe_name {
                pool_names.insert(name.clone());
                if pool_slots.get(*slot_idx).is_some_and(|s| s.is_ult) {
                    pool_ult_names.insert(name.clone());
                } else {
                    pool_std_names.insert(name.clone());
                }
            }
        }

        let mut defining_abilities = Vec::new();
        for (slot_idx, (coord, is_ult)) in pool_coords.iter().enumerate() {
            if !*is_ult && coord.ability_order == Some(2) {
                defining_abilities.push(HeroDefiningAbility {
                    name: recognized_by_slot
                        .get(&slot_idx)
                        .and_then(|opt| opt.clone()),
                    confidence: conf_by_slot.get(&slot_idx).copied().unwrap_or(0.0),
                    hero_order: coord.hero_order,
                });
            }
        }

        let models = identify_hero_models(
            &defining_abilities,
            &layout.models_coords,
            &self.ability_to_hero_id,
            &self.heroes_by_id,
        );
        let identified_models: Vec<(Rect, IdentifiedHeroModel)> = layout
            .models_coords
            .iter()
            .zip(models)
            .map(|(coord, model)| {
                (
                    Rect {
                        x: coord.x,
                        y: coord.y,
                        width: coord.width.unwrap_or(0).max(0) as u32,
                        height: coord.height.unwrap_or(0).max(0) as u32,
                    },
                    model,
                )
            })
            .collect();

        let spot_w = layout.heroes_params.width.max(0) as u32;
        let spot_h = layout.heroes_params.height.max(0) as u32;
        let hero_spots: Vec<(u8, Rect)> = layout
            .heroes_coords
            .iter()
            .map(|coord| {
                (
                    coord.hero_order,
                    Rect {
                        x: coord.x,
                        y: coord.y,
                        width: spot_w,
                        height: spot_h,
                    },
                )
            })
            .collect();

        let (pick_readings, picked_abilities) =
            self.scan_picked_slots(frame, &layout, &pool_std_names, &pool_ult_names);
        let (op_combinations, trap_combinations) = self.find_pool_combinations(&pool_names);

        let analysis = CachedFrameAnalysis {
            target_resolution: format!("{}x{}", frame.width, frame.height),
            resolution_source: source,
            pool_slots,
            recognized_by_slot,
            pool_names,
            identified_models,
            hero_spots,
            picked_abilities,
            op_combinations,
            trap_combinations,
        };

        let mut session = self
            .session
            .lock()
            .map_err(|_| anyhow::anyhow!("session mutex poisoned"))?;

        for (slot_idx, name, conf) in newly_recognized {
            session.pool_slot_cache.insert(slot_idx, (name, conf));
            session.pool_retry_counts.remove(&slot_idx);
        }
        for slot_idx in newly_missed {
            let entry = session.pool_retry_counts.entry(slot_idx).or_insert(0);
            *entry = entry.saturating_add(1);
        }

        if !pick_readings.is_empty() && !self.pick_templates.is_empty() {
            let upd = reconcile_ability_picks(&session.timeline, &pick_readings, None, None);
            session.timeline = upd.timeline;
            for mut ev in upd.added {
                ev.seq = session.timeline.len();
                session.timeline.push(ev);
            }
        }

        let mut sigs = std::mem::take(&mut session.ocr_strip_sigs);
        let mut ocr_reads = std::mem::take(&mut session.ocr_hero_names_by_row);
        self.run_card_ocr_updates(
            frame,
            &analysis.hero_spots,
            &analysis.identified_models,
            &mut sigs,
            &mut ocr_reads,
        );
        session.ocr_strip_sigs = sigs;
        session.ocr_hero_names_by_row = ocr_reads;

        let pool_model_refs: Vec<PoolModelRef> = analysis
            .identified_models
            .iter()
            .map(|(_, m)| PoolModelRef {
                hero_order: m.hero_order,
                hero_name: Some(m.hero_name.clone()),
            })
            .collect();
        let ocr_raw_map: HashMap<u8, String> = session
            .ocr_hero_names_by_row
            .iter()
            .map(|(&r, rd)| (r, rd.name.clone()))
            .collect();
        let own_row = options.selected_spot_hero_order.or_else(|| {
            options
                .gsi_local_hero
                .as_deref()
                .and_then(|hero| resolve_own_row_from_ocr(&ocr_raw_map, hero, options.gsi_team_half_start))
        });
        let local_anchor = match (options.gsi_local_hero.as_ref(), own_row) {
            (Some(hero_name), Some(row)) => Some(LocalModelAnchor {
                hero_name: hero_name.clone(),
                row,
            }),
            _ => None,
        };
        let assignments = resolve_model_assignments(
            &pool_model_refs,
            &session.ocr_hero_names_by_row,
            local_anchor.as_ref(),
        );
        if !assignments.is_empty() {
            let model_upd =
                reconcile_model_markers(&session.timeline, &assignments, None, None);
            session.timeline = model_upd.timeline;
            for mut ev in model_upd.added {
                ev.seq = session.timeline.len();
                session.timeline.push(ev);
            }
        }

        let snapshot = self.build_snapshot(
            &analysis,
            &session.timeline,
            &session.ocr_hero_names_by_row,
            options,
            sequence,
        );
        session.last_analysis = Some(analysis);
        Ok(snapshot)
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
    use super::*;

    fn test_pipeline() -> ScanPipeline {
        let resources_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../resources");
        ScanPipeline::from_resources_dir(&resources_dir).expect("load ScanPipeline")
    }

    fn base_scan_options() -> ScanOptions {
        ScanOptions {
            role_mode: RoleMode::Fixed,
            role_fixed_positions: vec![1, 2],
            selected_spot_hero_order: Some(0),
            selected_model_hero_order: None,
            auto_rescan_enabled: true,
            dota_window: None,
            gsi_local_hero: None,
            gsi_team_half_start: None,
            gsi_connected: false,
            game_phase: None,
        }
    }

    #[test]
    fn finds_op_and_trap_combinations_across_real_database() {
        let pipeline = test_pipeline();
        let (ops, traps) = pipeline.find_pool_combinations(&pipeline.active_class_names);
        assert!(!ops.is_empty(), "expected real OP combinations in seed DB");
        assert!(!traps.is_empty(), "expected real Trap combinations in seed DB");
        assert!(ops.len() <= MAX_COMBO_ENTRIES);
        assert!(traps.len() <= MAX_COMBO_ENTRIES);
    }

    #[test]
    fn scans_synthetic_1920x1080_frame_into_pool_spots_and_hero_models() {
        let pipeline = test_pipeline();
        assert!(pipeline.layout_count() >= 20);

        let frame = RawFrame {
            width: 1920,
            height: 1080,
            format: PixelFormat::Bgra8,
            bytes: vec![64u8; 1920 * 1080 * 4],
        };
        let options = base_scan_options();

        let snapshot = pipeline
            .scan_frame(&frame, &options, 1)
            .expect("scan synthetic 1080p frame");
        assert_eq!(snapshot.target_resolution, "1920x1080");
        assert_eq!(snapshot.resolution_source, ResolutionSource::Preset);
        assert!(!snapshot.scanning);
        assert_eq!(snapshot.slots.len(), 48);
        assert_eq!(snapshot.hero_spots.len(), 10);
        assert_eq!(snapshot.hero_models.len(), 12);
        assert_eq!(snapshot.picked_abilities.len(), 40);
        assert!(snapshot.hero_spots.iter().any(|s| s.hero_order == 0 && s.is_my_spot));
        assert!(snapshot.auto_rescan_enabled);
    }

    #[test]
    fn scan_png_bytes_decodes_in_memory_1080p_png() {
        let pipeline = test_pipeline();
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, 1920, 1080);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            let raw = vec![48u8; 1920 * 1080 * 4];
            writer.write_image_data(&raw).unwrap();
        }

        let snap = pipeline
            .scan_png_bytes(&png_bytes, &base_scan_options(), 7)
            .expect("scan encoded PNG bytes");
        assert_eq!(snap.sequence, 7);
        assert_eq!(snap.slots.len(), 48);
        assert_eq!(snap.target_resolution, "1920x1080");
    }

    #[test]
    fn rescore_cached_updates_spot_model_suppresses_hero_and_auto_resolves_own_row() {
        let pipeline = test_pipeline();
        let mut names_iter = pipeline.abilities_by_name.keys().cloned();
        let ab1 = names_iter.next().unwrap();
        let ab2 = names_iter.next().unwrap();

        let (axe_id, axe_rec) = pipeline
            .heroes_by_id
            .iter()
            .find(|(_, h)| h.winrate.unwrap_or(0.0) > 0.5)
            .map(|(&id, h)| (id, h.clone()))
            .unwrap();

        let analysis = CachedFrameAnalysis {
            target_resolution: "1920x1080".into(),
            resolution_source: ResolutionSource::Preset,
            pool_slots: vec![
                PoolSlotMeta {
                    bounds: Rect { x: 10, y: 10, width: 40, height: 40 },
                    is_ult: false,
                },
                PoolSlotMeta {
                    bounds: Rect { x: 60, y: 10, width: 40, height: 40 },
                    is_ult: false,
                },
            ],
            recognized_by_slot: HashMap::from([(0, Some(ab1.clone())), (1, Some(ab2.clone()))]),
            pool_names: HashSet::from([ab1, ab2]),
            identified_models: vec![(
                Rect { x: 200, y: 200, width: 44, height: 44 },
                IdentifiedHeroModel {
                    hero_order: 3,
                    hero_name: axe_rec.name.clone(),
                    hero_display_name: axe_rec.display_name.clone(),
                    db_hero_id: Some(axe_id),
                    winrate: Some(0.99),
                    pick_rate: Some(1.0),
                    identification_confidence: 0.99,
                },
            )],
            hero_spots: vec![
                (0, Rect { x: 20, y: 20, width: 200, height: 100 }),
                (4, Rect { x: 20, y: 140, width: 200, height: 100 }),
            ],
            picked_abilities: Vec::new(),
            op_combinations: Vec::new(),
            trap_combinations: Vec::new(),
        };

        {
            let mut session = pipeline.session.lock().unwrap();
            session.last_analysis = Some(analysis);
            session.ocr_hero_names_by_row.insert(
                4,
                OcrHeroRead {
                    name: axe_rec.name.clone(),
                    similarity: 1.0,
                },
            );
        }

        let auto_row_opts = ScanOptions {
            role_mode: RoleMode::Off,
            role_fixed_positions: vec![],
            selected_spot_hero_order: None,
            selected_model_hero_order: None,
            auto_rescan_enabled: false,
            dota_window: None,
            gsi_local_hero: Some(axe_rec.name.clone()),
            gsi_team_half_start: Some(0),
            gsi_connected: false,
            game_phase: None,
        };
        let snap1 = pipeline.rescore_cached(&auto_row_opts, 2).expect("cached snapshot");
        assert!(snap1.hero_models[0].is_top_tier);
        assert_eq!(snap1.selected_spot_hero_order, Some(4));
        assert!(snap1.hero_spots[1].is_my_spot);
        assert_eq!(
            snap1.hero_spots[1].ocr_hero_name.as_deref(),
            Some(axe_rec.display_name.as_str())
        );

        let with_model_opts = ScanOptions {
            selected_model_hero_order: Some(3),
            selected_spot_hero_order: Some(0),
            ..auto_row_opts
        };
        let snap2 = pipeline.rescore_cached(&with_model_opts, 3).expect("rescored snapshot");
        assert!(!snap2.hero_models[0].is_top_tier);
        assert!(snap2.hero_models[0].is_my_model);
        assert!(snap2.hero_spots[0].is_my_spot);
    }

    #[test]
    fn synergy_partner_lookup_marks_strong_partners_for_my_spot() {
        let pipeline = test_pipeline();
        let pair = pipeline
            .synergies
            .iter()
            .find(|s| s.is_op || s.synergy_increase.is_some_and(|v| v >= DEFAULT_OP_THRESHOLD))
            .expect("expected at least one strong synergy pair in seed DB")
            .clone();

        let analysis = CachedFrameAnalysis {
            target_resolution: "1920x1080".into(),
            resolution_source: ResolutionSource::Preset,
            pool_slots: vec![PoolSlotMeta {
                bounds: Rect { x: 10, y: 10, width: 40, height: 40 },
                is_ult: false,
            }],
            recognized_by_slot: HashMap::from([(0, Some(pair.internal2.clone()))]),
            pool_names: HashSet::from([pair.internal2.clone()]),
            identified_models: Vec::new(),
            hero_spots: Vec::new(),
            picked_abilities: vec![PickedAbilitySlot {
                hero_order: 2,
                box_index: 0,
                is_ultimate: false,
                ability_name: Some(pair.internal1.clone()),
                display_name: pair.display1.clone(),
            }],
            op_combinations: Vec::new(),
            trap_combinations: Vec::new(),
        };

        let opts = ScanOptions {
            role_mode: RoleMode::Off,
            role_fixed_positions: vec![],
            selected_spot_hero_order: Some(2),
            selected_model_hero_order: None,
            auto_rescan_enabled: false,
            dota_window: None,
            gsi_local_hero: None,
            gsi_team_half_start: None,
            gsi_connected: false,
            game_phase: None,
        };
        let snap = pipeline.build_snapshot(&analysis, &[], &HashMap::new(), &opts, 5);
        assert!(snap.slots[0].is_synergy_pick);
        assert_eq!(snap.slots[0].top_rank, Some(1));
    }

    #[test]
    fn pool_slot_cache_retains_known_slots_and_caps_unknown_retries() {
        let pipeline = test_pipeline();
        let known_name = pipeline.abilities_by_name.keys().next().unwrap().clone();
        {
            let mut session = pipeline.session.lock().unwrap();
            session.pool_slot_cache.insert(0, (known_name.clone(), 0.99));
            session.pool_retry_counts.insert(1, POOL_RETRY_MAX_ATTEMPTS);
        }

        let frame = RawFrame {
            width: 1920,
            height: 1080,
            format: PixelFormat::Bgra8,
            bytes: vec![0u8; 1920 * 1080 * 4],
        };
        let snap = pipeline
            .scan_frame(&frame, &base_scan_options(), 10)
            .expect("scan with cached pool slot");
        assert!(!snap.slots[0].is_unknown);
        assert!(snap.slots[1].is_unknown);
        let session = pipeline.session.lock().unwrap();
        assert_eq!(
            session.pool_retry_counts.get(&1).copied(),
            Some(POOL_RETRY_MAX_ATTEMPTS)
        );
        assert_eq!(session.pool_retry_counts.get(&2).copied(), Some(1));
    }

    #[test]
    fn dynamic_role_mode_stays_neutral_empty_and_infers_from_picks() {
        let pipeline = test_pipeline();
        let carry_pick = pipeline
            .shift_axes
            .iter()
            .max_by(|a, b| a.1.greed.total_cmp(&b.1.greed))
            .map(|(n, _)| n.clone())
            .unwrap();
        let candidate = pipeline
            .abilities_by_name
            .keys()
            .find(|n| *n != &carry_pick && pipeline.shift_axes.contains_key(*n))
            .unwrap()
            .clone();

        let analysis = CachedFrameAnalysis {
            target_resolution: "1920x1080".into(),
            resolution_source: ResolutionSource::Preset,
            pool_slots: vec![PoolSlotMeta {
                bounds: Rect { x: 10, y: 10, width: 40, height: 40 },
                is_ult: false,
            }],
            recognized_by_slot: HashMap::from([(0, Some(candidate.clone()))]),
            pool_names: HashSet::from([candidate.clone()]),
            identified_models: Vec::new(),
            hero_spots: Vec::new(),
            picked_abilities: Vec::new(),
            op_combinations: Vec::new(),
            trap_combinations: Vec::new(),
        };

        let dyn_opts = ScanOptions {
            role_mode: RoleMode::Dynamic,
            role_fixed_positions: vec![],
            selected_spot_hero_order: Some(0),
            selected_model_hero_order: None,
            auto_rescan_enabled: false,
            dota_window: None,
            gsi_local_hero: None,
            gsi_team_half_start: None,
            gsi_connected: false,
            game_phase: None,
        };
        let off_opts = ScanOptions {
            role_mode: RoleMode::Off,
            ..dyn_opts.clone()
        };

        let snap_empty_dyn = pipeline.build_snapshot(&analysis, &[], &HashMap::new(), &dyn_opts, 1);
        let snap_empty_off = pipeline.build_snapshot(&analysis, &[], &HashMap::new(), &off_opts, 1);
        assert_eq!(
            snap_empty_dyn.slots[0].consolidated_score,
            snap_empty_off.slots[0].consolidated_score
        );

        let inferred = pipeline.infer_dynamic_positions(&[carry_pick]);
        assert!(!inferred.is_empty());
        assert!(inferred.len() <= 2);
    }
}
