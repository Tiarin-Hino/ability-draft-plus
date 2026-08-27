// @DEV-GUIDE: Horizontal focus overrides for the near-square portrait crop. The strip
// crops the official 16:9 portraits to a 1.2:1 box with object-fit: cover; most faces
// sit in the horizontal center of Valve's art, but a few don't — verified against a
// contact sheet of ALL cached portraits (2026-08-27). Values are the object-position X
// (0% = left edge of the art). Add entries here when Valve art puts a face off-center;
// keys are npc short names as they appear in /icons/heroes/<npc>.png paths.

const PORTRAIT_FOCUS: Record<string, number> = {
  jakiro: 24, // two heads at the art's edges; frame the ice head
  alchemist: 66, // Razzil rides high-right on the ogre
  grimstroke: 62,
  templar_assassin: 60,
  lina: 30,
  ogre_magi: 30, // both heads sit left of center
  magnataur: 32,
  luna: 36,
  dark_seer: 40,
  abaddon: 40,
}

/** object-position for a portrait, from its server-relative icon path. */
export function portraitObjectPosition(portraitPath: string): string {
  const npc = /\/heroes\/([a-z0-9_]+)\.png$/.exec(portraitPath)?.[1]
  const focus = npc !== undefined ? PORTRAIT_FOCUS[npc] : undefined
  return focus !== undefined ? `${focus}% center` : 'center'
}
