# Twitch Extension Subpackages — Agent Guidelines

Rules for working inside `twitch/` (`catalog`, `ebs`, `frontend`). Each subfolder is a **standalone npm package** with its own `package.json`, `node_modules/`, and CI job (`.github/workflows/twitch.yml`). Electron-builder packages `out/**` only, so nothing under `twitch/` ships inside the Windows desktop installer.

## Subpackage Map & Commands

| Package | Purpose | Commands |
|---|---|---|
| `twitch/catalog/` | Builds `catalog-<hash>.json` + `catalog-manifest.json` from OpenDota `dotaconstants`, verified against `../../resources/model/class_names.json` and `../../resources/data/hero_meta.json` (`allowed-missing.json` tracks exceptions). | `npm run build:demo`, `npm run build`, `npm test` |
| `twitch/ebs/` | AWS SAM Lambda Extension Backend Service (pairing codes, DynamoDB store, Helix PubSub relay, JWT verification) + local dev server (`127.0.0.1:8787/twitch`). | `npm run typecheck`, `npm test`, `npm run bundle`, `npm run dev` |
| `twitch/frontend/` | Twitch Video Fullscreen overlay (`video_overlay.html`) + Broadcaster Config view (`config.html`). Runs in viewer iframes on `https://<clientId>.ext-twitch.tv`. | `npm run gen:geometry`, `npm run typecheck`, `npm test`, `npm run build`, `npm run pack`, `node scripts/smoke.mjs` |

## Architecture & Review Invariants

1. **Type-only shared boundary**: `twitch/*` imports **ONLY TypeScript types** from `../../src/shared/types/*` (`src/shared/types/twitch.ts`, etc.). Never import runtime Electron, Node, or `src/core` code into `twitch/frontend/`.
2. **Flat Twitch extension zip (`pack.mjs`)**: Twitch silently drops subdirectories on zip ingestion (causing blank overlays with no error). Vite emits flat chunks/assets into `dist/` and `twitch/frontend/scripts/pack.mjs` enforces flat contents and the `< 900 KB` zip cap.
3. **Unminified build (`vite.config.ts`)**: `twitch/frontend` sets `minify: false` intentionally to satisfy Twitch Extension human review rules — do not enable minification without verifying Twitch review policy.
4. **Three-channel PubSub / HTTPS contract (`src/shared/types/twitch.ts`)**:
   - **Compact (`TwitchCompactState`, `< 5 KB` `TWITCH_COMPACT_MAX_BYTES`)**: Dynamic draft state over Helix PubSub + viewer `hlsLatencyBroadcaster` delay buffer. Enforced by worst-case byte tests in `tests/unit/core/domain/twitch-projection.test.ts`.
   - **Rich (`TwitchRichState`)**: Per-draft static stats, pool-internal synergy graph, and normalized geometry fetched via HTTPS once per revision.
   - **Caster live telemetry (`TwitchLiveState`)**: Spectate-only, `ingame`-only 2s ticker (~2 KB) sent directly via PubSub. **NEVER fold it into `TwitchCompactState`** (defeats content-key dedupe and risks Twitch's 1 msg/s/channel rate limit), **NEVER persist it in DynamoDB**, and **NEVER retry** skipped ticks.
5. **Seat vs. draft-row mapping**: Wire state is keyed by **draft row** (`0..9`), while Dota's top bar is in **GSI lobby slot order**. Top-bar overlays must translate through `compact.seats`.
6. **Catalog immutability & CORS**: Published `catalog-<hash>.json` files on `abilitydraftplus.com` / CloudFront are immutable (`max-age=31536000`); only `catalog-manifest.json` uses short caching (`max-age=0,must-revalidate`), and CORS (`Access-Control-Allow-Origin: *`) is mandatory for `*.ext-twitch.tv`.
7. **Console & Review Constraints**: Only the user operates the Twitch Dev Console (listing, versions, review) and the EBS AWS account. External links on `twitch/frontend/config.html` require an off-site indicator (`"↗"`) per Twitch Guideline `4.6.2`, and light-mode readability must be verified before submitting the next review zip.
8. **Chrome 142+ Local Test Gotcha**: If the Twitch Local Test iframe is blank over localhost HTTPS, disable `chrome://flags/#local-network-access-check` (requires full Chrome restart) and fully restart Chrome after `mkcert -install`.
