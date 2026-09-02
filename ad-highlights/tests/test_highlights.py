"""Run from the ad-highlights folder:  python -m unittest discover -s tests -t ."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from make_fixture import ABILITY_IDS, HEROES, build  # noqa: E402

from adhl.analyze import analyze_match, player_kit, rank  # noqa: E402
from adhl.report import render_markdown  # noqa: E402
from adhl.sources import from_windrun  # noqa: E402
from adhl.util import clock, extract_match_ids, load_json, parse_match_id_list  # noqa: E402

TAGS = load_json(HERE.parent / "data" / "ability_tags.json")


class UtilTests(unittest.TestCase):
    def test_extract_prefers_links_then_keys_then_bare(self):
        html = 'x <a href="/matches/8533514845">m</a> "account_id": 45008415 "start_time": 1756600000 /matches/8197826129'
        self.assertEqual(extract_match_ids(html), [8533514845, 8197826129])
        js = json.dumps([{"match_id": 8533514845, "account_id": 45008415}, {"matchId": 8197826129}])
        self.assertEqual(extract_match_ids(js), [8533514845, 8197826129])
        self.assertEqual(extract_match_ids("ids: 8533514845, 1756600000, 45008415"), [8533514845])

    def test_parse_manual_list(self):
        txt = "# comment\n8533514845  # first\nhttps://windrun.io/matches/8197826129, 8533514845\n\n"
        self.assertEqual(parse_match_id_list(txt), [8533514845, 8197826129])

    def test_clock(self):
        self.assertEqual(clock(1210), "20:10")
        self.assertEqual(clock(-30), "-0:30")
        self.assertEqual(clock(None), "?")


class AnalyzeTests(unittest.TestCase):
    def setUp(self):
        self.match = build()

    def test_kit_excludes_talents_and_keeps_order(self):
        kit = player_kit(self.match["players"][0], ABILITY_IDS)
        self.assertEqual(kit, ["sven_storm_bolt", "crystal_maiden_freezing_field", "dark_seer_vacuum", "lion_finger_of_death"])

    def test_combo_hero_ranks_first_with_synergy_reasons(self):
        ms = analyze_match(self.match, ABILITY_IDS, HEROES, TAGS)
        best = ms[0]
        self.assertEqual((best.hero, best.kind, best.kills, best.start), ("Lion", "teamfight", 3, 1195.0))
        self.assertEqual(best.player_name, "ComboEnjoyer")
        reasons = "; ".join(best.reasons)
        self.assertIn("3 kills in one fight", reasons)
        self.assertIn("setup->payoff", reasons)  # storm bolt (hard_cc) -> freezing field / vacuum
        self.assertIn("3 kills within 12s", reasons)  # kills_log burst merged into the fight
        # 3*3 + 4.2 + 1.5*2 + 2 (setup/payoff) + 2 (triple) - 1 (death) + 1.5*2 (burst) = 22.2
        self.assertAlmostEqual(best.score, 22.2, places=1)

    def test_anonymous_and_kill_burst_outside_fight(self):
        ms = analyze_match(self.match, ABILITY_IDS, HEROES, TAGS)
        anon = [m for m in ms if m.player_index == 1 and m.kind == "teamfight"][0]
        self.assertEqual(anon.player_name, "Anonymous")
        burst = [m for m in ms if m.kind == "kill_burst"]
        self.assertEqual(len(burst), 1)
        self.assertEqual((burst[0].hero, burst[0].kills, burst[0].start), ("Kunkka", 2, 700.0))
        self.assertAlmostEqual(burst[0].score, 5.0)

    def test_focus_bonus(self):
        base = analyze_match(self.match, ABILITY_IDS, HEROES, TAGS)[0].score
        focused = analyze_match(self.match, ABILITY_IDS, HEROES, TAGS, focus_abilities=["freezing_field"])[0]
        self.assertAlmostEqual(focused.score - base, 3.0)
        self.assertIn("focus ability: crystal_maiden_freezing_field", focused.reasons)

    def test_rank_caps_per_match_and_threshold(self):
        ms = analyze_match(self.match, ABILITY_IDS, HEROES, TAGS)
        self.assertGreater(len(ms), 2)
        top = rank(ms, top=10, per_match=2, min_score=0)
        self.assertEqual(len(top), 2)
        self.assertEqual(rank(ms, top=10, per_match=10, min_score=100), [])

    def test_unparsed_match_yields_nothing(self):
        m = build()
        m["teamfights"] = []
        for p in m["players"]:
            p["kills_log"] = []
        self.assertEqual(analyze_match(m, ABILITY_IDS, HEROES, TAGS), [])


class ReportTests(unittest.TestCase):
    def test_markdown_contains_table_and_links(self):
        m = build()
        ms = rank(analyze_match(m, ABILITY_IDS, HEROES, TAGS), 5, 3, 0)
        md = render_markdown(ms, {m["match_id"]: {"duration": 2400, "replay_url": m["replay_url"], "radiant_win": True, "start_time": 1756600000}}, {"date": "2026-09-02", "candidates": 1, "analyzed": 1})
        self.assertIn("| 1 | 22.2 | 8533514845 | 19:55 | Lion (ComboEnjoyer) |", md)
        self.assertIn("https://www.opendota.com/matches/8533514845", md)
        self.assertIn("replay .dem.bz2", md)
        self.assertIn("won", md)


class SourceTests(unittest.TestCase):
    def test_windrun_tries_urls_in_order(self):
        calls: list[str] = []

        def fake(url: str) -> str:
            calls.append(url)
            if url.endswith("/replays/recommended?idf=tag"):
                return json.dumps({"data": [{"match_id": 8533514845}, {"match_id": 8197826129}]})
            raise OSError("404")

        cfg = {"windrun_recommended_urls": ["https://a/x", "https://a/replays/recommended"], "windrun_client_tag": "tag"}
        ids, used = from_windrun(cfg, fake)
        self.assertEqual(ids, [8533514845, 8197826129])
        self.assertEqual(used, "https://a/replays/recommended")
        self.assertEqual(calls, ["https://a/x?idf=tag", "https://a/replays/recommended?idf=tag"])


class PipelineFixtureTests(unittest.TestCase):
    def test_cli_fixture_run_writes_report(self):
        import subprocess

        fixture = HERE / "fixtures" / "sample_match.json"
        with tempfile.TemporaryDirectory() as td:
            cfg = Path(td) / "config.json"
            cfg.write_text(json.dumps({"output_dir": td + "/out", "min_score": 4}), encoding="utf-8")
            r = subprocess.run([sys.executable, str(HERE.parent / "highlights.py"), "--fixture", str(fixture), "--config", str(cfg), "--dry-run"],
                               capture_output=True, text=True, cwd=str(HERE.parent))
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn("match 8533514845 @ 19:55  Lion", r.stdout)


if __name__ == "__main__":
    unittest.main()
