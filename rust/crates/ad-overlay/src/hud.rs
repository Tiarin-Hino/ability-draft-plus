//! Native GPU overlay (`eframe` / `wgpu`) with stateless OS pointer passthrough,
//! DPI-aligned coordinates, Role Mode quick bar, OP/Trap combo drawers, and
//! My Spot / My Model selection.

#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use ad_protocol::{
    HeroModelHighlight, OverlayCommand, OverlaySnapshot, Rect, RoleMode, SlotHighlight,
    SynergyCombo,
};
use eframe::egui::{self, Align2, Color32, CornerRadius, FontId, Pos2, Stroke, StrokeKind, Vec2};
use tokio::sync::mpsc;

use crate::{
    daemon_client::{empty_snapshot, spawn_daemon_bridge, DaemonConnectionState},
    hit_test::{HitRegion, HitTester},
};

const BG_SLATE: Color32 = Color32::from_rgba_premultiplied(11, 16, 23, 240);
const GOLD_BORDER: Color32 = Color32::from_rgb(212, 173, 86);
const TEAL_PICK: Color32 = Color32::from_rgb(33, 185, 154);
const BLUE_SYNERGY: Color32 = Color32::from_rgb(72, 148, 232);
const AMBER_UNKNOWN: Color32 = Color32::from_rgb(232, 174, 52);
const TRAP_RED: Color32 = Color32::from_rgb(230, 114, 140);

pub fn phys_rect_to_egui(rect: Rect, pixels_per_point: f32) -> egui::Rect {
    let ppp = pixels_per_point.max(0.5);
    egui::Rect::from_min_size(
        Pos2::new(rect.x as f32 / ppp, rect.y as f32 / ppp),
        Vec2::new(rect.width as f32 / ppp, rect.height as f32 / ppp),
    )
}

pub fn egui_rect_to_phys(rect: egui::Rect, pixels_per_point: f32, pad_px: i32) -> Rect {
    let ppp = pixels_per_point.max(0.5);
    let x = (rect.min.x * ppp).floor() as i32 - pad_px;
    let y = (rect.min.y * ppp).floor() as i32 - pad_px;
    let w = (rect.width() * ppp).ceil().max(0.0) as i32 + pad_px.saturating_mul(2);
    let h = (rect.height() * ppp).ceil().max(0.0) as i32 + pad_px.saturating_mul(2);
    Rect {
        x,
        y,
        width: w.max(0) as u32,
        height: h.max(0) as u32,
    }
}

pub struct OverlayHudApp {
    snapshot: Arc<RwLock<OverlaySnapshot>>,
    conn_state: Arc<RwLock<DaemonConnectionState>>,
    cmd_tx: mpsc::UnboundedSender<OverlayCommand>,
    hit_tester: Arc<RwLock<HitTester>>,
    hover_rects: Arc<RwLock<Vec<Rect>>>,
    cursor_phys: Arc<RwLock<Option<(i32, i32)>>>,
    #[cfg(target_os = "windows")]
    pointer_down: Arc<AtomicBool>,
    #[cfg(not(target_os = "windows"))]
    last_passthrough: Option<bool>,
    last_window_bounds: Option<Rect>,
    show_op_drawer: bool,
    show_trap_drawer: bool,
    controls_area_id: egui::Id,
    role_area_id: egui::Id,
    op_drawer_id: egui::Id,
    trap_drawer_id: egui::Id,
    spot_base_id: egui::Id,
    model_base_id: egui::Id,
}

