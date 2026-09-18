# Twitch Extension (streamer edition)

Viewers of a streamer running Ability Draft Plus get a clickable layer over the draft:
every pool ability and hero model opens Dota info (description, cooldown, mana, Scepter /
Shard), Windrun stats and the combinations available in *this* pool; once the game starts,
the top-bar portraits open each player's draft, "Show all picks" lists all ten, and "Draft
overview" shows the full pool with the pick order.

It is a **transport swap** of the Streamer View (`docs/STREAMER_VIEW.md`): the same built
board state, projected to two payloads and delivered through Twitch instead of local SSE.

```
scan/rescan/GSI ─► stream-server-service.buildState()  (StreamBoardState, unchanged)
                        │ subscribeState()
                        ▼
      twitch-publisher-service ── twitch-projection.ts ─► compact (<5 KB) + rich
                        │ POST /twitch/channels/{id}/publish  (bearer channel token)
                        ▼
      EBS Lambda (twitch/ebs) ── DynamoDB ── Helix PubSub ─► viewers (twitch/frontend)
                                                               ├ delay buffer (hlsLatencyBroadcaster)
                                                               ├ GET .../compact (late join)
                                                               ├ GET .../state   (rich, per draft)
                                                               └ catalog-<hash>.json (Dota text)
```

## Pieces

| Where | What |
|---|---|
| `src/shared/types/twitch.ts` | Wire contract (`TwitchCompactState`, `TwitchRichState`, `TwitchLiveState`, pairing/publish types), `TWITCH_PROTOCOL_VERSION` |
| `src/core/domain/twitch-live-projection.ts` | Pure caster-telemetry projection (slot→row placement, flag packing, size-degrading encoder) |
| `src/core/domain/twitch-projection.ts` | Pure projection: pool index map, compact builder + size-degrading encoder, rich builder (geometry, synergy graph), phase state machine |
| `src/main/services/twitch-publisher-service.ts` | Subscribes to the stream server; debounce/coalesce, revisions, persistence (`userData/twitch-state.json`), retries, pairing |
| `src/main/services/twitch-ebs-client.ts` | HTTPS client for the EBS |
| `src/main/ipc/twitch-handlers.ts` + `twitch:*` in `src/shared/ipc/api.ts` | Pairing, toggle, test publish |
| `control-panel/.../streaming/twitch-card.tsx` | Streaming page card (8 locales, `streaming.json` → `twitch.*`) |
| `twitch/ebs/` | Lambda EBS (SAM), DynamoDB, JWT, Helix relay, dev server — see its README |
| `twitch/catalog/` | Dota game-data catalog build from OpenDota dotaconstants — see below |
| `twitch/frontend/` | Extension frontend (video overlay + config page) — see its README |

The `twitch/*` packages have their own `package.json` and import **types only** from
`src/shared` by relative path. electron-builder ships `out/**`, so nothing under `twitch/`
enters the installer.

## Protocol in one paragraph

Twitch Extension PubSub caps a message at 5 KB. The **compact** state (everything that
changes during a draft: pool names + picked bit masks, player picks as pool indices, the
attributed feed, phase, draft id, revision, send time) is what rides PubSub; the encoder
in `twitch-projection.ts` strips player names, then the feed, if a pathological draft still
exceeds `TWITCH_COMPACT_MAX_BYTES`. The **rich** state (stable per draft: Windrun numbers,
the pool-internal synergy graph, normalized slot geometry, thresholds, names) is uploaded
once per draft revision and fetched by viewers over HTTPS. The frontend derives "still in
pool", partner lists and OP/trap panels itself from compact + rich.

Phases: `waiting` → `drafting` (initial scan) → `ingame` (overlay reset/close, or GSI
leaves hero selection) → `ended` (POST_GAME, app quit, or a 3 h stale snapshot). A new
match's hero selection returns to `waiting` so the old board disappears. The in-game
snapshot survives overlay resets and app restarts (persisted), mirroring the Picks View.

## Streamer setup

1. Install the extension on the channel, open its configuration page, press **Get pairing
   code**.
