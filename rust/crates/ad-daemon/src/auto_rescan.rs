//! GSI-driven serpentine auto-rescan state machine (`ad_core::draft_clock`).

use ad_core::{
    draft_clock::{
        build_turn_schedule, classify_hero_selection_reentry, is_preview_clock, is_round_break,
        turns_ended_between, DraftTurnWindow, HeroSelectionReentry, DEFAULT_AD_DRAFT_CLOCK,
    },
    gsi::{GamePhase, GsiSnapshot},
};

pub const PREVIEW_INITIAL_SCAN_DELAY_MS: u64 = 15_000;
pub const TURN_VISIBILITY_DELAY_S: f64 = 2.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RescanAction {
    None,
    ResetDraft,
    TriggerInitialScan,
    TriggerTurnRescan { ended_turns: usize },
    TriggerRoundBreakRescan,
}

pub struct AutoRescanController {
    pub enabled: bool,
    match_id: Option<String>,
    in_hero_selection: bool,
    preview_entered_at_ms: Option<u64>,
    pick_anchor_ms: Option<u64>,
    initial_scan_fired: bool,
    last_turn_scan_elapsed_s: f64,
    last_round_break_fired: Option<u8>,
    schedule: Vec<DraftTurnWindow>,
    picks_tracked: usize,
}

impl AutoRescanController {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            match_id: None,
            in_hero_selection: false,
            preview_entered_at_ms: None,
            pick_anchor_ms: None,
            initial_scan_fired: false,
            last_turn_scan_elapsed_s: 0.0,
            last_round_break_fired: None,
            schedule: build_turn_schedule(DEFAULT_AD_DRAFT_CLOCK),
            picks_tracked: 0,
        }
    }

    pub fn set_picks_tracked(&mut self, count: usize) {
        self.picks_tracked = count;
    }

    pub fn reset_draft(&mut self) {
        self.preview_entered_at_ms = None;
        self.pick_anchor_ms = None;
        self.initial_scan_fired = false;
        self.last_turn_scan_elapsed_s = 0.0;
        self.last_round_break_fired = None;
        self.picks_tracked = 0;
    }

    fn apply_hero_selection_clock(&mut self, clock_time: Option<i64>, now_ms: u64) {
        if is_preview_clock(clock_time) {
            if self.preview_entered_at_ms.is_none() {
                self.preview_entered_at_ms = Some(now_ms);
            }
        } else if let Some(clock) = clock_time.filter(|&c| c >= 0) {
            if self.pick_anchor_ms.is_none() {
                let offset_ms = u64::try_from(clock).unwrap_or(0).saturating_mul(1_000);
                self.pick_anchor_ms = Some(now_ms.saturating_sub(offset_ms));
                self.initial_scan_fired = true;
            }
        }
    }

    pub fn on_gsi_snapshot(&mut self, gsi: &GsiSnapshot, now_ms: u64) -> RescanAction {
        let mut action = RescanAction::None;

        if let Some(new_match_id) = gsi.match_id.as_ref() {
            if self.match_id.as_ref() != Some(new_match_id) {
                self.match_id = Some(new_match_id.clone());
                self.in_hero_selection = gsi.game_phase == Some(GamePhase::HeroSelection);
                self.reset_draft();
                if self.in_hero_selection {
                    self.apply_hero_selection_clock(gsi.clock_time, now_ms);
                }
                return RescanAction::ResetDraft;
            }
        }

        let Some(phase) = gsi.game_phase else {
            // Ignore transient gamePhase: null dropouts.
            return RescanAction::None;
        };

        if phase == GamePhase::HeroSelection {
            let reentered = !self.in_hero_selection
                && (self.preview_entered_at_ms.is_some() || self.pick_anchor_ms.is_some());
            if reentered
                && classify_hero_selection_reentry(gsi.clock_time, self.picks_tracked)
                    == HeroSelectionReentry::Restart
            {
                self.reset_draft();
                action = RescanAction::ResetDraft;
            }
            self.in_hero_selection = true;
            self.apply_hero_selection_clock(gsi.clock_time, now_ms);
        } else {
            self.in_hero_selection = false;
        }

        action
    }

    pub fn poll_tick(&mut self, now_ms: u64) -> RescanAction {
        if !self.enabled || !self.in_hero_selection {
            return RescanAction::None;
        }

        if !self.initial_scan_fired {
            if let Some(entered_ms) = self.preview_entered_at_ms {
                if now_ms.saturating_sub(entered_ms) >= PREVIEW_INITIAL_SCAN_DELAY_MS {
                    self.initial_scan_fired = true;
                    return RescanAction::TriggerInitialScan;
                }
            }
        }

        let Some(anchor_ms) = self.pick_anchor_ms else {
            return RescanAction::None;
        };
        let elapsed_s = now_ms.saturating_sub(anchor_ms) as f64 / 1000.0;
        let check_to = elapsed_s - TURN_VISIBILITY_DELAY_S;
        if check_to > self.last_turn_scan_elapsed_s {
            let ended =
                turns_ended_between(&self.schedule, self.last_turn_scan_elapsed_s, check_to);
            if !ended.is_empty() {
                self.last_turn_scan_elapsed_s = ended
                    .last()
                    .map(|w| w.end_s)
                    .unwrap_or(check_to);
                return RescanAction::TriggerTurnRescan {
                    ended_turns: ended.len(),
                };
            }
        }

        if is_round_break(elapsed_s, &self.schedule) {
            let completed_round = self
                .schedule
                .iter()
                .filter(|w| w.end_s <= elapsed_s)
                .map(|w| w.round)
                .max();
            if completed_round.is_some() && self.last_round_break_fired != completed_round {
                self.last_round_break_fired = completed_round;
                return RescanAction::TriggerRoundBreakRescan;
            }
        }

        RescanAction::None
    }
}