enum HoveredCard<'a> {
    Ability(&'a SlotHighlight, egui::Rect),
    HeroModel(&'a HeroModelHighlight, egui::Rect),
}

impl OverlayHudApp {
    fn new(cc: &eframe::CreationContext<'_>, daemon_url: String) -> Self {
        let snapshot = Arc::new(RwLock::new(empty_snapshot()));
        let conn_state = Arc::new(RwLock::new(DaemonConnectionState::Connecting));
        let hit_tester = Arc::new(RwLock::new(HitTester::new()));
        let hover_rects = Arc::new(RwLock::new(Vec::new()));
        let cursor_phys = Arc::new(RwLock::new(None));
        #[cfg(target_os = "windows")]
        let pointer_down = Arc::new(AtomicBool::new(false));
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();

        let egui_ctx = cc.egui_ctx.clone();
        spawn_daemon_bridge(
            daemon_url,
            snapshot.clone(),
            conn_state.clone(),
            cmd_rx,
            Arc::new(move || egui_ctx.request_repaint()),
        );

        #[cfg(target_os = "windows")]
        {
            let repaint_ctx = cc.egui_ctx.clone();
            crate::win32_surface::spawn_cursor_passthrough_watcher(
                "Ability Draft Plus Overlay",
                hit_tester.clone(),
                hover_rects.clone(),
                cursor_phys.clone(),
                pointer_down.clone(),
                Arc::new(move || repaint_ctx.request_repaint()),
            );
        }

        Self {
            snapshot,
            conn_state,
            cmd_tx,
            hit_tester,
            hover_rects,
            cursor_phys,
            #[cfg(target_os = "windows")]
            pointer_down,
            #[cfg(not(target_os = "windows"))]
            last_passthrough: None,
            last_window_bounds: None,
            show_op_drawer: false,
            show_trap_drawer: false,
            controls_area_id: egui::Id::unique("ad_controls_bar"),
            role_area_id: egui::Id::unique("ad_role_bar"),
            op_drawer_id: egui::Id::unique("ad_op_drawer"),
            trap_drawer_id: egui::Id::unique("ad_trap_drawer"),
            spot_base_id: egui::Id::unique("ad_spot_btn"),
            model_base_id: egui::Id::unique("ad_model_btn"),
        }
    }

    fn send_cmd(&self, cmd: OverlayCommand) {
        let _ = self.cmd_tx.send(cmd);
    }

    fn sync_window_bounds(&mut self, ctx: &egui::Context, target: Option<Rect>) {
        if self.last_window_bounds == target {
            return;
        }
        self.last_window_bounds = target;
        let Some(mut rect) = target else {
            return;
        };
        let ppp = ctx.pixels_per_point().max(0.5);
        if let Some(monitor) = ctx.input(|i| i.viewport().monitor_size) {
            let mon_phys_w = (monitor.x * ppp).round() as u32;
            let mon_phys_h = (monitor.y * ppp).round() as u32;
            if rect.width >= mon_phys_w && rect.height >= mon_phys_h {
                // Keep Windows DWM click-through forwarding intact by shrinking 1px off full width.
                rect.width = rect.width.saturating_sub(1);
            }
        }
        ctx.send_viewport_cmd(egui::ViewportCommand::Maximized(false));
        ctx.send_viewport_cmd(egui::ViewportCommand::OuterPosition(Pos2::new(
            rect.x as f32 / ppp,
            rect.y as f32 / ppp,
        )));
        ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(Vec2::new(
            rect.width as f32 / ppp,
            rect.height as f32 / ppp,
        )));
    }

    fn sync_passthrough(&mut self, ctx: &egui::Context, _ppp: f32) {
        #[cfg(target_os = "windows")]
        {
            // Never call ViewportCommand::MousePassthrough on Windows: winit strips WS_EX_LAYERED
            // when IGNORE_CURSOR_EVENT turns off, turning the transparent surface solid white.
            // win32_surface::spawn_cursor_passthrough_watcher toggles WS_EX_TRANSPARENT directly.
            let down = ctx.input(|i| i.pointer.any_down());
            self.pointer_down.store(down, Ordering::Relaxed);
        }

        #[cfg(not(target_os = "windows"))]
        {
            let os_hit = ctx
                .input(|i| i.pointer.latest_pos())
                .and_then(|p| {
                    let px = (p.x * _ppp).round() as i32;
                    let py = (p.y * _ppp).round() as i32;
                    self.hit_tester
                        .read()
                        .ok()
                        .map(|guard| guard.is_interactive(px, py))
                })
                .unwrap_or(false);
            let interactive = os_hit || ctx.egui_wants_pointer_input();
            let passthrough = !interactive;
            if self.last_passthrough != Some(passthrough) {
                ctx.send_viewport_cmd(egui::ViewportCommand::MousePassthrough(passthrough));
                self.last_passthrough = Some(passthrough);
            }
        }
    }

    fn draw_rank_pill(painter: &egui::Painter, rect: egui::Rect, rank: u8) {
        let pill_rect = egui::Rect::from_min_size(rect.min, Vec2::new(26.0, 16.0));
        painter.rect_filled(pill_rect, CornerRadius::same(3), BG_SLATE);
        painter.text(
            pill_rect.center(),
            Align2::CENTER_CENTER,
            format!("#{rank}"),
            FontId::proportional(11.0),
            GOLD_BORDER,
        );
    }

    fn draw_card_tooltip(
        painter: &egui::Painter,
        anchor: egui::Rect,
        badge: Option<(&str, Color32)>,
        title: &str,
        winrate: Option<f64>,
        pick_rate: Option<f64>,
        score: Option<f64>,
    ) {
        let tip_pos = Pos2::new(anchor.max.x + 8.0, anchor.min.y);
        let tip_rect = egui::Rect::from_min_size(tip_pos, Vec2::new(220.0, 92.0));
        painter.rect_filled(tip_rect, CornerRadius::same(6), BG_SLATE);
        painter.rect_stroke(
            tip_rect,
            CornerRadius::same(6),
            Stroke::new(1.0, GOLD_BORDER),
            StrokeKind::Inside,
        );

        if let Some((label, color)) = badge {
            painter.text(
                tip_pos + Vec2::new(8.0, 6.0),
                Align2::LEFT_TOP,
                label,
                FontId::proportional(10.0),
                color,
            );
        }
        painter.text(
            tip_pos + Vec2::new(8.0, 20.0),
            Align2::LEFT_TOP,
            title,
            FontId::proportional(13.5),
            Color32::WHITE,
        );
        if let Some(wr) = winrate {
            painter.text(
                tip_pos + Vec2::new(8.0, 42.0),
                Align2::LEFT_TOP,
                format!("Winrate: {:.1}%", wr * 100.0),
                FontId::proportional(11.5),
                TEAL_PICK,
            );
        }
        if let Some(pick) = pick_rate {
            painter.text(
                tip_pos + Vec2::new(8.0, 58.0),
                Align2::LEFT_TOP,
                format!("Avg Pick: #{pick:.1}"),
                FontId::proportional(11.5),
                Color32::LIGHT_GRAY,
            );
        }
        if let Some(s) = score {
            painter.text(
                tip_pos + Vec2::new(8.0, 74.0),
                Align2::LEFT_TOP,
                format!("Score: {s:.3}"),
                FontId::proportional(11.0),
                GOLD_BORDER,
            );
        }
    }

    fn draw_board_highlights(
        &self,
        ctx: &egui::Context,
        snap: &OverlaySnapshot,
        pointer: Option<Pos2>,
        ppp: f32,
    ) {
        if snap.scanning {
            return;
        }
        let painter = ctx.layer_painter(egui::LayerId::background());
        let mut hovered: Option<HoveredCard<'_>> = None;

        for slot in &snap.slots {
            let r = phys_rect_to_egui(slot.bounds, ppp);
            let color = if slot.is_unknown {
                Some(AMBER_UNKNOWN)
            } else if slot.is_synergy_pick {
                Some(BLUE_SYNERGY)
            } else if slot.is_top_tier {
                Some(TEAL_PICK)
            } else {
                None
            };

            if let Some(stroke_color) = color {
                painter.rect_stroke(
                    r,
                    CornerRadius::same(4),
                    Stroke::new(2.0, stroke_color),
                    StrokeKind::Inside,
                );
            }
            if let Some(rank) = slot.top_rank {
                Self::draw_rank_pill(&painter, r, rank);
            }
            if let Some(pt) = pointer {
                if r.contains(pt) {
                    hovered = Some(HoveredCard::Ability(slot, r));
                }
            }
        }

        for model in &snap.hero_models {
            let r = phys_rect_to_egui(model.bounds, ppp);
            let stroke_color = if model.is_my_model {
                Some(TEAL_PICK)
            } else if model.is_top_tier {
                Some(GOLD_BORDER)
            } else if model.is_unknown {
                Some(AMBER_UNKNOWN)
            } else {
                None
            };

            if let Some(c) = stroke_color {
                painter.rect_stroke(
                    r,
                    CornerRadius::same(4),
                    Stroke::new(2.0, c),
                    StrokeKind::Inside,
                );
            }
            if let Some(rank) = model.top_rank {
                Self::draw_rank_pill(&painter, r, rank);
            }
            if let Some(pt) = pointer {
                if r.contains(pt) {
                    hovered = Some(HoveredCard::HeroModel(model, r));
                }
            }
        }

        match hovered {
            Some(HoveredCard::Ability(slot, rect)) => {
                let badge = if slot.is_synergy_pick {
                    Some(("SYNERGY PICK", BLUE_SYNERGY))
                } else if let Some(rank) = slot.top_rank {
                    Some((
                        if rank <= 3 { "TOP PICK" } else { "RECOMMENDED" },
                        TEAL_PICK,
                    ))
                } else {
                    None
                };
                Self::draw_card_tooltip(
                    &painter,
                    rect,
                    badge,
                    &slot.display_name,
                    slot.winrate,
                    slot.pick_rate,
                    slot.consolidated_score,
                );
            }
            Some(HoveredCard::HeroModel(model, rect)) => {
                let badge = if model.is_my_model {
                    Some(("MY MODEL", TEAL_PICK))
                } else if model.top_rank.is_some() {
                    Some(("TOP HERO MODEL", GOLD_BORDER))
                } else {
                    Some(("HERO MODEL", Color32::LIGHT_GRAY))
                };
                Self::draw_card_tooltip(
                    &painter,
                    rect,
                    badge,
                    &model.display_name,
                    model.winrate,
                    model.pick_rate,
                    model.consolidated_score,
                );
            }
            None => {}
        }
    }

    fn draw_spot_and_model_buttons(
        &self,
        ctx: &egui::Context,
        snap: &OverlaySnapshot,
        ppp: f32,
        regions: &mut Vec<HitRegion>,
    ) {
        if snap.scanning {
            return;
        }

        for spot in &snap.hero_spots {
            let r = phys_rect_to_egui(spot.bounds, ppp);
            let pos = Pos2::new(r.min.x + 4.0, r.min.y + 4.0);
            let resp = egui::Area::new(self.spot_base_id.with(spot.hero_order))
                .fixed_pos(pos)
                .show(ctx, |ui| {
                    let label = match (spot.is_my_spot, &spot.ocr_hero_name) {
                        (true, Some(hero)) => format!("★ My Spot ({hero})"),
                        (true, None) => "★ My Spot".to_string(),
                        (false, Some(hero)) => format!("My Spot · {hero}"),
                        (false, None) => "My Spot".to_string(),
                    };
                    if ui.selectable_label(spot.is_my_spot, label).clicked() {
                        self.send_cmd(OverlayCommand::SelectMySpot {
                            hero_order: spot.hero_order,
                            db_hero_id: 0,
                        });
                    }
                });
            Self::push_rect_region(
                regions,
                &format!("spot_{}", spot.hero_order),
                resp.response.rect,
                ppp,
            );
        }

        for model in &snap.hero_models {
            if model.is_unknown {
                continue;
            }
            let r = phys_rect_to_egui(model.bounds, ppp);
            let pos = Pos2::new(r.min.x, (r.max.y - 18.0).max(0.0));
            let resp = egui::Area::new(self.model_base_id.with(model.hero_order))
                .fixed_pos(pos)
                .show(ctx, |ui| {
                    let label = if model.is_my_model { "★ Model" } else { "Model" };
                    if ui.selectable_label(model.is_my_model, label).clicked() {
                        self.send_cmd(OverlayCommand::SelectMyModel {
                            hero_order: model.hero_order,
                            db_hero_id: model.db_hero_id.unwrap_or(0),
                        });
                    }
                });
            Self::push_rect_region(
                regions,
                &format!("model_{}", model.hero_order),
                resp.response.rect,
                ppp,
            );
        }
    }

    fn push_rect_region(regions: &mut Vec<HitRegion>, id: &str, rect: egui::Rect, ppp: f32) {
        regions.push(HitRegion {
            id: id.to_string(),
            rect: egui_rect_to_phys(rect, ppp, 2),
        });
    }

    fn draw_combo_drawer(
        ctx: &egui::Context,
        id: egui::Id,
        offset_y: f32,
        title: &str,
        accent: Color32,
        combos: &[SynergyCombo],
        on_close: &mut bool,
    ) -> egui::Rect {
        let resp = egui::Area::new(id)
            .anchor(Align2::RIGHT_TOP, Vec2::new(-124.0, offset_y))
            .show(ctx, |ui| {
                egui::Frame::NONE
                    .fill(BG_SLATE)
                    .stroke(Stroke::new(1.0, accent))
                    .corner_radius(CornerRadius::same(6))
                    .inner_margin(egui::Margin::same(8))
                    .show(ui, |ui| {
                        ui.set_max_width(290.0);
                        ui.horizontal(|ui| {
                            ui.colored_label(accent, title);
                            if ui.small_button("Hide").clicked() {
                                *on_close = false;
                            }
                        });
                        ui.separator();
                        egui::ScrollArea::vertical()
                            .max_height(220.0)
                            .show(ui, |ui| {
                                for combo in combos {
                                    ui.label(format!(
                                        "{} + {} ({:.1}%)",
                                        combo.ability1_name,
                                        combo.ability2_name,
                                        combo.synergy_winrate * 100.0
                                    ));
                                }
                            });
                    });
            });
        resp.response.rect
    }
}

