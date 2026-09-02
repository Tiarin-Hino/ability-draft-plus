# ad-highlights - daily clip finder for Ability Draft

Finds clip-worthy moments in recommended Ability Draft games and writes a ranked shortlist
(`out/latest.md`): match id, game-clock time, hero, the abilities cast in that fight and why it
scored. You open the replay, seek to the time, record, polish, publish.

It never looks at video. Everything comes from OpenDota's parsed replay data (teamfights,
per-fight ability casts, kill log), so a full day's run costs a few dozen HTTP calls and zero tokens.

**Standalone.** This folder has no dependency on the app repo - move it anywhere
(e.g. `C:\projects\ad-highlights`). Requires only Python 3.10+ (stdlib, no `pip install`).

## Setup (5 minutes)

```powershell
# 1. Put the folder where you want it, open PowerShell there
cd C:\projects\ad-highlights

# 2. Optional: config.json (defaults are fine to start) and a manual match list
copy config.example.json config.json
copy matches.example.txt matches.txt

# 3. First run by hand - proves OpenDota + Windrun access from your PC
python highlights.py --matches <recent match id> -v   # e.g. one of your own recent AD games (replay must still exist)
python highlights.py -v                               # the real daily flow

# 4. Schedule it: every day at 04:00 local time (CET/CEST on a CET-configured PC)
.\install_task.ps1            # add -Wake to wake the PC from sleep; -Uninstall to remove
Start-ScheduledTask -TaskName 'AD Highlights Daily'   # smoke-test the task itself
```

If PowerShell refuses to run the script: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

Output: `out/<date>/highlights.md` + `.json`, and `out/latest.md` always pointing at the newest run.
Logs: `logs/<date>.log` (pipeline) and `task.log` (scheduler launcher).

## What a run does

1. **Collect candidates** from `sources` (config): Windrun *Recommended Replays*, `matches.txt`,
   optionally recent high-rank public AD games from OpenDota. Matches already handled are skipped
   (`state/seen.json`), so each recommended game is reported once.
2. **Ensure parsed.** A match on OpenDota is only "parsed" (teamfights, ability casts) after
   someone requests it. The tool requests the parse and waits up to `parse_wait_minutes`;
   anything still queued is retried on the following runs for `pending_retry_days`.
   Replays older than roughly two weeks may be gone from Valve's servers - those are reported
   as unavailable, which is why this runs daily.
3. **Analyze.** For every hero in every detected teamfight: kills, damage, which drafted abilities
   were cast, plus rapid multi-kills from the kill log. See *Scoring*.
4. **Rank + report.** Top `top_moments` overall, at most `max_moments_per_match` per game.
5. Optional: download each reported game's replay straight into Dota's `replays` folder
   (`download_replays` + `dota_replays_dir`) so *Watch replay* works without the in-game download.

## Scoring (tune in `adhl/analyze.py`, constants at the top)

| Signal | Weight |
|---|---|
| kill in the fight | +3 each |
| hero damage in the fight | +1 per 1000 |
| each additional drafted ability cast in the same fight | +1.5 |
| setup -> payoff pair cast (hard_cc/setup_cc/initiation -> nuke/aoe/teamfight_ult/steroid, from `data/ability_tags.json`) | +2 |
| two teamfight ultimates in one fight | +2 |
| triple kill or better | +2 |
| rapid kills (<= 20 s apart) | +1.5 per extra kill |
| ability listed in `focus_abilities` | +3 |
| death in the fight | -1 |

`min_score` (default 6) hides filler. The tag file is a snapshot of the app's
`resources/data/ability_tags.json`; refresh it whenever the app's copy changes.

## Windrun URL

Windrun's API is undocumented, so `windrun_recommended_urls` is a list of guesses tried in order.
If the log says `windrun: no recommended replays found`, find the real one once:

1. Open the Recommended Replays page on windrun.io with DevTools (F12) > Network > Fetch/XHR.
2. Reload; click the request that returns the match list; copy its URL.
3. Put it first in `windrun_recommended_urls` in `config.json`.

The extractor is format-agnostic: it pulls any `/matches/<id>` links or `match_id` fields out of
JSON or HTML, in page order. Until then, `matches.txt` works as the source.

## CLI

```
python highlights.py                     # daily flow
python highlights.py --matches 123,456   # specific games (ids or URLs), ignores state
python highlights.py --no-wait           # request parses and exit; results next run
python highlights.py --rescan            # re-process matches already in state
python highlights.py --dry-run           # analyze, write nothing
python highlights.py --fixture m.json    # analyze a saved OpenDota match JSON offline
```

## Tests

```
python -m unittest discover -s tests -t .
```

Runs offline against `tests/fixtures/sample_match.json` (regenerate with `python tests/make_fixture.py`).

## Can Claude run this instead of Task Scheduler?

Claude Code's cloud Routines run in a cloud sandbox, not on your PC, and that sandbox cannot reach
windrun.io or OpenDota. A `/loop` in a local Claude Code session only lives while that terminal is
open. Task Scheduler is the reliable option and needs no Claude in the loop; the pipeline is
deterministic. If you want an editorial pass on top, set `USE_CLAUDE_DIGEST=1` in `run_daily.cmd`:
it pipes the report through `claude -p` once per run and writes `out/latest-digest.md`.

## Next step (not built yet)

Stage two - automatic recording: launch Dota on the replay, jump to the tick, lock the camera on
the hero, record with OBS via its websocket. Deliberately left out until the shortlist proves it
picks moments you actually use.
