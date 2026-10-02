# Life-science routing gate evaluation

Offline dataset and scoring for the **broad-science life-science gate** (`yes` / `no` / `not_sure`). This is not a Jev adapter and does not change production routing.

## What is in v1

- `v1/dataset.json` — 100 historical cases, AI drafts, **gold pending review**
- `v1/review.csv` — review table for Vanessa
- `v1/CHANGELOG.md` — version and hashes
- `SOURCE_INVENTORY.md` — recoverable sources, bias, gaps

Model-visible input is only `id`, `title`, `journal`, `source_id`. Drafts and historical LLM/keyword verdicts are reference, not gold.

## Commands (offline, no API key)

```bash
npm run eval:life-science-gate -- validate
npm run eval:life-science-gate -- export-review --out eval/life-science-gate/v1/review.csv
npm run eval:life-science-gate -- apply-review --review eval/life-science-gate/v1/review.csv --out eval/life-science-gate/v1/dataset.json
npm run eval:life-science-gate -- export-request --split eval
npm run eval:life-science-gate -- score --predictions path/to/predictions.json
```

Stdout is JSON. Progress and diagnostics go to stderr. `score` exits `1` if IDs, dataset version, or hash checks fail.

After review, only `annotationStatus=reviewed` rows enter official scores. Pending and disputed rows are listed and excluded.

## Annotation rules

- **yes:** visible fields are enough to judge life-science research (biology, medicine, neuroscience, ecology, biotech, AI-for-biology, and the other fields in the routing prompt).
- **no:** visible fields are enough to judge not life science, **including** news / commentary / editorial / career / obituary / erratum / correction under current policy.
- **not_sure:** the title is too vague; do not read the full text to force yes/no.
- Do not copy old model or keyword-fallback answers as gold.

## Scoring

Reports, separately:

1. Semantic 3-way confusion / precision / recall on successful model verdicts
2. Service failures (`timeout`, `http_429`, `http_5xx`, `empty`, `malformed`, `missing`)
3. Product include/exclude using the existing rule: `yes` and `not_sure` include, `no` excludes; keyword fallback is applied only when the model result is unavailable

`not_sure` is never treated as `no`. Keyword-fallback success is never counted as model success. Missing cost / tokens / latency is `unavailable`, not `0`. Zero denominators are `N/A`.

General vs hard, and dev vs eval, are counted separately in the report. Do not read the hard set as online accuracy.

## Online comparison protocol (for a later ticket)

Keep this dataset version, visible fields, and semantic rules fixed. A later Jev/LLM adapter may use a native API.

Record for every run: model id/version, request date, environment, batch size, concurrency, timeout, retries, quota wait, cache, full settings.

Run each candidate at least 3 times, interleaved. Report per-run wall time, request latency p50/p95 with sample size, failure rate, answer consistency, and cost. A few runs are a first look, not an SLA.

Keep queue wait, HTTP duration, retry, and fallback as separate fields. Failures stay in the denominator. Different batch/concurrency tunings are listed separately, not mixed into one ranking.

Do not tune prompts or thresholds on the frozen eval split.