#[cfg(test)]
mod tests {
    use ad_core::gsi::GsiMode;

    use super::*;

    fn gsi_hero_sel(match_id: &str, clock_time: Option<i64>) -> GsiSnapshot {
        GsiSnapshot {
            match_id: Some(match_id.into()),
            game_phase: Some(GamePhase::HeroSelection),
            clock_time,
            in_draft: true,
            mode: GsiMode::Playing,
            local_slot_index: Some(0),
            local_player: None,
            players: Vec::new(),
        }
    }

    #[test]
    fn triggers_preview_initial_scan_turn_rescan_and_round_break_rescan() {
        let mut ctrl = AutoRescanController::new(true);

        // New match in preview
        assert_eq!(
            ctrl.on_gsi_snapshot(&gsi_hero_sel("100", Some(-59)), 1_000),
            RescanAction::ResetDraft
        );
        assert_eq!(ctrl.poll_tick(15_999), RescanAction::None);
        assert_eq!(ctrl.poll_tick(16_000), RescanAction::TriggerInitialScan);
        assert_eq!(ctrl.poll_tick(20_000), RescanAction::None);

        // Pick phase starts at clock_time = 0 (anchor = 60_000)
        assert_eq!(
            ctrl.on_gsi_snapshot(&gsi_hero_sel("100", Some(0)), 60_000),
            RescanAction::None
        );
        // Turn 0 ends at +7s; visibility delay is +2s -> fires at 69_000
        assert_eq!(ctrl.poll_tick(68_500), RescanAction::None);
        assert_eq!(
            ctrl.poll_tick(69_000),
            RescanAction::TriggerTurnRescan { ended_turns: 1 }
        );

        // Advance cursor to 70s; at 72s (round break, 70s..75s) fires break reconciliation
        ctrl.last_turn_scan_elapsed_s = 70.0;
        assert_eq!(
            ctrl.poll_tick(60_000 + 72_000),
            RescanAction::TriggerRoundBreakRescan
        );
        assert_eq!(ctrl.poll_tick(60_000 + 73_000), RescanAction::None);
    }

    #[test]
    fn restarts_when_reentering_preview_with_zero_picks_and_resumes_otherwise() {
        let mut ctrl = AutoRescanController::new(true);
        ctrl.on_gsi_snapshot(&gsi_hero_sel("200", Some(-59)), 1_000);

        // Transient disconnect then loading phase before restart
        let mut loading = gsi_hero_sel("200", None);
        loading.game_phase = Some(GamePhase::WaitForPlayersToLoad);
        ctrl.on_gsi_snapshot(&loading, 10_000);

        // With 0 picks tracked and preview clock, restart clears timing
        assert_eq!(
            ctrl.on_gsi_snapshot(&gsi_hero_sel("200", Some(-58)), 30_000),
            RescanAction::ResetDraft
        );

        // With tracked picks, reentry resumes instead of resetting
        ctrl.set_picks_tracked(3);
        ctrl.on_gsi_snapshot(&loading, 40_000);
        assert_eq!(
            ctrl.on_gsi_snapshot(&gsi_hero_sel("200", Some(-55)), 50_000),
            RescanAction::None
        );
    }
}
