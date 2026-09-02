"""Markdown + JSON report writers."""
from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

from .analyze import Moment
from .util import clock, save_json


def _links(match_id: int, replay_url: str | None) -> str:
    parts = [
        f"[OpenDota](https://www.opendota.com/matches/{match_id})",
        f"[Windrun](https://windrun.io/matches/{match_id})",
    ]
    if replay_url:
        parts.append(f"[replay .dem.bz2]({replay_url})")
    return " · ".join(parts)


def render_markdown(
    moments: list[Moment],
    match_meta: dict[int, dict[str, Any]],
    run_info: dict[str, Any],
) -> str:
    date = run_info.get("date") or dt.date.today().isoformat()
    lines: list[str] = [f"# Ability Draft highlights - {date}", ""]
    lines.append(
        f"Candidates: {run_info.get('candidates', 0)} · analyzed: {run_info.get('analyzed', 0)} · "
        f"still parsing (retry next run): {run_info.get('pending', 0)} · skipped: {run_info.get('skipped', 0)}"
    )
    if run_info.get("source_note"):
        lines.append(f"Sources: {run_info['source_note']}")
    lines.append("")
    if not moments:
        lines.append("_No moments cleared the score threshold today._")
        return "\n".join(lines) + "\n"

    lines.append("| # | Score | Match | Clock | Hero (player) | Fight | Combo used |")
    lines.append("|---|------:|-------|------:|---------------|-------|------------|")
    for n, m in enumerate(moments, 1):
        combo = " + ".join(f"{a}×{c}" if c > 1 else a for a, c in sorted(m.used.items(), key=lambda kv: -kv[1])) or "-"
        fight = f"{m.kills}K/{m.deaths}D, {m.damage:,} dmg" if m.kind == "teamfight" else f"{m.kills} rapid kills"
        lines.append(
            f"| {n} | {m.score:.1f} | {m.match_id} | {clock(m.start)} | {m.hero} ({m.player_name}) | {fight} | {combo} |"
        )
    lines.append("")
    lines.append("## Details")
    lines.append("")
    lines.append("Seek to the clock time minus ~15 s in the replay, then select the hero (or the player's slot) to lock the camera.")
    lines.append("")
    for n, m in enumerate(moments, 1):
        meta = match_meta.get(m.match_id, {})
        dur = clock(meta.get("duration")) if meta.get("duration") else "?"
        started = meta.get("start_time")
        when = dt.datetime.fromtimestamp(started).strftime("%Y-%m-%d") if started else "?"
        win = meta.get("radiant_win")
        result = "" if win is None else (" · won" if (win == (m.team == "Radiant")) else " · lost")
        lines.append(f"### {n}. {m.hero} - match {m.match_id} @ {clock(m.start)}  (score {m.score:.1f})")
        lines.append("")
        lines.append(f"- **Player:** {m.player_name} ({m.team}{result}) · match played {when}, length {dur}")
        lines.append(f"- **Window:** {clock(m.start)} -> {clock(m.end)} ({m.kind.replace('_', ' ')})")
        lines.append(f"- **Kit:** {', '.join(m.kit) or '?'}")
        if m.used:
            lines.append("- **Cast in this fight:** " + ", ".join(f"{a} ×{c}" for a, c in sorted(m.used.items(), key=lambda kv: -kv[1])))
        if m.reasons:
            lines.append("- **Why:** " + "; ".join(m.reasons))
        lines.append(f"- **Links:** {_links(m.match_id, meta.get('replay_url'))}")
        lines.append("")
    return "\n".join(lines) + "\n"


def write_reports(
    out_dir: Path,
    moments: list[Moment],
    match_meta: dict[int, dict[str, Any]],
    run_info: dict[str, Any],
) -> tuple[Path, Path]:
    date = run_info.get("date") or dt.date.today().isoformat()
    day_dir = out_dir / date
    day_dir.mkdir(parents=True, exist_ok=True)
    md = render_markdown(moments, match_meta, run_info)
    md_path = day_dir / "highlights.md"
    md_path.write_text(md, encoding="utf-8")
    json_path = day_dir / "highlights.json"
    save_json(
        json_path,
        {
            "run": run_info,
            "matches": {str(k): v for k, v in match_meta.items()},
            "moments": [m.to_dict() for m in moments],
        },
    )
    (out_dir / "latest.md").write_text(md, encoding="utf-8")
    return md_path, json_path
