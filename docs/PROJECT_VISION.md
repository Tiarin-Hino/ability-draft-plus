# Project Vision

## The Idea

Dota 2 has a game mode called "Ability Draft" where 12 heroes are randomly assigned to players, and their abilities are pooled together for players to draft. Players take turns picking abilities from the pool to build custom hero builds. This creates a unique mini-game within Dota where knowing ability synergies, win rates, and optimal picks is extremely valuable.

**Ability Draft Plus** is an AI-powered desktop overlay that helps players make optimal picks during the draft phase by:

1. Automatically identifying all abilities in the pool using computer vision (ML)
2. Cross-referencing identified abilities against a statistical database
3. Displaying real-time recommendations directly on the game screen

## Target Audience

- Dota 2 players who enjoy Ability Draft mode
- Players who want to improve their draft picks with data-driven decisions
- Both casual players (who want simple "pick this" recommendations) and experienced players (who want detailed synergy data)
- Currently Windows-only users

## Design Principles

1. **UI/UX**: Professional gaming tool quality -- comparable to Mobalytics, Blitz.gg, or Porofessor
2. **Stability**: No crashes, no memory leaks, graceful error handling, meaningful error messages
3. **Performance**: Fast scan times, responsive UI, reasonable memory footprint
4. **Onboarding**: New users should understand what to do without reading a manual
5. **Maintainability**: Clean code architecture with separation of concerns

## Core Value Proposition

During an Ability Draft, players have limited time to pick abilities. The app provides:

- **Speed**: One-click scan identifies all 48 abilities in the pool
- **Knowledge**: Statistical data that would take hours to research manually
- **Synergies**: Identifies which abilities work well together (OP combos) and which don't (traps)
- **Personalization**: Adjusts recommendations based on the user's hero and already-picked abilities

## Data Pipeline

```
Windrun.io API ──► Scraper ──► SQLite Database (local)
                                      │
Game Screen ──► Screenshot ──► ML Model ──► Ability IDs
                                      │
                               Scan Processor (synergy enrichment, scoring)
                                      │
                               Overlay UI (tooltips, panels, recommendations)
```

## Key Technical Challenges

1. **Real-time ML inference** in a desktop app (ONNX Runtime with DirectML GPU acceleration)
2. **Transparent overlay** that sits on top of a fullscreen game (Electron always-on-top window)
3. **Click-through windows** that selectively capture mouse events (Win32 setIgnoreMouseEvents)
4. **Screen resolution handling** -- different resolutions have different ability icon positions (mathematical scaling + preset coordinates)
5. **Data freshness** -- statistics change as the game evolves (API-based scraper with staleness detection)
