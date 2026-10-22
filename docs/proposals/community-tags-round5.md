# Community tags, round 5 — FINAL specification

Status: AGREED 2026-10-21 after two review rounds (152 + 55 items, every one
settled; answers archived in `community-tags-round5-review1.json`, the item list in
`community-tags-round5-items.json`, the review page at
https://claude.ai/artifact/MeccZyzu1WiTbTQXhcTD8W). Implementation status:
step 1 (board tag profile, `combos` / `viaUpgrade` / `with` parsing, mechanical
debuff tags) shipped 2026-10-22 — measured on the live dataset:
debuff_dispellable 129, debuff_strong_only 46, bkb_piercing 131 (the rule needs
an enemy target OR a CC tag, so target-less DoTs such as Fury Swipes or Firestorm
are missed until the amp_* family joins DEBUFF_MARKER_TAGS in step 3). Step 2
(reposition split + knockback, dispel split + demand boost, override seeds for
the 66 agreed mappings in §3.1/§3.4) shipped 2026-10-22; live counts:
reposition_enemy 26 (25 + Nether Strike's conditional), reposition_ally 14,
knockback 5, dispel_self 19, dispel_ally 7, purge_enemy 8. The Lab's accepted
`move_enemy` / `dispel` assignments are now SUPERSEDED_TAGS in the import script
(ignored on import; the curated split wins) until the Lab catalog ships the new
names. Steps 3-5 pending.
Source: Tag Lab export version 2 (513 abilities, 30-tag vocab) vs the shipped
version 1 (25 tags). The app currently DROPS the five new tags at load.

## 1. Vocabulary changes

| Community tag | Outcome |
|---|---|
| `move_enemy` | REPLACED by `reposition_enemy`, `reposition_ally`, `knockback` (rename alias → reposition_enemy) |
| `damage_amp` | REPLACED by `spell_steroid`, `amp_physical`, `amp_magical`, `amp_all` (umbrella derivable in the Lab) |
| `good_counter` | RENAMED `good_deny` + a curated `combos:` relation |
| `pick_asap` | KEPT, visual only (border + tooltip), import-time staleness audit |
| `dispel` | REPLACED by `dispel_self`, `dispel_ally`, `purge_enemy` (rename alias → dispel_self) + mechanical `debuff_dispellable` / `debuff_strong_only` |

Carrier counts after curation: amp_all 4, amp_magical 5, amp_physical 17, dispel_ally 7, dispel_self 19, good_deny 16, knockback 5, purge_enemy 8, reposition_ally 14, reposition_enemy 25, spell_steroid 6.

New dataset entry fields (all curated in `tag_overrides.json`, preserved by
`import_site_export.py` like `requires:`):

- `combos: ["<ability>" | "model:<hero>", ...]` — directional deny partners.
- `viaUpgrade: {"<tag>": "shard" | "scepter"}` — the tag is granted by an item
  upgrade. Counted at FULL value (decision: Shard is cheap and standard, Scepter
  worth it too); the tooltip says "with Shard" / "with Scepter".
- `with: {"<tag>": ["<ability>", ...]}` — the tag holds only while a listed
  ability is drafted by the same player (Nether Strike ↔ Greater Bash).

Mechanical tags (built by `build_ability_tags.py` from dotaconstants, hidden from
the Lab composer): `debuff_dispellable` (dispellable = Yes, enemy-targeting: 70
abilities), `debuff_strong_only` (48), `bkb_piercing` (from `bkbpierce`, for the
later counters work).

## 2. Scoring rules (all agreed)

### Shared plumbing
Board tag profile computed once per scan: tag counts over MY picks, TEAMMATES'
picks, ENEMY picks (the other five rows) and the UNPICKED pool, passed to the
scorer like the scarcity map. Enemy/team-aware terms are board facts and join the
role-independent set (apply with role mode off; golden tests zero them).

### Reposition (role layer only)
- `reposition_enemy`: new pos-4 need `catch` (priority 0.5, own scarcity key) +
  full-credit alternative for the pos-3 `initiation` need. Stacks with the
  hard_cc need when both tags are present.
- `reposition_ally`: full-credit alternative for the pos-5 `save` need
  (`covers:save:reposition_ally`) + plus accent for pos 4/5. No pos-1/2 minus.
- `knockback`: descriptive only in v1 (interrupt value goes to counters later).
- Gap-close stays mobility + initiation; no new tag.

### Damage amp
- Team amps (`amp_physical` / `amp_magical` / `amp_all`), role-independent:
  demand(physical) = steroid count over my + teammates' picks; demand(magical) =
  nuke + teamfight_ult count; amp_all uses both.
  `boost = AMP_TEAM_WEIGHT (0.06) × clamp(demand / 3, 0, 1)`; zero demand = zero
  boost; tooltip names the picks amplified. Teammates DO count (the amp lands on
  the enemy). Plus accent for pos 4/5.
- `spell_steroid`: plus accent for pos 2; full-credit alternative for the pos-2
  `nuke` need ONLY when the drafter already owns a nuke (soft gate).
- Self-only amps needing specific partners (Sticky Napalm, Liquid Frost) are NOT
  amp-tagged: they are combo hubs in `combos:`. Self-only amps on a right-click
  kit (Flesh Golem, Wild Axes' BM side) stay plain steroid.

### Combo deny
- `good_deny` = "playable on its own, so the deny is not a dead pick".
- Combo links are CURATED ONLY (`combos:`); the synergy table is a suggestion
  source inside the Lab composer and never triggers anything in the app.
- For each unpicked candidate C with good_deny: if the ENEMY holds any listed
  partner (ability or model), show the deny marker, tooltip "deny: completes
  <partner> for row N", add `DENY_BOOST` (0.05), role-independent, outside the
  role cap, only while the enemy still has turns. No partner held = nothing.
- Guard: the boost applies only when C's own global score is above the pool
  median; below it the marker and tooltip still show.

### pick_asap
- Own border treatment + tooltip line "Community: pick as soon as possible" with
  the live numbers. No score term.
- `import_site_export.py` prints carriers failing `wr ≥ 0.52 and avg pick ≤ 10`
  as Lab review items (today: Forge Spirit; Shadow Dance borderline).

### Dispel
- Demand: `demand = enemy.debuff_dispellable + 0.5 × pool.debuff_dispellable`;
  `boost = DISPEL_WEIGHT (0.06) × clamp(demand / 4, 0, 1.5)` on `dispel_ally` and
  `dispel_self`; tooltip "dispels: …". `purge_enemy` demand = enemy steroid +
  summon + illusion counts. Zero demand = zero boost.
- Role layer: `dispel_ally` covers the pos-5 `save` need + pos-4/5 accent;
  `dispel_self` is a full-credit alternative for pos-1 survival / pos-3
  durability.
- Debuff immunity (Repel, Rolling Thunder) counts as a dispel for this purpose.

## 3. Ability mappings

### 3.1 Reposition / knockback
| Ability | Tags | Removed | Note |
|---|---|---|---|
| Adaptive Strike | `knockback` |  | Knockback with the stun. |
| Aether Remnant | `reposition_enemy` |  | Pulls units that cross its gaze into the remnant. |
| Blinding Light | `reposition_enemy` |  | Knocks units back to the edge of the area. |
| Boulder Smash | `reposition_enemy`, `reposition_ally` |  | Pushes the target (enemy, ally or remnant) a long way: both tags. |
| Catchy Lick | `reposition_enemy`, `reposition_ally` |  | Pulls the target (ally or enemy) back a short distance: both tags. |
| Deafening Blast | `reposition_enemy` |  | Knocks enemies back along the wave. |
| Dispose | `reposition_enemy`, `reposition_ally` |  | Dispose: grabs ally or enemy and throws it behind her: both tags. |
| Firesnap Cookie | `reposition_enemy`, `reposition_ally` |  | Landing knocks enemies back; the cookie target (self/ally) jumps: both tags. |
| Flamebreak | `reposition_enemy` |  | Knockback away from the impact point. |
| Flaming Lasso | `reposition_enemy` | `move_enemy` | Drags the target in Batrider's wake. |
| Geomagnetic Grip | `reposition_ally` |  | Pulls an allied unit (or remnant) to Earth Spirit. |
| Glimpse | `reposition_enemy` | `move_enemy` | Teleports the target to where it was 4 s ago. |
| God's Rebuke | `knockback` |  | Knocks enemies back in the cone. |
| Gust | `knockback` | `move_enemy` | Knockback scaled by proximity. |
| Inner Fire | `knockback` |  | Knocks all nearby enemies to a fixed distance. |
| Meat Hook | `reposition_enemy`, `reposition_ally` | `move_enemy` | Pulls the hooked unit to Pudge. Also hooks allies: both tags. |
| Nether Strike | `reposition_enemy` only with spirit_breaker_greater_bash |  | Knockback exists only with Greater Bash drafted: conditional entry with: {reposition_enemy: ['spirit_breaker_greater_bash']}. |
| Nether Swap | `reposition_enemy`, `reposition_ally` |  | Swaps positions with friend or enemy: both tags. |
| Nightmare | `reposition_enemy`, `reposition_ally` | `move_enemy` | Vector-targeted slow move while asleep (your ruling: stays). |
| Onslaught | `reposition_enemy` |  | Knocks back enemies and allies in the charge path. |
| Power Cogs | `reposition_enemy` |  | Knocks back enemies touching a cog from outside; the trap itself holds. |
| Primal Roar | `reposition_enemy` |  | Pushes units aside in the shout's path (450). Minor displacement. |
| Rebound | `reposition_ally` (with shard) |  | Rebound carries the ally with Shard. Tagged per the upgrade policy, marked 'with Shard'. |
| Relocate | `reposition_ally` |  | Teleports Io and the tethered ally, then returns them. |
| Reverse Polarity | `reposition_enemy` | `move_enemy` | Pulls everyone in radius to Magnus. |
| Rolling Thunder | `reposition_enemy` |  | Rolling Thunder knocks struck enemies back. |
| Shockwave | `knockback` |  | Pulls enemies in the line toward Magnus (short). |
| Skewer | `reposition_enemy` | `move_enemy` | Drags heroes hit to the destination. |
| Snowball | `reposition_ally` |  | Carries allied heroes inside the snowball; enemies hit are stunned in place. |
| Sonic Wave | `reposition_enemy` |  | Pushes enemies back along the wave. |
| Spear of Mars | `reposition_enemy` | `move_enemy` | Carries the first hero hit until it pins. |
| Telekinesis | `reposition_enemy`, `reposition_ally` (with shard) |  | Lifts and throws an enemy; ally cast with Shard. |
| Toss | `reposition_enemy`, `reposition_ally` |  | Grabs the nearest unit, ally or enemy, and throws it: both tags. |
| Vacuum | `reposition_enemy` | `move_enemy` | Pulls every enemy in the area to a point. |
| X Marks the Spot | `reposition_enemy`, `reposition_ally` |  | Returns the target (ally or enemy) to the mark: both tags. |
| Arena Of Blood | — |  | Edge spears knock enemies back INTO the arena. Containment rather than catch. |
| Bushwhack | — | `move_enemy` | Drags trapped enemies to the tree. |
| Disruption | — |  | Banish in place, no movement. Exclusion to confirm (it keeps save_ally). |
| Electric Vortex | — |  | Pulls the enemy to Storm's location. |
| Fiend's Gate | — |  | Fiend's Gate: allies walk through the portal pair. |
| Grappling Claw | — |  | Kez pulls HIMSELF to the target. Self-mobility only; listed so you can confirm the exclusion. |
| Ice Vortex | — |  | dotaconstants lists a DRAG SPEED: current Vortex pulls units toward its center slowly. |
| Reality Rift | — |  | Pulls the target toward CK along the line. |
| Solar Guardian | — |  | Dawnbreaker flies to the ally; the ally does not move. Exclusion to confirm. |
| Tornado (AD) | — |  | Lifts in place and carries along the path only slightly. Displacement or not? |
| Wheel of Wonder | — |  | Knocks enemies aside on the way to the target. |

### 3.2 Damage amp
| Ability | Tags | Removed | Note |
|---|---|---|---|
| Acid Spray | `amp_physical` |  | Armor reduction + DPS in the area. NEW carrier. |
| Ancient Seal | `amp_magical` | `damage_amp` | Magic resistance reduction + silence. |
| Arcane Supremacy | `spell_steroid` | `damage_amp` | Self spell amp 11-26%. |
| Bloodrage | `spell_steroid` | `damage_amp` | Self (or ally) attack speed + spell damage. No longer castable on enemies. |
| Corrosive Haze | `amp_physical` | `damage_amp` | Corrosive Haze: armor reduction + true sight. |
| Croak of Genius | `spell_steroid` | `damage_amp` | Spell amp, self-cast or on an ally. Tagged spell_steroid; the ally cast is noted in the tooltip, no team-demand term (one ally's nukes, not the team's). |
| Decrepify | `amp_magical` | `damage_amp` | Extra magic damage taken (and physical immunity). |
| Disseminate | `amp_all` | `damage_amp` | Damage sharing. |
| Eye of the Storm | `amp_physical` |  | Each strike reduces armor. NEW carrier. |
| Fatal Bonds | `amp_all` | `damage_amp` | Damage sharing across bonded units. |
| Forge Spirit (AD) | `amp_physical` | `damage_amp` | Spirit attacks melt armor. |
| Gush | `amp_physical` | `damage_amp` | Armor reduction + slow. |
| Howl | `amp_physical` | `damage_amp` | Armor + attack damage reduction in 2000 range. |
| Lil' Shredder | `amp_physical` | `damage_amp` | Each shot reduces armor. |
| Lucky Shot | `amp_physical` | `damage_amp` | 17% chance: attack slow + armor reduction (dotaconstants confirms; my earlier doubt was wrong). |
| Maledict | `amp_all` | `damage_amp` | Bursts scale with HP lost: a follow-up amplifier rather than a debuff amp. Keep as amp_all? |
| Meld | `amp_physical` |  | Meld strike reduces armor 6 s. NEW carrier. |
| Natural Order | `amp_physical`, `amp_magical` | `damage_amp` | Removes base armor AND base magic resistance. |
| Overcharge | `spell_steroid` |  | Io gains spell amp (and attack speed); shared with the tethered ally. NEW carrier. |
| Poison Attack | `amp_magical` |  | Stacking magic resistance reduction. NEW carrier. |
| Presence of the Dark Lord | `amp_physical` | `damage_amp` | Armor aura. |
| Proximity Mines | `amp_magical` |  | Temporary magic resistance reduction on detonation. NEW carrier (minor). |
| Reality Rift | `amp_physical` |  | Armor reduced for 6 s after the pull. NEW carrier. |
| Rip Tide | `amp_physical` | `damage_amp` | Armor reduction every 6th attack. |
| Spirit Form | `spell_steroid` | `damage_amp` | Your call: cast-range amp is caster value. Tagged spell_steroid so it rides the pos-2 accent and the owns-a-nuke gate, with the caveat that it does not raise damage numbers. |
| Stone Gaze | `amp_physical` | `damage_amp` | Petrified units take bonus physical damage. |
| The Swarm | `amp_physical` |  | Beetles reduce armor until killed. NEW carrier. |
| Track | `amp_all` | `damage_amp` | DAMAGE AMPLIFICATION 8/12/16% (dotaconstants confirms; my earlier doubt was wrong). |
| Viscous Nasal Goo | `amp_physical` | `damage_amp` | Stacking armor reduction. |
| Wave of Terror | `amp_physical` | `damage_amp` | Armor + attack damage reduction. |
| Wild Axes | `spell_steroid` | `damage_amp` | Amplifies subsequent damage from Beastmaster and his units only: self amp, not team. |
| Flesh Golem | — |  | Attacks apply damage amplification + slow. NEW carrier. |
| Liquid Frost | — |  | Increases damage taken from Jakiro's attacks and abilities only. NEW carrier. |
| Pulse Nova | — | `damage_amp` | No amplification mechanic. Propose removing damage_amp. |
| Requiem of Souls | — |  | Brief magic resistance reduction per line hit. Probably too short to count. |
| Sticky Napalm | — |  | Amplifies Batrider's OWN attacks and abilities only. The combo enabler. NEW carrier. |
| Winter's Curse | — | `damage_amp` | Dispel + freeze + taunt. Not an amp. Propose removing damage_amp (it gains purge_enemy in section F). |

### 3.3 Combo deny
| Ability | Tags | Removed | Deny when the enemy holds | Note |
|---|---|---|---|---|
| Ball Lightning | `good_deny` | `good_counter` | Aftershock, model:obsidiandestroyer | Deny fires only when the enemy holds one of: Aftershock, the obsidiandestroyer model. Confirm the list is exactly right (names resolved to internal ids). |
| Berserker's Call | `good_deny` | `good_counter` | Counter Helix, Retaliate, Dispersion | Deny fires only when the enemy holds one of: Counter Helix, Retaliate, Dispersion. Confirm the list is exactly right (names resolved to internal ids). |
| Burning Spear | `good_deny` | `good_counter` | Chemical Rage, Sticky Napalm, Berserker's Blood, Liquid Frost | Deny fires only when the enemy holds one of: Chemical Rage, Sticky Napalm, Berserker's Blood, Liquid Frost. Confirm the list is exactly right (names resolved to internal ids). |
| Counter Helix | `good_deny` | `good_counter` | Berserker's Call | Deny fires only when the enemy holds one of: Berserker's Call. Confirm the list is exactly right (names resolved to internal ids). |
| Crippling Fear | `good_deny` | `good_counter` | Liquid Frost, Sticky Napalm | Deny fires only when the enemy holds one of: Liquid Frost, Sticky Napalm. Confirm the list is exactly right (names resolved to internal ids). |
| Doppelganger | `good_deny` | `good_counter` | Moon Glaives, Juxtapose | Deny fires only when the enemy holds one of: Moon Glaives, Juxtapose. Confirm the list is exactly right (names resolved to internal ids). |
| Homing Missile | `good_deny` | `good_counter` | Rocket Barrage | Deny fires only when the enemy holds one of: Rocket Barrage. Confirm the list is exactly right (names resolved to internal ids). |
| Lightning Bolt | `good_deny` | `good_counter` | Thundergod's Wrath | Deny fires only when the enemy holds one of: Thundergod's Wrath. Confirm the list is exactly right (names resolved to internal ids). |
| Lil' Shredder | `good_deny` | `good_counter` | Glaives of Wisdom, Poison Attack, Mana Break, Impetus, Haunt, Burning Spear, Fury Swipes, Frost Arrows | Deny fires only when the enemy holds one of: Glaives of Wisdom, Poison Attack, Mana Break, Impetus, Haunt, Burning Spear, Fury Swipes, Frost Arrows. Confirm the list is exactly right (names resolved to internal ids). |
| Lucent Beam | `good_deny` | `good_counter` | Eclipse | Deny fires only when the enemy holds one of: Eclipse. Confirm the list is exactly right (names resolved to internal ids). |
| Overpower | `good_deny` | `good_counter` | Glaives of Wisdom, Poison Attack, Mana Break, Impetus, Haunt, Burning Spear, Fury Swipes, Frost Arrows | Deny fires only when the enemy holds one of: Glaives of Wisdom, Poison Attack, Mana Break, Impetus, Haunt, Burning Spear, Fury Swipes, Frost Arrows. Confirm the list is exactly right (names resolved to internal ids). |
| Quill Spray | `good_deny` | `good_counter` | Aftershock | Deny fires only when the enemy holds one of: Aftershock. Confirm the list is exactly right (names resolved to internal ids). |
| Rocket Barrage | `good_deny` | `good_counter` | Aftershock, Sticky Napalm, Homing Missile | Deny fires only when the enemy holds one of: Aftershock, Sticky Napalm, Homing Missile. Confirm the list is exactly right (names resolved to internal ids). |
| Scream Of Pain | `good_deny` | `good_counter` | Aftershock, Shadow Strike | Deny fires only when the enemy holds one of: Aftershock, Shadow Strike. Confirm the list is exactly right (names resolved to internal ids). |
| Shadow Strike | `good_deny` | `good_counter` | Aftershock, Scream Of Pain | Deny fires only when the enemy holds one of: Aftershock, Scream Of Pain. Confirm the list is exactly right (names resolved to internal ids). |
| Tombstone | `good_deny` | `good_counter` | Flesh Golem | Deny fires only when the enemy holds one of: Flesh Golem. Confirm the list is exactly right (names resolved to internal ids). |
| Time Lock | — | `good_counter` | — | Never a good deny (your ruling). good_counter removed, no good_deny. |
| Time Walk | — | `good_counter` | — | A good spell, not a good deny (your ruling). The Time Lock + Time Walk Scepter combo could come back as a combos: entry if you want it. |

### 3.4 Dispel
| Ability | Tags | Removed | Note |
|---|---|---|---|
| Aphotic Shield | `dispel_ally` | `dispel` | Dispels the ally on cast. |
| Battle Trance | `dispel_self` |  | Applies a basic dispel (text). NEW carrier. |
| Blade Fury | `dispel_self` |  | Strong dispel at the end of the spin (text). NEW carrier. |
| Borrowed Time | `dispel_self` | `dispel` | Dispels you on activation. |
| Catchy Lick | `dispel_ally`, `purge_enemy` | `dispel` | Basic dispel on the target, ally or enemy. |
| Chemical Rage | `dispel_self` | `dispel` | Basic dispel on cast. |
| Dark Pact | `dispel_self` |  | Repeated strong dispel pulses. NEW carrier. |
| Demonic Purge | `purge_enemy`, `dispel_ally` (with shard) | `dispel` | Purges enemy buffs; Shard adds an ally cast. |
| Doom | `purge_enemy` |  | Dispels the enemy on cast. NEW carrier. |
| Doppelganger | `dispel_self` | `dispel` | Basic dispel on cast. |
| Enchant | `purge_enemy` |  | Enemy hero is dispelled and slowed. NEW carrier. |
| Enrage | `dispel_self` |  | Removes existing debuffs. NEW carrier. |
| False Promise | `dispel_ally` |  | Strong dispel on initial cast. NEW carrier (currently save_ally only). |
| Fortune's End | `dispel_ally`, `purge_enemy` | `dispel` | Dispels enemies of buffs; on an ally only dispels. |
| Infest | `dispel_self` |  | Same as Omnislash: comment says basic dispel, button said exclude. Included for you to confirm. |
| Kraken Shell | `dispel_self` | `dispel` | Removes debuffs when damage crosses the threshold. |
| Life Break | `dispel_self` |  | Debuff immune while leaping; basic dispel on cast in the current patch? Confirm. |
| Mirror Image | `dispel_self` | `dispel` | Basic dispel on cast. |
| Omnislash | `dispel_self` |  | Your comment says the ability is marked basic dispel, your button said exclude. I have included it; flip to Disagree if the exclusion was intended. |
| Phantasm | `dispel_self` |  | Basic dispel on cast. NEW carrier. |
| Press The Attack | `dispel_ally` | `dispel` | Removes debuffs and disables from the friendly target. |
| Rage | `dispel_self` |  | Basic dispel + debuff immunity. NEW carrier. |
| Raptor Dance | `dispel_self` |  | Receives a basic dispel at cast start (text). NEW carrier. |
| Reactive Tazer | `purge_enemy` |  | Purges the enemies it hits, not the ally it is cast on. |
| Repel | `dispel_ally` |  | Repel: debuff immunity on an ally counts as a dispel for this purpose (your ruling). |
| Rolling Thunder | `dispel_self` |  | Rolling Thunder: debuff immune; I believe a basic dispel applies on cast; confirm. |
| Supernova | `dispel_self` |  | Strong dispel on rebirth. NEW carrier. |
| Time Lapse | `dispel_self` |  | dotaconstants lists DISPEL TYPE: Strong Dispel. I believe it dispels on cast; confirm. |
| Whirling Axes (Melee) | `dispel_self` (with scepter) | `dispel` | Base ability has no dispel (community tag removed); Scepter adds a self dispel on the melee version. Tagged per the upgrade policy, marked 'with Scepter'. |
| Whirling Axes (Ranged) | `purge_enemy` (with scepter) |  | Scepter adds an enemy purge on the ranged version. Tagged per the upgrade policy, marked 'with Scepter'. |
| Winter's Curse | `purge_enemy` |  | Dispels then freezes. NEW carrier. |
| Glimpse | — |  | No dispel of any kind (your ruling). Not in the dispel family; the illusion kill is not a purge. |

## 4. Build order (one PR each, golden fixtures per step)

1. Board tag profile + mechanical `debuff_dispellable` / `debuff_strong_only` /
   `bkb_piercing` layer in the build script; new entry fields parsed
   (`combos`, `viaUpgrade`, `with`) with unknown-field tolerance.
2. Reposition split (rename + re-seed overrides) and dispel split + demand boost.
3. Damage-amp split + team-demand boost.
4. `good_deny` + `combos:` deny marker and boost.
5. pick_asap border + tooltip + import-time audit.

## 5. Migration checklist per rename
`VOCAB` (build script) + `TAG_VOCABULARY` (app) + `tagDocs.ts` / `labI18n.ts`
(site) + rename map in `import_site_export.py` (`move_enemy` → reposition_enemy,
`dispel` → dispel_self, `good_counter` → good_deny, `damage_amp` → per-ability
remap from §3.2) + supersede the old `new_tag` proposals in the Lab (the effective
vocab is catalog ∪ accepted new_tag names, so both names must not coexist) + the
i18n parity test for the new chip labels + the Lab composer learns `combos`,
`viaUpgrade`, `with` (until then they live in tag_overrides.json only).

## 6. Other export changes, imported as-is
Borrowed Time gains roleMust [1, 3]; +4 good_shard, +4 good_aghanims, +2 steroid,
+1 each nuke / mobility / teamfight_ult / soft_cc / mana_hungry / grants_ranged,
−1 soft_cc.
