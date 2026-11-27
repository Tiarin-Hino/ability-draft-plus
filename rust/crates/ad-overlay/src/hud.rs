//! Native GPU overlay (`eframe` / `wgpu`) with stateless pointer passthrough,
//! Role Mode quick bar, OP/Trap combo drawers, and dynamic Dota 2 window tracking.

use std::sync::{Arc, RwLock};

use ad_protocol::{OverlayCommand, OverlaySnapshot, Rect, RoleMode, SlotHighlight, SynergyCombo};
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

pub struct OverlayHudApp {
    snapshot: Arc<RwLock<OverlaySnapshot>>,
    conn_state: Arc<RwLock<DaemonConnectionState>>,
    cmd_tx: mpsc::UnboundedSender<OverlayCommand>,
    hit_tester: HitTester,
    last_passthrough: Option<bool>,
    last_window_bounds: Option<Rect>,
    show_op_drawer: bool,
    show_trap_drawer: bool,
    controls_area_id: egui::Id,
    role_area_id: egui::Id,
    op_drawer_id: egui::Id,
    trap_drawer_id: egui::Id,
}

impl OverlayHudApp {
    fn new(cc: &eframe::CreationContext<'_>, daemon_url: String) -> Self {
        let snapshot = Arc::new(RwLock::new(empty_snapshot()));
        let conn_state = Arc::new(RwLock::new(DaemonConnectionState::Connecting));
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();

        let egui_ctx = cc.egui_ctx.clone();
        spawn_daemon_bridge(
            daemon_url,
            snapshot.clone(),
            conn_state.clone(),
            cmd_rx,
            Arc::new(move || egui_ctx.request_repaint()),
        );

        Self {
            snapshot,
            conn_state,
            cmd_tx,
            hit_tester: HitTester::new(),
            last_passthrough: None,
            last_window_bounds: None,
            show_op_drawer: false,
            show_trap_drawer: false,
            controls_area_id: egui::Id::unique("ad_controls_bar"),
            role_area_id: egui::Id::unique("ad_role_bar"),
            op_drawer_id: egui::Id::unique("ad_op_drawer"),
            trap_drawer_id: egui::Id::unique("ad_trap_drawer"),
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
        if let Some(monitor) = ctx.input(|i| i.viewport().monitor_size) {
            if rect.width as f32 >= monitor.x && rect.height as f32 >= monitor.y {
                // Keep Windows DWM click-through forwarding intact by shrinking 1px off full width.
                rect.width = rect.width.saturating_sub(1);
            }
        }
        ctx.send_viewport_cmd(egui::ViewportCommand::OuterPosition(Pos2::new(
            rect.x as f32,
            rect.y as f32,
        )));
        ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(Vec2::new(
            rect.width as f32,
            rect.height as f32,
        )));
    }

    fn sync_passthrough(&mut self, ctx: &egui::Context) {
        let pointer_pos = ctx.input(|i| i.pointer.latest_pos());
        let in_region = pointer_pos
            .map(|p| self.hit_tester.is_interactive(p.x.round() as i32, p.y.round() as i32))
            .unwrap_or(false);
        let interactive = in_region || ctx.egui_wants_pointer_input();
        let passthrough = !interactive;
        if self.last_passthrough != Some(passthrough) {
            ctx.send_viewport_cmd(egui::ViewportCommand::MousePassthrough(passthrough));
            self.last_passthrough = Some(passthrough);
        }
    }

    fn draw_slot_highlights(
        &self,
        ctx: &egui::Context,
        snap: &OverlaySnapshot,
        pointer: Option<Pos2>,
    ) {
        if snap.scanning {
            return;
        }
        let painter = ctx.layer_painter(egui::LayerId::background());
        let mut hovered_slot: Option<&SlotHighlight> = None;

        for slot in &snap.slots {
            let r = egui::Rect::from_min_size(
                Pos2::new(slot.bounds.x as f32, slot.bounds.y as f32),
                Vec2::new(slot.bounds.width as f32, slot.bounds.height as f32),
            );
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
                let pill_rect = egui::Rect::from_min_size(r.min, Vec2::new(26.0, 16.0));
                painter.rect_filled(pill_rect, CornerRadius::same(3), BG_SLATE);
                painter.text(
                    pill_rect.center(),
                    Align2::CENTER_CENTER,
                    format!("#{rank}"),
                    FontId::proportional(11.0),
                    GOLD_BORDER,
                );
            }

            if let Some(pt) = pointer {
                if r.contains(pt) {
                    hovered_slot = Some(slot);
                }
            }
        }

        if let Some(slot) = hovered_slot {
            let tip_pos = Pos2::new(
                (slot.bounds.x + slot.bounds.width as i32 + 10) as f32,
                slot.bounds.y as f32,
            );
            let tip_rect = egui::Rect::from_min_size(tip_pos, Vec2::new(220.0, 92.0));
            painter.rect_filled(tip_rect, CornerRadius::same(6), BG_SLATE);
            painter.rect_stroke(
                tip_rect,
                CornerRadius::same(6),
                Stroke::new(1.0, GOLD_BORDER),
                StrokeKind::Inside,
            );

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
                &slot.display_name,
                FontId::proportional(13.5),
                Color32::WHITE,
            );
            if let Some(wr) = slot.winrate {
                painter.text(
                    tip_pos + Vec2::new(8.0, 42.0),
                    Align2::LEFT_TOP,
                    format!("Winrate: {:.1}%", wr * 100.0),
                    FontId::proportional(11.5),
                    TEAL_PICK,
                );
            }
            if let Some(pick) = slot.pick_rate {
                painter.text(
                    tip_pos + Vec2::new(8.0, 58.0),
                    Align2::LEFT_TOP,
                    format!("Avg Pick: #{pick:.1}"),
                    FontId::proportional(11.5),
                    Color32::LIGHT_GRAY,
                );
            }
            if let Some(score) = slot.consolidated_score {
                painter.text(
                    tip_pos + Vec2::new(8.0, 74.0),
                    Align2::LEFT_TOP,
                    format!("Score: {score:.3}"),
                    FontId::proportional(11.0),
                    GOLD_BORDER,
                );
            }
        }
    }

    fn push_rect_region(regions: &mut Vec<HitRegion>, id: &str, rect: egui::Rect) {
        regions.push(HitRegion {
            id: id.to_string(),
            rect: Rect {
                x: rect.min.x.floor() as i32,
                y: rect.min.y.floor() as i32,
                width: rect.width().ceil().max(0.0) as u32,
                height: rect.height().ceil().max(0.0) as u32,
            },
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
        let pointer_pos = ctx.input(|i| i.pointer.latest_pos());
        self.draw_slot_highlights(ctx, &snap, pointer_pos);

        let mut regions = Vec::new();

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
        Self::push_rect_region(&mut regions, "controls_bar", controls_resp.response.rect);

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
        Self::push_rect_region(&mut regions, "role_bar", role_resp.response.rect);

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
            Self::push_rect_region(&mut regions, "op_drawer", rect);
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
            Self::push_rect_region(&mut regions, "trap_drawer", rect);
        }

        self.hit_tester.set_regions(regions);
        self.sync_passthrough(ctx);
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
