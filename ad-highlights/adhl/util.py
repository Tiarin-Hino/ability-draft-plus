"""Small helpers shared by the pipeline: JSON IO, HTTP text fetch, match-id extraction, clock formatting."""
from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterable

log = logging.getLogger("adhl")

ROOT = Path(__file__).resolve().parent.parent
USER_AGENT = "ad-highlights/0.1 (Ability Draft Plus clip finder; stdlib urllib)"

# Dota 2 match ids: ~6.0e9 was early 2021; ~8.5e9 is 2025. Account ids and unix timestamps are
# both < 2.2e9, so a range filter cleanly separates match ids from other big integers in a page.
MATCH_ID_MIN = 5_000_000_000
MATCH_ID_MAX = 30_000_000_000

_URL_ID_RE = re.compile(r"/matches?/(\d{9,11})(?!\d)")
_KEY_ID_RE = re.compile(r'"(?:match_?id|matchID|id)"\s*:\s*"?(\d{9,11})(?!\d)', re.IGNORECASE)
_BARE_ID_RE = re.compile(r"(?<!\d)(\d{9,11})(?!\d)")


def load_json(path: Path, default: Any = None) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def http_get_text(url: str, timeout: int = 30, accept: str = "application/json, text/html;q=0.9, */*;q=0.8") -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return raw.decode("utf-8", errors="replace")


def _valid(ids: Iterable[str]) -> list[int]:
    out: list[int] = []
    for s in ids:
        n = int(s)
        if MATCH_ID_MIN <= n <= MATCH_ID_MAX and n not in out:
            out.append(n)
    return out


def extract_match_ids(text: str, allow_bare: bool = True) -> list[int]:
    """Pull Dota match ids out of arbitrary JSON/HTML.

    Priority: `/matches/<id>` links, then `"match_id": <id>` style keys, then (only if neither
    matched) any bare 9-11 digit number in the plausible match-id range. Order of first
    appearance is preserved so "top recommended first" survives.
    """
    ids = _valid(_URL_ID_RE.findall(text))
    ids += [i for i in _valid(_KEY_ID_RE.findall(text)) if i not in ids]
    if not ids and allow_bare:
        ids = _valid(_BARE_ID_RE.findall(text))
    return ids


def parse_match_id_list(text: str) -> list[int]:
    """Parse a user-written list: one id or URL per line, commas allowed, `#` comments."""
    ids: list[int] = []
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        for tok in re.split(r"[,\s]+", line):
            if not tok:
                continue
            for i in extract_match_ids(tok):
                if i not in ids:
                    ids.append(i)
    return ids


def clock(seconds: float | int | None) -> str:
    """Game-clock string (mm:ss) as shown in the Dota replay UI. Negative = pre-horn."""
    if seconds is None:
        return "?"
    s = int(round(seconds))
    sign = "-" if s < 0 else ""
    s = abs(s)
    return f"{sign}{s // 60}:{s % 60:02d}"