impl eframe::App for OverlayHudApp {
    fn clear_color(&self, _visuals: &egui::Visuals) -> [f32; 4] {
        [0.0, 0.0, 0.0, 0.0]
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx();
        let ppp = ctx.pixels_per_point().max(0.5);
        let snap = self
            .snapshot
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|_| empty_snapshot());
        let conn = self
            .conn_state
            .read()
            .map(|g| *g)
            .unwrap_or(DaemonConnectionState::Disconnected);

        self.sync_window_bounds(ctx, snap.dota_window);
        let os_pointer = self
            .cursor_phys
            .read()
            .ok()
            .and_then(|g| *g)
            .map(|(x, y)| Pos2::new(x as f32 / ppp, y as f32 / ppp));
        let pointer_pos = ctx.input(|i| i.pointer.latest_pos()).or(os_pointer);

        if let Ok(mut hover_guard) = self.hover_rects.write() {
            hover_guard.clear();
            if !snap.scanning {
                hover_guard.extend(snap.slots.iter().map(|s| s.bounds));
                hover_guard.extend(snap.hero_models.iter().map(|m| m.bounds));
            }
        }

        self.draw_board_highlights(ctx, &snap, pointer_pos, ppp);

        let mut regions = Vec::new();
        self.draw_spot_and_model_buttons(ctx, &snap, ppp, &mut regions);

