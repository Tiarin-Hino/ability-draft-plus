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
5 top-tier synergy-partners-first selection        (top-tier.ts, unchanged)
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
  type excludes candidates from top-tier entirely (tooltip explains).
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
