"""Optional replay download: OpenDota's replay_url is a .dem.bz2 on Valve's replay CDN."""
from __future__ import annotations

import bz2
import urllib.request
from pathlib import Path

from .util import USER_AGENT, log


def download_replay(replay_url: str, dest_dir: Path, match_id: int) -> Path | None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{match_id}.dem"
    if dest.exists() and dest.stat().st_size > 1_000_000:
        log.info("replay %s already present", dest)
        return dest
    tmp = dest.with_suffix(".dem.part")
    log.info("downloading replay %s -> %s", replay_url, dest)
    try:
        req = urllib.request.Request(replay_url, headers={"User-Agent": USER_AGENT})
        decomp = bz2.BZ2Decompressor()
        with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as f:
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                f.write(decomp.decompress(chunk))
        tmp.replace(dest)
        return dest
    except Exception as e:  # noqa: BLE001 - best effort, report and move on
        log.warning("replay download failed for %s: %s", match_id, e)
        tmp.unlink(missing_ok=True)
        return None
