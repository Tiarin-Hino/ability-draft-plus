//! Normalized cross-correlation (NCC) template matching for picked-ability slots.
//!
//! Mirrors `src/core/ml/template-matcher.ts`.

use std::collections::HashSet;

use crate::{PICK_TEMPLATE_EMPTY_STD, PICK_TEMPLATE_MIN_MARGIN, PICK_TEMPLATE_MIN_NCC};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PixelStats {
    pub mean: f64,
    pub std: f64,
}

#[derive(Debug, Clone)]
pub struct IconTemplate {
    pub name: String,
    pub vec: Vec<u8>,
    pub mean: f64,
    pub std: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TemplateScores {
    pub best: f64,
    pub best_name: Option<String>,
    pub second: f64,
    pub second_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PickMatchResult {
    pub name: Option<String>,
    pub score: f64,
    pub is_empty: bool,
    pub best_name: Option<String>,
    pub second_name: Option<String>,
    pub margin: Option<f64>,
    pub pixel_std: f64,
}

pub fn compute_pixel_stats(vec: &[u8]) -> PixelStats {
    if vec.is_empty() {
        return PixelStats { mean: 0.0, std: 0.0 };
    }
    let len = vec.len() as f64;
    let sum: u64 = vec.iter().map(|&b| u64::from(b)).sum();
    let mean = sum as f64 / len;
    let var_sum: f64 = vec
        .iter()
        .map(|&b| {
            let d = f64::from(b) - mean;
            d * d
        })
        .sum();
    PixelStats {
        mean,
        std: (var_sum / len).sqrt(),
    }
}

pub fn make_icon_template(name: impl Into<String>, vec: Vec<u8>) -> IconTemplate {
    let stats = compute_pixel_stats(&vec);
    IconTemplate {
        name: name.into(),
        vec,
        mean: stats.mean,
        std: stats.std,
    }
}

fn ncc(a: &[u8], a_stats: PixelStats, b: &[u8], b_mean: f64, b_std: f64) -> f64 {
    let dot: f64 = a
        .iter()
        .zip(b.iter())
        .map(|(&av, &bv)| (f64::from(av) - a_stats.mean) * (f64::from(bv) - b_mean))
        .sum();
    dot / (a.len() as f64 * a_stats.std * b_std)
}

pub fn score_templates(
    vec: &[u8],
    stats: PixelStats,
    templates: &[&IconTemplate],
) -> TemplateScores {
    let mut best = f64::NEG_INFINITY;
    let mut best_name: Option<String> = None;
    let mut second = f64::NEG_INFINITY;
    let mut second_name: Option<String> = None;

    for t in templates {
        if t.std == 0.0 || t.vec.len() != vec.len() {
            continue;
        }
        let score = ncc(vec, stats, &t.vec, t.mean, t.std);
        if score > best {
            second = best;
            second_name = best_name;
            best = score;
            best_name = Some(t.name.clone());
        } else if score > second {
            second = score;
            second_name = Some(t.name.clone());
        }
    }

    TemplateScores {
        best,
        best_name,
        second,
        second_name,
    }
}

pub fn match_pick_slot(
    vec: &[u8],
    templates: &[IconTemplate],
    candidate_names: Option<&HashSet<String>>,
) -> PickMatchResult {
    let stats = compute_pixel_stats(vec);
    if stats.std < f64::from(PICK_TEMPLATE_EMPTY_STD) {
        return PickMatchResult {
            name: None,
            score: 0.0,
            is_empty: true,
            best_name: None,
            second_name: None,
            margin: None,
            pixel_std: stats.std,
        };
    }

    let scoped: Vec<&IconTemplate> = match candidate_names {
        Some(names) if !names.is_empty() => {
            let filtered: Vec<&IconTemplate> =
                templates.iter().filter(|t| names.contains(&t.name)).collect();
            if filtered.is_empty() {
                templates.iter().collect()
            } else {
                filtered
            }
        }
        _ => templates.iter().collect(),
    };

    let scores = score_templates(vec, stats, &scoped);
    let Some(best_name) = scores.best_name else {
        return PickMatchResult {
            name: None,
            score: 0.0,
            is_empty: false,
            best_name: None,
            second_name: None,
            margin: None,
            pixel_std: stats.std,
        };
    };

    let margin = if scores.second.is_finite() {
        Some(scores.best - scores.second)
    } else {
        None
    };
    let accepted = scores.best >= f64::from(PICK_TEMPLATE_MIN_NCC)
        && (scores.best - scores.second) >= f64::from(PICK_TEMPLATE_MIN_MARGIN);

    PickMatchResult {
        name: if accepted { Some(best_name.clone()) } else { None },
        score: scores.best,
        is_empty: false,
        best_name: Some(best_name),
        second_name: scores.second_name,
        margin,
        pixel_std: stats.std,
    }
}

pub fn match_pick_slot_scoped(
    vec: &[u8],
    templates: &[IconTemplate],
    candidate_names: Option<&HashSet<String>>,
    fallback_min_ncc: f64,
) -> PickMatchResult {
    let scoped = match_pick_slot(vec, templates, candidate_names);
    if scoped.name.is_some() || scoped.is_empty {
        return scoped;
    }
    let Some(names) = candidate_names else {
        return scoped;
    };
    if names.is_empty() {
        return scoped;
    }

    let wide = match_pick_slot(vec, templates, None);
    if wide.name.is_some() && wide.score >= fallback_min_ncc {
        return wide;
    }
    scoped
}

#[cfg(test)]
mod tests {
    use crate::PICK_TEMPLATE_FALLBACK_MIN_NCC;

    use super::*;

    fn pattern_a() -> Vec<u8> {
        (0..64).map(|i| ((i * 37) % 256) as u8).collect()
    }

    fn pattern_b() -> Vec<u8> {
        (0..64).map(|i| (((63 - i) * 53) % 256) as u8).collect()
    }

    #[test]
    fn empty_uniform_box_is_skipped() {
        let dark = vec![12u8; 64];
        let tpl = make_icon_template("axe_berserkers_call", pattern_a());
        let res = match_pick_slot(&dark, &[tpl], None);
        assert!(res.is_empty);
        assert_eq!(res.name, None);
    }

    #[test]
    fn matches_shifted_brightness_via_ncc() {
        let base = pattern_a();
        let bright: Vec<u8> = base.iter().map(|&v| v.saturating_add(15)).collect();
        let templates = vec![
            make_icon_template("sven_storm_bolt", base),
            make_icon_template("lion_impale", pattern_b()),
        ];

        let res = match_pick_slot(&bright, &templates, None);
        assert!(!res.is_empty);
        assert_eq!(res.name.as_deref(), Some("sven_storm_bolt"));
        assert!(res.score > 0.95);
    }

    #[test]
    fn rejects_near_tie_below_min_margin() {
        let a = pattern_a();
        let mut almost_a = a.clone();
        almost_a[0] = almost_a[0].saturating_add(1);
        let templates = vec![
            make_icon_template("cand_one", a.clone()),
            make_icon_template("cand_two", almost_a),
        ];

        let res = match_pick_slot(&a, &templates, None);
        assert_eq!(res.name, None);
        assert!(res.margin.unwrap() < f64::from(PICK_TEMPLATE_MIN_MARGIN));
    }

    #[test]
    fn scoped_mismatch_recovers_via_unrestricted_fallback() {
        let a = pattern_a();
        let b = pattern_b();
        let templates = vec![
            make_icon_template("missed_from_pool", a.clone()),
            make_icon_template("wrong_pool_candidate", b),
        ];
        let scope = HashSet::from(["wrong_pool_candidate".to_string()]);

        let res = match_pick_slot_scoped(
            &a,
            &templates,
            Some(&scope),
            f64::from(PICK_TEMPLATE_FALLBACK_MIN_NCC),
        );
        assert_eq!(res.name.as_deref(), Some("missed_from_pool"));
        assert!(res.score > 0.99);
    }
}