        // 1. Controls bar
        let controls_resp = egui::Area::new(self.controls_area_id)
            .anchor(Align2::RIGHT_TOP, Vec2::new(-12.0, 8.0))
            .show(ctx, |ui| {
                egui::Frame::NONE
                    .fill(BG_SLATE)
                    .stroke(Stroke::new(1.0, GOLD_BORDER))
                    .corner_radius(CornerRadius::same(6))
                    .inner_margin(egui::Margin::symmetric(8, 5))
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            let status_color = match conn {
                                DaemonConnectionState::Connected => TEAL_PICK,
                                DaemonConnectionState::Connecting => AMBER_UNKNOWN,
                                DaemonConnectionState::Disconnected => TRAP_RED,
                            };
                            ui.colored_label(status_color, "●");

                            if snap.scanning {
                                ui.label("Scanning...");
                            } else if ui.button("Scan").clicked() {
                                self.send_cmd(OverlayCommand::TriggerScan { is_initial: true });
                            }

                            if ui.button("Reset").clicked() {
                                self.send_cmd(OverlayCommand::ResetDraft);
                            }

                            if ui
                                .selectable_label(snap.auto_rescan_enabled, "Auto-Scan")
                                .clicked()
                            {
                                self.send_cmd(OverlayCommand::SetAutoRescan {
                                    enabled: !snap.auto_rescan_enabled,
                                });
                            }

                            if !snap.op_combinations.is_empty()
                                && ui
                                    .selectable_label(
                                        self.show_op_drawer,
                                        format!("OP ({})", snap.op_combinations.len()),
                                    )
                                    .clicked()
                            {
                                self.show_op_drawer = !self.show_op_drawer;
                                if self.show_op_drawer {
                                    self.show_trap_drawer = false;
                                }
                            }

                            if !snap.trap_combinations.is_empty()
                                && ui
                                    .selectable_label(
                                        self.show_trap_drawer,
                                        format!("Trap ({})", snap.trap_combinations.len()),
                                    )
                                    .clicked()
                            {
                                self.show_trap_drawer = !self.show_trap_drawer;
                                if self.show_trap_drawer {
                                    self.show_op_drawer = false;
                                }
                            }

                            if ui.button("Close").clicked() {
                                self.send_cmd(OverlayCommand::CloseOverlay);
                                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                            }
                        });
                    });
            });
        Self::push_rect_region(&mut regions, "controls_bar", controls_resp.response.rect, ppp);

        // 2. Role Mode quick bar
        let role_y = controls_resp.response.rect.max.y + 4.0;
        let role_resp = egui::Area::new(self.role_area_id)
            .anchor(Align2::RIGHT_TOP, Vec2::new(-12.0, role_y))
            .show(ctx, |ui| {
                egui::Frame::NONE
                    .fill(BG_SLATE)
                    .stroke(Stroke::new(1.0, Color32::from_rgb(90, 108, 130)))
                    .corner_radius(CornerRadius::same(6))
                    .inner_margin(egui::Margin::symmetric(8, 4))
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.label("Role:");
                            if ui
                                .selectable_label(snap.role_mode == RoleMode::Off, "Off")
                                .clicked()
                            {
                                self.send_cmd(OverlayCommand::SetRoleMode {
                                    mode: RoleMode::Off,
                                    fixed_positions: snap.role_fixed_positions.clone(),
                                });
                            }
                            for pos in 1..=5u8 {
                                let active = snap.role_mode == RoleMode::Fixed
                                    && snap.role_fixed_positions.contains(&pos);
                                if ui.selectable_label(active, pos.to_string()).clicked() {
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
                                    self.send_cmd(OverlayCommand::SetRoleMode {
                                        mode,
                                        fixed_positions: next,
                                    });
                                }
                            }
                            if ui
                                .selectable_label(snap.role_mode == RoleMode::Dynamic, "Auto")
                                .clicked()
                            {
                                let next_mode = if snap.role_mode == RoleMode::Dynamic {
                                    RoleMode::Off
                                } else {
                                    RoleMode::Dynamic
                                };
                                self.send_cmd(OverlayCommand::SetRoleMode {
                                    mode: next_mode,
                                    fixed_positions: snap.role_fixed_positions.clone(),
                                });
                            }
                        });
                    });
            });
        Self::push_rect_region(&mut regions, "role_bar", role_resp.response.rect, ppp);

        // 3. Collapsible OP / Trap combo drawers
        let drawer_y = role_resp.response.rect.max.y + 6.0;
        if self.show_op_drawer && !snap.op_combinations.is_empty() {
            let rect = Self::draw_combo_drawer(
                ctx,
                self.op_drawer_id,
                drawer_y,
                "OP Combinations",
                TEAL_PICK,
                &snap.op_combinations,
                &mut self.show_op_drawer,
            );
            Self::push_rect_region(&mut regions, "op_drawer", rect, ppp);
        }
        if self.show_trap_drawer && !snap.trap_combinations.is_empty() {
            let rect = Self::draw_combo_drawer(
                ctx,
                self.trap_drawer_id,
                drawer_y,
                "Trap Combinations",
                TRAP_RED,
                &snap.trap_combinations,
                &mut self.show_trap_drawer,
            );
            Self::push_rect_region(&mut regions, "trap_drawer", rect, ppp);
        }

        if let Ok(mut guard) = self.hit_tester.write() {
            guard.set_regions(regions);
        }
        self.sync_passthrough(ctx, ppp);
    }
}

