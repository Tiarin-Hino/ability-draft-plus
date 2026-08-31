# Role-Aware Suggestions

How the overlay tailors ability/model suggestions to the position you intend to
play. Built 2026-08-28/30; design spec + research trail in the session artifacts
(Position Templates spec) and `.claude` memory. This doc is the maintenance map.

## Data sources

| Source | What | Where it lands |
|---|---|---|
| Windrun `GET /ability-shifts` (undocumented; provider-approved 2026-08-28) | Per-ability AND per-hero-model (negative ids) average deviation of drafters' kills/deaths/KA/gpm/xpm/dmg/healing. Units undocumented — treated as ORDERING ONLY. | 7 nullable shift columns on `Abilities` and `Heroes`, applied by `windrun_id` during phase-1 scrape (non-fatal on failure, never wipes) |
| `resources/data/ability_tags.json` | 513 abilities × 20-tag closed vocabulary (community-curated via the website Tag Lab) | Loaded once at startup (`ability-tags-service`); absent/invalid = tags feature off |
| `resources/data/hero_meta.json` | Hero attack type, primary attribute, base stats + gains (dotaconstants) | Same loader; drives model fit + inert filter |

Both JSON files are GENERATED — never hand-edit. Pipeline:
`../ad_data_gather_script/build_ability_tags.py` (layers: dotaconstants
mechanical → heuristics → Liquipedia CC source-lists → LLM judgment →
`tag_overrides.json`, which is the durable source of truth). Community flow and
the export/import loop: `../tiarinhino.com/TAGS-WORKFLOW.md` (Tag Lab is LIVE at
tiarinhino.com/ability-tags.html with a Lambda/DynamoDB backend).

## Scoring stack (fixed layer order)

```
1 global   0.4·winrate + 0.6·pickOrder            (scoring.ts, unchanged)
2 personal shrinkage blend, K=20                   (linked Windrun profile)
3 role     greed fit · pick-index taper + shift accents + tag accents
           + needs engine (priority · pool scarcity · credit)
           + ult-security nudge, all capped        (role-scoring.ts)
4 team     −TAU · teamGreed · candidateGreed       (inside layer 3's cap)
5 top-tier synergy → curated must-picks → general  (top-tier.ts)
```

Every layer defaults to a no-op: `roleMode: 'off'` (or missing shift data) is
bit-identical to the pre-feature scorer — golden tests enforce this.

Key mechanics in `core/domain/role-scoring.ts`:

- **Axes** (`shift-axes.ts`): pool-percentile ranks (average-rank ties — the
  healing column is zero-inflated) → greed / killtaking / playmaking / enabling,
  each in [−1, +1].
- **Modes** → one *effective position set*: `fixed` = user multi-selection
  (works from the INITIAL scan, no spot needed); `dynamic` = teammates' build
  greed rank-matched (minimal-cost order-preserving DP) onto positions 1–5,
  vacancies recommended behind an evidence gate (≥2 teammates with ≥2 picks).
  The spot only unlocks auxiliaries (teammate estimates, team balance,
  pick-aware needs).
- **Needs engine**: per-position checklists (`POSITION_NEEDS`) with priorities
  ordered by hardness-to-itemize, boosts scaled by pool scarcity
  (`clamp(6/supply, 0.6, 1.8)` over UNPICKED pool) and by tag credit —
  `soft_cc` counts as HALF a `hard_cc`. Duplicate damping (third single-target
  stun) and the mana budget (third `mana_hungry` ability) subtract. Produces
  the tooltip reason chips (`covers:X` / `duplicate:X`).
- **Greed taper** `[1.0, 0.85, 0.6, 0.4]` by the user's own pick index —
  corpus finding: experts draft their greed engine first, utility later.
- **Models**: attribute fit per position (agi-gain for 1, overall stats for 2,
  STR for 3, INT/mana + best remaining gains for 4/5), percentiled among
  REMAINING models; shift greed is a scaled-down secondary
  (`ROLE_MODEL_WEIGHT_SCALE`); core roles get a model-urgency ramp (lock by
  ~round 3) scaled by good-core-model scarcity.
- **Hard filter**: `melee_only`/`ranged_only` vs the selected model's attack
  type excludes candidates from top-tier entirely (tooltip explains). Two
  exceptions (user ruling 2026-08-30, Wukong's Command case): a candidate
  NATIVE to the selected model's hero is never inert (the game designed them
  together), and a drafted `grants_ranged` ability (Psi Blades, Take Aim)
  waives `ranged_only` on melee models for the rest of the draft. No symmetric
  melee waiver — nothing grants melee.
