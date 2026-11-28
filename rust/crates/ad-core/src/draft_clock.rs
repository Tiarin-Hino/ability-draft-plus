//! Ability Draft serpentine turn clock math for GSI-driven auto-rescan.
//!
//! Mirrors `src/core/gsi/draft-clock.ts`.

use crate::pick_attribution::TurnWindow;

pub const PREVIEW_CLOCK_MAX_S: i64 = -8;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DraftClockConfig {
    pub turn_duration_s: f64,
    pub round_break_s: f64,
    pub player_count: u8,
    pub rounds: u8,
}

pub const DEFAULT_AD_DRAFT_CLOCK: DraftClockConfig = DraftClockConfig {
    turn_duration_s: 7.0,
    round_break_s: 5.0,
    player_count: 10,
    rounds: 5,
};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DraftTurnWindow {
    pub seq: usize,
    pub round: u8,
    pub player_index: u8,
    pub start_s: f64,
    pub end_s: f64,
}

impl DraftTurnWindow {
    pub fn to_pick_window(self) -> TurnWindow {
        TurnWindow {
            player_index: self.player_index,
            start_s: self.start_s,
            end_s: self.end_s,
        }
    }
}

impl From<&DraftTurnWindow> for TurnWindow {
    fn from(value: &DraftTurnWindow) -> Self {
        value.to_pick_window()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeroSelectionReentry {
    Restart,
    Resume,
}

fn interleaved_order(player_count: u8) -> Vec<u8> {
    let half = player_count / 2;
    let mut order = Vec::with_capacity(usize::from(player_count));
    for i in 0..half {
        order.push(i);
        order.push(half + i);
    }
    order
}

/// Builds the full serpentine pick schedule relative to `clock_time == 0`.
pub fn build_turn_schedule(config: DraftClockConfig) -> Vec<DraftTurnWindow> {
    let forward = interleaved_order(config.player_count);
    let mut backward = forward.clone();
    backward.reverse();

    let mut windows = Vec::with_capacity(usize::from(config.player_count) * usize::from(config.rounds));
    let mut cursor = 0.0f64;
    let mut seq = 0usize;

    for round in 0..config.rounds {
        if round > 0 {
            cursor += config.round_break_s;
        }
        let order = if round % 2 == 0 { &forward } else { &backward };
        for &player_index in order {
            let start_s = cursor;
            let end_s = cursor + config.turn_duration_s;
            windows.push(DraftTurnWindow {
                seq,
                round,
                player_index,
                start_s,
                end_s,
            });
            seq += 1;
            cursor = end_s;
        }
    }

    windows
}

/// Returns the turn active at `elapsed_s` (seconds since clock zero), or `None`.
pub fn turn_at(elapsed_s: f64, schedule: &[DraftTurnWindow]) -> Option<DraftTurnWindow> {
    schedule
        .iter()
        .copied()
        .find(|w| elapsed_s >= w.start_s && elapsed_s < w.end_s)
}

/// Returns turns that finished inside `(from_s, to_s]`.
pub fn turns_ended_between(
    schedule: &[DraftTurnWindow],
    from_s: f64,
    to_s: f64,
) -> Vec<DraftTurnWindow> {
    schedule
        .iter()
        .copied()
        .filter(|w| w.end_s > from_s && w.end_s <= to_s)
        .collect()
}

/// Matches an OCR'd `"YOU WILL DRAFT IN: N"` countdown against the nearest turn start within `tolerance_s`.
pub fn countdown_target_row(
    countdown_s: f64,
    elapsed_s: f64,
    tolerance_s: f64,
    schedule: &[DraftTurnWindow],
) -> Option<(u8, f64)> {
    let turn_start_s = elapsed_s + countdown_s;
    let mut best: Option<(u8, f64)> = None;
    for window in schedule {
        let delta_s = (window.start_s - turn_start_s).abs();
        if delta_s <= tolerance_s && best.is_none_or(|b| delta_s < b.1) {
            best = Some((window.player_index, delta_s));
        }
    }
    best
}

/// True when `elapsed_s` sits inside a round break or past the final turn.
pub fn is_round_break(elapsed_s: f64, schedule: &[DraftTurnWindow]) -> bool {
    let Some(last) = schedule.last() else {
        return false;
    };
    if elapsed_s >= last.end_s {
        return true;
    }
    elapsed_s >= 0.0 && turn_at(elapsed_s, schedule).is_none()
}

/// True when `clock_time` reflects the pre-pick preview ramp (`-59 -> -8`).
pub fn is_preview_clock(clock_time: Option<i64>) -> bool {
    clock_time.is_some_and(|c| c <= PREVIEW_CLOCK_MAX_S)
}

/// Classifies re-entering hero selection for the same match as a full draft restart vs mid-draft resume.
pub fn classify_hero_selection_reentry(
    clock_time: Option<i64>,
    picks_tracked: usize,
) -> HeroSelectionReentry {
    if picks_tracked == 0 && is_preview_clock(clock_time) {
        HeroSelectionReentry::Restart
    } else {
        HeroSelectionReentry::Resume
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_50_turn_serpentine_schedule_with_breaks() {
        let schedule = build_turn_schedule(DEFAULT_AD_DRAFT_CLOCK);
        assert_eq!(schedule.len(), 50);

        // Round 0 forward: Radiant 0, Dire 5, Radiant 1, ... Dire 9
        let round0: Vec<u8> = schedule[0..10].iter().map(|w| w.player_index).collect();
        assert_eq!(round0, vec![0, 5, 1, 6, 2, 7, 3, 8, 4, 9]);
        assert!((schedule[0].start_s - 0.0).abs() < 1e-12);
        assert!((schedule[9].end_s - 70.0).abs() < 1e-12);

        // Round 1 reversed after 5s break (starts at 75.0)
        let round1: Vec<u8> = schedule[10..20].iter().map(|w| w.player_index).collect();
        assert_eq!(round1, vec![9, 4, 8, 3, 7, 2, 6, 1, 5, 0]);
        assert!((schedule[10].start_s - 75.0).abs() < 1e-12);
        assert!((schedule[49].end_s - 370.0).abs() < 1e-12);
    }

    #[test]
    fn resolves_turns_ended_breaks_countdown_and_reentry() {
        let schedule = build_turn_schedule(DEFAULT_AD_DRAFT_CLOCK);

        assert!(is_round_break(72.0, &schedule));
        assert!(!is_round_break(5.0, &schedule));
        assert!(!is_round_break(-10.0, &schedule));
        assert!(is_round_break(370.0, &schedule));

        let ended = turns_ended_between(&schedule, 7.0, 21.0);
        let ended_seqs: Vec<usize> = ended.iter().map(|w| w.seq).collect();
        assert_eq!(ended_seqs, vec![1, 2]);

        let target = countdown_target_row(27.2, -13.0, 2.5, &schedule);
        // -13 + 27.2 = 14.2 -> turn start 14.0 is player_index 1 (Radiant #2)
        assert_eq!(target.map(|(row, _)| row), Some(1));

        assert!(is_preview_clock(Some(-59)));
        assert!(!is_preview_clock(Some(-7)));
        assert_eq!(
            classify_hero_selection_reentry(Some(-55), 0),
            HeroSelectionReentry::Restart
        );
        assert_eq!(
            classify_hero_selection_reentry(Some(-55), 3),
            HeroSelectionReentry::Resume
        );
    }
}
