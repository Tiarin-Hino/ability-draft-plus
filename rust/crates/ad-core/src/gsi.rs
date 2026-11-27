//! Dota 2 Game State Integration (GSI) domain types and tolerant payload parser.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GsiMode {
    Playing,
    Spectating,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GamePhase {
    Init,
    WaitForPlayersToLoad,
    HeroSelection,
    StrategyTime,
    PreGame,
    GameInProgress,
    PostGame,
    Disconnect,
    Unknown,
}

impl GamePhase {
    pub fn from_dota_str(raw: &str) -> Self {
        match raw {
            "DOTA_GAMERULES_STATE_INIT" => Self::Init,
            "DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD" => Self::WaitForPlayersToLoad,
            "DOTA_GAMERULES_STATE_HERO_SELECTION" => Self::HeroSelection,
            "DOTA_GAMERULES_STATE_STRATEGY_TIME" => Self::StrategyTime,
            "DOTA_GAMERULES_STATE_PRE_GAME" => Self::PreGame,
            "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS" => Self::GameInProgress,
            "DOTA_GAMERULES_STATE_POST_GAME" => Self::PostGame,
            "DOTA_GAMERULES_STATE_DISCONNECT" => Self::Disconnect,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GsiPlayer {
    pub slot_index: u8,
    pub name: String,
    pub account_id: Option<String>,
    pub hero_npc_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalGsiPlayer {
    pub name: String,
    pub account_id: Option<String>,
    pub slot_index: Option<u8>,
    pub hero_npc_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GsiSnapshot {
    pub match_id: Option<String>,
    pub game_phase: Option<GamePhase>,
    pub clock_time: Option<i64>,
    pub in_draft: bool,
    pub mode: GsiMode,
    pub local_slot_index: Option<u8>,
    pub local_player: Option<LocalGsiPlayer>,
    pub players: Vec<GsiPlayer>,
}

fn non_empty_str(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

fn slot_index_from_key(key: &str) -> Option<u8> {
    let rest = key.strip_prefix("player")?;
    if rest.len() == 1 {
        let digit = rest.chars().next()?.to_digit(10)?;
        return u8::try_from(digit).ok();
    }
    None
}

fn hero_npc_short_name(value: Option<&Value>) -> Option<String> {
    let raw = non_empty_str(value)?;
    raw.strip_prefix("npc_dota_hero_").map(ToOwned::to_owned)
}

fn resolve_slot_index(key: &str, player: &Map<String, Value>, is_dire: bool) -> Option<u8> {
    if let Some(team_slot) = player.get("team_slot").and_then(Value::as_i64) {
        if (0..=4).contains(&team_slot) {
            let base: i64 = if is_dire { 5 } else { 0 };
            return u8::try_from(base + team_slot).ok();
        }
    }
    let raw_index = slot_index_from_key(key)?;
    if is_dire && raw_index < 5 {
        Some(raw_index + 5)
    } else {
        Some(raw_index)
    }
}

fn local_slot_index(player: &Map<String, Value>) -> Option<u8> {
    let team_name = player.get("team_name").and_then(Value::as_str)?;
    let team_slot = player.get("team_slot").and_then(Value::as_i64)?;
    if !(0..=4).contains(&team_slot) {
        return None;
    }
    let team_slot_u8 = u8::try_from(team_slot).ok()?;
    match team_name {
        "radiant" => Some(team_slot_u8),
        "dire" => Some(5 + team_slot_u8),
        _ => None,
    }
}

fn parse_team_heroes(team: Option<&Value>) -> HashMap<u8, String> {
    let mut heroes = HashMap::new();
    let Some(team_map) = team.and_then(Value::as_object) else {
        return heroes;
    };
    for (key, value) in team_map {
        let Some(key_index) = slot_index_from_key(key) else {
            continue;
        };
        let Some(hero) = value.as_object() else {
            continue;
        };
        if let Some(npc) = hero_npc_short_name(hero.get("name")) {
            heroes.insert(key_index, npc);
        }
    }
    heroes
}

fn parse_team_players(
    team: Option<&Value>,
    heroes_by_key: &HashMap<u8, String>,
    is_dire: bool,
    into: &mut Vec<GsiPlayer>,
) {
    let Some(team_map) = team.and_then(Value::as_object) else {
        return;
    };
    for (key, value) in team_map {
        let Some(key_index) = slot_index_from_key(key) else {
            continue;
        };
        let Some(player) = value.as_object() else {
            continue;
        };
        let Some(slot_index) = resolve_slot_index(key, player, is_dire) else {
            continue;
        };
        let Some(name) = non_empty_str(player.get("name")) else {
            continue;
        };
        into.push(GsiPlayer {
            slot_index,
            name,
            account_id: non_empty_str(player.get("accountid")),
            hero_npc_name: heroes_by_key.get(&key_index).cloned(),
        });
    }
}

/// Normalizes a raw Dota 2 GSI JSON payload into a `GsiSnapshot`.
/// Tolerant by design: missing or unexpected sections yield `None`/empty fields.
pub fn parse_gsi_payload(raw: &Value) -> GsiSnapshot {
    let map = raw.get("map").and_then(Value::as_object);
    let match_id = map.and_then(|m| non_empty_str(m.get("matchid")));
    let game_phase = map
        .and_then(|m| m.get("game_state").and_then(Value::as_str))
        .filter(|s| !s.is_empty())
        .map(GamePhase::from_dota_str);
    let clock_time = map.and_then(|m| m.get("clock_time").and_then(Value::as_i64));
    let in_draft = game_phase == Some(GamePhase::HeroSelection);

    let player_block = raw.get("player").and_then(Value::as_object);
    let hero_block = raw.get("hero").and_then(Value::as_object);

    let mut players = Vec::new();
    let mut local_player = None;
    let mut local_slot = None;

    if let Some(player_map) = player_block {
        let team2 = player_map.get("team2");
        let team3 = player_map.get("team3");
        if team2.and_then(Value::as_object).is_some()
            || team3.and_then(Value::as_object).is_some()
        {
            let radiant_heroes = parse_team_heroes(hero_block.and_then(|h| h.get("team2")));
            let dire_heroes = parse_team_heroes(hero_block.and_then(|h| h.get("team3")));
            parse_team_players(team2, &radiant_heroes, false, &mut players);
            parse_team_players(team3, &dire_heroes, true, &mut players);
            players.sort_by_key(|p| p.slot_index);
        } else if let Some(name) = non_empty_str(player_map.get("name")) {
            let slot_index = local_slot_index(player_map);
            let hero_npc_name = hero_block.and_then(|h| hero_npc_short_name(h.get("name")));
            local_slot = slot_index;
            local_player = Some(LocalGsiPlayer {
                name,
                account_id: non_empty_str(player_map.get("accountid")),
                slot_index,
                hero_npc_name,
            });
        }
    }

    let mode = if !players.is_empty() {
        GsiMode::Spectating
    } else if local_player.is_some() {
        GsiMode::Playing
    } else {
        GsiMode::Unknown
    };

    GsiSnapshot {
        match_id,
        game_phase,
        clock_time,
        in_draft,
        mode,
        local_slot_index: local_slot,
        local_player,
        players,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn maps_hero_selection_phase() {
        assert_eq!(
            GamePhase::from_dota_str("DOTA_GAMERULES_STATE_HERO_SELECTION"),
            GamePhase::HeroSelection
        );
        assert_eq!(GamePhase::from_dota_str("SOMETHING_NEW"), GamePhase::Unknown);
    }

    #[test]
    fn parses_playing_mode_hero_selection() {
        let payload = json!({
            "map": {
                "matchid": "8012345678",
                "game_state": "DOTA_GAMERULES_STATE_HERO_SELECTION",
                "clock_time": -42
            },
            "player": {
                "name": "Tiarin",
                "accountid": "45008415",
                "team_name": "dire",
                "team_slot": 2
            },
            "hero": {
                "name": "npc_dota_hero_crystal_maiden"
            }
        });

        let snap = parse_gsi_payload(&payload);
        assert_eq!(snap.match_id.as_deref(), Some("8012345678"));
        assert_eq!(snap.game_phase, Some(GamePhase::HeroSelection));
        assert_eq!(snap.clock_time, Some(-42));
        assert!(snap.in_draft);
        assert_eq!(snap.mode, GsiMode::Playing);
        assert_eq!(snap.local_slot_index, Some(7));
        let lp = snap.local_player.expect("local player");
        assert_eq!(lp.name, "Tiarin");
        assert_eq!(lp.hero_npc_name.as_deref(), Some("crystal_maiden"));
    }

    #[test]
    fn parses_spectating_mode_prefers_team_slot_and_joins_hero_by_raw_key() {
        let payload = json!({
            "map": {
                "matchid": "9001",
                "game_state": "DOTA_GAMERULES_STATE_HERO_SELECTION",
                "clock_time": 12
            },
            "player": {
                "team2": {
                    "player0": { "name": "RadB", "accountid": "10", "team_slot": 3 },
                    "player1": { "name": "RadA", "accountid": "11", "team_slot": 0 }
                },
                "team3": {
                    "player5": { "name": "DireA", "accountid": "20", "team_slot": 1 }
                }
            },
            "hero": {
                "team2": {
                    "player0": { "name": "npc_dota_hero_zuus" },
                    "player1": { "name": "npc_dota_hero_axe" }
                },
                "team3": {
                    "player5": { "name": "npc_dota_hero_puck" }
                }
            }
        });

        let snap = parse_gsi_payload(&payload);
        assert_eq!(snap.mode, GsiMode::Spectating);
        assert_eq!(snap.players.len(), 3);
        assert_eq!(snap.players[0].slot_index, 0);
        assert_eq!(snap.players[0].name, "RadA");
        assert_eq!(snap.players[0].hero_npc_name.as_deref(), Some("axe"));
        assert_eq!(snap.players[1].slot_index, 3);
        assert_eq!(snap.players[1].name, "RadB");
        assert_eq!(snap.players[1].hero_npc_name.as_deref(), Some("zuus"));
        assert_eq!(snap.players[2].slot_index, 6);
        assert_eq!(snap.players[2].name, "DireA");
        assert_eq!(snap.players[2].hero_npc_name.as_deref(), Some("puck"));
    }

    #[test]
    fn tolerates_empty_or_malformed_payloads() {
        let snap = parse_gsi_payload(&json!({ "unexpected": [1, 2, 3] }));
        assert_eq!(snap.mode, GsiMode::Unknown);
        assert_eq!(snap.game_phase, None);
        assert!(!snap.in_draft);
        assert!(snap.players.is_empty());
        assert!(snap.local_player.is_none());
    }
}
