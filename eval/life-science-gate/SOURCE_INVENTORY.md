# Life-science gate source inventory (2026-10-03)

This inventory is for the **broad-science life-science routing gate** only (`id`, `title`, `journal`, `source_id`). Life-science-only feeds are scope-default and are not natural gate samples.

## Recoverable sources

| Source | Working tree (2026-09-03–2026-10-02) | Git-recovered pruned days | Notes |
| --- | --- | --- | --- |
| `data/processed/{date}/papers.json` | 27 dates, 553 unique broad-science papers, **0 missing titles** | 102 extra dates, 0 unrecoverable paths | Included papers **and** `excludedPapers[]` keep full titles. Daily dirs are 30-day pruned on `main`; v1 copies selected cases into `eval/`. |
| Git history of the same path | n/a | 2026-05-21–2026-09-02 | Recovered via deletion-commit parent (`git show DELETE^:path`). Marked `historical_processed` with the git commit. |
| `test/fixtures/regression/*.json` | 63 broad-science rows | n/a | Regression fixtures only. Not used as gold. |
| `scripts/llm-probe/fixtures/routing-samples.json` | 2 smoke titles | n/a | Synthetic `adq9999` / `adp0001`. **Not gold.** |
| `test/fixtures/rss-snapshots/2026-05-22` and `2026-05-24` | raw RSS | n/a | Not gate snapshots; would need re-normalization. Not used. |
| `data/raw` | gitignored | n/a | Cannot claim restored titles from raw. |
| GitHub Actions run [36598521687](https://github.com/VanessaLin9/sci-search/actions/runs/36598521687) | inaccessible (API 403) | n/a | The 2026-09-30 `papers.json` in git is the recoverable snapshot for that day, including excluded papers. |

## Sampling population

- Date range: **2026-05-22 – 2026-10-02** (105 processed days with recoverable JSON).
- Unique broad-science articles after DOI grouping: **2487**.
- Historical method mix (reference only): llm 1507, keyword-fallback 710, missing-method excluded from eligible included papers.
- Unique historical verdict mix (reference only): yes 972, no 1507, not_sure 8.
- Eligible gate samples require `llm` or `routing-keyword-fallback` (or excluded with a recoverable title). **scope-default / life-science-only papers were not sampled.**

## Gaps and bias

- **PNAS:** configured as broad-science, but **0 papers** in the recoverable processed history. Do not invent PNAS items.
- **Science:** only 32 unique articles in the pool; general quota oversamples it (12/70) relative to Science Advances.
- **Science Advances** dominates the pool (~57% of unique articles). Quotas cap it in the general set.
- **Keyword-fallback days** (timeout / degrade) are common; historical fallback verdicts are **reference only**, never gold.
- **Historical disagreement** (same DOI, different stored verdicts): **0 groups**. Hard quota could not be filled.
- **Interdisciplinary hard tag:** wanted 8, found 6.
- Target 100 was reached by topping up 5 extra general cases after those hard-tag shortfalls.
- Probe fixtures and later re-crawls are not treated as original gate inputs.

## Sampling rules (v1)

- Seed `20261003`; 60% dev / 40% eval, stratified by `sampleGroup` × `source_id`, split by article `groupId`.
- Hard cases sampled first (news/commentary, vague title, interdisciplinary, keyword-fallback, disagreement), then general by source, then top-up.
- General and hard scores must be reported separately. Hard is not a substitute for online accuracy.
