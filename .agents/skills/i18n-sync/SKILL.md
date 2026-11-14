---
name: i18n-sync
description: >-
  Audits, scaffolds, and validates translations across all 8 supported languages
  (en, ru, zh-CN, es, pt-BR, uk, fil, fi) and all 4 renderer apps (80 locale JSON files).
  Use this skill whenever adding, renaming, deleting, or translating user-facing UI strings.
---

# i18n Synchronization Skill

All user-visible strings across **Ability Draft Plus** are localized via `i18next` across **8 languages** (`SUPPORTED_LANGUAGES` in `src/shared/constants/defaults.ts`) and **10 namespaces** (80 JSON files total):

| App / Scope | Namespaces | File Path Pattern |
|---|---|---|
| Control Panel | `common`, `dashboard`, `data`, `settings`, `streaming`, `update`, *(plus unused `feedback`)* | `src/renderer/control-panel/src/locales/<lang>/<ns>.json` |
| Overlay | `overlay` | `src/renderer/overlay/src/locales/<lang>/overlay.json` |
| Stream Board | `stream` | `src/renderer/stream/src/locales/<lang>.json` |
| Picks View | `picks` | `src/renderer/picks/src/locales/<lang>.json` |

## Rules
1. **`en` is the schema contract.** Every non-English locale must have identical leaf keys and identical `{{token}}` interpolation placeholders (`tests/unit/renderer/i18n-locales.test.ts` fails CI on any mismatch or empty string).
2. **Main-process messages pass keys + params**, never raw English text (see `FeedbackStatus` in `src/shared/types/`).
3. **Never add keys to `en` without updating all 7 non-English locales** (`ru`, `zh-CN`, `es`, `pt-BR`, `uk`, `fil`, `fi`).
4. **Watch out for TypeScript i18n global augmentation:** `src/renderer/control-panel/src/i18n/types.ts` currently augments `i18next` globally inside `tsconfig.web.json`, causing cross-renderer key errors in `overlay`, `stream`, and `picks` during `tsc -p tsconfig.web.json`.

## Workflow

1. Edit the English (`en`) locale JSON file(s) and wire `t('...')` in components.
2. Scaffold missing keys into all other languages (inserts `en` values in matching key order so you can translate them cleanly without breaking Vitest):
   ```bash
   node .agents/skills/i18n-sync/scripts/check-i18n.mjs --scaffold
   ```
3. Translate the newly added strings in `ru`, `zh-CN`, `es`, `pt-BR`, `uk`, `fil`, and `fi`.
4. Audit parity AND inspect remaining identical-to-English fallback strings:
   ```bash
   node .agents/skills/i18n-sync/scripts/check-i18n.mjs
   ```
   Optional flags:
   - `--strict-untranslated` — exit non-zero if non-English files contain untranslated English strings (excluding proper nouns / Dota terms / short strings).
   - `--json` — machine-readable summary output.
5. Run the authoritative Vitest locale parity suite:
   ```bash
   npx vitest run tests/unit/renderer/i18n-locales.test.ts
   ```