2. In the app: Streaming → **Twitch extension** → paste the code → **Pair**.
3. Turn on **Broadcast the draft to Twitch**. The stream server must be running for
   GSI-driven phases (it is the GSI ingest); OBS is not required.
   Don't want the overlay on your own screen? Streaming → **Background mode** runs the
   session with the overlay never shown (`docs/STREAMER_VIEW.md`); publishing is
   unaffected.
4. Optional: if the game is not the full stream canvas, describe the game rectangle on the
   configuration page; fine-tune the in-game top bar there too.

Pick order in the overview needs the app's automatic draft tracking (experimental
setting); without it the overview shows the pool and final picks only.

## Caster edition (in-game telemetry)

While the app is **spectating**, viewers get a *Scoreboard* button in game: net worth per
player and per team, K/D/A, GPM/XPM, hero damage dealt and taken, level, Aghanim's scepter
and shard, buyback state, and the full item build. Valve exposes all ten players to
observers only, so a *playing* streamer never sees this panel — their viewers keep the
draft board, pool and pick order exactly as before.

```
GSI (allplayers + items) ─► parser (GsiPlayerLive)
                              │  slot → draft row (slot-row-correlation)
                              ▼
                   twitch-live-projection ─► TwitchLiveState (~2 KB)
                              │  every 2 s, 'ingame' phase only
                              ▼
                   EBS relay (not stored) ─► PubSub ─► delay buffer ─► CasterPanel
```

Design points worth keeping:

- **Its own message, not a wider compact.** The compact is a full snapshot with content-key
  dedupe; folding per-second numbers into it would force a send every tick and re-transmit
  ~3.6 KB of unchanged draft state to carry ~1 KB of new numbers.
- **2-second cadence.** Twitch allows 1 PubSub message per second per channel, so 1 Hz sits
  exactly on the limit and jitter earns `429`s. Viewers are 10–30 s behind the broadcast
  anyway. Telemetry only sends in `ingame`, where the draft path is idle, so the two never
  contend despite sharing the budget.
- **Not stored by the EBS.** Two-second-old net worth is worthless; a late joiner waits for
  the next tick rather than being served a stale one.
- **No retries.** A skipped tick is replaced by a fresher one two seconds later.
- **Keyed by draft row**, like every other payload, and placed through the learned slot↔row
  mapping. An unmapped player is omitted rather than guessed.
- **Item art** comes straight from the already-allowlisted image domain
  (`cdn.cloudflare.steamstatic.com/.../items/<name>.png`), so items need no catalog entry.

Requires `"items" "1"` in the GSI cfg — an installed cfg written before this feature lacks
it, and the Streaming page's GSI card detects that and prompts for a reinstall (then
restart Dota).

## In-game seats while playing

The top bar is in lobby order, the draft in pick order, and a *playing* client's GSI only
reports its own hero, so nothing in GSI says which portrait belongs to which draft row.
`topbar-seat-service` captures the game once in `PRE_GAME`/`GAME_IN_PROGRESS` and matches
each of the ten portraits against the CDN art of the models its team drafted, solved as a
one-to-one assignment per team (`core/domain/topbar-seats.ts`,
`core/ml/topbar-portraits.ts`). It retries every 5 s until all ten are identified (dead
heroes are greyed and fail to match), merging results across captures, and patches
`seats` into the publisher's last compact — the draft session has already been reset by
overlay auto-close at that point.

- **Keyed by model, not player.** A drafted model keeps its drafted abilities through a
  swap, and the portrait shows the model, so swaps need no special handling.
- **Always filled.** The released extension draws nothing at all for a seat without a
  row, so once at least one portrait is recognised (a capture taken before the HUD draws
  matches nothing, and is not sent), any seat not confidently matched is filled: the local player's seat (paired
  with the row that drafted the hero they *control*), elimination within the team, then
  remaining rows in order. Never across teams.
- Validated on a live 2560×1440 frame: 10/10, weakest correct portrait 0.54 (Slardar,
  whose in-game portrait uses different art than the CDN image).

## Catalog (Dota text data)

