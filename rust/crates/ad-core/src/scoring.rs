//! Base Ability Draft Plus scoring formula and top-tier selection invariants.
//!
//! Mirrors `src/core/domain/scoring.ts`:
//! `0.4 * winrate_norm + 0.6 * inverted_pick_order_norm`, with pick order clamped
//! to `[1.0, 50.0]` and top-tier recommendations capped at `TOP_TIER_CAP = 10`.

pub const WINRATE_WEIGHT: f64 = 0.4;
pub const PICK_ORDER_WEIGHT: f64 = 0.6;
pub const MIN_PICK_ORDER: f64 = 1.0;
pub const MAX_PICK_ORDER: f64 = 50.0;
pub const TOP_TIER_CAP: usize = 10;

/// Normalizes a winrate in `[0.0, 1.0]` across the active pool bounds.
pub fn normalize_winrate(winrate: f64, min_wr: f64, max_wr: f64) -> f64 {
    let span = max_wr - min_wr;
    if span <= f64::EPSILON {
        return 0.5;
    }
    ((winrate - min_wr) / span).clamp(0.0, 1.0)
}

/// Normalizes and inverts average pick order (lower pick order = higher value).
pub fn normalize_inverted_pick_order(pick_order: f64) -> f64 {
    let clamped = pick_order.clamp(MIN_PICK_ORDER, MAX_PICK_ORDER);
    1.0 - ((clamped - MIN_PICK_ORDER) / (MAX_PICK_ORDER - MIN_PICK_ORDER))
}

/// Computes the consolidated base score for an ability or hero model.
pub fn compute_base_score(winrate: f64, min_wr: f64, max_wr: f64, avg_pick_order: f64) -> f64 {
    let wr_norm = normalize_winrate(winrate, min_wr, max_wr);
    let pick_norm = normalize_inverted_pick_order(avg_pick_order);
    WINRATE_WEIGHT * wr_norm + PICK_ORDER_WEIGHT * pick_norm
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inverted_pick_order_clamps_bounds() {
        assert!((normalize_inverted_pick_order(0.0) - 1.0).abs() < 1e-9);
        assert!((normalize_inverted_pick_order(1.0) - 1.0).abs() < 1e-9);
        assert!((normalize_inverted_pick_order(50.0) - 0.0).abs() < 1e-9);
        assert!((normalize_inverted_pick_order(99.0) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn base_score_weights_winrate_and_pick_order() {
        let best = compute_base_score(0.60, 0.40, 0.60, 1.0);
        let worst = compute_base_score(0.40, 0.40, 0.60, 50.0);
        assert!((best - 1.0).abs() < 1e-9);
        assert!((worst - 0.0).abs() < 1e-9);

        let flat_wr = compute_base_score(0.50, 0.50, 0.50, 1.0);
        assert!((flat_wr - (0.4 * 0.5 + 0.6 * 1.0)).abs() < 1e-9);
    }
}
