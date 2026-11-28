//! Native standalone Control Panel application (`eframe` / `wgpu`) for Ability Draft Plus.

mod client;

use std::{
    process::Child,
    sync::{Arc, RwLock},
};

use ad_protocol::{
    AbilityCatalogEntry, DaemonSettings, HeroCatalogEntry, OverlayCommand, PROTOCOL_VERSION,
    RoleMode,
};
use client::{ensure_daemon_running, spawn_panel_worker, PanelAction, PanelState};
use eframe::egui::{self, Color32, CornerRadius, RichText, Stroke};
use tokio::sync::mpsc;
use tracing::info;

const BG_MAIN: Color32 = Color32::from_rgb(11, 16, 23);
const BG_CARD: Color32 = Color32::from_rgb(18, 25, 36);
const BG_SIDEBAR: Color32 = Color32::from_rgb(14, 20, 29);
const GOLD_ACCENT: Color32 = Color32::from_rgb(212, 173, 86);
const TEAL_OK: Color32 = Color32::from_rgb(33, 185, 154);
const TRAP_RED: Color32 = Color32::from_rgb(230, 114, 140);
const MUTED_TEXT: Color32 = Color32::from_rgb(148, 163, 184);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Page {
    Dashboard,
    Abilities,
    Heroes,
    Streaming,
    Settings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AbilityFilter {
    All,
    StandardOnly,
    UltimateOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SortKey {
    Name,
    Winrate,
    PickRate,
    Score,
}

fn filter_and_sort_abilities<'a>(
    abilities: &'a [AbilityCatalogEntry],
    query: &str,
    filter: AbilityFilter,
    sort_key: SortKey,
    descending: bool,
) -> Vec<&'a AbilityCatalogEntry> {
    let q = query.trim().to_ascii_lowercase();
    let mut list: Vec<&AbilityCatalogEntry> = abilities
        .iter()
        .filter(|entry| match filter {
            AbilityFilter::All => true,
            AbilityFilter::StandardOnly => !entry.is_ultimate,
            AbilityFilter::UltimateOnly => entry.is_ultimate,
        })
        .filter(|entry| {
            if q.is_empty() {
                return true;
            }
            entry.display_name.to_ascii_lowercase().contains(&q)
                || entry.name.to_ascii_lowercase().contains(&q)
                || entry
                    .hero_display_name
                    .as_deref()
                    .is_some_and(|h| h.to_ascii_lowercase().contains(&q))
                || entry
                    .tags
                    .iter()
                    .any(|t| t.to_ascii_lowercase().contains(&q))
        })
        .collect();

    list.sort_by(|a, b| {
        let ord = match sort_key {
            SortKey::Name => a.display_name.cmp(&b.display_name),
            SortKey::Winrate => a
                .winrate
                .unwrap_or(0.0)
                .total_cmp(&b.winrate.unwrap_or(0.0)),
            SortKey::PickRate => a
                .pick_rate
                .unwrap_or(99.0)
                .total_cmp(&b.pick_rate.unwrap_or(99.0)),
            SortKey::Score => a.consolidated_score.total_cmp(&b.consolidated_score),
        };
        if descending {
            ord.reverse()
        } else {
            ord
        }
    });
    list
}

fn filter_and_sort_heroes<'a>(
    heroes: &'a [HeroCatalogEntry],
    query: &str,
    sort_key: SortKey,
    descending: bool,
) -> Vec<&'a HeroCatalogEntry> {
    let q = query.trim().to_ascii_lowercase();
    let mut list: Vec<&HeroCatalogEntry> = heroes
        .iter()
        .filter(|hero| {
            q.is_empty()
                || hero.display_name.to_ascii_lowercase().contains(&q)
                || hero.name.to_ascii_lowercase().contains(&q)
        })
        .collect();

    list.sort_by(|a, b| {
        let ord = match sort_key {
            SortKey::Name => a.display_name.cmp(&b.display_name),
            SortKey::Winrate => a
                .winrate
                .unwrap_or(0.0)
                .total_cmp(&b.winrate.unwrap_or(0.0)),
            SortKey::PickRate => a
                .pick_rate
                .unwrap_or(99.0)
                .total_cmp(&b.pick_rate.unwrap_or(99.0)),
            SortKey::Score => a.consolidated_score.total_cmp(&b.consolidated_score),
        };
        if descending {
            ord.reverse()
        } else {
            ord
        }
    });
    list
}

