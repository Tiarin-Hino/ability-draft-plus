import type { TopBarGeometry } from './types'

// In-game top bar (Dota HUD, 1920x1080): 5 Radiant portraits left of the clock, 5 Dire
// portraits right of it. Fractions of the game frame.
//
// MEASURED (2026-09-03) from an in-game 2560x1440 screenshot, replacing the original
// estimates. Method: the portrait boxes abut with thin dark separators, so the strip is
// periodic — the pitch came from an autocorrelation of the column-brightness profile
// over the portrait band and the phase from a comb fit on the separators (colour/run
// detection is biased by whatever art a given hero has). Pitch 84 px @1440 = 63 @1920;
// the vertical extent measured y=4 h=35 @1080, i.e. the previous estimates were already
// right and only the horizontal pitch/origins moved (STEP 66 -> 63, so the old error
// GREW along each row). The bar is centred, so the two origins are mirrored about
// x=960: measured radiant 542.9 and dire 1060.5 imply 544 / 1062 once symmetry is
// enforced (~1.5 px of fit noise split between them).
// The bar is horizontally centered, so 21:9 / 4:3 frames only shift the fractions by the
// letterbox math already applied by project.ts. Dota's HUD-scale setting is not covered
// by this: the broadcaster's in-game calibration (dx/dy/scale on the config page)
// absorbs that.

const PORTRAIT_W = 62 / 1920
const PORTRAIT_H = 35 / 1080
const PORTRAIT_Y = 4 / 1080
const RADIANT_START = 544 / 1920
const DIRE_START = 1062 / 1920
const STEP = 63 / 1920

export const TOPBAR_1080P: TopBarGeometry = {
  frame: { w: 1920, h: 1080 },
  portraits: [
    ...Array.from({ length: 5 }, (_, i) => [
      Math.round((RADIANT_START + i * STEP) * 10000) / 10000,
      PORTRAIT_Y,
      PORTRAIT_W,
      PORTRAIT_H,
    ]),
    ...Array.from({ length: 5 }, (_, i) => [
      Math.round((DIRE_START + i * STEP) * 10000) / 10000,
      PORTRAIT_Y,
      PORTRAIT_W,
      PORTRAIT_H,
    ]),
  ] as TopBarGeometry['portraits'],
  clock: [900 / 1920, 0, 120 / 1920, 44 / 1080],
}
