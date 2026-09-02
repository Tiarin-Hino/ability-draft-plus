"""Builds tests/fixtures/sample_match.json: a synthetic OpenDota-shaped parsed Ability Draft match.

Run `python tests/make_fixture.py` to regenerate. Shape follows OpenDota's /matches/{id} response
(the fields the analyzer reads; see adhl/analyze.py docstring).
"""
from __future__ import annotations

import json
from pathlib import Path

MATCH_ID = 8533514845
# ability id -> internal name (subset of OpenDota constants/ability_ids)
ABILITY_IDS = {
    "5060": "lion_impale", "5064": "lion_finger_of_death", "5061": "lion_voodoo",
    "5080": "crystal_maiden_freezing_field", "5028": "sven_storm_bolt", "5033": "sven_gods_strength",
    "5106": "kunkka_torrent", "5108": "kunkka_ghostship", "5320": "dark_seer_vacuum",
    "5323": "dark_seer_wall_of_replica", "5001": "antimage_mana_break", "5155": "tidehunter_ravage",
    "5093": "juggernaut_blade_fury", "5152": "enigma_black_hole", "6000": "special_bonus_hp_200",
}
HEROES = {"25": {"localized_name": "Lion"}, "18": {"localized_name": "Sven"}, "23": {"localized_name": "Kunkka"},
          "55": {"localized_name": "Dark Seer"}, "29": {"localized_name": "Tidehunter"}}


def player(slot: int, hero_id: int, name: str, kit_ids: list[int], uses: dict[str, int], kills_log: list[tuple[int, str]]):
    return {
        "player_slot": slot, "hero_id": hero_id, "personaname": name, "isRadiant": slot < 128,
        "ability_upgrades_arr": kit_ids + [6000],
        "ability_uses": uses,
        "kills_log": [{"time": t, "key": k} for t, k in kills_log],
    }


def tf_player(uses: dict[str, int] | None = None, killed: dict[str, int] | None = None, deaths: int = 0, damage: int = 0):
    return {"ability_uses": uses or {}, "killed": killed or {}, "deaths": deaths, "damage": damage,
            "healing": 0, "gold_delta": 0, "xp_delta": 0, "buybacks": 0, "deaths_pos": {}}


def build() -> dict:
    players = [
        # slot 0: Lion model with Storm Bolt + Freezing Field + Vacuum: the "combo" hero
        player(0, 25, "ComboEnjoyer", [5028, 5080, 5320, 5064], {"sven_storm_bolt": 30, "crystal_maiden_freezing_field": 6, "dark_seer_vacuum": 12, "lion_finger_of_death": 9},
               [(1210, "npc_dota_hero_kunkka"), (1216, "npc_dota_hero_tidehunter"), (1222, "npc_dota_hero_dark_seer"), (1900, "npc_dota_hero_kunkka")]),
        player(1, 18, "", [5060, 5033, 5001, 5155], {"lion_impale": 20, "sven_gods_strength": 5, "tidehunter_ravage": 4}, [(1214, "npc_dota_hero_kunkka")]),
        player(2, 23, "Solo", [5106, 5093, 5061, 5108], {"kunkka_torrent": 25, "juggernaut_blade_fury": 15},
               [(700, "npc_dota_hero_kunkka"), (705, "npc_dota_hero_tidehunter")]),  # rapid double outside any teamfight
        player(3, 55, "P4", [5320, 5323], {"dark_seer_vacuum": 10}, []),
        player(4, 29, "P5", [5155], {"tidehunter_ravage": 3}, []),
        player(128, 23, "D1", [5106], {"kunkka_torrent": 20}, [(1230, "npc_dota_hero_lion")]),
        player(129, 29, "D2", [5155], {}, []),
        player(130, 55, "D3", [5323], {}, []),
        player(131, 18, "D4", [5028], {}, []),
        player(132, 25, "D5", [5064], {}, []),
    ]
    teamfights = [
        {"start": 1195, "end": 1240, "last_death": 1230, "deaths": 4, "players": [
            tf_player({"sven_storm_bolt": 2, "crystal_maiden_freezing_field": 1, "dark_seer_vacuum": 1}, {"npc_dota_hero_kunkka": 1, "npc_dota_hero_tidehunter": 1, "npc_dota_hero_dark_seer": 1}, deaths=1, damage=4200),
            tf_player({"lion_impale": 1, "sven_gods_strength": 1}, {"npc_dota_hero_kunkka": 1}, damage=1800),
            tf_player({"kunkka_torrent": 1}, {}, damage=900),
            tf_player({}, {}, damage=100),
            tf_player({}, {}, damage=0),
            tf_player({"kunkka_torrent": 1}, {"npc_dota_hero_lion": 1}, deaths=1, damage=1500),
            tf_player({}, {}, deaths=1, damage=200),
            tf_player({}, {}, deaths=1, damage=50),
            tf_player({}, {}, deaths=0, damage=0),
            tf_player({}, {}, deaths=0, damage=0),
        ]},
        {"start": 1880, "end": 1910, "last_death": 1900, "deaths": 1, "players": [
            tf_player({"lion_finger_of_death": 1}, {"npc_dota_hero_kunkka": 1}, damage=1200),
        ] + [tf_player() for _ in range(9)]},
    ]
    return {
        "match_id": MATCH_ID, "game_mode": 18, "version": 21, "duration": 2400, "start_time": 1756600000,
        "radiant_win": True, "replay_url": f"http://replay123.valve.net/570/{MATCH_ID}_123456789.dem.bz2",
        "players": players, "teamfights": teamfights,
        "_fixture_constants": {"ability_ids": ABILITY_IDS, "heroes": HEROES},
    }


if __name__ == "__main__":
    out = Path(__file__).parent / "fixtures" / "sample_match.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(build(), indent=1), encoding="utf-8")
    print("wrote", out)
