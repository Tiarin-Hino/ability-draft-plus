# Rust Daemon + Native Overlay Architecture Blueprint

Status: **Implemented & CI-Verified (M1–M7 Complete — Ready for Live Testing)** on branch `feat/rust-daemon-native-overlay`  
Scope: Long-term replacement of the Electron runtime with a native Rust architecture (`ad-daemon` + `ad-control-panel` + `ad-overlay`) plus OBS Browser Sources (`/stream`, `/picks`).

---

## 1. Why Native Rust Processes (`ad-daemon` + `ad-control-panel` + `ad-overlay`)

1. **Zero Chromium over Dota 2:** The in-game HUD is rendered by `ad-overlay` using a lightweight native surface (`egui` / `wgpu` on Windows/macOS/Linux X11, and a future `wlr-layer-shell` or Vulkan implicit layer on Linux Wayland). No `getUserMedia` capture bridge, no `overlayBackgroundMode` hidden window workaround, and no async DOM `mouseenter`/`mouseleave` click-through lock state.
2. **Stateless OS Hit-Testing:** Instead of toggling `setIgnoreMouseEvents` via IPC, the overlay answers OS hit-tests synchronously per cursor position (`WM_NCHITTEST` returning `HTTRANSPARENT` vs `HTCLIENT` on Windows, `NSWindow` region/hit-testing on macOS, `XShapeCombineRectangles` on Linux X11). Empty pixels can never get stuck swallowing game clicks.
3. **Always-On Headless Daemon:** `ad-daemon` stays running across matches and works identically with or without a visible overlay (Background Mode, OBS Browser Sources, and Twitch extension broadcasting live natively in the daemon).

---

## 2. Workspace Crate Map (`rust/`)

```
rust/
├── Cargo.toml
└── crates/
    ├── ad-protocol   # Versioned daemon <-> overlay IPC messages & snapshots
    ├── ad-core       # Pure domain logic (zero OS/GUI deps): scoring, GSI, tags, geometry
    ├── ad-capture    # OS screen capture & game window tracking traits + per-OS backends
    ├── ad-ml             # ONNX FP16 MobileNetV2, SIMD NCC template matcher, native OCR
    ├── ad-daemon         # Tokio/Axum server: GSI, SQLite, OBS /stream & /picks, catalog/settings, ML loop
    ├── ad-overlay        # Native HUD process (egui/wgpu + OS click-through window surface)
    └── ad-control-panel  # Standalone native desktop Control Panel (Dashboard, Abilities, Heroes, OBS, Settings)
```

### `ad-protocol`
- Defines the versioned local IPC contract (`PROTOCOL_VERSION`) between `ad-daemon` and `ad-overlay`:
  - Daemon $\rightarrow$ Overlay: `OverlaySnapshot` (slot bounds, recommendations, tooltips, synergy panels, role context, scan status), `GameWindowBounds`, `ResolutionSource`.
  - Overlay $\rightarrow$ Daemon: `OverlayCommand` (`TriggerScan`, `SelectMySpot`, `SelectMyModel`, `SetRoleMode`, `ResetDraft`, `CloseOverlay`, `ReportFailedScan`).

### `ad-core`
- Pure Rust port of `src/core/`, strictly isolated from OS APIs, SQLite, and GUI frameworks so `cargo test -p ad-core` runs sub-second anywhere:
  - **Scoring (`scoring.rs`):** `0.4 * winrate_norm + 0.6 * inverted_pick_order_norm`, pick order clamped to `1.0..=50.0`, `TOP_TIER_CAP = 10`, plus layered Personal shrinkage (`K = 20`), 42-tag Role needs/shifts, and Top-Tier verdict rules.
  - **GSI & Draft Sequencing (`gsi.rs`):** Dota 2 `POST /gsi` normalization, `GamePhase` lifecycle, `draft-clock`, card-box pick attribution, and seat-to-row correlation.
  - **Geometry:** Aspect-aware slot layouts, perspective alignment, and fallback auto-scaling.

### `ad-capture`
- Traits: `ScreenCapturer` and `GameWindowTracker` returning `RawFrame` (BGRA/RGBA pixel buffer + dimensions) and `WindowBounds`.
- Per-OS backends (`#[cfg(target_os = ...)]`):
  - **Windows:** `windows-capture` (WGC) + `windows-rs` Win32 window bounds tracking.
  - **macOS:** `ScreenCaptureKit` (`SCStream`) + `CGWindowListCopyWindowInfo`.
  - **Linux:** X11 MIT-SHM + `_NET_WM_*` tracking, plus `xdg-desktop-portal` + PipeWire for Wayland capture.

### `ad-ml`
- **Pool classifier:** `ort` (ONNX Runtime) running `resources/model/ability_classifier_fp16.onnx` with dynamic class count validated against `resources/model/class_names.json`. Inputs are raw `0–255` `f32` NHWC `[batch, 96, 96, 3]` tensors (`Rescaling` lives inside the ONNX graph). Pool slots require `confidence >= 0.9`.
- **Picked-ability matching:** SIMD border-inset NCC template matcher over cached ability icons, scoped by box type (36 standard vs 12 ultimate) with unrestricted fallback.
- **Card OCR:** OS-native engines behind `OcrEngine` — `Windows.Media.Ocr` on Windows, Apple `Vision` on macOS, and `ocrs` / native Tesseract on Linux.

