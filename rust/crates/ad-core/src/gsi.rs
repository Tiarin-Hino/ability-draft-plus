//! Dota 2 Game State Integration (GSI) domain types.

use serde::{Deserialize, Serialize};

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
pub struct GsiSnapshot {
    pub match_id: Option<String>,
    pub game_phase: Option<GamePhase>,
    pub clock_time: Option<i64>,
    pub in_draft: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_hero_selection_phase() {
        assert_eq!(
            GamePhase::from_dota_str("DOTA_GAMERULES_STATE_HERO_SELECTION"),
            GamePhase::HeroSelection
        );
        assert_eq!(GamePhase::from_dota_str("SOMETHING_NEW"), GamePhase::Unknown);
    }
}