struct ControlPanelApp {
    port: u16,
    daemon_url: String,
    state: Arc<RwLock<PanelState>>,
    action_tx: mpsc::UnboundedSender<PanelAction>,
    owned_daemon: Option<Child>,
    active_page: Page,
    ability_search: String,
    ability_filter: AbilityFilter,
    ability_sort: SortKey,
    ability_desc: bool,
    hero_search: String,
    hero_sort: SortKey,
    hero_desc: bool,
    draft_settings: DaemonSettings,
    draft_settings_synced: bool,
}

impl Drop for ControlPanelApp {
    fn drop(&mut self) {
        let _ = self.action_tx.send(PanelAction::StopOverlay);
        if let Some(mut child) = self.owned_daemon.take() {
            info!("Shutting down managed ad-daemon child on Control Panel exit");
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl ControlPanelApp {
    fn new(
        cc: &eframe::CreationContext<'_>,
        port: u16,
        daemon_url: String,
        owned_daemon: Option<Child>,
    ) -> Self {
        let state = Arc::new(RwLock::new(PanelState::default()));
        let (action_tx, action_rx) = mpsc::unbounded_channel();

        let repaint_ctx = cc.egui_ctx.clone();
        spawn_panel_worker(
            daemon_url.clone(),
            state.clone(),
            action_rx,
            Arc::new(move || repaint_ctx.request_repaint()),
        );

        let mut visuals = egui::Visuals::dark();
        visuals.panel_fill = BG_MAIN;
        visuals.window_fill = BG_CARD;
        cc.egui_ctx.set_visuals(visuals);

        Self {
            port,
            daemon_url,
            state,
            action_tx,
            owned_daemon,
            active_page: Page::Dashboard,
            ability_search: String::new(),
            ability_filter: AbilityFilter::All,
            ability_sort: SortKey::Score,
            ability_desc: true,
            hero_search: String::new(),
            hero_sort: SortKey::Score,
            hero_desc: true,
            draft_settings: DaemonSettings::default(),
            draft_settings_synced: false,
        }
    }

    fn send(&self, action: PanelAction) {
        let _ = self.action_tx.send(action);
    }

    fn draw_card(ui: &mut egui::Ui, title: &str, value: &str, detail: &str, accent: Color32) {
        egui::Frame::NONE
            .fill(BG_CARD)
            .stroke(Stroke::new(1.0, Color32::from_rgb(38, 49, 66)))
            .corner_radius(CornerRadius::same(8))
            .inner_margin(egui::Margin::same(12))
            .show(ui, |ui| {
                ui.set_min_width(205.0);
                ui.label(RichText::new(title).color(MUTED_TEXT).size(12.0));
                ui.add_space(4.0);
                ui.label(RichText::new(value).color(accent).strong().size(18.0));
                if !detail.is_empty() {
                    ui.add_space(2.0);
                    ui.label(RichText::new(detail).color(MUTED_TEXT).size(11.5));
                }
            });
    }

    fn draw_dashboard(&self, ui: &mut egui::Ui, st: &PanelState) {
        ui.heading(RichText::new("Dashboard").color(Color32::WHITE).size(22.0));
        ui.add_space(10.0);

        let daemon_val = if st.daemon_connected {
            "Connected"
        } else {
            "Disconnected"
        };
        let daemon_detail = st
            .health
            .as_ref()
            .map(|h| format!("Backend: {}", h.capture_backend))
            .unwrap_or_else(|| self.daemon_url.clone());

        let ov_running = st.overlay_status.as_ref().is_some_and(|o| o.running);
        let ov_val = if ov_running { "Running" } else { "Idle" };
        let ov_detail = match (
            st.overlay_status.as_ref().and_then(|o| o.pid),
            st.snapshot.as_ref().and_then(|s| s.dota_window),
        ) {
            (Some(pid), Some(w)) => format!("PID {pid} · {}x{}", w.width, w.height),
            (Some(pid), None) => format!("PID {pid} · Waiting for Dota 2"),
            (None, Some(w)) => format!("Dota 2 detected ({}x{})", w.width, w.height),
            (None, None) => "Dota 2 window not found".to_string(),
        };

        let (db_val, db_detail) = match st.health.as_ref().and_then(|h| h.db_summary.as_ref()) {
            Some(db) => (
                format!("{} Abilities", db.abilities_count),
                format!(
                    "{} Heroes · {} Pick Icons",
                    db.heroes_count,
                    st.health
                        .as_ref()
                        .map(|h| h.pick_templates_loaded)
                        .unwrap_or(0)
                ),
            ),
            None => ("Not Loaded".to_string(), "Check resources/dota_ad_data.db".to_string()),
        };

        let gsi_on = st.snapshot.as_ref().is_some_and(|s| s.gsi_connected)
            || st.health.as_ref().is_some_and(|h| h.gsi_connected);
        let gsi_val = if gsi_on { "Connected" } else { "Waiting" };
        let gsi_detail = st
            .snapshot
            .as_ref()
            .and_then(|s| s.game_phase.as_deref())
            .unwrap_or("Waiting for Dota 2 GSI packets");

        ui.horizontal_wrapped(|ui| {
            Self::draw_card(
                ui,
                "Daemon Service",
                daemon_val,
                &daemon_detail,
                if st.daemon_connected { TEAL_OK } else { TRAP_RED },
            );
            Self::draw_card(
                ui,
                "Native Overlay",
                ov_val,
                &ov_detail,
                if ov_running { TEAL_OK } else { MUTED_TEXT },
            );
            Self::draw_card(
                ui,
                "Seed Database",
                &db_val,
                &db_detail,
                if st.health.as_ref().and_then(|h| h.db_summary.as_ref()).is_some() {
                    GOLD_ACCENT
                } else {
                    TRAP_RED
                },
            );
            Self::draw_card(
                ui,
                "Dota 2 GSI",
                gsi_val,
                gsi_detail,
                if gsi_on { TEAL_OK } else { MUTED_TEXT },
            );
        });

        ui.add_space(16.0);
        egui::Frame::NONE
            .fill(BG_CARD)
            .stroke(Stroke::new(1.0, Color32::from_rgb(38, 49, 66)))
            .corner_radius(CornerRadius::same(8))
            .inner_margin(egui::Margin::same(14))
            .show(ui, |ui| {
                ui.label(RichText::new("Quick Actions").color(GOLD_ACCENT).strong());
                ui.add_space(8.0);
                ui.horizontal_wrapped(|ui| {
                    if ov_running {
                        if ui.button("Stop Overlay").clicked() {
                            self.send(PanelAction::StopOverlay);
                        }
                    } else if ui.button("Launch Overlay").clicked() {
                        self.send(PanelAction::LaunchOverlay);
                    }
                    if ui
                        .button("Scan Board Now")
                        .on_hover_text("Ctrl+Shift+S")
                        .clicked()
                    {
                        self.send(PanelAction::SendCommand(OverlayCommand::TriggerScan {
                            is_initial: true,
                        }));
                    }
                    if ui
                        .button("Reset Draft")
                        .on_hover_text("Ctrl+Shift+R")
                        .clicked()
                    {
                        self.send(PanelAction::SendCommand(OverlayCommand::ResetDraft));
                    }

                    let auto_enabled = st
                        .snapshot
                        .as_ref()
                        .map(|s| s.auto_rescan_enabled)
                        .unwrap_or(st.settings.auto_rescan_enabled);
                    if ui
                        .selectable_label(auto_enabled, "Auto-Scan (GSI)")
                        .clicked()
                    {
                        self.send(PanelAction::SendCommand(OverlayCommand::SetAutoRescan {
                            enabled: !auto_enabled,
                        }));
                    }
                });

                if let Some(snap) = &st.snapshot {
                    ui.add_space(10.0);
                    ui.horizontal_wrapped(|ui| {
                        ui.label(RichText::new("Role Mode:").color(MUTED_TEXT));
                        if ui
                            .selectable_label(snap.role_mode == RoleMode::Off, "Off")
                            .clicked()
                        {
                            self.send(PanelAction::SendCommand(OverlayCommand::SetRoleMode {
                                mode: RoleMode::Off,
                                fixed_positions: snap.role_fixed_positions.clone(),
                            }));
                        }
                        for pos in 1..=5u8 {
                            let active = snap.role_mode == RoleMode::Fixed
                                && snap.role_fixed_positions.contains(&pos);
                            if ui.selectable_label(active, format!("Pos {pos}")).clicked() {
                                let mut next = if snap.role_mode == RoleMode::Fixed {
                                    snap.role_fixed_positions.clone()
                                } else {
                                    Vec::new()
                                };
                                if let Some(idx) = next.iter().position(|&p| p == pos) {
                                    next.remove(idx);
                                } else {
                                    next.push(pos);
                                    next.sort_unstable();
                                }
                                let mode = if next.is_empty() {
                                    RoleMode::Off
                                } else {
                                    RoleMode::Fixed
                                };
                                self.send(PanelAction::SendCommand(OverlayCommand::SetRoleMode {
                                    mode,
                                    fixed_positions: next,
                                }));
                            }
                        }
                        if ui
                            .selectable_label(snap.role_mode == RoleMode::Dynamic, "Auto")
                            .clicked()
                        {
                            let mode = if snap.role_mode == RoleMode::Dynamic {
                                RoleMode::Off
                            } else {
                                RoleMode::Dynamic
                            };
                            self.send(PanelAction::SendCommand(OverlayCommand::SetRoleMode {
                                mode,
                                fixed_positions: snap.role_fixed_positions.clone(),
                            }));
                        }
                    });
                }
            });

        ui.add_space(16.0);
        if let Some(snap) = &st.snapshot {
            egui::Frame::NONE
                .fill(BG_CARD)
                .stroke(Stroke::new(1.0, Color32::from_rgb(38, 49, 66)))
                .corner_radius(CornerRadius::same(8))
                .inner_margin(egui::Margin::same(14))
                .show(ui, |ui| {
                    let recognized = snap.slots.iter().filter(|s| !s.is_unknown).count();
                    let picks = snap
                        .picked_abilities
                        .iter()
                        .filter(|p| p.ability_name.is_some())
                        .count();
                    ui.label(
                        RichText::new(format!(
                            "Live Draft Snapshot (Seq #{}) · Resolution: {} · Pool {}/{} · {} Picks",
                            snap.sequence,
                            snap.target_resolution,
                            recognized,
                            snap.slots.len(),
                            picks
                        ))
                        .color(Color32::WHITE)
                        .strong(),
                    );
                    ui.add_space(8.0);
                    ui.columns(2, |cols| {
                        cols[0].label(
                            RichText::new(format!("OP Combinations ({})", snap.op_combinations.len()))
                                .color(TEAL_OK)
                                .strong(),
                        );
                        if snap.op_combinations.is_empty() {
                            cols[0].label(RichText::new("Scan an active draft board to compute OP pairs.").color(MUTED_TEXT));
                        } else {
                            for combo in snap.op_combinations.iter().take(8) {
                                cols[0].label(format!(
                                    "{} + {} ({:.1}%)",
                                    combo.ability1_name,
                                    combo.ability2_name,
                                    combo.synergy_winrate * 100.0
                                ));
                            }
                        }

                        cols[1].label(
                            RichText::new(format!("Trap Combinations ({})", snap.trap_combinations.len()))
                                .color(TRAP_RED)
                                .strong(),
                        );
                        if snap.trap_combinations.is_empty() {
                            cols[1].label(RichText::new("No trap pairs flagged yet.").color(MUTED_TEXT));
                        } else {
                            for combo in snap.trap_combinations.iter().take(8) {
                                cols[1].label(format!(
                                    "{} + {} ({:.1}%)",
                                    combo.ability1_name,
                                    combo.ability2_name,
                                    combo.synergy_winrate * 100.0
                                ));
                            }
                        }
                    });
                });
        }
    }

    fn draw_abilities(&mut self, ui: &mut egui::Ui, st: &PanelState) {
        ui.heading(RichText::new("Abilities Catalog").color(Color32::WHITE).size(22.0));
        ui.add_space(8.0);
        ui.horizontal_wrapped(|ui| {
            ui.label("Search:");
            ui.text_edit_singleline(&mut self.ability_search);
            ui.selectable_value(&mut self.ability_filter, AbilityFilter::All, "All");
            ui.selectable_value(&mut self.ability_filter, AbilityFilter::StandardOnly, "Standard");
            ui.selectable_value(&mut self.ability_filter, AbilityFilter::UltimateOnly, "Ultimate");
            ui.separator();
            ui.label("Sort:");
            for (key, label) in [
                (SortKey::Score, "Score"),
                (SortKey::Winrate, "Winrate"),
                (SortKey::PickRate, "Pick #"),
                (SortKey::Name, "Name"),
            ] {
                if ui.selectable_label(self.ability_sort == key, label).clicked() {
                    if self.ability_sort == key {
                        self.ability_desc = !self.ability_desc;
                    } else {
                        self.ability_sort = key;
                        self.ability_desc = key != SortKey::Name && key != SortKey::PickRate;
                    }
                }
            }
        });

        let filtered = filter_and_sort_abilities(
            &st.abilities,
            &self.ability_search,
            self.ability_filter,
            self.ability_sort,
            self.ability_desc,
        );
        ui.label(
            RichText::new(format!("Showing {} of {} abilities", filtered.len(), st.abilities.len()))
                .color(MUTED_TEXT)
                .size(12.0),
        );
        ui.add_space(6.0);

        egui::ScrollArea::vertical().show(ui, |ui| {
            egui::Grid::new("abilities_table")
                .striped(true)
                .min_col_width(90.0)
                .show(ui, |ui| {
                    ui.label(RichText::new("Ability").color(GOLD_ACCENT).strong());
                    ui.label(RichText::new("Hero").color(GOLD_ACCENT).strong());
                    ui.label(RichText::new("Winrate").color(GOLD_ACCENT).strong());
                    ui.label(RichText::new("Avg Pick").color(GOLD_ACCENT).strong());
                    ui.label(RichText::new("Score").color(GOLD_ACCENT).strong());
                    ui.label(RichText::new("Tags").color(GOLD_ACCENT).strong());
                    ui.end_row();

                    for ab in filtered.into_iter().take(200) {
                        ui.label(if ab.is_ultimate {
                            format!("{} [R]", ab.display_name)
                        } else {
                            ab.display_name.clone()
                        });
                        ui.label(ab.hero_display_name.as_deref().unwrap_or("-"));
                        ui.label(
                            ab.winrate
                                .map(|w| format!("{:.1}%", w * 100.0))
                                .unwrap_or_else(|| "-".to_string()),
                        );
                        ui.label(
                            ab.pick_rate
                                .map(|p| format!("#{p:.1}"))
                                .unwrap_or_else(|| "-".to_string()),
                        );
                        ui.label(format!("{:.3}", ab.consolidated_score));
                        ui.label(RichText::new(ab.tags.join(", ")).color(MUTED_TEXT));
                        ui.end_row();
                    }
                });
        });
    }

    fn draw_heroes(&mut self, ui: &mut egui::Ui, st: &PanelState) {
        ui.heading(RichText::new("Hero Models").color(Color32::WHITE).size(22.0));
        ui.add_space(8.0);
        ui.horizontal_wrapped(|ui| {
            ui.label("Search:");
            ui.text_edit_singleline(&mut self.hero_search);
            ui.separator();
            ui.label("Sort:");
            for (key, label) in [
                (SortKey::Score, "Score"),
                (SortKey::Winrate, "Winrate"),
                (SortKey::PickRate, "Pick #"),
                (SortKey::Name, "Name"),
            ] {
                if ui.selectable_label(self.hero_sort == key, label).clicked() {
                    if self.hero_sort == key {
                        self.hero_desc = !self.hero_desc;
                    } else {
                        self.hero_sort = key;
                        self.hero_desc = key != SortKey::Name && key != SortKey::PickRate;
                    }
                }
            }
        });

        let filtered = filter_and_sort_heroes(
            &st.heroes,
            &self.hero_search,
            self.hero_sort,
            self.hero_desc,
        );
        ui.label(
            RichText::new(format!("Showing {} of {} heroes", filtered.len(), st.heroes.len()))
                .color(MUTED_TEXT)
                .size(12.0),
        );
        ui.add_space(6.0);

        egui::ScrollArea::vertical().show(ui, |ui| {
            egui::Grid::new("heroes_table")
                .striped(true)
                .min_col_width(120.0)
                .show(ui, |ui| {
                    ui.label(RichText::new("Hero").color(GOLD_ACCENT).strong());
                    ui.label(RichText::new("Winrate").color(GOLD_ACCENT).strong());
                    ui.label(RichText::new("Avg Pick").color(GOLD_ACCENT).strong());
                    ui.label(RichText::new("Score").color(GOLD_ACCENT).strong());
                    ui.end_row();

                    for hero in filtered {
                        ui.label(&hero.display_name);
                        ui.label(
                            hero.winrate
                                .map(|w| format!("{:.1}%", w * 100.0))
                                .unwrap_or_else(|| "-".to_string()),
                        );
                        ui.label(
                            hero.pick_rate
                                .map(|p| format!("#{p:.1}"))
                                .unwrap_or_else(|| "-".to_string()),
                        );
                        ui.label(format!("{:.3}", hero.consolidated_score));
                        ui.end_row();
                    }
                });
        });
    }

    fn draw_streaming(ctx: &egui::Context, daemon_url: &str, ui: &mut egui::Ui, st: &PanelState) {
        ui.heading(RichText::new("OBS Streaming & GSI").color(Color32::WHITE).size(22.0));
        ui.add_space(10.0);

        let stream_url = format!("{}/stream", daemon_url.trim_end_matches('/'));
        let picks_url = format!("{}/picks", daemon_url.trim_end_matches('/'));
        let gsi_url = format!("{}/gsi", daemon_url.trim_end_matches('/'));

        egui::Frame::NONE
            .fill(BG_CARD)
            .stroke(Stroke::new(1.0, Color32::from_rgb(38, 49, 66)))
            .corner_radius(CornerRadius::same(8))
            .inner_margin(egui::Margin::same(14))
            .show(ui, |ui| {
                ui.label(RichText::new("Local Browser Source Endpoints").color(GOLD_ACCENT).strong());
                ui.add_space(8.0);
                for (label, url) in [
                    ("Draft Board Browser Source", &stream_url),
                    ("In-Game Picks Strip Source", &picks_url),
                    ("Dota 2 GSI Endpoint (POST)", &gsi_url),
                ] {
                    ui.horizontal(|ui| {
                        ui.label(format!("{label}:"));
                        ui.monospace(url);
                        if ui.button("Copy").clicked() {
                            ctx.copy_text(url.clone());
                        }
                    });
                }
                ui.add_space(10.0);
                let gsi_on = st.snapshot.as_ref().is_some_and(|s| s.gsi_connected);
                ui.label(format!(
                    "GSI Status: {}",
                    if gsi_on { "Connected" } else { "Waiting for Dota 2 packets" }
                ));
            });
    }

    fn draw_settings(&mut self, ui: &mut egui::Ui) {
        ui.heading(RichText::new("Settings & Hotkeys").color(Color32::WHITE).size(22.0));
        ui.add_space(10.0);

        egui::Frame::NONE
            .fill(BG_CARD)
            .stroke(Stroke::new(1.0, Color32::from_rgb(38, 49, 66)))
            .corner_radius(CornerRadius::same(8))
            .inner_margin(egui::Margin::same(14))
            .show(ui, |ui| {
                ui.checkbox(
                    &mut self.draft_settings.auto_rescan_enabled,
                    "Enable GSI Auto-Rescan automatically",
                );
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    ui.label("Default Role Mode:");
                    ui.selectable_value(&mut self.draft_settings.role_mode, RoleMode::Off, "Off");
                    ui.selectable_value(
                        &mut self.draft_settings.role_mode,
                        RoleMode::Fixed,
                        "Fixed",
                    );
                    ui.selectable_value(
                        &mut self.draft_settings.role_mode,
                        RoleMode::Dynamic,
                        "Auto (Dynamic)",
                    );
                });
                if self.draft_settings.role_mode == RoleMode::Fixed {
                    ui.horizontal(|ui| {
                        ui.label("Fixed Positions:");
                        for pos in 1..=5u8 {
                            let active = self.draft_settings.role_fixed_positions.contains(&pos);
                            if ui.selectable_label(active, format!("Pos {pos}")).clicked() {
                                if let Some(idx) = self
                                    .draft_settings
                                    .role_fixed_positions
                                    .iter()
                                    .position(|&p| p == pos)
                                {
                                    self.draft_settings.role_fixed_positions.remove(idx);
                                } else {
                                    self.draft_settings.role_fixed_positions.push(pos);
                                    self.draft_settings.role_fixed_positions.sort_unstable();
                                }
                            }
                        }
                    });
                }
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    ui.label("OP Synergy Threshold:");
                    ui.add(
                        egui::DragValue::new(&mut self.draft_settings.op_threshold)
                            .speed(0.005)
                            .range(0.02..=0.40),
                    );
                });
                ui.horizontal(|ui| {
                    ui.label("Trap Synergy Threshold:");
                    ui.add(
                        egui::DragValue::new(&mut self.draft_settings.trap_threshold)
                            .speed(0.005)
                            .range(0.01..=0.30),
                    );
                });
                ui.add_space(10.0);
                if ui.button("Save Settings").clicked() {
                    self.send(PanelAction::SaveSettings(self.draft_settings.clone()));
                }
            });