### `ad-daemon`
- Single Tokio + Axum service bound to `127.0.0.1` hosting:
  - `POST /gsi` for Dota 2 Game State Integration.
  - `/stream` + `/events` SSE and `/picks` + `/picks/events` SSE (reusing the existing Vite web bundles for OBS Browser Sources).
  - Local web Control Panel (reusing `src/renderer/control-panel/` over HTTP/WebSocket).
  - Native SQLite (`rusqlite`) reading/migrating `dota_ad_data.db` directly without WASM memory copies.
  - Windrun/Liquipedia data sync, Twitch EBS publisher, and the local IPC channel to `ad-overlay`.

### `ad-overlay`
- Native `egui`/`wgpu` HUD process subscribing to `ad-daemon` snapshots:
  - **Windows:** Layered transparent `HWND` with `WM_NCHITTEST` hit-testing against live interactive widget rects (`ControlsPanel`, `RolePanel`, `MySpot`/`MyModel` pills, combo drawers).
  - **macOS:** Transparent `NSWindow` (`ignoringMouseEvents` / region tracking).
  - **Linux:** X11 `XShapeCombineRectangles` overlay on X11; `wlr-layer-shell` (wlroots/KDE) or Vulkan implicit swapchain layer (`VK_LAYER_AD_PLUS_overlay`) for Wayland/exclusive fullscreen.

---

## 3. Phased Milestones & Parity Strategy

1. **M1 — Daemon Skeleton & Windows Capture/Overlay Prototype:**
   - Wire `ad-daemon` (`POST /gsi`, `rusqlite` seed DB reader, `/health`) and `ad-overlay` (`WM_NCHITTEST` click-through prototype on Windows).
2. **M2 — Capture + ML + OCR Pipeline (`ad-capture`, `ad-ml`):**
   - Implement WGC frame capture, `ort` FP16 inference, SIMD NCC template matching, and `Windows.Media.Ocr`; benchmark latency and CPU usage vs Electron + `tesseract.js`.
3. **M3 — Full Domain Port & Golden Parity (`ad-core`):**
   - Export golden JSON fixtures from the existing TypeScript Vitest suite (`scoring`, `role-scoring`, `pick-attribution`, `slot-row-correlation`, `gsi/parser`) and assert bit-identical outputs in `cargo test -p ad-core`.
4. **M4 — Web Control Panel & OBS Bridge (`ad-daemon`):**
   - Serve the existing React Control Panel and OBS `/stream` + `/picks` bundles from `ad-daemon` over HTTP + WebSocket/SSE, decoupling them from Electron IPC.
5. **M5 — Hero/Pick Scanning, Auto-Rescan Clock & TS Golden Parity (`ad-core`, `ad-daemon`, `ad-overlay`):**
   - Ported serpentine `draft_clock`, `hero_identification`, `My Spot`/`Model` HUD controls, and golden parity fixtures (`scripts/generate-rust-parity-fixtures.mjs`).
6. **M6 — Native Capture & Card OCR (`ad-capture`, `ad-ml`, `ad-daemon`):**
   - Windows `PrintWindow(PW_CLIENTONLY | PW_RENDERFULLCONTENT)` + `BitBlt` hybrid capture, Linux `x11rb` X11 capture, macOS `CoreGraphics` capture, 3-pass `card_ocr` cascade (`WinRT` + `tesseract` fallback), `own_row_detection`, `model_picks_from_ocr`, and `POST /debug/scan-image`.
7. **M7 — Windows Full-Monitor `WS_EX_LAYERED` Hit-Testing, Global Hotkeys & Daemon Polish (`ad-overlay`, `ad-daemon`, `scripts/`):**
   - Initialize the Windows overlay at full monitor width `- 1px` before `WS_EX_LAYERED` locks hit-test bounds (eliminating both white backdrop regressions and frozen `800x600` regions), toggle `WS_EX_TRANSPARENT` + `SWP_FRAMECHANGED` from an OS cursor watcher with `GetAsyncKeyState(VK_LBUTTON)`, register `Ctrl+Shift+S`/`Ctrl+Shift+R`, auto-discover icon caches & GSI `.cfg` ports, infer `RoleMode::Dynamic`, and stream live `/picks/events` updates.
8. **M8 — Standalone Native Control Panel & 3D Perspective Edges (`ad-control-panel`, `ad-core/visual_geometry`):**
   - Ported `visual-geometry.ts` (`compute_panorama_projection`, `resolve_visual_slot_layout`, `compute_board_perspective`) and skewed quad border rendering so overlay highlights hug Dota 2's 3D slanted plinths and ultimates cleanly across all aspect ratios.
   - Added `ad-control-panel` standalone native `egui`/`wgpu` desktop app (Dashboard, Abilities/Heroes catalogs, OBS Streaming, Settings, and overlay launch/stop controls) backed by `/api/{abilities,heroes,settings,overlay/*}` on `ad-daemon`.

---

## 4. Quick Start (Windows Live Testing)

From the repository root in PowerShell:

```powershell
# Build & start ad-daemon + standalone native Control Panel (launch overlay from Dashboard)
.\scripts\rust-kit-start.ps1

# Also auto-launch the in-game overlay immediately + enable GSI auto-rescan
.\scripts\rust-kit-start.ps1 -WithOverlay -AutoRescan

# Overlay only (legacy mode)
.\scripts\rust-kit-start.ps1 -OverlayOnly -AutoRescan
```
