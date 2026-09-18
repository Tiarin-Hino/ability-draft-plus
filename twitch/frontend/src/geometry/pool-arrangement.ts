// The game's canonical pool arrangement (mirrors src/renderer/stream/src/components/PoolBoard.tsx;
// pinned by test/pool-arrangement.test.ts against the 1080p layout preset).
// Ultimates: two rows of six hero orders; standard rows: six pairs (left hero, right hero),
// each hero's Q/W/E beside its portrait.

export const ULT_ROWS: readonly (readonly number[])[] = [
  [0, 1, 2, 7, 6, 5],
  [3, 4, 10, 11, 9, 8],
]

export const STD_PAIRS: readonly (readonly [number, number])[] = [
  [0, 5],
  [1, 6],
  [2, 7],
  [3, 8],
  [4, 9],
  [10, 11],
]
