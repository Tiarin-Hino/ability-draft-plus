# Design sources (streamer view)

AI-generated art sources for the stream board. These files are INPUTS — they are
processed into the shipped assets by dev-time scripts and both sides are
committed:

| Source | Script | Output |
|---|---|---|
| `fonts/display-caps.png` + `fonts/punctuation.png` | `scripts/build-stream-fonts.mjs` | `src/renderer/stream/src/assets/fonts/adplus-display.otf` |
| `fonts/score-digits.png` (+ `.` `-` from punctuation) | `scripts/build-stream-fonts.mjs` | `src/renderer/stream/src/assets/fonts/adplus-score.otf` |
| `ui/tile-frames.png` | `scripts/build-stream-ui-assets.mjs` | `.../assets/ui/tile-frame-*.png` (5 states) |
| `ui/topbar-medallion.png` | `scripts/build-stream-ui-assets.mjs` | `.../assets/ui/clock-medallion.png`, `gem-radiant.png`, `gem-dire.png` |
| `sigils/sigils-mono.png` | `scripts/build-stream-ui-assets.mjs` | `.../assets/ui/sigil-radiant.png`, `sigil-dire.png` |
| `sigils/sigils-color.png` | `scripts/build-stream-ui-assets.mjs` | `.../assets/ui/crest-radiant.png`, `crest-dire.png` |

Regenerate everything with `npm run build:stream-assets` after replacing a
source sheet. The scripts segment sheets by projection profiles, so keep the
layout conventions (glyph grid rows, 5 frames in a row, sigil order
radiant-then-dire) when regenerating art.

Backdrop art ships directly (no processing): `resources/data/stream/board-bg.jpg`.
