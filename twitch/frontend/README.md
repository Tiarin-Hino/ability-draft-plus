# Twitch extension frontend

Video-overlay extension for streamers running Ability Draft Plus. Viewers click the pool
abilities and hero models on the streamer's draft screen (Dota info, Windrun stats, pool
combinations), then the top-bar portraits in game (each player's draft, expand all, draft
overview with pick order).

- `video_overlay.html` — the overlay (desktop). Root is click-through; hit regions opt in.
- `config.html` — broadcaster page: pairing code for the desktop app, scene calibration.
- Data: compact states over Twitch PubSub (delay-buffered against `hlsLatencyBroadcaster`),
  rich state + late-join snapshot from the EBS, Dota catalog from tiarinhino.com.
- Protocol: `src/shared/types/twitch.ts` (type-only import from the app repo).

## Develop

```bash
cd twitch/frontend
npm install
npm run gen:geometry     # regenerates src/geometry/fallback-1080p.ts from the app's layout preset
npm run dev              # https://localhost:8080 (self-signed cert — accept it once) — for ?demo work
npm run local-test       # build + preview on https://localhost:8080 — use THIS for Twitch Local Test
```

Open `https://localhost:8080/video_overlay.html?demo=1` — no Twitch, no backend:

| Query | Shows |
|---|---|
| `?demo=1` | mid-draft board, 48 + 12 hit regions over a blank frame |
| `?demo=ingame` / `?demo=ended` | in-game portraits, player cards, expand all |
| `?demo=waiting` | launcher only |
| `?demo=timeline&latency=4` | picks replayed one by one, each held back by the latency |
| `?ebs=http://127.0.0.1:8787/twitch` | real flow against the local EBS dev server |
| `?catalog=<manifest url>` | alternative catalog manifest |

Tests: `npm test` (delay buffer, geometry, arrangement pin, catalog loader, selectors).

## Twitch developer console

1. Create the extension (type: **Video - Fullscreen** overlay + **Config** view).
2. Capabilities → allowlist the fetch domains: `tiarinhino.com`, the EBS API host
   (`r8xvmhusi7.execute-api.eu-north-1.amazonaws.com`); image domain:
   `cdn.cloudflare.steamstatic.com`.
3. Local Test: Testing Base URI `https://localhost:8080/`, then run **`npm run local-test`**
   (production build served by `vite preview`, HTTPS). Do NOT use `npm run dev` inside
   Twitch: the dev server's React fast-refresh injects an inline script that Twitch's CSP
   blocks, leaving the frame blank. Two Chrome hurdles, both ending in a blank frame plus
   the console warning "Extension Helper Library Not Loaded":
   - **Certificate**: a click-through exception on a self-signed cert does not extend to
     iframes, so use mkcert (see `vite.config.ts`) — and fully restart Chrome
     (`chrome://restart`) after `mkcert -install`; a running Chrome does not re-read the
     Windows trust store.
   - **Local Network Access** (Chrome 142+): the dashboard is a public site, so Chrome
     blocks its iframes from reaching localhost, and Twitch's supervisor iframe cannot
     request the permission (no `allow="local-network-access"`) — it fails silently, no
     prompt. For local testing set `chrome://flags/#local-network-access-check` to
     **Disabled** and restart Chrome; re-enable it when done. (The per-site permission in
     Chrome settings does not help — permission policy still blocks the nested iframe.)
4. Hosted Test / Release: `npm run build && npm run pack` → upload the zip. The build is
   unminified on purpose (review requirement) and guarded to stay under ~900 KB.

**The zip must be FLAT.** Twitch's ingestion keeps root-level files and silently drops
subdirectories — an upload containing `assets/` served both HTML files from the CDN and
404'd every script and stylesheet, so the extension rendered as a blank frame with nothing
in the version's status to suggest a problem (2026-09-04). The build therefore emits every
chunk and asset at the `dist` root (`build.rollupOptions.output` file-name patterns carry
no directory), and `pack.mjs` refuses to build a zip containing a nested path. Do not
"tidy up" the output back into `assets/`.

After any upload, confirm the assets actually landed before opening the dialog — the hash
is in the extension frame's URL in DevTools:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  "https://<client-id>.ext-twitch.tv/<client-id>/<version>/<hash>/vendor-<hash>.js"
```

## Submitting for review

The reviewer problem: the overlay renders nothing without a paired desktop app publishing
a live draft, and a reviewer cannot run Dota 2 and Ability Draft Plus. **`?demo=1` is the
answer** — it installs a mock Twitch helper and a full fake draft, so the hosted asset URL
opened directly in a browser shows the whole interface with no backend at all:

```
https://<client-id>.ext-twitch.tv/<client-id>/<version>/<hash>/video_overlay.html?demo=1
https://…/video_overlay.html?demo=ingame     the in-game overlay + Scoreboard
https://…/config.html                        broadcaster page (pairing needs Twitch)
```

Put those URLs in the review notes. The demo chunk is lazily imported and only ever loads
for `?demo=…`, so it costs viewers nothing and gives the reviewer a way in.

**Demo mode draws its own board** (`demoBoard` in the store, set by `startDemo` for the
`drafting` phase; rendered by `DraftOverlay`). Without it `?demo=1` opened standalone is a
BLANK WHITE PAGE — the overlay is transparent because it composites over the stream, so
with no video there is nothing but 60 invisible hit regions. That is the exact URL the
reviewer is handed, and it is indistinguishable from a broken extension (2026-09-05).

A screenshot behind the overlay was tried first and is the WRONG fix: a photo of one draft
under the fixtures of another disagrees with itself — the details panel named an ability
the tile beneath it did not show, and picked-markers sat between tiles. The board is
therefore generated from the demo's own pool, through the *same* `projectRects` output the
hit regions use, so tiles, names, markers and panels cannot drift apart. Icons come from
the already-allowlisted Valve CDN, so nothing is bundled. `ingame`/`ended` get no board:
they draw over the in-game top bar, where a pool would put a draft on top of gameplay.

The size guard excludes `demo-*` files from the budget — they are not part of a viewer's
initial load — and prints them separately instead.

Checklist before submitting:

- Allowlists in the console must match what the bundle actually references — currently
  fetch: `tiarinhino.com` (Dota catalog) and the EBS API host; images:
  `cdn.cloudflare.steamstatic.com` (ability, hero and item art). Verify with a grep of
  `dist/` after building rather than from memory.
- The EBS must be deployed with the caster-telemetry route, and the catalog published to
  `tiarinhino.com/data/twitch/` with CORS — a viewer with neither still sees the draft
  board, but items and Dota text quietly disappear.
- Browser storage to disclose: `adplus.ui.v1` (whether the launcher is minimised) and
  `adplus.catalog.v1` (cached Dota text). No viewer data is collected or sent anywhere —
  the extension only receives PubSub and fetches static JSON.

The in-game top-bar geometry (`src/geometry/topbar-1080p.ts`) was measured from an
in-game screenshot on 2026-09-03 (portrait pitch 63/1920, origins mirrored about the
centre; the vertical extent matched the earlier estimate). The broadcaster fine-tune
(config page) still absorbs per-setup differences such as Dota's HUD-scale setting.