- **Dependency gates** (`requires: [entries]` on a dataset entry, curated in
  tag_overrides.json): entries are ability internal names or `model:<hero>`.
  The ability is HARD-excluded from suggestions until one entry is satisfied —
  a listed ability among the USER'S drafted picks, or the picked model matching
  a `model:` entry (its innate provides the mechanic; innates stay with the
  model in AD since 7.36). Stats stay fully visible; the tooltip names the
  missing piece. Unknown spot/model counts as unsatisfied (conservative).
  Seeds: Eclipse -> Lucent Beam, Requiem -> the SF model (souls). The Tag Lab
  does not carry `requires` yet — `import_site_export.py` preserves it.
- **Model chassis (Layer A)**: hero_meta.json also ships body properties from
  dotaconstants (attack range/BAT/projectile, move speed, base armor/HP/mana/
  damage). Three derived percentiles feed `modelAttrFit`: attackQuality
  (negated BAT) for pos 1, bulk (baseHealth·(1+0.06·armor)) for pos 3, move
  speed for pos 4-5. Missing fields score as neutral 0.5 (old datasets safe).
- **Overrated marker + damp**: an ability BOTH below `OVERRATED_WINRATE_MAX`
  (0.48) AND picked earlier than `OVERRATED_PICK_ORDER_MAX` (15) gets a flat
  `OVERRATED_DAMP` (0.12) off its score plus an explanatory tooltip line —
  the 0.6 pick-order weight otherwise rewards popularity over quality (Rearm:
  wr 45.7%, picked ~9th, was suggested to every role). Checked on GLOBAL
  inputs, applied role mode or not. Calibrated 2026-08-31: catches 21/513
  abilities, all textbook traps. FUTURE LEVER if core/trap pollution
  persists (documented, deliberately not built yet): discount
  `WEIGHT_PICK_ORDER` itself while a role mode is active, so role-aware
  drafters trust winrate over herd behavior.
- **Curated never-recommend** (`roleAvoid: [positions]`): the negative
  counterpart of roleMust. Excluded from suggestions when the drafter's
  effective positions are ALL inside the avoid set — or unconditionally when
  it covers all five positions (role mode on or off; Ransack class). Tooltip
  explains; stats stay visible. Tag Lab: the position toggles are tri-state
  (neutral → must → avoid), submitting `role_avoid` proposals with the same
  replace semantics, mandatory rationale, and newest-accepted-wins.
- **Hero-model roleAvoid + teammates-modeled lift** (Drow/Luna case): hero
  entries carry `roleAvoid` too (seeded Drow/Luna [4,5] — a premier core body
  should not be stolen from your cores; note their model greed axes sit at
  the 1st-2nd percentile because supports DO pick them for the aura, which is
  exactly the play the lift permits). The avoid — and the reservation damp
  below — LIFT once every teammate has picked a model: taking the body then
  only denies the enemy team. Unknown My Spot = no lift (conservative).
- **Model reservation** (curation-free generalization): a support drafter
  (effective positions all 4-5) is damped `MODEL_RESERVATION_DAMP` on bodies
  whose best pos-1-3 attr fit beats their best pos-4-5 fit by more than
  `MODEL_RESERVATION_FIT_GAP`, while core teammates still need models. Folded
  into the displayed role delta.
- **Reason-chip via suffix** (`covers:<need>:<viaTag>`): when a need is
  covered by an ALTERNATIVE tag rather than its namesake (nuke covering the
  pos-4/5 wave need — Shadow Realm case), the chip says "covers: waveclear
  (via nuke)". The renderer collapses the suffix when the labels coincide.
- **Role-off invariant, amended**: `roleMode: 'off'` remains bit-identical to
  the role-less path EXCEPT for role-independent verdicts and facts: an
  all-five roleMust is guaranteed a slot, an all-five roleAvoid is excluded,
  the overrated damp applies, and the inert/requires filters apply — all by
  design (they are not role opinions).