The app holds no ability descriptions. `twitch/catalog/build-catalog.mjs` fetches
OpenDota's dotaconstants (`abilities`, `hero_abilities`, `heroes`, `aghs_desc`) and writes
`dist/catalog-<hash>.json` (~515 KB, ~120 KB gzipped) + `catalog-manifest.json`. Coverage
is asserted against `resources/model/class_names.json` and `resources/data/hero_meta.json`
(`npm test` in `twitch/catalog`); exceptions go in `allowed-missing.json` with a reason.

Publishing (tiarinhino.com repo, S3 + CloudFront):

1. Copy `dist/catalog-<hash>.json` and `dist/catalog-manifest.json` to
   `public/data/twitch/`. Hashed files are immutable — never delete old ones (viewers with
   a cached manifest keep working); the manifest is the only short-cache file.
2. In `deploy.yml`, add `--include "data/twitch/catalog-*.json"` to the immutable
   (`max-age=31536000`) sync so the hashed catalogs get long caching; the manifest keeps
   the existing `*.json` `max-age=0,must-revalidate` rule.
3. **CORS is required** — the extension runs on `https://<clientId>.ext-twitch.tv`.
   Either add `access-control-allow-origin: *` for `/data/twitch/*` in the CloudFront
   security-headers function, or set an S3 CORS rule (`GET` from `*`) and forward the
   `Origin` header in the cache policy. Verify:
   `curl -sI -H "Origin: https://x.ext-twitch.tv" https://tiarinhino.com/data/twitch/catalog-manifest.json | grep -i access-control`.

Rebuild after Dota patches (dotaconstants master can lag a patch by days; missing new
abilities show "Dota data not available yet" while Windrun stats still work).

## Dev loop

```bash
# EBS
cd twitch/ebs && npm install && npm run dev        # http://127.0.0.1:8787/twitch
# app: TWITCH_EBS_URL=http://127.0.0.1:8787/twitch in .env, pair with
#      curl http://127.0.0.1:8787/dev/pair-code?channelId=123
# frontend
cd twitch/frontend && npm install && npm run dev   # https://localhost:8080
#   ?demo=1 | ingame | waiting | ended | timeline&latency=4   (no backend needed)
#   ?ebs=http://127.0.0.1:8787/twitch                          (real flow, local EBS)
node scripts/smoke.mjs                             # Playwright checks of the built bundle
```

## Twitch developer console checklist

- Extension type: **Video – Fullscreen** overlay + **Config** view; upload the zip from
  `npm run pack` (unminified on purpose — review rule; size-guarded < 900 KB).
- Capabilities: allowlist fetch domains `tiarinhino.com` and the EBS host
  (`r8xvmhusi7.execute-api.eu-north-1.amazonaws.com`); image domain
  `cdn.cloudflare.steamstatic.com`.
- Secrets: put the extension secret, client id and owner id in SSM (`twitch/ebs/README.md`),
  then `sam deploy` from `twitch/ebs`.
- Review requires a live channel showing the overlay in use.

## Known gaps / verify on first real run

- In-game top-bar portrait geometry (`twitch/frontend/src/geometry/topbar-1080p.ts`) was
  measured from an in-game screenshot (2026-09-03); the broadcaster fine-tune still
  covers per-setup differences (notably Dota's HUD-scale setting).
- Windowed-mode games captured with Display Capture need the game-rect calibration
  (coords are relative to the game client area).
- Channel display name on pairing needs the extension **client secret** in SSM
  (client-credentials lookup); without it the card shows "Channel <id>".
- Player names in spectate resolve progressively: a draft row can only be identified once
  its player has drafted a hero model (the hero name on the card is the join key), with the
  last player in each team half filled in by elimination. All ten resolve by the end of a
  draft; earlier names would need the player-name strip OCR'd as well.
- A mobile view is not built.
- **TODO (spectate, tournaments): player names after a hero swap.** Abilities and
  portraits stay correct through a swap (they follow the model), but the player name
  shown with them is still the *drafter's*, not the player now controlling the hero —
  in the pick columns and the scoreboard. Spectator GSI reports the name per top-bar
  slot, so the fix is to label seats with the GSI slot name instead of the draft row's.
