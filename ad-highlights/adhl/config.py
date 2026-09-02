"""Configuration: defaults merged with an optional config.json next to highlights.py."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .util import ROOT, load_json, log

DEFAULTS: dict[str, Any] = {
    # Where candidate matches come from, in order. Every source's ids are merged (deduped).
    #   windrun          - Windrun.io "Recommended Replays" (see windrun_recommended_urls)
    #   manual           - matches.txt in this folder (ids or URLs, one per line)
    #   opendota_public  - recent high-rank public Ability Draft matches (fallback / extra volume)
    "sources": ["windrun", "manual"],
    # Tried in order until one yields match ids. Windrun's API shape is not documented; if none of
    # these work, open the Recommended Replays page with DevTools > Network and paste the JSON
    # request URL here (README has the walkthrough).
    "windrun_recommended_urls": [
        "https://api.windrun.io/api/v2/recommended-replays",
        "https://api.windrun.io/api/v2/replays/recommended",
        "https://api.windrun.io/api/v2/matches/recommended",
        "https://windrun.io/recommended-replays",
        "https://windrun.io/replays",
    ],
    # Optional `idf` query parameter, same as the app's CLIENT_TAG. Leave empty if unsure.
    "windrun_client_tag": "",
    # OpenDota: free tier is 60 req/min, 2000/day - plenty. A key lifts limits (https://www.opendota.com/api-keys).
    "opendota_api_key": "",
    "opendota_min_interval_seconds": 1.2,
    # How many never-seen matches to take per run (each may need a parse request on OpenDota).
    "max_new_matches_per_run": 12,
    # After requesting parses, wait up to this long for OpenDota to finish (parsing takes 1-5 min per match,
    # queue depth varies). Matches still unparsed are retried on the next run for pending_retry_days.
    "parse_wait_minutes": 20,
    "poll_interval_seconds": 45,
    "pending_retry_days": 3,
    # Ranking / report
    "top_moments": 25,
    "max_moments_per_match": 4,
    "min_score": 6.0,
    "kill_burst_window_seconds": 20,
    # Ability internal names (or substrings) you especially want clips of, e.g. ["tinker_rearm", "chain_frost"].
    "focus_abilities": [],
    # opendota_public source: OpenDota rank tiers (10=Herald ... 70=Divine, 80=Immortal), pages of 100 matches.
    "opendota_public_min_rank": 70,
    "opendota_public_pages": 3,
    # Optionally download the replay (.dem) of every match that made the report straight into Dota's replays
    # folder so "watch replay" works offline. ~50-150 MB each.
    "download_replays": False,
    "dota_replays_dir": "",  # e.g. "C:/Program Files (x86)/Steam/steamapps/common/dota 2 beta/game/dota/replays"
    "output_dir": "out",
    "ability_tags_path": "data/ability_tags.json",
}


def load_config(path: Path | None = None) -> dict[str, Any]:
    cfg = dict(DEFAULTS)
    path = path or (ROOT / "config.json")
    user = load_json(path, default=None)
    if user is None:
        log.info("No config.json found at %s - using defaults (copy config.example.json to customize)", path)
        return cfg
    if not isinstance(user, dict):
        raise SystemExit(f"config.json must contain a JSON object, got {type(user).__name__}")
    unknown = sorted(set(user) - set(DEFAULTS))
    if unknown:
        log.warning("config.json has unknown keys (ignored): %s", ", ".join(unknown))
    cfg.update({k: v for k, v in user.items() if k in DEFAULTS})
    return cfg