        ui.add_space(14.0);
        egui::Frame::NONE
            .fill(BG_CARD)
            .stroke(Stroke::new(1.0, Color32::from_rgb(38, 49, 66)))
            .corner_radius(CornerRadius::same(8))
            .inner_margin(egui::Margin::same(14))
            .show(ui, |ui| {
                ui.label(RichText::new("Global Windows Hotkeys & Endpoints").color(GOLD_ACCENT).strong());
                ui.add_space(6.0);
                ui.label("• Ctrl+Shift+S — Scan live Dota 2 Ability Draft board");
                ui.label("• Ctrl+Shift+R — Reset active draft session");
                ui.label(format!("• Daemon URL: {} (port {})", self.daemon_url, self.port));
            });
    }
}

impl eframe::App for ControlPanelApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        let snapshot_state = self
            .state
            .read()
            .map(|g| g.clone())
            .unwrap_or_default();

        if !self.draft_settings_synced && snapshot_state.settings_loaded {
            self.draft_settings = snapshot_state.settings.clone();
            self.draft_settings_synced = true;
        }

        egui::Panel::left("ad_cp_sidebar")
            .resizable(false)
            .exact_size(190.0)
            .frame(egui::Frame::NONE.fill(BG_SIDEBAR).inner_margin(egui::Margin::same(12)))
            .show(ui, |ui| {
                ui.label(
                    RichText::new("Ability Draft Plus")
                        .color(GOLD_ACCENT)
                        .strong()
                        .size(16.0),
                );
                ui.label(RichText::new("Native Rust Suite").color(MUTED_TEXT).size(11.0));
                ui.separator();
                ui.add_space(6.0);

                for (page, label) in [
                    (Page::Dashboard, "Dashboard"),
                    (Page::Abilities, "Abilities"),
                    (Page::Heroes, "Heroes"),
                    (Page::Streaming, "Streaming / OBS"),
                    (Page::Settings, "Settings"),
                ] {
                    if ui
                        .selectable_label(self.active_page == page, label)
                        .clicked()
                    {
                        self.active_page = page;
                    }
                    ui.add_space(4.0);
                }

                ui.with_layout(egui::Layout::bottom_up(egui::Align::LEFT), |ui| {
                    let ov_running = snapshot_state
                        .overlay_status
                        .as_ref()
                        .is_some_and(|o| o.running);
                    ui.label(
                        RichText::new(if ov_running {
                            "● Overlay Active"
                        } else {
                            "● Overlay Idle"
                        })
                        .color(if ov_running { TEAL_OK } else { MUTED_TEXT })
                        .size(12.0),
                    );
                    ui.label(
                        RichText::new(if snapshot_state.daemon_connected {
                            "● Daemon Online"
                        } else {
                            "● Daemon Offline"
                        })
                        .color(if snapshot_state.daemon_connected {
                            TEAL_OK
                        } else {
                            TRAP_RED
                        })
                        .size(12.0),
                    );
                });
            });

        egui::CentralPanel::default()
            .frame(egui::Frame::NONE.fill(BG_MAIN).inner_margin(egui::Margin::same(18)))
            .show(ui, |ui| {
                if let Some(msg) = &snapshot_state.status_banner {
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(msg).color(GOLD_ACCENT));
                        if ui.small_button("Refresh").clicked() {
                            self.send(PanelAction::RefreshAll);
                        }
                    });
                    ui.add_space(6.0);
                }

                match self.active_page {
                    Page::Dashboard => self.draw_dashboard(ui, &snapshot_state),
                    Page::Abilities => self.draw_abilities(ui, &snapshot_state),
                    Page::Heroes => self.draw_heroes(ui, &snapshot_state),
                    Page::Streaming => Self::draw_streaming(&ctx, &self.daemon_url, ui, &snapshot_state),
                    Page::Settings => self.draw_settings(ui),
                }
            });
    }
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ad_control_panel=info".into()),
        )
        .init();

    let port: u16 = std::env::var("AD_DAEMON_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(41234);
    let daemon_url =
        std::env::var("AD_DAEMON_URL").unwrap_or_else(|_| format!("http://127.0.0.1:{port}"));
    let headless = std::env::args().any(|a| a == "--headless");

    info!(
        protocol_version = PROTOCOL_VERSION,
        %daemon_url,
        headless,
        "ad-control-panel initialized"
    );

    if headless {
        return Ok(());
    }

    let owned_daemon = ensure_daemon_running(port);
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Ability Draft Plus")
            .with_inner_size([1120.0, 740.0])
            .with_min_inner_size([860.0, 560.0]),
        ..Default::default()
    };

    eframe::run_native(
        "Ability Draft Plus",
        options,
        Box::new(move |cc| {
            Ok(Box::new(ControlPanelApp::new(
                cc,
                port,
                daemon_url,
                owned_daemon,
            )))
        }),
    )
    .map_err(|e| anyhow::anyhow!("Control Panel exited with error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_abilities() -> Vec<AbilityCatalogEntry> {
        vec![
            AbilityCatalogEntry {
                ability_id: 1,
                name: "sven_storm_bolt".into(),
                display_name: "Storm Hammer".into(),
                hero_id: Some(1),
                hero_display_name: Some("Sven".into()),
                winrate: Some(0.54),
                pick_rate: Some(6.0),
                is_ultimate: false,
                consolidated_score: 0.72,
                tags: vec!["hard_cc".into(), "aoe".into()],
            },
            AbilityCatalogEntry {
                ability_id: 2,
                name: "enigma_black_hole".into(),
                display_name: "Black Hole".into(),
                hero_id: Some(2),
                hero_display_name: Some("Enigma".into()),
                winrate: Some(0.56),
                pick_rate: Some(4.0),
                is_ultimate: true,
                consolidated_score: 0.81,
                tags: vec!["teamfight_ult".into()],
            },
        ]
    }

    #[test]
    fn filter_and_sort_abilities_filters_ultimates_and_tags() {
        let items = sample_abilities();
        let ults = filter_and_sort_abilities(&items, "", AbilityFilter::UltimateOnly, SortKey::Score, true);
        assert_eq!(ults.len(), 1);
        assert_eq!(ults[0].display_name, "Black Hole");

        let by_tag = filter_and_sort_abilities(&items, "hard_cc", AbilityFilter::All, SortKey::Name, false);
        assert_eq!(by_tag.len(), 1);
        assert_eq!(by_tag[0].display_name, "Storm Hammer");
    }

    #[test]
    fn filter_and_sort_heroes_orders_descending_by_score() {
        let heroes = vec![
            HeroCatalogEntry {
                hero_id: 1,
                name: "npc_dota_hero_axe".into(),
                display_name: "Axe".into(),
                winrate: Some(0.51),
                pick_rate: Some(10.0),
                consolidated_score: 0.55,
            },
            HeroCatalogEntry {
                hero_id: 2,
                name: "npc_dota_hero_lina".into(),
                display_name: "Lina".into(),
                winrate: Some(0.55),
                pick_rate: Some(5.0),
                consolidated_score: 0.75,
            },
        ];
        let sorted = filter_and_sort_heroes(&heroes, "", SortKey::Score, true);
        assert_eq!(sorted[0].display_name, "Lina");
        assert_eq!(sorted[1].display_name, "Axe");
    }
}
