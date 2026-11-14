# Ability Draft Plus — Maintenance & Improvement Roadmap

Baseline: `main` at `e92f71e` (v3.3.0), audited across Electron Main, `src/core/`, 4 Vite renderers (`control-panel`, `overlay`, `stream`, `picks`), `ml-worker`, `twitch/` (`catalog`, `ebs`, `frontend`), CI/CD workflows, seed SQLite DB, and 8-language i18n locales.

> **Branch note:** Local unmerged branch `claude/stream-performance-optimization-b8e5b3` holds two unmerged commits (`f137b04` GSI ability-bar identity mapping for spectated players; `e988649` [MID_STREAM_RUNBOOK.md](../docs/MID_STREAM_RUNBOOK.md) + hotfix scripts investigating first-rescan template & model-tile stalls). Review and cherry-pick/discard intentionally before cutting the next release.

---

## Phase 1 — P0 Correctness, Type Safety & Seed DB Integrity

- [ ] **Fix TypeScript project-reference check (`157` hidden errors)**
  - Update [package.json](../package.json#L21) `typecheck` script from `tsc --noEmit` (which inspects 0 files because [tsconfig.json](../tsconfig.json#L1-L7) uses `"files": []` project references) to `tsc -b --noEmit` or sequential `-p tsconfig.node.json` + `-p tsconfig.web.json`, and run the same command in [ci.yml](../.github/workflows/ci.yml).
  - Resolve existing errors across [SetupPanel.tsx](../src/renderer/picks/src/components/SetupPanel.tsx), [RolePanel.tsx](../src/renderer/overlay/src/components/RolePanel.tsx), [App.tsx](../src/renderer/overlay/src/App.tsx), [EditMode.tsx](../src/renderer/stream/src/components/EditMode.tsx), [PlayerRows.tsx](../src/renderer/stream/src/components/PlayerRows.tsx), [TopBar.tsx](../src/renderer/stream/src/components/TopBar.tsx), [ControlsPanel.tsx](../src/renderer/overlay/src/components/ControlsPanel.tsx), [CombinationPanel.tsx](../src/renderer/overlay/src/components/CombinationPanel.tsx), [AbilityTile.tsx](../src/renderer/stream/src/components/AbilityTile.tsx), [ml-worker.ts](../src/main/workers/ml-worker.ts), and [database-service.ts](../src/main/services/database-service.ts).

- [ ] **Fix combination-suggestion threshold filtering bug**
  - [synergy-repository.ts](../src/core/database/repositories/synergy-repository.ts#L195-L264): `getHighWinrateCombinations` (called per selected ability in [scan-processor.ts](../src/core/domain/scan-processor.ts#L732-L745)) currently queries `abilitySynergies` forward + reverse without filtering by `synergyWinrate` or `synergyIncrease`. Pass the configured threshold from settings so low-synergy/negative pairs are not surfaced as recommended combos.

- [ ] **Rebuild clean seed database & harden scraper schema parity**
  - Rebuild [resources/dota_ad_data.db](../resources/dota_ad_data.db) (`2026-07-31`, `1600.0 KB`) after running `.agents/skills/quality-and-release/scripts/audit-seed-data.mjs`:
    - Populate missing `Ability` and `Hero` shift columns (`7/7` missing on both tables) and `Abilities.windrun_id` (`false` vs `Heroes=true`).
    - Apply `SLOT_METADATA_OVERRIDES` ([slot-metadata-overrides.ts](../src/core/scraper/slot-metadata-overrides.ts#L16-L54)) and eliminate the `4` abilities with `NULL ability_order` and unexpected non-random-pool heroes missing `ability_order = 2` (`skeletonking`; note `invoker`/`kez` are expected random pools) that break `ability_order === 2` fallback assumptions in [hero-identification.ts](../src/core/domain/hero-identification.ts#L23-L54).
    - Strip local/dev `Metadata` keys baked into the seed DB (`experimental_auto_draft_tracking`, `stream_autostart`, `stream_port`, `theme_mode`, `overlay_*`, `ml_model_gaps`).
    - Decide whether `HeroAbilityTriplets` (`7,862` rows — `45.3%` of seed rows, currently unread at runtime) should be wired into combo scoring or trimmed cleanly to cut DB size/memory nearly in half.
    - Reconcile the `15` stale model classes vs. `513` DB abilities (`528` model classes, `0` missing from model) and verify unpickable-ability exclusions in [staleness-detector.ts](../src/core/ml/staleness-detector.ts#L39-L49).

- [x] **Fix Windows 10 Background-Mode Shell/Audio Progressive Lag & Crash Recovery** *(Bug #1 core — done in v3.3.1)*
  - Made `repositionOverlay()`, `setOverlayMouseEvents()`, and `refreshOverlayMouseEvents()` in [window-manager.ts](../src/main/services/window-manager.ts) strict no-ops when `!overlayVisible`, skipped `bridge.subscribe([overlayWin])` and `windowTracker.startTracking` in [ipc/index.ts](../src/main/ipc/index.ts) when `backgroundMode` is active, and gated `ml:scanResults`/`overlay:data` overlay broadcasts in [scan-processing-service.ts](../src/main/services/scan-processing-service.ts).
  - Changed background capture hosts to tiny non-transparent hidden windows (`100x100`, `transparent: false, frame: true, focusable: false, skipTaskbar: true, show: false`, `?background=1`) and split overlay mounting ([main.tsx](../src/renderer/overlay/src/main.tsx) / [mount-ui.tsx](../src/renderer/overlay/src/mount-ui.tsx)) so background hosts run only `initCaptureAgent()` without React/i18n/CSS.
  - Added match-boundary capture host recycling (`resetSession()` in [cached-window-capture-service.ts](../src/main/services/cached-window-capture-service.ts) + `recycleBackgroundOverlay()` in [main/index.ts](../src/main/index.ts)) so Chromium `WgcCaptureSession` / DWM state does not accumulate across games.
  - Added bounded auto-reload recovery (`MAX_CRASH_RECOVERIES = 3`) for `render-process-gone` in [window-manager.ts](../src/main/services/window-manager.ts).
- [ ] **Overlay Click-Through Reference Counting & Multi-DPI Bounds Follow-Ups** *(Bug #1 follow-ups)*
  - Replace single-flag hover toggles in [use-mouse-passthrough.ts](../src/renderer/overlay/src/hooks/use-mouse-passthrough.ts#L9-L24) with hover reference counting + unmount cleanup, and fix [ConfirmModal.tsx](../src/renderer/overlay/src/components/ConfirmModal.tsx) closing over [ControlsPanel.tsx](../src/renderer/overlay/src/components/ControlsPanel.tsx) forcing `ignore: true`.
  - Use display-aware bounds via `screen.getDisplayMatching(...)` instead of `screen.getPrimaryDisplay().scaleFactor` in [window-tracker-service.ts](../src/main/services/window-tracker-service.ts#L137), and clamp negative/off-desktop bounds in `getGameWindowPhysicalBounds()` ([window-tracker-service.ts](../src/main/services/window-tracker-service.ts#L170-L175)).

- [ ] **Fix live-draft state desyncs & Sentry release symbolication**
  - Trigger `scanProcessingService` re-evaluation (or cached snapshot re-score) from `draft:selectMySpot` / `draft:selectMyModel` in [draft-handlers.ts](../src/main/ipc/draft-handlers.ts#L21-L63).
  - Keep `captureGsiPayload` active in production ([stream-server-service.ts](../src/main/services/stream-server-service.ts#L761)) — writing bounded `gsi-captures/<mode>_<phase>.json` is intentional live-stream diagnostic evidence.
  - Fix [release.yml](../.github/workflows/release.yml#L46-L52) `if: env.SENTRY_AUTH_TOKEN != ''` (use `${{ secrets.SENTRY_AUTH_TOKEN != '' }}`) and enable hidden sourcemaps in [electron.vite.config.ts](../electron.vite.config.ts#L28-L90).
  - Resolve `drizzle-orm` version mismatch between [package.json](../package.json#L34) (`^0.45.1`) and `patches/drizzle-orm+0.45.2.patch`.
  - Validate `COUNTDOWN_*` OCR crop ratios across non-1440p resolutions (currently measured at `2560x1440` only).

---

## Phase 2 — Performance (Main Process, ML Worker, Overlay, Stream & Twitch)

- [ ] **Eliminate per-scan SQL N+1 loops & synchronous DB disk blocks**
  - Replace the per-pool-ability `getAbilitySynergySplit` loop, unfiltered `getAllHeroAbilitySynergiesUnfiltered()`, and repeated per-hero/triplet/OP/trap full-table scans in [scan-processor.ts](../src/core/domain/scan-processor.ts#L629-L766) with prepared batch `IN (...)` queries and an indexed `abilityName -> heroId` lookup map (replacing line `766` repeated `deps.heroes.getByAbilityName(name)` calls).
  - Collapse the `16` individual `get(...)` calls in `MetadataRepository.getSettings()` ([metadata-repository.ts](../src/core/database/repositories/metadata-repository.ts#L39-L56)) into a single `SELECT key, value` query.
  - Stop calling `persist()` unconditionally inside `initialize()` ([database-service.ts](../src/main/services/database-service.ts#L140)), remove the redundant `Buffer.from(data)` copy, write asynchronously via `.tmp` + atomic rename, and add save-time debouncing (`~250ms`) so opacity slider drags in [appearance-card.tsx](../src/renderer/control-panel/src/components/settings/appearance-card.tsx) do not stall the main thread.

- [ ] **Unblock ML Worker rescan latency, OCR queue & IPC memory copies**
  - Add a cooldown/TTL guard to `refreshPickTemplates()` in [ml-worker.ts](../src/main/workers/ml-worker.ts#L177-L202) (matching `MODEL_TILE_REFRESH_INTERVAL_MS = 30_000` at line `118`), and avoid repeating full `captureModelTiles` + `matchModelTiles` on every rescan once initial models settle.
  - Add `requestId` correlation in [ml-service.ts](../src/main/services/ml-service.ts#L210-L277) instead of a single `scanResolve`/`scanReject` pair, transfer `ArrayBuffer` instead of copying `screenshot.data.buffer.slice(...)` (`#L254`), and clear `lastScan` in [feedback-service.ts](../src/main/services/feedback-service.ts#L72) on session reset/overlay close.
  - Split `processCountdown` ([ocr-service.ts](../src/main/services/ocr-service.ts#L210-L230)) off the heavy card-OCR `queue`, bundle `eng.traineddata` into packaged resources instead of runtime download (`#L85-L87`), and clear `rosterCache` after scrape completion (`#L190-L199`).
  - Eliminate extra IPC hop/canvas copies in [capture-agent.ts](../src/renderer/overlay/src/capture-agent.ts#L74-L146) or reuse main-process WGC (`desktopCapturer`/native frame) path consistently.

- [ ] **Optimize Overlay GPU compositing, memoization & Twitch/Stream fanout**
  - Fix the missing dependency array on the `overlay:hotkey` `useEffect` in [App.tsx](../src/renderer/overlay/src/App.tsx#L75-L85).
  - Replace continuous `box-shadow` / `border-color` shimmer keyframes in [globals.css](../src/renderer/overlay/src/globals.css#L235-L294) with GPU-friendly `opacity`/`transform` pseudo-element animations.
  - Memoize [HotspotLayer.tsx](../src/renderer/overlay/src/components/HotspotLayer.tsx) and [AbilityHotspot.tsx](../src/renderer/overlay/src/components/AbilityHotspot.tsx), pre-index `modelsCoords` by hero/slot instead of `.find()` on hover, and scope `@zubridge` subscriptions to overlay-relevant slices.
  - Cache DB projections in [twitch-publisher-service.ts](../src/main/services/twitch-publisher-service.ts#L348-L418) (`buildTwitchRichState`) when pool/picks haven't changed instead of running 4 DB queries + `JSON.stringify` every `GSI_BROADCAST_DEBOUNCE_MS = 500` tick ([stream-server-service.ts](../src/main/services/stream-server-service.ts#L72)).
  - Isolate the 1s GSI clock tick from full-board React re-renders in `src/renderer/stream`, replace the O(N²) `slotByIndex` lookup in [selectors.ts](../twitch/frontend/src/data/selectors.ts) with an indexed map, and pause the permanent 250ms delay timer in [bootstrap.ts](../twitch/frontend/src/app/bootstrap.ts) when hidden or unbuffered.

---

## Phase 3 — UI/UX Polish (Overlay, Control Panel, Mapper, Stream & Twitch)

- [x] **Fix `RolePanel` overlapping top `My Spot` button** *(Bug #2, Plan A — done in v3.3.1)*
  - Arranged `RolePanel` + `.resolution-badge` + `.scan-summary` horizontally beside `ControlsPanel` inside `.overlay-header-row` ([App.tsx](../src/renderer/overlay/src/App.tsx), [globals.css](../src/renderer/overlay/src/globals.css); `.overlay-header-row-left` with `flex-direction: row-reverse`) with tightened header control/role sizing so Row 5 and Row 0 `My Spot` buttons remain unobstructed on both anchors across `1280x720`–`3840x2160`.
- [ ] **Overlay ergonomics & visual clarity**
  - Collapse secondary controls into a single drawer/stack without nested scrollbars, add an interactive color/shimmer/marker legend, gate `Escape` in [App.tsx](../src/renderer/overlay/src/App.tsx#L49-L58) so modal/panel dismissal runs before closing the overlay, fix [StatusToast.tsx](../src/renderer/overlay/src/components/StatusToast.tsx) stacking and repeat-toast suppression, read settings reactively in [RolePanel.tsx](../src/renderer/overlay/src/components/RolePanel.tsx) (eliminating forced manual rescan), and use trap-specific tooltip keys instead of `opCombinations.tripletTooltip` in [CombinationPanel.tsx](../src/renderer/overlay/src/components/CombinationPanel.tsx).

- [ ] **Control Panel consistency, feedback & lazy splitting**
  - Start/sync `streamService` automatically when enabling `experimentalAutoDraftTracking` in [auto-tracking-card.tsx](../src/renderer/control-panel/src/components/settings/auto-tracking-card.tsx#L44-L49), deduplicate GSI controls shared with [gsi-card.tsx](../src/renderer/control-panel/src/components/streaming/gsi-card.tsx), remove duplicate `p-6` padding and add port validation + Open-in-Browser links on [streaming-page.tsx](../src/renderer/control-panel/src/pages/streaming-page.tsx).
  - Add confirmation dialogs to Twitch Unpair ([twitch-card.tsx](../src/renderer/control-panel/src/components/streaming/twitch-card.tsx)) and Player Profile Unlink ([player-profile-card.tsx](../src/renderer/control-panel/src/components/settings/player-profile-card.tsx)), unify instant/reset persistence in [threshold-card.tsx](../src/renderer/control-panel/src/components/settings/threshold-card.tsx), and fix double theme writes in [sidebar.tsx](../src/renderer/control-panel/src/components/layout/sidebar.tsx).
  - Show contextual re-onboarding access even after `scraperLastUpdated` is populated ([first-run-checklist.tsx](../src/renderer/control-panel/src/components/dashboard/first-run-checklist.tsx#L26)).
  - Localize column headers, fix Hero numeric sort (`heroId` vs winrate/name), add Ultimate filter + row virtualization in [ability-columns.tsx](../src/renderer/control-panel/src/components/abilities/ability-columns.tsx) and [hero-columns.tsx](../src/renderer/control-panel/src/components/statistics/hero-columns.tsx).
  - Route-split heavy Control Panel chunks (`dev-mapper-page`, Konva mapper, TanStack Table).

- [ ] **Resolution Mapper & Broadcast / Twitch UX**
  - Prevent Ctrl+drag pan gestures from placing accidental slot points in [konva-canvas.tsx](../src/renderer/control-panel/src/components/mapper/konva-canvas.tsx), surface `result.validation` feedback in [step-anchor-calibration.tsx](../src/renderer/control-panel/src/components/mapper/step-anchor-calibration.tsx), and expose custom layout management (`resolution:getAll`/`deleteCustom`).
  - Reset stale broken-image error flags when props change in [AbilityTile.tsx](../src/renderer/stream/src/components/AbilityTile.tsx), [PlayerRows.tsx](../src/renderer/stream/src/components/PlayerRows.tsx), [PoolBoard.tsx](../src/renderer/stream/src/components/PoolBoard.tsx), [StatPanels.tsx](../src/renderer/stream/src/components/StatPanels.tsx), [PickTicker.tsx](../src/renderer/stream/src/components/PickTicker.tsx), [TeamStrip.tsx](../src/renderer/picks/src/components/TeamStrip.tsx), and [Art.tsx](../twitch/frontend/src/components/common/Art.tsx).
  - Make `?edit=1` layout customization persist via server-backed settings (not browser-local `localStorage`) in [EditMode.tsx](../src/renderer/stream/src/components/EditMode.tsx), and stop [SetupPanel.tsx](../src/renderer/picks/src/components/SetupPanel.tsx) from opening a live SSE `/picks/events` stream just to read language.
  - Fix Twitch viewer z-index (`DraftOverviewModal` `z-index: 25` covering `DetailsDock` `z-index: 20`) and `Escape` priority across [DraftOverviewModal.tsx](../twitch/frontend/src/components/overview/DraftOverviewModal.tsx) and [DetailsDock.tsx](../twitch/frontend/src/components/details/DetailsDock.tsx); add close button & responsive mobile layout to [CasterPanel.tsx](../twitch/frontend/src/components/ingame/CasterPanel.tsx); add pairing countdown, copy button, and tab-visibility polling pause in [ConfigPage.tsx](../twitch/frontend/src/components/config/ConfigPage.tsx).
  - **Twitch extension next-release blockers**: Fix unreadable light mode (priority) and add the desktop app link on `twitch/frontend/config.html` with off-site indicator `"↗"` (per Twitch Guideline `4.6.2`) before generating the next review zip.

---

## Phase 4 — Automations, CI/CD, Data Pipeline, Backlog & i18n

- [ ] **CI/CD workflow deduplication & cross-repo coverage**
  - Add workflow `concurrency:` and stop running duplicate builds on both `push` and `pull_request` for the same PR head in [ci.yml](../.github/workflows/ci.yml#L3-L8); move full Portable/NSIS installer packaging out of routine PRs onto release/manual/main builds.
  - Fix [twitch.yml](../.github/workflows/twitch.yml#L3-L75) `pull_request.paths` to include shared contracts (`src/core/stream/**`, `src/core/domain/twitch-projection.ts`, `src/core/domain/twitch-live-projection.ts`, `src/shared/types/twitch.ts`, `resources/model/class_names.json`, `resources/data/hero_meta.json`).
  - Fix [train-model.yml](../.github/workflows/train-model.yml#L5): remove `npm version minor` (policy forbids auto-bumping `package.json`), default `fine_tune` to `true` (once agreed, and validate against `low-conf-pool` / `low-confidence-pool` crops + `"Fine-tuned top block: yes"`), trigger CI checks cleanly on automated PRs, and clean up obsolete INT8 / TF.js references and dead [convert-model-to-onnx.py](../scripts/convert-model-to-onnx.py).
  - Automate post-release GitHub Draft-Race consolidation or eliminate dual-draft upload split in [release.yml](../.github/workflows/release.yml).
  - Add weekly/scheduled seed-data drift & audit workflow using `.agents/skills/quality-and-release/scripts/audit-seed-data.mjs`.

- [ ] **Open PR Review, Role-Layer v2 & Tag Lab Backlog**
  - Review open external PRs: `#149`, `#148` (`zh-CN` fixes), `#143` (My Spot synergy scoping), `#141` (403 browser recovery), `#136` (`zh-CN` website translation).
  - Tag Lab website (`../tiarinhino.com`): add `tagDocs`/catalog support for round-5 tag names, supersede 5 legacy `new_tag` proposals, and add `combos` / `viaUpgrade` / `with` UI support.
  - Role-layer v2 design exploration (when scheduled): team+pool-scope needs, scarcity pricing, function complementarity (`mobility*threat`, `CC*damage`), and evaluating pos 4/5 collapse (`POSITION_NEEDS`).

- [ ] **Automated quality gates, i18n completion & cleanup**
  - Translate the **`175`** remaining English fallback strings reported by `.agents/skills/i18n-sync/scripts/check-i18n.mjs` across `fil` (**`117`**), `es` (**`14`**), `fi` (**`14`**), `pt-BR` (**`13`**), `ru` (**`6`**), `uk` (**`6`**), and `zh-CN` (**`5`**).
  - Wire `.agents/skills/i18n-sync/scripts/check-i18n.mjs` and `.agents/skills/quality-and-release/scripts/audit-seed-data.mjs` into CI / pre-release checklists via [quality-and-release](../.agents/skills/quality-and-release/SKILL.md) and [i18n-sync](../.agents/skills/i18n-sync/SKILL.md).
  - Archive or remove confirmed dead assets after verifying zero references: orphaned `src/assets/locales/{en,ru}/common.json` ([en](../src/assets/locales/en/common.json), [ru](../src/assets/locales/ru/common.json)) and the 8 unused `control-panel/src/locales/*/feedback.json` files (or wire `feedback.json` back into [feedback-card.tsx](../src/renderer/control-panel/src/components/settings/feedback-card.tsx)).
