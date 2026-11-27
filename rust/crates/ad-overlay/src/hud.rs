//! Native GPU overlay (`eframe` / `wgpu`) with stateless pointer passthrough.

use std::sync::{Arc, RwLock};

use ad_protocol::{OverlayCommand, OverlaySnapshot, Rect, SlotHighlight};
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

pub struct OverlayHudApp {
    snapshot: Arc<RwLock<OverlaySnapshot>>,
    conn_state: Arc<RwLock<DaemonConnectionState>>,
    cmd_tx: mpsc::UnboundedSender<OverlayCommand>,
    hit_tester: HitTester,
    last_passthrough: Option<bool>,
    controls_area_id: egui::Id,
}

impl OverlayHudApp {
    fn new(
        cc: &eframe::CreationContext<'_>,
        daemon_url: String,
    ) -> Self {
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
            controls_area_id: egui::Id::unique("ad_controls_bar"),
        }
    }

    fn send_cmd(&self, cmd: OverlayCommand) {
        let _ = self.cmd_tx.send(cmd);
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
            let tip_rect = egui::Rect::from_min_size(tip_pos, Vec2::new(200.0, 56.0));
            painter.rect_filled(tip_rect, CornerRadius::same(6), BG_SLATE);
            painter.rect_stroke(
                tip_rect,
                CornerRadius::same(6),
                Stroke::new(1.0, GOLD_BORDER),
                StrokeKind::Inside,
            );
            painter.text(
                tip_pos + Vec2::new(8.0, 8.0),
                Align2::LEFT_TOP,
                &slot.display_name,
                FontId::proportional(13.0),
                Color32::WHITE,
            );
            if let Some(wr) = slot.winrate {
                painter.text(
                    tip_pos + Vec2::new(8.0, 30.0),
                    Align2::LEFT_TOP,
                    format!("Winrate: {:.1}%", wr * 100.0),
                    FontId::proportional(11.5),
                    TEAL_PICK,
                );
            }
        }
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
        let pointer_pos = ctx.input(|i| i.pointer.latest_pos());

        self.draw_slot_highlights(ctx, &snap, pointer_pos);

        let mut regions = Vec::new();
        let area_resp = egui::Area::new(self.controls_area_id)
            .anchor(Align2::RIGHT_TOP, Vec2::new(-12.0, 12.0))
            .show(ctx, |ui| {
                let frame = egui::Frame::NONE
                    .fill(BG_SLATE)
                    .stroke(Stroke::new(1.0, GOLD_BORDER))
                    .corner_radius(CornerRadius::same(6))
                    .inner_margin(egui::Margin::symmetric(8, 6));
                frame.show(ui, |ui| {
                    ui.horizontal(|ui| {
                        let status_color = match conn {
                            DaemonConnectionState::Connected => TEAL_PICK,
                            DaemonConnectionState::Connecting => AMBER_UNKNOWN,
                            DaemonConnectionState::Disconnected => Color32::from_rgb(230, 114, 140),
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

                        if ui.button("Close").clicked() {
                            self.send_cmd(OverlayCommand::CloseOverlay);
                            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                        }
                    });
                });
            });

        let bar_rect = area_resp.response.rect;
        regions.push(HitRegion {
            id: "controls_bar".to_string(),
            rect: Rect {
                x: bar_rect.min.x.floor() as i32,
                y: bar_rect.min.y.floor() as i32,
                width: bar_rect.width().ceil().max(0.0) as u32,
                height: bar_rect.height().ceil().max(0.0) as u32,
            },
        });
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
