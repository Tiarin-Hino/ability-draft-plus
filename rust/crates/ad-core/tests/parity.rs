//! Golden JSON parity suite comparing `ad-core` outputs bit-for-bit (`< 1e-12`) against `src/core/`.

use std::collections::{HashMap, HashSet};

use ad_core::{
    draft_clock::{
        build_turn_schedule, classify_hero_selection_reentry, countdown_target_row,
        is_preview_clock, is_round_break, HeroSelectionReentry, DEFAULT_AD_DRAFT_CLOCK,
    },
    gsi::{parse_gsi_payload, GamePhase, GsiMode},
    role_scoring::{compute_role_score, RoleContext, RoleTagInput},
    scoring::{
        calculate_consolidated_score, calculate_personalized_score, normalize_pick_order,
        normalize_winrate, PersonalSample,
    },
    shift_axes::{compute_shift_axes, AbilityShiftRow, ShiftAxes},
    tags::AbilityTag,
    top_tier::{determine_top_tier_entities, EntityType, ScoredEntity},
};
use serde::Deserialize;
use serde_json::Value;

const GOLDEN_JSON: &str = include_str!("fixtures/parity_golden.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenFixture {
    scoring_cases: Vec<ScoringCase>,
    shift_rows: Vec<ShiftRowJson>,
    shift_axes: HashMap<String, ShiftAxesJson>,
    role_cases: Vec<RoleCase>,
    top_tier_entities: Vec<TopTierEntityIn>,
    top_tier: Vec<TopTierEntityOut>,
    draft_clock: DraftClockGolden,
    gsi_payloads: Vec<GsiGolden>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersonalJson {
    games: u32,
    winrate: f64,
    avg_pick_position: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScoringInput {
    winrate: Option<f64>,
    pick_rate: Option<f64>,
    personal: Option<PersonalJson>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersonalizedJson {
    consolidated_score: f64,
    personal_games: Option<u32>,
    personal_winrate: Option<f64>,
    personal_score_delta: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScoringCase {
    input: ScoringInput,
    normalized_winrate: f64,
    normalized_pick_order: f64,
    consolidated_score: f64,
    personalized: PersonalizedJson,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShiftRowJson {
    name: String,
    kills_shift: Option<f64>,
    ka_shift: Option<f64>,
    gpm_shift: Option<f64>,
    xpm_shift: Option<f64>,
    healing_shift: Option<f64>,
}

#[derive(Deserialize)]
struct ShiftAxesJson {
    greed: f64,
    killtaking: f64,
    playmaking: f64,
    enabling: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoleInputJson {
    axes: ShiftAxesJson,
    positions: Vec<u8>,
    my_pick_count: usize,
    team_greed: Option<f64>,
    candidate_tags: Vec<String>,
    role_must: Vec<u8>,
    my_pick_tags: Vec<Vec<String>>,
    pool_has_hard_cc: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoleOutputJson {
    delta: f64,
    best_position: u8,
    reasons: Vec<String>,
    curated: bool,
}

#[derive(Deserialize)]
struct RoleCase {
    input: RoleInputJson,
    output: Option<RoleOutputJson>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TopTierEntityIn {
    internal_name: String,
    entity_type: String,
    consolidated_score: f64,
    is_ultimate_from_coord_source: bool,
    is_ultimate_from_db: bool,
    #[serde(default)]
    role_curated: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TopTierEntityOut {
    internal_name: String,
    entity_type: String,
    is_synergy_suggestion_for_my_spot: bool,
    is_general_top_tier: bool,
    is_curated_for_role: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TurnWindowJson {
    seq: usize,
    round: u8,
    player_index: u8,
    start_s: f64,
    end_s: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CountdownTargetJson {
    row: u8,
    #[serde(rename = "deltaS")]
    delta_s: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoundBreakJson {
    elapsed_s: f64,
    is_break: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewClockJson {
    clock_time: i64,
    is_preview: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftClockGolden {
    schedule: Vec<TurnWindowJson>,
    countdown_target: Option<CountdownTargetJson>,
    round_breaks: Vec<RoundBreakJson>,
    preview_clocks: Vec<PreviewClockJson>,
    reentries: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GsiPlayerJson {
    slot_index: u8,
    name: String,
    account_id: Option<String>,
    hero_npc_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GsiParsedJson {
    match_id: Option<String>,
    game_phase: Option<String>,
    clock_time: Option<i64>,
    mode: String,
    local_slot_index: Option<u8>,
    local_hero_npc_name: Option<String>,
    players: Vec<GsiPlayerJson>,
}

#[derive(Deserialize)]
struct GsiGolden {
    raw: Value,
    parsed: GsiParsedJson,
}

fn load_golden() -> GoldenFixture {
    serde_json::from_str(GOLDEN_JSON).expect("parse parity_golden.json")
}

fn assert_close(actual: f64, expected: f64, label: &str) {
    assert!(
        (actual - expected).abs() < 1e-12,
        "{label}: rust={actual} vs ts={expected}"
    );
}

#[test]
fn scoring_matches_typescript_golden() {
    let golden = load_golden();
    for (idx, c) in golden.scoring_cases.iter().enumerate() {
        assert_close(
            normalize_winrate(c.input.winrate),
            c.normalized_winrate,
            &format!("case {idx} normalize_winrate"),
        );
        assert_close(
            normalize_pick_order(c.input.pick_rate),
            c.normalized_pick_order,
            &format!("case {idx} normalize_pick_order"),
        );
        assert_close(
            calculate_consolidated_score(c.input.winrate, c.input.pick_rate),
            c.consolidated_score,
            &format!("case {idx} consolidated_score"),
        );

        let sample = c.input.personal.as_ref().map(|p| PersonalSample {
            games: p.games,
            winrate: p.winrate,
            avg_pick_position: p.avg_pick_position,
        });
        let rs = calculate_personalized_score(c.input.winrate, c.input.pick_rate, sample.as_ref());
        assert_close(
            rs.consolidated_score,
            c.personalized.consolidated_score,
            &format!("case {idx} personalized.consolidated_score"),
        );
        assert_eq!(rs.personal_games, c.personalized.personal_games);
        match (rs.personal_winrate, c.personalized.personal_winrate) {
            (Some(a), Some(b)) => assert_close(a, b, &format!("case {idx} personal_winrate")),
            (None, None) => {}
            _ => panic!("case {idx}: personal_winrate presence mismatch"),
        }
        match (rs.personal_score_delta, c.personalized.personal_score_delta) {
            (Some(a), Some(b)) => assert_close(a, b, &format!("case {idx} personal_score_delta")),
            (None, None) => {}
            _ => panic!("case {idx}: personal_score_delta presence mismatch"),
        }
    }
}

#[test]
fn shift_axes_and_role_scoring_match_typescript_golden() {
    let golden = load_golden();
    let rows: Vec<AbilityShiftRow> = golden
        .shift_rows
        .iter()
        .map(|r| AbilityShiftRow {
            name: r.name.clone(),
            kills_shift: r.kills_shift,
            ka_shift: r.ka_shift,
            gpm_shift: r.gpm_shift,
            xpm_shift: r.xpm_shift,
            healing_shift: r.healing_shift,
        })
        .collect();
    let computed = compute_shift_axes(&rows);
    for (name, ts_axes) in &golden.shift_axes {
        let rs_axes = computed.get(name).expect("missing shift axes row");
        assert_close(rs_axes.greed, ts_axes.greed, &format!("{name}.greed"));
        assert_close(rs_axes.killtaking, ts_axes.killtaking, &format!("{name}.killtaking"));
        assert_close(rs_axes.playmaking, ts_axes.playmaking, &format!("{name}.playmaking"));
        assert_close(rs_axes.enabling, ts_axes.enabling, &format!("{name}.enabling"));
    }

    for (idx, rc) in golden.role_cases.iter().enumerate() {
        let axes = ShiftAxes {
            greed: rc.input.axes.greed,
            killtaking: rc.input.axes.killtaking,
            playmaking: rc.input.axes.playmaking,
            enabling: rc.input.axes.enabling,
        };
        let ctx = if rc.input.positions.is_empty() {
            None
        } else {
            Some(RoleContext {
                effective_positions: rc.input.positions.clone(),
                my_pick_count: rc.input.my_pick_count,
                team_greed: rc.input.team_greed,
            })
        };
        let cand_tags: HashSet<AbilityTag> = rc
            .input
            .candidate_tags
            .iter()
            .filter_map(|s| AbilityTag::from_str_opt(s))
            .collect();
        let role_must: HashSet<u8> = rc.input.role_must.iter().copied().collect();
        let pick_tags: Vec<HashSet<AbilityTag>> = rc
            .input
            .my_pick_tags
            .iter()
            .map(|set| {
                set.iter()
                    .filter_map(|s| AbilityTag::from_str_opt(s))
                    .collect()
            })
            .collect();
        let tag_input = RoleTagInput {
            candidate_tags: Some(&cand_tags),
            candidate_role_must: if role_must.is_empty() {
                None
            } else {
                Some(&role_must)
            },
            my_pick_tags: &pick_tags,
            need_scarcity: None,
            pool_has_hard_cc: rc.input.pool_has_hard_cc,
        };
        let rs = compute_role_score(Some(&axes), ctx.as_ref(), Some(&tag_input));
        match (rs, &rc.output) {
            (None, None) => {}
            (Some(actual), Some(expected)) => {
                assert_close(actual.delta, expected.delta, &format!("role case {idx} delta"));
                assert_eq!(actual.best_position, expected.best_position);
                assert_eq!(actual.reasons, expected.reasons);
                assert_eq!(actual.curated, expected.curated);
            }
            _ => panic!("role case {idx}: None vs Some mismatch"),
        }
    }
}

#[test]
fn top_tier_matches_typescript_golden() {
    let golden = load_golden();
    let entities: Vec<ScoredEntity> = golden
        .top_tier_entities
        .iter()
        .map(|e| ScoredEntity {
            internal_name: e.internal_name.clone(),
            entity_type: if e.entity_type == "hero" {
                EntityType::Hero
            } else {
                EntityType::Ability
            },
            consolidated_score: e.consolidated_score,
            is_ultimate_from_coord_source: e.is_ultimate_from_coord_source,
            is_ultimate_from_db: e.is_ultimate_from_db,
            role_curated: e.role_curated.unwrap_or(false),
        })
        .collect();
    let synergies = HashSet::from(["synergy_std".to_string(), "synergy_ult".to_string()]);
    let rs = determine_top_tier_entities(&entities, Some(10), true, &synergies);
    assert_eq!(rs.len(), golden.top_tier.len());

    for (actual, expected) in rs.iter().zip(golden.top_tier.iter()) {
        assert_eq!(actual.entity.internal_name, expected.internal_name);
        let et = match actual.entity.entity_type {
            EntityType::Ability => "ability",
            EntityType::Hero => "hero",
        };
        assert_eq!(et, expected.entity_type);
        assert_eq!(
            actual.is_synergy_suggestion_for_my_spot,
            expected.is_synergy_suggestion_for_my_spot
        );
        assert_eq!(actual.is_general_top_tier, expected.is_general_top_tier);
        assert_eq!(actual.is_curated_for_role, expected.is_curated_for_role);
    }
}

#[test]
fn draft_clock_and_gsi_parser_match_typescript_golden() {
    let golden = load_golden();
    let schedule = build_turn_schedule(DEFAULT_AD_DRAFT_CLOCK);
    assert_eq!(schedule.len(), golden.draft_clock.schedule.len());
    for (a, b) in schedule.iter().zip(golden.draft_clock.schedule.iter()) {
        assert_eq!(a.seq, b.seq);
        assert_eq!(a.round, b.round);
        assert_eq!(a.player_index, b.player_index);
        assert_close(a.start_s, b.start_s, "turn start_s");
        assert_close(a.end_s, b.end_s, "turn end_s");
    }

    let cd = countdown_target_row(27.2, -13.0, 2.5, &schedule);
    let ts_cd = golden.draft_clock.countdown_target.as_ref().unwrap();
    assert_eq!(cd.unwrap().0, ts_cd.row);
    assert_close(cd.unwrap().1, ts_cd.delta_s, "countdown delta_s");

    for rb in &golden.draft_clock.round_breaks {
        assert_eq!(is_round_break(rb.elapsed_s, &schedule), rb.is_break);
    }
    for pc in &golden.draft_clock.preview_clocks {
        assert_eq!(is_preview_clock(Some(pc.clock_time)), pc.is_preview);
    }

    let rs_reentries = vec![
        classify_hero_selection_reentry(Some(-55), 0),
        classify_hero_selection_reentry(Some(-55), 3),
        classify_hero_selection_reentry(Some(10), 0),
    ];
    let ts_reentries: Vec<HeroSelectionReentry> = golden
        .draft_clock
        .reentries
        .iter()
        .map(|s| {
            if s == "restart" {
                HeroSelectionReentry::Restart
            } else {
                HeroSelectionReentry::Resume
            }
        })
        .collect();
    assert_eq!(rs_reentries, ts_reentries);

    for gp in &golden.gsi_payloads {
        let rs = parse_gsi_payload(&gp.raw);
        assert_eq!(rs.match_id, gp.parsed.match_id);
        assert_eq!(rs.clock_time, gp.parsed.clock_time);
        assert_eq!(
            rs.game_phase,
            gp.parsed
                .game_phase
                .as_deref()
                .map(GamePhase::from_dota_str)
        );
        let rs_mode = match rs.mode {
            GsiMode::Playing => "playing",
            GsiMode::Spectating => "spectating",
            GsiMode::Unknown => "unknown",
        };
        assert_eq!(rs_mode, gp.parsed.mode);
        assert_eq!(rs.local_slot_index, gp.parsed.local_slot_index);
        assert_eq!(
            rs.local_player.as_ref().and_then(|l| l.hero_npc_name.clone()),
            gp.parsed.local_hero_npc_name
        );
        assert_eq!(rs.players.len(), gp.parsed.players.len());
        for (rp, tp) in rs.players.iter().zip(gp.parsed.players.iter()) {
            assert_eq!(rp.slot_index, tp.slot_index);
            assert_eq!(rp.name, tp.name);
            assert_eq!(rp.account_id, tp.account_id);
            assert_eq!(rp.hero_npc_name, tp.hero_npc_name);
        }
    }
}
