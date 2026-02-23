# Dota 2 Ability Draft Plus

AI-powered overlay for Dota 2's Ability Draft mode. Scans the draft board using machine learning, identifies all abilities in the pool, and displays real-time synergy recommendations directly on your game screen.

![License](https://img.shields.io/badge/license-ISC-blue)
![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Electron](https://img.shields.io/badge/Electron-40+-47848F)

## Features

### Core Functionality
- **One-click ability scanning** -- machine learning identifies all 48 abilities in the draft pool from a single screenshot
- **Real-time overlay** -- recommendations appear directly on top of the Dota 2 game screen
- **Synergy detection** -- highlights overpowered (OP) ability combinations and trap combinations to avoid
- **Triplet analysis** -- suggests the best third ability to complete known strong pairs
- **Top-tier picks** -- up to 10 ranked recommendations, prioritizing synergies with your already-picked abilities
- **Rescan** -- update recommendations after abilities are drafted

### Smart Overlay
- **Click-through transparency** -- overlay sits on top of the game without blocking gameplay
- **My Spot / My Model** -- select your hero position and model for personalized recommendations
- **Ability tooltips** -- hover any ability for detailed stats, synergies, and win rates
- **Hero model tooltips** -- hover hero models for hero-specific ability synergies
- **OP & Trap panels** -- scrollable lists of the best and worst ability combinations in the current pool

### Data & ML
- **Windrun.io integration** -- one-click data scraping from the premier Ability Draft statistics site
- **524-class ML model** -- MobileNetV2 INT8 quantized, with optional DirectML GPU acceleration
- **Automatic resolution detection** -- works out of the box for 28 common resolutions, with mathematical auto-scaling for others
- **Calibration wizard** -- 4-anchor calibration for non-standard resolution setups

### Quality of Life
- **Dark mode** -- follows your system theme, or set manually to light/dark
- **English & Russian** -- full interface localization
- **Auto-updater** -- in-app notifications when a new version is available
- **Database backups** -- automatic backups on startup, manual backup/restore from Settings
- **Windowed mode** -- automatic game window tracking for non-fullscreen setups

## Installation

### From Release (Recommended)

1. Download the latest installer from [Releases](https://github.com/Tiarin-Hino/ability-draft-plus/releases)
2. Run the installer -- choose your install directory
3. Launch **Dota 2 Ability Draft Plus** from the Start Menu or Desktop shortcut

### From Source

```bash
git clone https://github.com/Tiarin-Hino/ability-draft-plus.git
cd ability-draft-plus
npm install
npm run dev
```

## Usage

### First Time Setup

1. Launch the application
2. Go to the **Data** page in the sidebar
3. Click **Update Windrun Data** to fetch the latest ability and hero statistics from Windrun.io
4. Wait for all three phases to complete (abilities, synergy pairs, triplets)

### During a Game

1. Click **Activate Overlay** on the Dashboard before starting the game or after starting it but before queueing
2. The overlay will appear on top of your game
3. Queue for an **Ability Draft** match in Dota 2
4. When the draft screen appears and is fully loaded click **Initial Scan** on the overlay control panel (top-right corner)
5. Review the highlighted abilities in the pool:
   - **Green shimmer** -- general top-tier picks (highest combined winrate + pick priority score)
   - **Blue/teal shimmer** -- synergy suggestions (abilities that pair well with your already-picked abilities, shown after selecting My Spot)
   - **Gold shimmer** -- top-tier hero model (on the hero model slots)
   - **Solid teal border** -- your own picked abilities (after selecting My Spot)
   - **Solid green border** -- your selected hero model (after selecting My Model)
6. Hover abilities for detailed tooltips with synergy information
7. Use the **OP Combos** and **Trap Combos** panels for combination analysis
8. After abilities are drafted, click **Rescan** to update recommendations
9. Click **Close** to dismiss the overlay or **Reset** to closes scan but leave overlay open

### Selecting Your Hero

- Click **My Spot** on a hero position to tell the app at which position you're playing -- this personalizes recommendations to show synergies with your already-picked abilities
- Click **My Model** on a hero model to indicate which hero model is yours

### Resolution Support

The app automatically detects your game resolution and selects the correct coordinate layout. Pre-mapped coordinates are included for 28 common resolutions (1920x1080, 2560x1440, 3840x2160, ultrawide, and more). For resolutions without a preset, the app mathematically scales coordinates from the nearest base resolution for your aspect ratio family. No manual setup is needed in the vast majority of cases.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 40 |
| Frontend | React 19 + shadcn/ui + Tailwind CSS v4 |
| State | Zustand + @zubridge/electron |
| Build | electron-vite |
| Database | Drizzle ORM + sql.js (WASM) |
| ML | ONNX Runtime + DirectML (INT8 quantized MobileNetV2) |
| Testing | Vitest (381 tests) + Playwright |
| Logging | electron-log v5 |
| i18n | i18next + react-i18next |

## Development

### Prerequisites

- Node.js 20+
- npm 10+

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build all targets (main, preload, renderer) |
| `npm run build:dist` | Build and package as Windows installer |
| `npm start` | Run the built application |
| `npm test` | Run all unit/integration tests |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint linting |
| `npm run format` | Prettier formatting |

### Project Structure

```
src/
  core/          Pure TypeScript domain logic (zero Electron imports)
    database/    Drizzle ORM schema and repositories
    domain/      Business logic (scoring, synergies, scan processing)
    ml/          ONNX Runtime classifier and image preprocessing
    resolution/  Coordinate mapping and mathematical scaling
    scraper/     Windrun.io API client and data transformer
  main/          Electron main process
    ipc/         IPC handler registration
    services/    Window management, ML, screenshots, scraping, etc.
    store/       Zustand app store + draft store
    workers/     ML worker thread
  preload/       Context-isolated preload scripts
  renderer/
    control-panel/   Main application window (React SPA)
    overlay/         Game overlay window (transparent, click-through)
  shared/        Types and constants shared between processes
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed technical documentation.

## License

[ISC](LICENSE)

## Author

Tiarin Hino
