//! Role-fingerprint shift axes derived from Windrun `/ability-shifts` columns.
//!
//! Mirrors `src/core/domain/shift-axes.ts` (ordering-only percentile ranks in `[-1, +1]`).

use std::collections::HashMap;

pub const SHIFT_GREED_XPM_WEIGHT: f64 = 0.5;

#[derive(Debug, Clone)]
pub struct AbilityShiftRow {
    pub name: String,
    pub kills_shift: Option<f64>,
    pub ka_shift: Option<f64>,
    pub gpm_shift: Option<f64>,
    pub xpm_shift: Option<f64>,
    pub healing_shift: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct ShiftAxes {
    pub greed: f64,
    pub killtaking: f64,
    pub playmaking: f64,
    pub enabling: f64,
}

fn percentile_ranks(values: &[Option<f64>]) -> HashMap<usize, f64> {
    let mut indexed: Vec<(usize, f64)> = values
        .iter()
        .enumerate()
        .filter_map(|(idx, val)| val.map(|v| (idx, v)))
        .collect();
    let mut ranks = HashMap::new();
    let n = indexed.len();
    if n == 0 {
        return ranks;
    }
    if n == 1 {
        ranks.insert(indexed[0].0, 0.5);
        return ranks;
    }

    indexed.sort_by(|a, b| a.1.total_cmp(&b.1));
    let mut i = 0;
    while i < n {
        let mut j = i + 1;
        while j < n && indexed[j].1 == indexed[i].1 {
            j += 1;
        }
        let avg_pos = (i + j - 1) as f64 / 2.0;
        let pct = avg_pos / (n - 1) as f64;
        for &(orig_idx, _) in &indexed[i..j] {
            ranks.insert(orig_idx, pct);
        }
        i = j;
    }
    ranks
}

fn to_axis(pct: Option<f64>) -> f64 {
    match pct {
        Some(p) => 2.0 * p - 1.0,
        None => 0.0,
    }
}

pub fn compute_shift_axes(rows: &[AbilityShiftRow]) -> HashMap<String, ShiftAxes> {
    let greed_input: Vec<Option<f64>> = rows
        .iter()
        .map(|r| match (r.gpm_shift, r.xpm_shift) {
            (Some(gpm), Some(xpm)) => Some(gpm + SHIFT_GREED_XPM_WEIGHT * xpm),
            _ => None,
        })
        .collect();
    let kills_input: Vec<Option<f64>> = rows.iter().map(|r| r.kills_shift).collect();
    let ka_input: Vec<Option<f64>> = rows.iter().map(|r| r.ka_shift).collect();
    let healing_input: Vec<Option<f64>> = rows.iter().map(|r| r.healing_shift).collect();

    let greed_pct = percentile_ranks(&greed_input);
    let kills_pct = percentile_ranks(&kills_input);
    let ka_pct = percentile_ranks(&ka_input);
    let healing_pct = percentile_ranks(&healing_input);

    let mut axes = HashMap::with_capacity(rows.len());
    for (idx, row) in rows.iter().enumerate() {
        let g = greed_pct.get(&idx).copied();
        let k = kills_pct.get(&idx).copied();
        let p = ka_pct.get(&idx).copied();
        let e = healing_pct.get(&idx).copied();
        if g.is_none() && k.is_none() && p.is_none() && e.is_none() {
            axes.insert(row.name.clone(), ShiftAxes::default());
        } else {
            axes.insert(
                row.name.clone(),
                ShiftAxes {
                    greed: to_axis(g),
                    killtaking: to_axis(k),
                    playmaking: to_axis(p),
                    enabling: to_axis(e),
                },
            );
        }
    }
    axes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn averages_ties_and_leaves_nulls_neutral() {
        let rows = vec![
            AbilityShiftRow {
                name: "low".into(),
                kills_shift: Some(0.0),
                ka_shift: None,
                gpm_shift: Some(-1.0),
                xpm_shift: Some(0.0),
                healing_shift: Some(0.0),
            },
            AbilityShiftRow {
                name: "tie_a".into(),
                kills_shift: Some(1.0),
                ka_shift: None,
                gpm_shift: Some(0.5),
                xpm_shift: Some(0.0),
                healing_shift: Some(0.0),
            },
            AbilityShiftRow {
                name: "tie_b".into(),
                kills_shift: Some(1.0),
                ka_shift: None,
                gpm_shift: Some(0.5),
                xpm_shift: Some(0.0),
                healing_shift: Some(0.0),
            },
            AbilityShiftRow {
                name: "null_row".into(),
                kills_shift: None,
                ka_shift: None,
                gpm_shift: None,
                xpm_shift: None,
                healing_shift: None,
            },
        ];

        let axes = compute_shift_axes(&rows);
        assert!((axes["low"].greed - (-1.0)).abs() < 1e-12);
        // Ranks 1 and 2 out of 3 -> avg 1.5 / 2 = 0.75 -> 2*0.75 - 1 = +0.5
        assert!((axes["tie_a"].greed - 0.5).abs() < 1e-12);
        assert_eq!(axes["tie_a"].greed, axes["tie_b"].greed);
        // All healing tied at 0.0 -> avg rank 1.0 / 2 = 0.5 -> 0.0
        assert!((axes["low"].enabling - 0.0).abs() < 1e-12);
        assert_eq!(axes["null_row"], ShiftAxes::default());
    }
}
