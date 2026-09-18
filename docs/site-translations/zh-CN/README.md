# tiarinhino.com Simplified Chinese translation — community review

This folder holds the Simplified Chinese translation of the two long-form
surfaces of [tiarinhino.com](https://tiarinhino.com), staged here for review
before going live. It exists only for the review; once approved, the content
moves into the website repo and this folder is deleted.

## What's here

| File | What it is | Goes live as |
| --- | --- | --- |
| `how-suggestions-work.zh-CN.html` | Full translation of the [how-suggestions-work](https://tiarinhino.com/how-suggestions-work.html) explainer, diagrams included | The `data-lang-only="zh-CN"` article block on that page |
| `tagLab.zh-CN.ts` | Tag Lab UI dictionary + tag/model-tag documentation | The `ZH` dictionary in the site's `labI18n.ts` |
| `site-chrome.zh-CN.json` | Reference copy of the site chrome dictionary (nav, landing page, FAQ, safety) | **Already live** — based directly on the in-app zh-CN localization; corrections welcome here too |

## Context for the reviewer

- Until this review lands, Chinese visitors picking 中文 on the site get the
  chrome in Chinese and these two surfaces in English (deliberate fallback).
- Terminology follows the in-app zh-CN localization from #133/#134
  (覆盖层 / 征召 / 技能池 / 号位 / 胜率 / 选取率 / 硬控制 / 清线 / 我的席位 /
  我的模型 / 先天能力). If a term reads wrong, flag it — the glossary should
  stay consistent between app and site.
- Tag names (`hard_cc`, `waveclear`, `must:` / `avoid:` chips) are dataset
  identifiers and deliberately stay in English everywhere; only their
  explanations translate.
- Ability names stay in English — the draft board and the overlay show them in
  English.
- In the `.html` file the `<svg>` `<text>` elements are diagram labels: please
  review wording only; box sizes are already fitted.
- Comment inline on anything — no suggestion is too small, and there is no
  deadline.
