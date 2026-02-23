# Claude Code Rules for Ability Draft Plus v2

## Project Rules
- This is a NEW project being built from scratch in this folder
- The v1 reference code is at `../ability-draft-plus/` - read it but don't modify it
- All 21 v1 features must be preserved - check `docs/V1_FEATURE_INVENTORY.md` before removing anything
- Two new features must be added - see `docs/V2_REQUIREMENTS.md`
- Implementation phases are in `docs/IMPLEMENTATION_PLAN.md` - follow the order

## Technology Stack (Decided)
- **Framework:** Electron 40+ with electron-vite build system
- **Frontend:** React + shadcn/ui + Tailwind CSS v4
- **State:** Zustand + @zubridge/electron (main process = single source of truth)
- **Database:** Drizzle ORM + sql.js (NO native modules - avoids node-gyp/electron-rebuild)
- **ML:** ONNX Runtime Node (onnxruntime-node) + DirectML, INT8 quantized model
- **IPC:** Typed domain-grouped channels (`domain:action` pattern)
- **Testing:** Vitest (unit/integration) + Playwright (E2E)
- **Logging:** electron-log v5 (scoped loggers)
- **i18n:** i18next + react-i18next with TypeScript module augmentation
- **Installer:** NSIS via electron-builder, electron-updater for auto-updates

## Architecture Rules
- `src/core/` must have ZERO Electron imports - pure TypeScript domain logic
- `src/shared/` for types and constants shared between processes
- ML inference runs in UtilityProcess or worker_threads, NEVER in main or renderer
- Database access only through Drizzle repositories in main process
- Renderers communicate only via typed IPC (contextBridge)
- Overlay window: `pointer-events: none` on body, `pointer-events: auto` only on interactive elements
- Overlay CSS: use `contain: strict`, `will-change: transform`, NO `backdrop-filter: blur()`
- Use `rgba()` semi-transparent backgrounds instead of blur for overlay tooltips

## Code Quality
- TypeScript strict mode, no `any` types unless absolutely necessary
- ESLint + Prettier
- Write tests for: ML pipeline, coordinate calculations, database queries, scoring logic, scrapers
- Meaningful error messages for all user-facing errors
- Use electron-log v5 scoped loggers (not console.log in production code)

## Git Workflow
- Branch from main for all work
- Never commit directly to main
- Do not push or create PRs unless user explicitly says "wrap it up"
- Commit messages: conventional commits format (feat:, fix:, refactor:, docs:, test:, chore:)

## Database
- Schema defined in Drizzle (schema-as-code in `src/core/database/`)
- Use sql.js (WASM) driver - no native modules
- Migrations via Drizzle Kit (plain SQL files, version-controlled)
- Run `migrate()` programmatically on app startup in main process
- Back up database file before migrations (`fs.copyFileSync`)
- Use transactions for batch operations (scraper inserts)
- Test with in-memory SQLite (`:memory:`) for speed

## Security
- API credentials must never be committed to git (.env + .gitignore)
- Validate all IPC inputs from renderer processes (Zod for complex operations)
- Content Security Policy on all HTML pages
- Context isolation enabled, nodeIntegration disabled
- Validate URLs before opening in external browser

## Important Constraints
- Windows-only target (for now)
- Must support transparent, always-on-top, click-through overlay windows
- Use `electron-overlay-window` npm package for overlay (proven by Awakened PoE Trade)
- Use `setIgnoreMouseEvents(true, { forward: true })` for click-through
- ML model: convert v1's Keras MobileNetV2 to ONNX (tf2onnx, opset 18) + INT8 quantization
- Model input: [1, 96, 96, 3] float32, 512 output classes
- Resolution coordinates stored in layout_coordinates.json (v1 format preserved)
- Windrun.io is a React SPA - primary approach is API endpoint reverse-engineering

## Key Business Logic to Preserve (from v1)
- Scoring formula: `0.4 * winrate_normalized + 0.6 * inverted_pick_order_normalized`
- Pick order normalization range: min=1.0, max=50.0
- ML confidence threshold: 0.9 (90%)
- Default OP threshold: 13%, Default trap threshold: 5%
- Top tier suggestions: 10 max, prioritizing user's picked ability synergies
- Synergy filtering: exclude same-hero ability pairs
- Hero identification: uses ability_order === 2 as "hero-defining ability"
- Worker auto-restart: max 3 attempts, 5s cooldown (port from mlManager.js)

## Resolution Mapping (v2 New Feature)
- Mathematical scaling: `scaleFactor = targetHeight / 1080`, `horizontalOffset = (targetWidth - 1920 * scaleFactor) / 2`
- Ship pre-computed mappings for common resolutions (zero clicks for ~90% of users)
- 4-anchor calibration wizard for custom resolutions (bilinear interpolation)
- Full 68-click advanced mode preserved as option
- Use Konva.js (react-konva) for the calibration canvas

## Scraping (v2 New Feature)
- Primary: reverse-engineer Windrun.io API endpoints (React SPA fetches JSON)
- Fallback: hidden BrowserWindow + monkey-patched window.fetch to intercept API responses
- Secondary data source: Stratz GraphQL API (2000 req/hr free with Steam login)
- Do NOT bundle Puppeteer/Playwright (Chromium conflicts, 300-500MB overhead)
