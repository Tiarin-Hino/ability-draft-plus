// @DEV-GUIDE: Pool-hero expansion of the pick-slot template candidates.
//
// Pick boxes are matched only against the draft's candidate names (see
// scan-trigger-service), which were built from the POOL SCAN plus names already
// read off pick boxes. That is complete only when the initial scan happens at
// draft start. Joining a draft mid-progress (spectating, app started late), the
// pool grid no longer shows the abilities already drafted — 34 of 48 were
// visible on 2026-10-24 — so those picks were NOT candidates, and their boxes
// were scored against the remaining pool only: the nearest wrong icon won with a
// clear margin (Overwhelming Odds on two players, Venomous Gale twice on one card).
//
// The draft's twelve HEROES are still known (model-tile reference matches, the
// hero-defining pool slots, card OCR for models already picked), and an AD pool
// is exactly those heroes' abilities. So every known pool hero's DB abilities
// join the candidates, typed by box (ultimate vs standard). In a normal draft
// this is (almost) the same set the pool scan produced; it only adds what the
// pool grid no longer shows or failed to read.

export interface PickCandidateSets {
  standard: Set<string>
  ultimates: Set<string>
}

export interface HeroAbility {
  name: string
  isUltimate: boolean
}

/**
 * Adds every ability of the given pool heroes to the candidate sets (mutates
 * them; they only grow within a draft). Returns the names that were new, so
 * the caller can fetch their icons.
 */
export function addPoolHeroAbilities(
  sets: PickCandidateSets,
  heroNames: Iterable<string>,
  abilitiesForHero: (heroName: string) => readonly HeroAbility[],
): string[] {
  const added: string[] = []
  for (const hero of heroNames) {
    for (const ability of abilitiesForHero(hero)) {
      const target = ability.isUltimate ? sets.ultimates : sets.standard
      if (target.has(ability.name)) continue
      target.add(ability.name)
      added.push(ability.name)
    }
  }
  return added
}