pub fn run_hud(daemon_url: String) -> anyhow::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Ability Draft Plus Overlay")
            .with_transparent(true)
            .with_decorations(false)
            .with_always_on_top()
            .with_mouse_passthrough(true)
            .with_maximized(true),
        renderer: eframe::Renderer::Wgpu,
        ..Default::default()
    };

    eframe::run_native(
        "Ability Draft Plus Overlay",
        options,
        Box::new(move |cc| Ok(Box::new(OverlayHudApp::new(cc, daemon_url)))),
    )
    .map_err(|e| anyhow::anyhow!("eframe exited with error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_between_physical_pixels_and_egui_logical_points() {
        let phys = Rect {
            x: 150,
            y: 300,
            width: 300,
            height: 150,
        };
        let logical = phys_rect_to_egui(phys, 1.5);
        assert!((logical.min.x - 100.0).abs() < 1e-4);
        assert!((logical.min.y - 200.0).abs() < 1e-4);
        assert!((logical.width() - 200.0).abs() < 1e-4);
        assert!((logical.height() - 100.0).abs() < 1e-4);

        let roundtrip = egui_rect_to_phys(logical, 1.5, 2);
        assert_eq!(roundtrip.x, 148);
        assert_eq!(roundtrip.y, 298);
        assert_eq!(roundtrip.width, 304);
        assert_eq!(roundtrip.height, 154);

        let unity = phys_rect_to_egui(phys, 1.0);
        assert_eq!(
            egui_rect_to_phys(unity, 1.0, 0),
            phys
        );
    }
}
