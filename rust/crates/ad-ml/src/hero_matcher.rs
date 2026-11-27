//! Fuzzy hero name matcher for player-card OCR reads.
//!
//! Mirrors `src/core/ocr/hero-name-matcher.ts`.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeroNameCandidate {
    pub name: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HeroNameMatch {
    pub name: String,
    pub display_name: String,
    pub distance: usize,
    pub similarity: f64,
}

pub fn normalize_hero_text(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphabetic())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

pub fn levenshtein(a: &str, b: &str) -> usize {
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();
    if a_bytes == b_bytes {
        return 0;
    }
    if a_bytes.is_empty() {
        return b_bytes.len();
    }
    if b_bytes.is_empty() {
        return a_bytes.len();
    }

    let mut prev: Vec<usize> = (0..=b_bytes.len()).collect();
    let mut curr = vec![0usize; b_bytes.len() + 1];

    for (i, &ac) in a_bytes.iter().enumerate() {
        curr[0] = i + 1;
        for (j, &bc) in b_bytes.iter().enumerate() {
            let cost = usize::from(ac != bc);
            curr[j + 1] = (prev[j + 1] + 1).min(curr[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }

    prev[b_bytes.len()]
}

fn max_distance_for(len: usize) -> usize {
    1.max(len / 3)
}

pub fn match_thin_two_letter_hero(
    raw: &str,
    candidates: &[HeroNameCandidate],
) -> Option<HeroNameMatch> {
    let text = normalize_hero_text(raw);
    if text.is_empty() || text.len() > 2 {
        return None;
    }

    let matches: Vec<&HeroNameCandidate> = candidates
        .iter()
        .filter(|c| {
            let norm = normalize_hero_text(&c.display_name);
            if norm.len() != 2 || norm == text {
                return false;
            }
            let stripped: String = norm.chars().filter(|&ch| ch != 'I' && ch != 'L').collect();
            stripped == text
        })
        .collect();

    if matches.len() != 1 {
        return None;
    }

    Some(HeroNameMatch {
        name: matches[0].name.clone(),
        display_name: matches[0].display_name.clone(),
        distance: 2 - text.len(),
        similarity: text.len() as f64 / 2.0,
    })
}

pub fn match_hero_name(raw: &str, candidates: &[HeroNameCandidate]) -> Option<HeroNameMatch> {
    let text = normalize_hero_text(raw);
    if text.len() < 2 {
        return None;
    }
    if text.len() == 2 {
        let exact: Vec<&HeroNameCandidate> = candidates
            .iter()
            .filter(|c| normalize_hero_text(&c.display_name) == text)
            .collect();
        if exact.len() != 1 {
            return None;
        }
        return Some(HeroNameMatch {
            name: exact[0].name.clone(),
            display_name: exact[0].display_name.clone(),
            distance: 0,
            similarity: 1.0,
        });
    }

    let mut best: Option<(&HeroNameCandidate, usize, usize)> = None;
    let mut second_dist = usize::MAX;

    for c in candidates {
        let norm = normalize_hero_text(&c.display_name);
        if norm.is_empty() {
            continue;
        }
        let dist = levenshtein(&text, &norm);
        if dist > max_distance_for(norm.len()) {
            continue;
        }
        match best {
            Some((_, best_dist, _)) if dist < best_dist => {
                second_dist = best_dist;
                best = Some((c, dist, norm.len()));
            }
            None => {
                best = Some((c, dist, norm.len()));
            }
            Some(_) if dist < second_dist => {
                second_dist = dist;
            }
            _ => {}
        }
    }

    let (cand, dist, norm_len) = best?;
    if second_dist == dist {
        return None;
    }
    Some(HeroNameMatch {
        name: cand.name.clone(),
        display_name: cand.display_name.clone(),
        distance: dist,
        similarity: 1.0 - (dist as f64 / norm_len as f64),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roster() -> Vec<HeroNameCandidate> {
        vec![
            HeroNameCandidate {
                name: "winter_wyvern".into(),
                display_name: "Winter Wyvern".into(),
            },
            HeroNameCandidate {
                name: "wisp".into(),
                display_name: "Io".into(),
            },
            HeroNameCandidate {
                name: "axe".into(),
                display_name: "Axe".into(),
            },
            HeroNameCandidate {
                name: "zuus".into(),
                display_name: "Zeus".into(),
            },
        ]
    }

    #[test]
    fn matches_spaced_uppercase_hero_name() {
        let m = match_hero_name("W I N T E R  W Y V E R N", &roster()).unwrap();
        assert_eq!(m.name, "winter_wyvern");
        assert_eq!(m.distance, 0);
        assert_eq!(m.similarity, 1.0);
    }

    #[test]
    fn handles_io_exact_and_thin_glyph_o_while_rejecting_no_hero() {
        let r = roster();
        assert_eq!(match_hero_name("IO", &r).unwrap().name, "wisp");
        assert_eq!(match_thin_two_letter_hero("O", &r).unwrap().name, "wisp");
        assert!(match_thin_two_letter_hero("I", &r).is_none());
        assert!(match_hero_name("NO HERO", &r).is_none());
    }

    #[test]
    fn rejects_ambiguous_ties() {
        let cands = vec![
            HeroNameCandidate {
                name: "hero_a".into(),
                display_name: "Abba".into(),
            },
            HeroNameCandidate {
                name: "hero_b".into(),
                display_name: "Abca".into(),
            },
        ];
        assert!(match_hero_name("ABDA", &cands).is_none());
    }
}
