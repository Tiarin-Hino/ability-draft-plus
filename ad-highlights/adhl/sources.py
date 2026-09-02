"""Candidate match sources. Each returns match ids in priority order."""
from __future__ import annotations

import urllib.parse
from pathlib import Path
from typing import Any, Callable

from .opendota import OpenDota
from .util import extract_match_ids, http_get_text, log, parse_match_id_list

GAME_MODE_ABILITY_DRAFT = 18


def from_windrun(cfg: dict[str, Any], fetch: Callable[[str], str] = http_get_text) -> tuple[list[int], str]:
    """Try each configured URL; first one that yields match ids wins. Returns (ids, url_used)."""
    tag = (cfg.get("windrun_client_tag") or "").strip()
    for url in cfg.get("windrun_recommended_urls") or []:
        full = url
        if tag:
            sep = "&" if "?" in url else "?"
            full = f"{url}{sep}idf={urllib.parse.quote(tag)}"
        try:
            text = fetch(full)
        except Exception as e:  # noqa: BLE001 - any transport error just means "try the next URL"
            log.info("windrun: %s -> %s", url, e)
            continue
        ids = extract_match_ids(text)
        if ids:
            log.info("windrun: %d match ids from %s", len(ids), url)
            return ids, url
        log.info("windrun: %s returned no match ids (%d chars)", url, len(text))
    log.warning("windrun: no recommended replays found on any configured URL - see README 'Windrun URL'")
    return [], ""


def from_manual(root: Path) -> list[int]:
    path = root / "matches.txt"
    if not path.exists():
        return []
    ids = parse_match_id_list(path.read_text(encoding="utf-8"))
    if ids:
        log.info("manual: %d match ids from matches.txt", len(ids))
    return ids


def from_opendota_public(od: OpenDota, cfg: dict[str, Any]) -> list[int]:
    ids: list[int] = []
    cursor: int | None = None
    for _ in range(int(cfg.get("opendota_public_pages") or 1)):
        rows = od.public_matches(min_rank=cfg.get("opendota_public_min_rank"), less_than_match_id=cursor)
        if not rows:
            break
        for r in rows:
            if r.get("game_mode") == GAME_MODE_ABILITY_DRAFT and r.get("match_id") not in ids:
                ids.append(int(r["match_id"]))
        cursor = min(int(r["match_id"]) for r in rows)
    log.info("opendota_public: %d Ability Draft matches", len(ids))
    return ids


def collect(cfg: dict[str, Any], od: OpenDota, root: Path, fetch: Callable[[str], str] = http_get_text) -> list[tuple[int, str]]:
    """Merged (match_id, source) list, deduped, in source order."""
    out: list[tuple[int, str]] = []
    seen: set[int] = set()

    def add(ids: list[int], src: str) -> None:
        for i in ids:
            if i not in seen:
                seen.add(i)
                out.append((i, src))

    for src in cfg.get("sources") or []:
        if src == "windrun":
            ids, _ = from_windrun(cfg, fetch)
            add(ids, "windrun")
        elif src == "manual":
            add(from_manual(root), "manual")
        elif src == "opendota_public":
            add(from_opendota_public(od, cfg), "opendota_public")
        else:
            log.warning("unknown source %r in config - skipped", src)
    return out
