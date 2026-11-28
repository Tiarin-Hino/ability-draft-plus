//! Own visual draft-row derivation for playing sessions (`heroNameToken` + OCR veto).
//!
//! Mirrors `src/core/domain/own-row-detection.ts`.

use std::collections::HashMap;

/// Lowercases, strips underscores, and normalizes the sole NPC-vs-DB alias (`zuus` -> `zeus`).
pub fn hero_name_token(name: &str) -> String {
    let normalized: String = name
        .to_ascii_lowercase()
        .chars()
        .filter(|&c| c != '_')
        .collect();
    if normalized == "zuus" {
        "zeus".to_string()
    } else {
        normalized
    }
}

/// Resolves the local player's visual draft row (`0..=9`) from OCR'd card hero names.
/// Returns `None` if absent, ambiguous across rows, or contradicting `team_half_start` (`0` or `5`).
pub fn resolve_own_row_from_ocr(
    ocr_hero_names_by_row: &HashMap<u8, String>,
    local_hero_npc_name: &str,
    team_half_start: Option<u8>,
) -> Option<u8> {
    let token = hero_name_token(local_hero_npc_name);
    let mut matches: Vec<u8> = Vec::new();
    for (&row, ocr_name) in ocr_hero_names_by_row {
        if hero_name_token(ocr_name) == token {
            matches.push(row);
        }
    }
    if matches.len() != 1 {
        return None;
    }

    let row = matches[0];
    if row > 9 {
        return None;
    }
    if let Some(start) = team_half_start {
        if row < start || row >= start + 5 {
            return None;
        }
    }
    Some(row)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_npc_tokens_including_zeus_alias() {
        assert_eq!(hero_name_token("npc_test"), "npctest");
        assert_eq!(hero_name_token("Drow_Ranger"), "drowranger");
        assert_eq!(hero_name_token("zuus"), "zeus");
        assert_eq!(hero_name_token("Zeus"), "zeus");
    }

    #[test]
    fn resolves_unique_row_and_enforces_ambiguity_and_team_half_veto() {
        let ocr = HashMap::from([
            (2u8, "zuus".to_string()),
            (6u8, "axe".to_string()),
            (7u8, "axe".to_string()),
        ]);

        assert_eq!(
            resolve_own_row_from_ocr(&ocr, "zeus", Some(0)),
            Some(2)
        );
        // Contradicts dire team half
        assert_eq!(resolve_own_row_from_ocr(&ocr, "zeus", Some(5)), None);
        // Ambiguous duplicate hero across two rows
        assert_eq!(resolve_own_row_from_ocr(&ocr, "axe", Some(5)), None);
        // Absent hero
        assert_eq!(resolve_own_row_from_ocr(&ocr, "puck", None), None);
    }
}
