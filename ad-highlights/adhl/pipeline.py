"""Daily run: collect candidates -> ensure parsed on OpenDota -> analyze -> rank -> report.

State (state/seen.json) remembers every match id ever considered so a recommended match is
reported once, and unparsed matches are retried for a few days before being given up.
"""
from __future__ import annotations

import datetime as dt
import time
from pathlib import Path
from typing import Any

from . import sources
from .analyze import GAME_MODE_ABILITY_DRAFT, Moment, analyze_match, rank
from .opendota import OpenDota, OpenDotaError
from .replays import download_replay
from .report import write_reports
from .util import ROOT, load_json, log, save_json

STATE_PATH = ROOT / "state" / "seen.json"
FINAL_STATES = {"reported", "no_moments", "not_ability_draft", "unavailable", "gave_up"}


def _now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def _match_meta(m: dict[str, Any]) -> dict[str, Any]:
    return {
        "duration": m.get("duration"),
        "start_time": m.get("start_time"),
        "radiant_win": m.get("radiant_win"),
        "replay_url": m.get("replay_url"),
        "patch": m.get("patch"),
    }


def run(
    cfg: dict[str, Any],
    root: Path = ROOT,
    only_matches: list[int] | None = None,
    wait: bool = True,
    rescan: bool = False,
    dry_run: bool = False,
    fixture_matches: list[dict[str, Any]] | None = None,
) -> tuple[list[Moment], Path | None]:
    cache_dir = root / "cache"
    od = OpenDota(cache_dir, api_key=cfg.get("opendota_api_key", ""), min_interval=float(cfg.get("opendota_min_interval_seconds", 1.2)))
    state: dict[str, Any] = load_json(STATE_PATH, default={}) or {}
    tags = load_json(root / cfg["ability_tags_path"], default={}) or {}
    run_info: dict[str, Any] = {"date": dt.date.today().isoformat(), "started": _now()}

    # ---- 1. candidates ------------------------------------------------------------------------
    parsed: dict[int, dict[str, Any]] = {}
    if fixture_matches is not None:
        candidates = [(int(m["match_id"]), "fixture") for m in fixture_matches]
        parsed = {int(m["match_id"]): m for m in fixture_matches}
        # Offline: prefer cached real constants, else whatever the fixture embeds.
        ability_ids = (load_json(cache_dir / "constants_ability_ids.json") or {}).get("data") or {}
        heroes = (load_json(cache_dir / "constants_heroes.json") or {}).get("data") or {}
        for m in fixture_matches:
            emb = m.get("_fixture_constants") or {}
            ability_ids = {**emb.get("ability_ids", {}), **ability_ids}
            heroes = {**emb.get("heroes", {}), **heroes}
    else:
        if only_matches:
            candidates = [(i, "cli") for i in only_matches]
        else:
            candidates = sources.collect(cfg, od, root)
        run_info["source_note"] = ", ".join(sorted({s for _, s in candidates})) or "none"
        ability_ids = od.constants("ability_ids")
        heroes = od.constants("heroes")

    fresh: list[tuple[int, str]] = []
    for mid, src in candidates:
        st = state.get(str(mid))
        if st and st.get("status") in FINAL_STATES and not rescan and not only_matches:
            continue
        fresh.append((mid, src))
    # retry previously pending ones first (they were requested on an earlier run)
    for mid_s, st in state.items():
        if st.get("status") == "pending" and int(mid_s) not in {m for m, _ in fresh} and fixture_matches is None:
            fresh.insert(0, (int(mid_s), st.get("source", "state")))
    if not only_matches and fixture_matches is None:
        fresh = fresh[: int(cfg.get("max_new_matches_per_run", 12))]
    run_info["candidates"] = len(fresh)
    log.info("%d candidate matches to process", len(fresh))

    # ---- 2. fetch, request parses, wait ------------------------------------------------------
    pending: list[int] = []
    skipped = 0
    for mid, src in fresh:
        state.setdefault(str(mid), {"first_seen": _now(), "source": src})
        if mid in parsed:
            continue
        try:
            m = od.match(mid)
        except OpenDotaError as e:
            log.warning("match %s: %s", mid, e)
            skipped += 1
            continue
        if not m:
            log.warning("match %s: not found on OpenDota", mid)
            state[str(mid)]["status"] = "unavailable"
            skipped += 1
            continue
        if m.get("game_mode") != GAME_MODE_ABILITY_DRAFT:
            log.info("match %s: game_mode %s is not Ability Draft - skipped", mid, m.get("game_mode"))
            state[str(mid)]["status"] = "not_ability_draft"
            skipped += 1
            continue
        if OpenDota.is_parsed(m):
            parsed[mid] = m
            continue
        if state[str(mid)].get("parse_requested") is None:
            job = od.request_parse(mid)
            state[str(mid)]["parse_requested"] = _now()
            state[str(mid)]["job_id"] = job
            if job is None:
                state[str(mid)]["status"] = "unavailable"
                skipped += 1
                continue
        state[str(mid)]["status"] = "pending"
        pending.append(mid)

    if pending and wait:
        deadline = time.monotonic() + 60 * float(cfg.get("parse_wait_minutes", 20))
        log.info("waiting for OpenDota to parse %d match(es), up to %s min", len(pending), cfg.get("parse_wait_minutes", 20))
        while pending and time.monotonic() < deadline:
            time.sleep(float(cfg.get("poll_interval_seconds", 45)))
            for mid in list(pending):
                try:
                    m = od.match(mid, force=True)
                except OpenDotaError as e:
                    log.warning("poll %s: %s", mid, e)
                    continue
                if OpenDota.is_parsed(m):
                    parsed[mid] = m
                    pending.remove(mid)
                    log.info("match %s parsed", mid)
    for mid in pending:
        st = state[str(mid)]
        first = dt.datetime.fromisoformat(st.get("parse_requested") or _now())
        if (dt.datetime.now() - first).days >= int(cfg.get("pending_retry_days", 3)):
            st["status"] = "gave_up"
            log.warning("match %s: still unparsed after %s days - giving up", mid, cfg.get("pending_retry_days", 3))
    run_info["pending"] = sum(1 for mid in pending if state[str(mid)].get("status") == "pending")
    run_info["skipped"] = skipped

    # ---- 3. analyze + rank -------------------------------------------------------------------
    all_moments: list[Moment] = []
    match_meta: dict[int, dict[str, Any]] = {}
    for mid, m in parsed.items():
        ms = analyze_match(
            m, ability_ids, heroes, tags,
            focus_abilities=cfg.get("focus_abilities") or [],
            kill_burst_window=float(cfg.get("kill_burst_window_seconds", 20)),
        )
        match_meta[mid] = _match_meta(m)
        all_moments.extend(ms)
        log.info("match %s: %d raw moments (best %.1f)", mid, len(ms), ms[0].score if ms else 0.0)
    top = rank(all_moments, int(cfg["top_moments"]), int(cfg["max_moments_per_match"]), float(cfg["min_score"]))
    reported_ids = {m.match_id for m in top}
    for mid in parsed:
        state.setdefault(str(mid), {"first_seen": _now(), "source": "?"})
        state[str(mid)]["status"] = "reported" if mid in reported_ids else "no_moments"
        state[str(mid)]["analyzed"] = _now()
    run_info["analyzed"] = len(parsed)
    run_info["moments"] = len(top)
    run_info["opendota_calls"] = od.calls
    run_info["finished"] = _now()

    # ---- 4. output -----------------------------------------------------------------------------
    md_path: Path | None = None
    if not dry_run:
        out_dir = root / cfg["output_dir"]
        md_path, _ = write_reports(out_dir, top, {k: v for k, v in match_meta.items() if k in reported_ids}, run_info)
        save_json(STATE_PATH, state)
        if cfg.get("download_replays") and cfg.get("dota_replays_dir"):
            for mid in sorted(reported_ids):
                url = match_meta[mid].get("replay_url")
                if url:
                    download_replay(url, Path(cfg["dota_replays_dir"]), mid)
                else:
                    log.info("match %s has no replay_url on OpenDota (salt unknown) - not downloaded", mid)
    return top, md_path
