---
name: draft-diagnostics
description: >-
  Diagnoses live draft scan failures, capture cascade slowdowns, card OCR misses, pick-slot template
  rejections, hero identification gaps, GSI lifecycle/seat-mapping issues, and Windows overlay lag.
  Use when investigating scan logs, diagnostic bundles, or live draft bugs.
---

# Live Draft & Overlay Diagnostics Skill

Use this runbook when troubleshooting scan accuracy, capture speed, OCR misses, GSI state transitions, or overlay lag.

## 1. Where Diagnostic Data Lives (`%APPDATA%/ability-draft-plus/`)

| Path | Scope | Contents |
|---|---|---|
| `logs/main.log` / `main.old.log` | Always | Scoped `electron-log` output (`main`, `ml`, `scan-trigger`, `ocr`, `auto-rescan`, `stream-server`, `twitch`, `window-manager`). |
| `debug/scan-diagnostics/*.jsonl` | Dev builds only | Per-scan slot results, rejections, model-tile matches, OCR hero names. |
| `debug/ocr-diagnostics/*.jsonl` | Dev builds only | Per-strip OCR attempts (`sparse`, `darkText`, `auto`), raw text, winning pass, unscoped best match. |
| `debug/ocr-unresolved/*.{png,txt}` | Dev builds only | Capped dumps (`OCR_UNRESOLVED_DUMP_MAX`) of strips that failed all OCR passes (excluding `"NO HERO"`). |
| `debug/rejected-picks/*.png` | Dev builds only | Border-inset crops where pick-slot NCC template matching fell below threshold (at 1440p pick boxes are 87px centered 7px up-left — suspect crop geometry first on score drops). |
| `debug/low-conf-pool/*.png` | Dev builds only | 96×96 pool crops scoring `< 0.9` in ONNX classification. |
| `gsi-captures/<mode>_<phase>.json` | Always (intentional live diagnostics) | Latest raw Dota GSI snapshot (throttled every 5s; keep active in packaged builds). |
| `picks-view.json` / `twitch-state.json` | Always | Persisted OBS Picks strips and Twitch extension snapshots. |

## 2. Diagnostic Analysis Commands

```bash
# Correlate an automated diagnostic_draft_cycle.py run with JSONL logs into report.html
node scripts/analyze-draft-diagnostics.mjs --run <run-dir>

# Verify pure domain pipelines on real failure scenarios
npx vitest run tests/unit/core/domain/scan-processor.test.ts
npx vitest run tests/unit/core/domain/pick-attribution.test.ts
npx vitest run tests/unit/core/domain/model-picks-from-ocr.test.ts
npx vitest run tests/unit/core/domain/gsi-pick-fallback.test.ts
npx vitest run tests/unit/core/ml/template-matcher.test.ts
npx vitest run tests/unit/core/ocr/hero-name-matcher.test.ts
```

## 3. Common Failure Signatures & Root Causes

- **Slow scans (~1s+ capture)** -> Check `cached-capture` / `game-frame` logs: `cached-window` (~10–50ms WGC stream in overlay renderer) fell back to `getSources-window` (~800–1700ms) or `display`. Causes: overlay renderer crashed, `capture-agent.ts` track died on resolution change, or windowed Dota mismatched bounds.
- **First rescan hits ~9–10s timeout (`ML scan slow`)** -> `ml-worker.ts` `refreshPickTemplates()` lazily decodes all 540+ cached PNG icons via `sharp` on the first rescan.
- **Missing pool hero + broken card OCR for that hero** -> `hero-identification.ts` currently relies solely on the single W-slot (`ability_order === 2`). One `< 0.9` read or missing `SLOT_METADATA_OVERRIDES` entry drops the hero from `identifiedHeroModelsCache`, which drops it from `ocr-service.ts` pool-scoped roster. Check `abilities` table `ability_order` and `modelTileMatches`.
- **Card OCR missing highlighted card** -> Note: hero names on player cards render in **English regardless of client language**; highlighted active drafter card renders dark text on a light background (`darkText` `OCR_DARK_TEXT_THRESHOLD` pass). `COUNTDOWN_*` ratios were calibrated at `2560x1440` only and remain unvalidated at other resolutions.
- **Draft clock physics & GSI quirks** -> Picks start at clock 0; 7s turns across 5 serpentine rounds (`[0,5,1,6,2,7,3,8,4,9]`) with 5s round breaks; `map.clock_time` counts `-7 -> 0` per turn (never positive), preview ramp `-59 -> 0` is 1:1 wall time, and hero models draft ON turns.
- **GSI stuck `"Not connected"`** -> Check Dota `.cfg` port vs. stream port FIRST (changing stream port setting does not rewrite `.cfg`), then restart Dota 2. GSI in **playing** mode only reports the local player (`allplayers` is spectator-only; neither `team_slot` nor `player_slot` maps to draft rows); live-play card colors are always ally green / enemy red.
- **Windows 10 Start menu / audio flyout progressive lag during Background Mode** -> Check if `repositionOverlay()` or `refreshOverlayMouseEvents()` applied `setIgnoreMouseEvents(..., { forward: true })` onto the hidden `transparent: true` fullscreen (`1919x1080`) background window (`WH_MOUSE_LL` hook + layered rebuilds) AND whether long multi-game background sessions accumulate Chromium `WgcCaptureSession` / DWM surface state across repeated 30s `capture-agent.ts` start/stop cycles without recycling the hidden capture window. (`Win + Ctrl + Shift + B` resets DWM to test immediately.)
- **OBS Streamer Board / PowerShell pitfalls** -> Missing OBS stream rendering after an update is usually a cached OBS Browser Source (hard-refresh first). On Windows PowerShell, chaining `Get-ChildItem Cert:\...` after another command's output can swallow cert output — query `Cert:\` in its own call.
- **Overlay tooltips stop opening after scan/move** -> Windows drops mouse-move forwarding after `setBounds` or layered state rebuilds; `window-manager.ts` `refreshOverlayMouseEvents()` cycles `ignore=false -> true` when `mouseIgnore === true`.
