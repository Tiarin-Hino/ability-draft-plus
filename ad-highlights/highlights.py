#!/usr/bin/env python3
"""ad-highlights CLI. Run `python highlights.py --help`."""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from adhl.config import load_config  # noqa: E402
from adhl.pipeline import run  # noqa: E402
from adhl.util import ROOT, load_json, log, parse_match_id_list  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Find clip-worthy Ability Draft moments (OpenDota-backed).")
    ap.add_argument("--config", type=Path, default=None, help="config.json path (default: next to this script)")
    ap.add_argument("--matches", default="", help="comma/space separated match ids or URLs; overrides sources")
    ap.add_argument("--no-wait", action="store_true", help="do not wait for OpenDota parses (retry next run)")
    ap.add_argument("--rescan", action="store_true", help="ignore state, re-process already-seen matches")
    ap.add_argument("--dry-run", action="store_true", help="analyze but write no report/state")
    ap.add_argument("--fixture", type=Path, action="append", help="analyze a saved OpenDota match JSON offline (repeatable)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    (ROOT / "logs").mkdir(exist_ok=True)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(ROOT / "logs" / f"{dt.date.today().isoformat()}.log", encoding="utf-8"),
        ],
    )
    cfg = load_config(args.config)
    fixtures = None
    if args.fixture:
        fixtures = []
        for p in args.fixture:
            m = load_json(p)
            if not isinstance(m, dict) or "players" not in m:
                ap.error(f"{p} is not an OpenDota match JSON")
            fixtures.append(m)
    only = parse_match_id_list(args.matches) if args.matches else None
    if args.matches and not only:
        ap.error("--matches contained no valid match ids")

    top, md_path = run(cfg, only_matches=only, wait=not args.no_wait, rescan=args.rescan, dry_run=args.dry_run, fixture_matches=fixtures)
    log.info("%d moment(s) reported%s", len(top), f" -> {md_path}" if md_path else "")
    for i, m in enumerate(top[:10], 1):
        print(f"{i:2d}. {m.score:5.1f}  match {m.match_id} @ {int(m.start)//60}:{int(m.start)%60:02d}  {m.hero:<18} {'; '.join(m.reasons)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
