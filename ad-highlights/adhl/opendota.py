"""Minimal OpenDota client (stdlib urllib): match fetch with on-disk cache for parsed matches,
parse requests, public-match listing and constants with a 7-day cache.

OpenDota facts this relies on:
  * GET  /matches/{id}      -> match JSON; `version` is null until the replay has been parsed.
  * POST /request/{id}      -> queues a replay parse; {"job": {"jobId": N}}. Fails if the replay is gone.
  * GET  /publicMatches     -> 100 recent public matches (game_mode 18 = Ability Draft), `min_rank` filter.
  * GET  /constants/{name}  -> e.g. ability_ids (id -> internal name), heroes (id -> {localized_name,...}).
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from .util import USER_AGENT, load_json, log, save_json

BASE = "https://api.opendota.com/api"
CONSTANTS_TTL_SECONDS = 7 * 24 * 3600


class OpenDotaError(RuntimeError):
    pass


class OpenDota:
    def __init__(self, cache_dir: Path, api_key: str = "", min_interval: float = 1.2) -> None:
        self.cache_dir = cache_dir
        self.api_key = api_key or ""
        self.min_interval = min_interval
        self._last_call = 0.0
        self.calls = 0

    # -- transport -------------------------------------------------------------------------------
    def _request(self, method: str, path: str, params: dict[str, Any] | None = None) -> Any:
        params = dict(params or {})
        if self.api_key:
            params["api_key"] = self.api_key
        url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
        for attempt in range(5):
            wait = self.min_interval - (time.monotonic() - self._last_call)
            if wait > 0:
                time.sleep(wait)
            req = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            self._last_call = time.monotonic()
            self.calls += 1
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    body = resp.read()
                return json.loads(body) if body.strip() else None
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                if e.code == 429 or e.code >= 500:
                    delay = 10 * (attempt + 1)
                    log.warning("OpenDota %s %s -> HTTP %s, retrying in %ss", method, path, e.code, delay)
                    time.sleep(delay)
                    continue
                raise OpenDotaError(f"HTTP {e.code} for {method} {path}") from e
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                delay = 5 * (attempt + 1)
                log.warning("OpenDota %s %s failed (%s), retrying in %ss", method, path, e, delay)
                time.sleep(delay)
        raise OpenDotaError(f"giving up on {method} {path}")

    # -- matches ---------------------------------------------------------------------------------
    def _match_cache(self, match_id: int) -> Path:
        return self.cache_dir / "matches" / f"{match_id}.json"

    def match(self, match_id: int, force: bool = False) -> dict[str, Any] | None:
        """Match JSON, served from cache once parsed (parsed data never changes)."""
        cached = None if force else load_json(self._match_cache(match_id))
        if isinstance(cached, dict) and cached.get("version") is not None:
            return cached
        data = self._request("GET", f"/matches/{match_id}")
        if isinstance(data, dict) and data.get("match_id") == match_id:
            if data.get("version") is not None:
                save_json(self._match_cache(match_id), data)
            return data
        return None

    @staticmethod
    def is_parsed(match: dict[str, Any] | None) -> bool:
        return bool(match) and match.get("version") is not None

    def request_parse(self, match_id: int) -> int | None:
        data = self._request("POST", f"/request/{match_id}")
        job = (data or {}).get("job") if isinstance(data, dict) else None
        job_id = job.get("jobId") if isinstance(job, dict) else None
        if job_id is None:
            log.warning("Parse request for %s returned no job (replay expired or unavailable?): %s", match_id, data)
        return job_id

    # -- listings / constants --------------------------------------------------------------------
    def public_matches(self, min_rank: int | None = None, less_than_match_id: int | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {}
        if min_rank:
            params["min_rank"] = min_rank
        if less_than_match_id:
            params["less_than_match_id"] = less_than_match_id
        data = self._request("GET", "/publicMatches", params)
        return data if isinstance(data, list) else []

    def constants(self, name: str) -> dict[str, Any]:
        path = self.cache_dir / f"constants_{name}.json"
        cached = load_json(path)
        if isinstance(cached, dict) and time.time() - cached.get("_fetched_at", 0) < CONSTANTS_TTL_SECONDS:
            return cached["data"]
        data = self._request("GET", f"/constants/{name}")
        if not isinstance(data, dict):
            if isinstance(cached, dict):
                log.warning("constants/%s fetch failed, using stale cache", name)
                return cached["data"]
            raise OpenDotaError(f"constants/{name} unavailable")
        save_json(path, {"_fetched_at": time.time(), "data": data})
        return data
