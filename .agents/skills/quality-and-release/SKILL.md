---
name: quality-and-release
description: >-
  Runs full multi-target verification (Node/Web TypeScript, ESLint, Vitest, Playwright E2E,
  Twitch subpackages, and bundled seed DB/JSON integrity), prepares tagged vX.Y.Z releases,
  or executes low-CPU live-stream hotfix workflows. Use before merging, releasing, or auditing repo health.
---

# Quality Assurance & Release Skill

Use this workflow to verify code health across all build targets, inspect bundled seed assets, or prepare a versioned release.

## 1. Full Verification Checklist (Before PR / Merge)

> [!IMPORTANT]
> Root `tsconfig.json` uses project references (`"files": []`), so `npm run typecheck` checks **nothing** until fixed. Always invoke both referenced configs explicitly:

```bash
# TypeScript (both Node/Main and Web/Renderers)
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json

# Lint & Formatting
npm run lint
npm run format:check

# Unit & Locale Parity Suite
npm test

# Locale untranslated fallback & seed integrity audit
node .agents/skills/i18n-sync/scripts/check-i18n.mjs
node .agents/skills/quality-and-release/scripts/audit-seed-data.mjs

# Production Build + Electron Playwright E2E Smoke
npm run build
npm run test:e2e
```

## 2. Twitch Extension Subpackage Verification
If changes touch `twitch/**`, `src/shared/**`, `src/core/stream/**`, `src/core/domain/twitch-projection.ts`, `resources/model/class_names.json`, or `resources/data/hero_meta.json`:

```bash
# EBS
cd twitch/ebs && npm run typecheck && npm test && npm run bundle

# Catalog
cd twitch/catalog && npm run build:demo && npm test

# Frontend (enforces flat zip < 900 KB)
cd twitch/frontend && npm run gen:geometry && npm run typecheck && npm test && npm run build && npm run pack
```

## 3. Preparing a Tagged Release (`vX.Y.Z`)
Releases are triggered strictly by pushing `v*` tags (`.github/workflows/release.yml`). Merges to `main` alone do not publish. **Never bump `package.json` version in normal PRs/fixes** — bump only when the user explicitly requests an official release and names `X.Y.Z`.

1. Run `node .agents/skills/quality-and-release/scripts/audit-seed-data.mjs` and confirm:
   - `resources/dota_ad_data.db` has current Windrun data, `*_shift` columns populated, and `SLOT_METADATA_OVERRIDES` applied.
   - Zero user-specific or dev-override `Metadata` keys (`overlay_opacity`, `experimental_auto_draft_tracking`, `stream_autostart`, `twitch_*`) are baked into the seed DB.
2. Update `CHANGELOG.md` with release notes under `## [X.Y.Z] - YYYY-MM-DD`.
3. Bump `package.json` + `package-lock.json` (`npm version X.Y.Z --no-git-tag-version`).
4. Commit, merge to `main`, then tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
5. **CI Secret Gotcha:** Never add a standalone `npm run prebuild` step before `npm run build` without the secret `env:` block — `prebuild` runs automatically via `npm run build` and would overwrite `resources/app-config.json` with empty credentials.
6. Verify `.github/workflows/release.yml` finishes and confirm Sentry sourcemaps if enabled (`electron.vite.config.ts` must emit sourcemaps and `SENTRY_AUTH_TOKEN` must be readable when `if:` evaluates). Note: `oneClick: false` NSIS wizard is intentional.
7. **Post-workflow GitHub Release Draft-Race Fix (Mandatory every release):** `release.yml` creates the release as a **DRAFT** and races into **two drafts** (one with only `Setup.exe.blockmap`, one with the other assets minus that blockmap). Until consolidated and published, `electron-updater` reading `releases/latest/download/latest.yml` reports "You're on the latest version":
   - Run `gh api repos/Tiarin-Hino/ability-draft-plus/releases` to find the two `v*` drafts.
   - Download the `.exe.blockmap` asset (`gh api -H "Accept: application/octet-stream" .../releases/assets/<id>`) and upload it to the main draft (`POST https://uploads.github.com/repos/.../releases/<complete-id>/assets?name=...`) so all 4 assets exist: portable exe, Setup exe, `.exe.blockmap`, `latest.yml`.
   - Delete the incomplete duplicate draft (`-X DELETE .../releases/<id>`).
   - Run **two separate PATCHes**: first `-X PATCH .../releases/<id> -f draft=false`, then a second PATCH with only `-f make_latest=true` (sending both together was ignored for v3.2.1). Verify `.../releases/latest` and `latest.yml` (~1 min CDN lag).

## 4. Low-CPU Live-Stream Hotfix Pipeline
An unmerged helper suite exists on branch `claude/stream-performance-optimization-b8e5b3` (`docs/MID_STREAM_RUNBOOK.md`, `scripts/hotfix/hotfix.ps1`, `scripts/hotfix/patch-asar.mjs`, `scripts/hotfix/triage.mjs`). When debugging on a live streaming PC without an installer rebuild, read that runbook before running heavy builds or full test suites.
