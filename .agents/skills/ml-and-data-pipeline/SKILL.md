---
name: ml-and-data-pipeline
description: >-
  Guides Dota 2 patch updates, Windrun/Liquipedia scraping, community ability/hero tag sync
  (ability_tags.json and hero_meta.json), FP16 ONNX model retraining via training/train.py,
  and Twitch dotaconstants catalog builds. Use when updating game data, tags, or ML models.
---

# ML & Game-Data Pipeline Skill

End-to-end procedure for keeping Windrun stats, community tags, ML vision weights, and Twitch Dota text catalogs synchronized after Dota 2 patches.

## 1. Windrun Stats & Seed Database
- **Production scraper**: `src/core/scraper/orchestrator.ts` runs 3 phases against `api.windrun.io/api/v2/` (public, no auth):
  1. Static heroes/abilities, stats (`/abilities`, `/ability-high-skill`, `/heroes`), and `/ability-shifts` (approved for use by Windrun maintainer Noxville; non-fatal if unavailable; parser stops at game start so no per-minute/lane stats exist).
  2. `/ability-pairs` -> `AbilitySynergies` & `HeroAbilitySynergies`.
  3. `/ability-triplets` -> `AbilityTriplets` & `HeroAbilityTriplets`.
- **Player & match endpoint quirks**: `/players/{id32}/stats` `spellStats` (keyed by Valve ability ID) is capped at top 200 by games (no `total` field) and `heroStats` lacks `avgPickPosition`; `/players/{id32}/matches?page=N` returns 30/page; `/matches/{id}` contains full 50-pick draft order (models as negative IDs) + `ignoredSpells`.
- **Slot overrides & AD board rules**: `src/core/scraper/slot-metadata-overrides.ts` fixes passive/reworked ability `ability_order` (`0`=Ult, `1-3`=Q/W/E) after Windrun + Liquipedia enrichment. Every board slot has 1 ability except Jakiro E (`liquid_fire`/`liquid_ice`), Troll W (`whirling_axes_melee`/`_ranged`), and Invoker/Kez random pools (Invoker ult comes from a hero outside the lobby). Legitimately missing slots: `arc_warden`, `meepo`, `ogre_magi`, `rubick`, `morphling` (no Ult); `crystal_maiden`, `morphling` (no E). Anything else with 2+ abilities/slot or `NULL ability_order` is a data bug for `SLOT_METADATA_OVERRIDES`. Note hero naming: `zeus` (npc `zuus`) is the sole alias among 127 heroes.
- **Seed DB maintenance**: Always audit `resources/dota_ad_data.db` via:
  ```bash
  node .agents/skills/quality-and-release/scripts/audit-seed-data.mjs
  ```
  Ensure new seed DBs have populated `*_shift` columns, `windrun_id`, applied `SLOT_METADATA_OVERRIDES`, and **zero** user/dev `Metadata` preference keys.

## 2. Community Tags (`ability_tags.json` & `hero_meta.json`)
- **NEVER hand-edit** `resources/data/ability_tags.json` or `resources/data/hero_meta.json`.
- **Tag Lab sync loop**: Durable overrides live in sibling repo `../ad_data_gather_script` (`tag_overrides.json`, `hero_tag_overrides.json`, `build_ability_tags.py`), fed by the live Tag Lab on `abilitydraftplus.com` (`../tiarinhino.com/TAGS-WORKFLOW.md`): admin export -> `import_site_export.py` -> `build_ability_tags.py assemble` -> copy to `resources/data/` + `export_site_catalog.py`.
- **Tag curation & Round-5 rulings**: Keep a tag only when the voiced advice ("covers your missing X") is genuinely accurate. `melee_only`/`ranged_only` apply ONLY to truly inert abilities (cleave works on ranged models in current AD). `good_deny` combos are curated-only; `reposition` applies to Nightmare (not Black Hole/Bushwhack/Tornado); short knockbacks = `knockback`; Shard/Scepter effects tag at full value with `viaUpgrade`; debuff immunity = dispel; `spell_steroid` is an own-pick complement boost (`docs/proposals/community-tags-round5.md`); `pick_asap` is visual-only.
- Whenever adding tags to the vocabulary:
  1. Update `TAG_VOCABULARY` (and `MECHANICAL_TAGS` if mechanical) or `HERO_TAG_VOCABULARY` in `src/core/domain/ability-tags.ts` in lockstep with `build_ability_tags.py`.
  2. Update `docs/ROLE_SUGGESTIONS.md` and scoring/tooltip logic (`role-scoring.ts`, `board-tag-profile.ts`, `scan-processor.ts`).
  3. Verify `npx vitest run tests/unit/core/domain/ability-tags.test.ts tests/unit/core/domain/board-tag-profile.test.ts tests/unit/core/domain/role-scoring.test.ts`.

## 3. ML Model Retraining (FP16 ONNX MobileNetV2)
See `docs/ML_PIPELINE.md` for full background. Key contracts:
- **Shipped files**: `resources/model/ability_classifier_fp16.onnx` + `resources/model/class_names.json` (must stay in sync; class count is dynamic at runtime).
- **Input contract**: Raw `0–255` float32 `[N, 96, 96, 3]`. Do **NOT** normalize in `src/core/ml/preprocessing.ts` — the Keras/ONNX graph normalizes internally.
- **FP16 ONLY**: Do NOT switch to INT8 quantization (collapsed accuracy twice; note `training/gate.py` comments still mention INT8 historically, while `train.py` produces FP16).
- **Always fine-tune (`--fine-tune`)**: Retrains without `--fine-tune` collapse live-crop confidence even when test-split accuracy reads 100%. Validate every model PR by A/B testing on `userData/debug/low-conf-pool` (`low-confidence-pool`) crops and confirming `"Fine-tuned top block: yes"` in `report.md`. Never give `tusk_snowball` a threshold override `>= 0.5` (it is the argmax on empty pick boxes) or add blind `ML_CLASS_THRESHOLD_OVERRIDES`.
- **Retrain workflow**:
  1. Export missing classes from the Control Panel Dashboard (`Export Model Gaps`) -> `model-gaps.json`.
  2. Run `gather_missing_data.py` & `upload_dataset.py` in `../ad_data_gather_script` -> S3 `datasets/dataset-vN.zip`.
  3. **Version conflict check:** Flag `.github/workflows/train-model.yml`'s `npm version minor` step before triggering a retrain (repo policy forbids bumping `package.json` version outside official releases).
  4. Trigger `.github/workflows/train-model.yml` with `dataset_version = N` (ensure `--fine-tune` is enabled).
  5. Review the generated PR's `report.md`: confirm `"Fine-tuned top block: yes"`, inspect worst per-class recall, confusion matrix, and **twin warnings** (`training/gate.py` detects renamed abilities that still have legacy classes in the dataset — verify in-game and merge or purge legacy folders).
  6. Note: PRs created by default `GITHUB_TOKEN` do not auto-trigger CI; close/reopen or push a follow-up commit to run CI checks.

## 4. Twitch Dota Catalog (`twitch/catalog/`)
After Dota patches adding/renaming abilities or heroes:
1. Run `cd twitch/catalog && npm run build && npm test`.
2. Any legitimately unpickable/special entries causing coverage test failures must be documented in `twitch/catalog/allowed-missing.json` with a reason.
3. Publish hashed `catalog-<hash>.json` (immutable, `max-age=31536000`) and `catalog-manifest.json` (`max-age=0,must-revalidate`) with CORS `*` to `abilitydraftplus.com` (`public/data/twitch/`).
