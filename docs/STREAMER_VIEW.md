# Streamer View

A locally hosted, tournament-style draft board for broadcasting Ability Draft games.
The app serves a web page that re-renders the live draft with official ability icons,
high contrast, and stat panels — designed to be used as an OBS browser source instead
of (or on top of) the game's own draft screen.

## Quick start (streamer)

1. Open the **Streaming** page in the control panel and press **Start server**.
2. Copy the board URL (default `http://localhost:58873/stream`).
3. In OBS: *Sources → Add → Browser*, paste the URL, size **1920×1080**.
4. In game, activate the overlay and scan the draft (**Ctrl+Shift+S**).
   The board renders the pool; rescans (**Ctrl+Shift+R**) grey out picked abilities
   and fill the player rows.

Background modes via query parameter:

| URL suffix | Background |
|---|---|
| *(none)* / `?bg=transparent` | Transparent (OBS composites it) |
| `?bg=dark` | Solid dark panel |
| `?bg=chroma` | `#00FF00` green screen |

Recommended: press **Prefetch all icons** once (Streaming page) so every ability icon
is cached locally before your first live draft.

## What the board shows

- **12 hero rows** — portrait + Q/W/E + ultimate tiles with winrates; top-tier picks
  get a gold border; picked abilities grey out on rescan.
- **Stat panels** — highest-winrate abilities still in the pool, strongest (OP) and
  worst (trap) combinations available, computed from the app's Windrun dataset.
- **10 player rows** (Radiant / Dire) — picked abilities and a computed **draft score**
  per player (mean normalized winrate + pair-synergy lift; confidence grows with pick
  count).
- Player names appear when GSI is connected (see below).

## Game State Integration (GSI)

GSI lets Dota itself send player names, game phase, and clock to the board. It does
**not** carry the draft pool or picks — the ML scan remains the source for those.

Setup (Streaming page → GSI card):

1. **Install config file** — the app locates your Dota installation (Steam registry +
   library folders) and writes
   `game/dota/cfg/gamestate_integration/gamestate_integration_adplus.cfg`.
   Use **Browse…** if detection fails.
2. **Restart Dota 2.** The card's badge turns *Connected* once payloads arrive.

Caveats:

- The cfg pins the server **port** — reinstall it after changing the port.
- All 10 player names are only available while **spectating/casting**. When playing,
  Dota reports only your own identity.

## Experimental: automatic draft tracking

Off by default (Streaming page → *Auto draft tracking*). When enabled, during the
draft the app rescans every 5 seconds and attributes each ability that left the pool
to the player whose turn it was (turn clock anchored on GSI's hero-selection
transition). This produces an ordered, attributed pick feed on the stream board.

Things to know before enabling:

- Your mouse is **never touched**. Instead, every rescan is validated before being
  applied: if an in-game hover tooltip covers the pick slots, that capture is
  discarded automatically and retried a few seconds later (picks never un-pick, so
  a previously recognized pick slot reading as unknown means the frame was obscured).
- The initial pool scan (**Ctrl+Shift+S**) is still manual.
- Turns where no ability left the pool are recorded as *model selection* markers —
  hero-model pick recognition is planned future work.
- The Ability Draft turn timings used by the clock are still being validated against
  real lobbies; expect attribution quirks (they are logged, and the board's snapshot
  view is unaffected).

## Architecture notes (maintainers)

- Server: `src/main/services/stream-server-service.ts` — plain Node `http`, bound to
  `127.0.0.1` only. Routes: static SPA (from `out/renderer`, asar-aware `readFile`),
  `GET /events` (SSE, versioned full-state envelopes), `GET /icons/*`
  (`icon-cache-service`, Valve CDN download-through cache in `userData/stream-icons`),
  `POST /gsi` (parser in `src/core/gsi/`).
- Board assembly is pure: `src/core/domain/stream-board.ts` builds the grid from the
  draft's *initial* scan payload (rescans subtract picked abilities from pool arrays)
  and the latest payload for picks/panels.
- The SPA (`src/renderer/stream/`) has **no preload and no electron API** — it runs in
  OBS's Chromium; its only I/O is `EventSource('/events')` and `<img>` tags.
- The wire protocol is versioned (`StreamEnvelope.v`) for future consumers — e.g. a
  Twitch extension backend.
- Dev mode: the SPA lives on the electron-vite dev server, so `/stream` redirects
  there with `?api=<server origin>` for the SSE connection.

## Planned (not yet built)

- Hero-model pick recognition (the `modelSelectionMarker` events mark the hook).
- Twitch extension letting viewers browse pool abilities themselves.
- Caster-triggered short clips explaining broken/bugged abilities during the draft.