- **Curated must-picks** (`roleMust: [positions]` on a dataset entry): a
  hand-curated VERDICT — "recommend for these positions even if stats
  disagree" — deliberately OUTSIDE the tag vocabulary (tags are mechanical
  facts; this is judgment). Reserved for abilities whose value the stats
  systematically miss (seed case: Disruptor's Glimpse for pos 4/5). Two
  effects when an effective position matches: `ROLE_CURATED_WEIGHT` boost +
  `curated` reason chip (role-scoring.ts), and a GUARANTEED top-tier slot
  after synergy suggestions (top-tier.ts) with its own tooltip badge — the
  guarantee is the mechanism, since the stats already voted these out.
  Curated in `tag_overrides.json` (not part of the Tag Lab export;
  `import_site_export.py` preserves it across site imports). Role mode off →
  complete no-op like the rest of the layer.
- **Contested-soon marker**: suggestion whose global avg pick position is due
  within `CONTESTED_SOON_WINDOW` of the board pick count — sim finding: our #1
  gets sniped before the user's next turn in 60% of disagreements.

All weights live in `shared/constants/thresholds.ts` with their empirical
rationale as comments (greed taper, team balance, ult security, etc. come from
2,981 expert drafts + a 2,000-pick solo-queue simulation).

## UI

- Control panel: Role-Aware Suggestions card (Off / My positions 1–5 multi /
  Fill for team). Overlay: quick panel (click position = fixed, Auto = dynamic;
  status line reflects the LAST PROCESSED scan — role changes apply on the next
  scan, same contract as My Spot). Tooltips: role-fit line + reason chips +
  inert/contested notes. EN + RU throughout.

## Research & validation tooling (../ad_data_gather_script)

- `gather_draft_corpus.py` — league + high-skill drafts from Windrun (full
  50-pick order + ignoredSpells; resumable JSONL). `analyze_draft_corpus.py`,
  `analyze_sim_results.py` — the corpus/sim reports.
- Draft simulator: `tests/unit/core/domain/draft-simulation.test.ts`, run with
  `DRAFT_SIM=1` (+ `DRAFT_SIM_IDS=<json id list>`); replays real drafts through
  the live pipeline. Solo-queue verification of matches via OpenDota
  `party_size` (cached verdicts in `draft_corpus/party_check.json`).

## Model-pairing Layers B and C (built 2026-08-31)

**Layer B — hero-model tags (talents + innates).** `hero_meta.json` entries
carry `tags` (HERO_TAG_VOCABULARY, 7 tags: `rc_talents`/`caster_talents`/
`tank_talents`/`utility_talents` + `innate_offense`/`innate_tank`/
`innate_team`) and `roleMust` (curated must-pick MODEL positions — guaranteed
suggestion slot via the same top-tier curated tier as abilities, skipped once
a model is picked). Pipeline: talent tags are auto-derived from GENERIC
talents only (ability-specific talents are dead on an AD model — measured
mean is ~1.3 generic talents/hero, so auto-tagging is sparse by design;
`hero_tags_pre_override.json` is the auto snapshot), innate tags are judgment
seeded in `hero_tag_overrides.json` (~39 heroes). The Tag Lab's "Browse
models" view runs the full community loop (`hero_modify` / `hero_role_must`
proposals, voting, admin decision, export with `features: ["heroTags"]`;
`import_site_export.py` diffs hero tags against the auto snapshot). In
scoring: per-position hero-tag accents (`MODEL_TAG_ACCENT_WEIGHT`) inside
`computeModelRoleScore`.

**Layer C — ability×model pairing (role-gated, own cap).** `PAIRING_WEIGHT` ·
(2·pct − 1) terms clamped to `PAIRING_ADJUSTMENT_CAP`, active only while a
role mode is on (preserves the role-off bit-identity invariant):
- Forward (`computeAbilityPairing`, model picked → ability candidates):
  steroid/farm_tool follow the model's attack cadence percentile (+flat bump
  on rc/offense-tagged models); initiation/channeled follow bulk (+bump on
  innate_tank); mana_hungry follows the mana pool. The picked model's
  percentiles are computed among ALL board models (the remaining-only set
  excludes it).
- Reverse (`computeModelPairing`, drafted abilities → model candidates): 2+
  right-click picks make cadence matter, a drafted teamfight ult/initiation
  makes bulk matter, 2+ mana-hungry actives make the pool matter.
Both surface as the "Model pairing" tooltip line (`pairingScoreDelta`).
Weights are first-pass priors — re-run `analyze_draft_corpus.py` correlating
drafted-tag profiles with chosen models before retuning.

## Known caveats

- Roles from endgame farm rank in research tooling are post-treatment (biased);
  the engine itself never infers your role from outcomes.
- Windrun aggregate winrates are marginals over pool draws (pool-conditional
  value differs) — known epistemic limit.
- Party drafting follows cross-player coordination logic the per-seat engine
  does not model (measured: solo-queue agreement is markedly higher).
- v2 roadmap (memory: role-aware-suggestions-research): team/pool-scope needs,
  combo tags, quality-weighted need coverage, `dot`/`dispel`/`spell_steroid`
  tags, mana-per-minute refinement, corpus-mined pair lifts.
