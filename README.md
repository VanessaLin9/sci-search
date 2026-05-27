# Paper Digest

Daily **life-science** paper digest: collect journal RSS feeds, filter with an LLM gate, pick up to **12 featured** articles with Traditional Chinese summaries, email subscribers, and publish the same HTML on **GitHub Pages** for preview.

Report date defaults to **yesterday (Asia/Taipei)**.

## What MVP v1 delivers

| Output | Description |
|--------|-------------|
| **Email** | HTML digest via [Resend](https://resend.com): featured cards (EN title, 繁中副標, 繁中摘要, English topic tags) in 主線 A / B / 預印本 sections, plus overflow titles grouped by journal |
| **Public preview** | [`docs/index.html`](docs/index.html) updated by CI — enable Pages from `/docs` on `main` |
| **Data** | `data/processed/{date}/papers.json` — routing stats, digest fields, excluded papers |

## Pipeline

```text
sources (config/sources.json)
  → fetch RSS → normalize → dedupe → filter by report date
  → life-science routing (2a): broad-science titles → LLM yes/no/not_sure
  → enrich abstracts (Nature HTML, etc.)
  → keyword section (legacy field, still in JSON)
  → digest phase (2b, ENABLE_LLM_DIGEST=1):
       tag digestLine (line-a | line-b | preprint | skip), batch LLM
       select featured ≤12 (line priority → source priority)
       summarize featured: one API call per paper → titleZh, summaryZh, topicTags
       translate overflow titles: batch LLM → titleZh only
  → papers.json
  → send-digest (email) + write-preview (docs/)
```

Papers with routing `no`, enrich drop, or digest `skip` do not appear in the email body.

## Email layout

**Featured (max 12)** — full card per paper:

- English headline (link)
- 繁中標題 (`titleZh`)
- English `topicTags`
- 繁中摘要 (`summaryZh`, 3–5 sentences from abstract)
- Grouped by `digestLine`: 單細胞/空間組學 (A), 其他重要生物學 (B), preprint placeholder

**Overflow (13+)** — compact list:

- Grouped by journal; EN title link + gray 繁中標題 when translation ran

## Commands

```bash
npm ci
npm run check
```

| Script | Purpose |
|--------|---------|
| `npm run dev` | Full pipeline → `data/processed/{date}/papers.json` |
| `npm run send-digest` | Email from existing `papers.json` |
| `npm run write-preview` | `docs/index.html` + `docs/archive/{date}.html` |
| `npm run daily` | `dev` → `send-digest` → `write-preview` |
| `npm run test-routing-llm` | One-paper routing smoke test |
| `npm run test-digest-llm` | One-paper digest tagging smoke test |
| `npm run test:e2e` | Golden pipeline acceptance test (fixture RSS + mock LLM, no network) |

Date flag (all three main commands):

```bash
npm run dev -- --date 2026-05-22
npm run send-digest -- --date 2026-05-22 --dry-run
npm run write-preview -- --date 2026-05-22
```

`test-digest-llm -- --use-routing` uses routing API key/model with digest caps from `config/digest.json`.

### RSS snapshots for tests

Record live feeds once (commit the XML under `test/fixtures/rss-snapshots/{date}/`):

```bash
npm run snapshot-rss -- --date 2026-05-22
npm run snapshot-rss -- --date 2026-05-24
```

Each run writes `{sourceId}.xml` plus `manifest.json` (item counts and how many entries match the report date in Taipei).

E2E tests load these files via `createMockFetch({ reportDate: "2026-05-22" })` — no live RSS, Crossref, or LLM calls.

### E2E acceptance tests

`npm run test:e2e` runs a deterministic golden pipeline:

- Fixture RSS: [`test/fixtures/golden/rss/nature-methods.xml`](test/fixtures/golden/rss/nature-methods.xml)
- Mock LLM responses (routing / tagging / summarize / translate)
- Asserts `papers.json` schema, selection stats, plain-text titles, featured fields, and digest HTML structure (blue links, DOI line, no leaked HTML tags)

CI runs this step before the daily collect job (no API keys required).

## Configuration

**Versioned (no secrets)**

| File | Role |
|------|------|
| [`config/sources.json`](config/sources.json) | RSS feeds, `scope` (`life-science-only` / `broad-science`), `priority` |
| [`config/keywords.json`](config/keywords.json) | Keyword fallback for `section` / digest line |
| [`config/routing.json`](config/routing.json) | Routing LLM endpoint, batch, tokens |
| [`config/digest.json`](config/digest.json) | `maxFeatured`, digest LLM limits, `summarizeConcurrency` |
| [`config/email.json`](config/email.json) | `fromEmail`, `fromName`, `subjectPrefix` (not secrets) |

**Environment (`.env` locally, Secrets in CI)** — copy from [`.env.example`](.env.example):

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | for email | Resend API key |
| `DIGEST_TO_EMAIL` | for email | JSON array or comma-separated recipients |
| `DIGEST_FROM_EMAIL` | no | Override [`config/email.json`](config/email.json) |
| `DIGEST_FROM_NAME` | no | Override display name in `config/email.json` |
| `RESEND_ACCOUNT_EMAIL` | sandbox | Your Resend login; other `DIGEST_TO_EMAIL` addresses skipped until domain verified |
| `DIGEST_SUBJECT_PREFIX` | no | Default `Paper Digest` |
| `ROUTE_LIFE_SCIENCE` | no | `1` to enable routing (on in CI) |
| `ROUTING_LLM_API_KEY` | if routing | Or `NVIDIA_API_KEY` / `OPENAI_API_KEY` |
| `ROUTING_LLM_MODEL` | if routing | Model id (not in repo) |
| `ENABLE_LLM_DIGEST` | no | `1` for LLM tagging + summarize + translate |
| `DIGEST_LLM_API_KEY` | no | Falls back to routing key |
| `DIGEST_LLM_MODEL` | if digest on | e.g. `minimaxai/minimax-m2.7` on NVIDIA integrate |
| `DEBUG_NORMALIZED` | no | `1` for verbose logs |

Digest logs use `[digest]`; routing uses `[routing]` (not gated by debug).

## GitHub Actions

Workflow: [`.github/workflows/daily.yml`](.github/workflows/daily.yml)

- **Schedule:** 06:30 Asia/Taipei daily (`workflow_dispatch` supported)
- **Steps:** resolve date → `dev` → `send-digest` → `write-preview` → artifact → commit `data/processed/{date}/` and `docs/`

### Repository secrets

| Secret | Required | Notes |
|--------|----------|-------|
| `RESEND_API_KEY` | yes | |
| `DIGEST_TO_EMAIL` | yes | All intended recipients (JSON array); used fully after domain verify |
| `RESEND_ACCOUNT_EMAIL` | yes (sandbox) | Your Resend login email — required while `DIGEST_FROM_EMAIL` is `onboarding@resend.dev` |
| `ROUTING_LLM_API_KEY` | yes | Used for routing; digest can reuse via fallback |
| `ROUTING_LLM_MODEL` | yes | |
| `DIGEST_LLM_MODEL` | recommended | CI falls back to `ROUTING_LLM_MODEL` if unset |
| `DIGEST_LLM_API_KEY` | no | Optional separate key |
| `DIGEST_SUBJECT_PREFIX` | no | Override `config/email.json` if needed |

**Resend sandbox:** `onboarding@resend.dev` only delivers to your account inbox. Set `RESEND_ACCOUNT_EMAIL` to that address; extra recipients in `DIGEST_TO_EMAIL` are skipped (warning in log) until you verify a domain and change `DIGEST_FROM_EMAIL`.

### GitHub Pages (public preview)

1. Repo → **Settings** → **Pages**
2. Source: branch **`main`**, folder **`/docs`**
3. After the next successful daily run, open `https://<user>.github.io/<repo>/`

Archives: `docs/archive/YYYY-MM-DD.html`.

## Local quick start

```bash
cp .env.example .env
# Set RESEND_*, ROUTING_LLM_*, ENABLE_LLM_DIGEST=1, DIGEST_LLM_MODEL=...

npm run daily
# Or step by step:
npm run dev
npm run send-digest -- --dry-run
npm run write-preview
open docs/index.html
```

## Project layout (high level)

```text
src/
  pipeline.ts, index.ts          # orchestration
  routing/                       # Phase 2a life-science gate
  digest/                        # Phase 2b tag, select, summarize, translate
  email/                         # Resend + HTML render
  commands/                      # CLI entrypoints
config/                          # sources, keywords, routing, digest
docs/                            # GitHub Pages (generated HTML)
data/processed/{date}/papers.json
```

## MVP v1 scope / known limits

- Preprint section is a **placeholder** until bioRxiv/medRxiv (or similar) is wired in `sources.json`
- **Zero papers** on some weekends/holidays → empty-state email and preview (expected)
- Email and preview share one renderer; no separate “subscriber-only” content
- LLM costs and latency scale with paper count (tagging batches + 12 summarize calls + overflow translate)
- `section` from keywords remains in JSON for compatibility; **email uses `digestLine` + `featured`**, not the old three keyword sections

## License / attribution

Private prototype; adjust as needed for your lab or project policy.
