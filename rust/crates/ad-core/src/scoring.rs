//! Ability/hero scoring formula and personalization shrinkage.
//!
//! Mirrors `src/core/domain/scoring.ts`:
//! `consolidated_score = 0.4 * normalize_winrate(winrate) + 0.6 * normalize_pick_order(pick_rate)`
//! with pick order clamped to `[1.0, 50.0]` and top-tier recommendations capped at `10`.

pub const WINRATE_WEIGHT: f64 = 0.4;
pub const PICK_ORDER_WEIGHT: f64 = 0.6;
pub const MIN_PICK_ORDER: f64 = 1.0;
pub const MAX_PICK_ORDER: f64 = 50.0;
pub const TOP_TIER_CAP: usize = 10;
pub const PERSONAL_PRIOR_STRENGTH: f64 = 20.0;
pub const NEUTRAL_PICK_POSITION: f64 = (MIN_PICK_ORDER + MAX_PICK_ORDER) / 2.0;

#[derive(Debug, Clone, PartialEq)]
pub struct PersonalSample {
    pub games: u32,
    pub winrate: f64,
    pub avg_pick_position: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PersonalizedScore {
    pub consolidated_score: f64,
    pub personal_games: Option<u32>,
    pub personal_winrate: Option<f64>,
    pub personal_score_delta: Option<f64>,
}

/// Normalizes winrate (`[0.0, 1.0]`). Missing winrate defaults to `0.5` (neutral).
pub fn normalize_winrate(winrate: Option<f64>) -> f64 {
    winrate.unwrap_or(0.5)
}

/// Normalizes and inverts average pick order (`[1.0, 50.0]`). Lower = picked earlier = higher score.
/// Missing pick rate defaults to `0.5` (neutral).
pub fn normalize_pick_order(pick_rate: Option<f64>) -> f64 {
    let Some(pick) = pick_rate else {
        return 0.5;
    };
    let clamped = pick.clamp(MIN_PICK_ORDER, MAX_PICK_ORDER);
    let range = MAX_PICK_ORDER - MIN_PICK_ORDER;
    (MAX_PICK_ORDER - clamped) / range
}

/// Computes `0.4 * normalize_winrate(winrate) + 0.6 * normalize_pick_order(pick_rate)`.
pub fn calculate_consolidated_score(winrate: Option<f64>, pick_rate: Option<f64>) -> f64 {
    WINRATE_WEIGHT * normalize_winrate(winrate) + PICK_ORDER_WEIGHT * normalize_pick_order(pick_rate)
}

/// Shrinks a personal sample toward the global value in input space:
/// `(games * personal + K * prior) / (games + K)` where `K = 20`.
pub fn blend_personal(
    global_value: Option<f64>,
    personal_value: f64,
    games: u32,
    neutral: f64,
) -> f64 {
    let prior = global_value.unwrap_or(neutral);
    if games == 0 {
        return prior;
    }
    let g = f64::from(games);
    (g * personal_value + PERSONAL_PRIOR_STRENGTH * prior) / (g + PERSONAL_PRIOR_STRENGTH)
}

/// Computes consolidated score with optional personal stats shrinkage.
/// When `personal` is `None` or `games == 0`, returns the global-only score bit-identically.
pub fn calculate_personalized_score(
    global_winrate: Option<f64>,
    global_pick_rate: Option<f64>,
    personal: Option<&PersonalSample>,
) -> PersonalizedScore {
    let base_score = calculate_consolidated_score(global_winrate, global_pick_rate);
    let Some(p) = personal.filter(|s| s.games > 0) else {
        return PersonalizedScore {
            consolidated_score: base_score,
            personal_games: None,
            personal_winrate: None,
            personal_score_delta: None,
        };
    };

    let blended_wr = blend_personal(global_winrate, p.winrate, p.games, 0.5);
    let blended_pick = match p.avg_pick_position {
        Some(avg_pick) => Some(blend_personal(
            global_pick_rate,
            avg_pick,
            p.games,
            NEUTRAL_PICK_POSITION,
        )),
        None => global_pick_rate,
    };

    let consolidated_score = calculate_consolidated_score(Some(blended_wr), blended_pick);
    PersonalizedScore {
        consolidated_score,
        personal_games: Some(p.games),
        personal_winrate: Some(p.winrate),
        personal_score_delta: Some(consolidated_score - base_score),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_pick_order_and_clamps_bounds() {
        assert!((normalize_pick_order(None) - 0.5).abs() < 1e-12);
        assert!((normalize_pick_order(Some(0.0)) - 1.0).abs() < 1e-12);
        assert!((normalize_pick_order(Some(1.0)) - 1.0).abs() < 1e-12);
        assert!((normalize_pick_order(Some(50.0)) - 0.0).abs() < 1e-12);
        assert!((normalize_pick_order(Some(99.0)) - 0.0).abs() < 1e-12);
    }

    #[test]
    fn consolidated_score_uses_global_formula_and_neutral_missing() {
        let best = calculate_consolidated_score(Some(1.0), Some(1.0));
        let worst = calculate_consolidated_score(Some(0.0), Some(50.0));
        let neutral = calculate_consolidated_score(None, None);
        assert!((best - 1.0).abs() < 1e-12);
        assert!((worst - 0.0).abs() < 1e-12);
        assert!((neutral - 0.5).abs() < 1e-12);
    }

    #[test]
    fn personal_shrinkage_is_bit_identical_when_absent_and_blends_with_k20() {
        let global = calculate_consolidated_score(Some(0.50), Some(25.5));
        let none_res = calculate_personalized_score(Some(0.50), Some(25.5), None);
        assert_eq!(none_res.consolidated_score, global);
        assert_eq!(none_res.personal_games, None);

        let zero_res = calculate_personalized_score(
            Some(0.50),
            Some(25.5),
            Some(&PersonalSample {
                games: 0,
                winrate: 0.90,
                avg_pick_position: Some(1.0),
            }),
        );
        assert_eq!(zero_res.consolidated_score, global);

        let sample = PersonalSample {
            games: 20,
            winrate: 0.70,
            avg_pick_position: Some(1.0),
        };
        let blended = calculate_personalized_score(Some(0.50), Some(25.5), Some(&sample));
        assert_eq!(blended.personal_games, Some(20));
        assert!((blended.personal_winrate.unwrap() - 0.70).abs() < 1e-12);
        assert!(blended.personal_score_delta.unwrap() > 0.1);
    }
}
