# Paper Digest

Daily paper digest prototype for RSS/API based science monitoring.

## Pipeline

1. Load sources and keywords
2. Fetch RSS/API metadata
3. Normalize to a shared `Paper` schema (per-source normalizers)
4. Dedupe and filter by report date (Asia/Taipei, default yesterday)
5. (Optional) **Life-science routing** — title-only LLM gate for `broad-science` sources (`no` → skip enrich)
6. Enrich missing metadata (only papers that passed routing; e.g. Nature abstract from HTML)
7. Tag keywords and classify section
8. Write `data/processed/{reportDate}/papers.json`
9. (Optional) Send HTML digest email via [Resend](https://resend.com)

## Commands

```bash
npm run dev
npm run send-digest
npm run write-preview  # docs/index.html for GitHub Pages (from latest papers.json)
npm run daily          # dev + send-digest + write-preview
npm run check
```

`send-digest` only reads `data/processed/{date}/papers.json`. After changing filters or enrich logic, run `npm run dev` first (it overwrites the file; no need to delete manually).

```bash
npm run dev -- --date 2026-05-22
npm run send-digest -- --date 2026-05-22
```

### Email digest (Resend)

After `npm run dev` writes `papers.json`, send the digest:

```bash
npm run send-digest
npm run send-digest -- --date 2026-05-22
npm run send-digest -- --dry-run
```

Requires `RESEND_API_KEY`, `DIGEST_TO_EMAIL`, and `DIGEST_FROM_EMAIL` in `.env` (see `.env.example`). Free Resend accounts can use `onboarding@resend.dev` as the sender until a domain is verified.

One-shot local run (collect + email):

```bash
npm run daily
```

### GitHub Actions

Workflow: [`.github/workflows/daily.yml`](.github/workflows/daily.yml)

- Schedule: **06:30 Asia/Taipei** daily (`workflow_dispatch` also supported).
- Steps: `npm run dev` → `npm run send-digest` → `npm run write-preview` → commit `data/processed/{date}/` and `docs/` → upload artifact.

### Public preview (GitHub Pages)

The latest digest HTML is published from the [`docs/`](docs/) folder (same layout as the email). After each daily run, CI updates `docs/index.html` and `docs/archive/{date}.html`.

**One-time setup:** GitHub repo → **Settings** → **Pages** → Build and deployment → **Deploy from a branch** → Branch `main`, folder **`/docs`**.

Share the site URL (e.g. `https://<user>.github.io/<repo>/`) so people can preview before subscribing.

Add these **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Required | Notes |
|--------|----------|-------|
| `RESEND_API_KEY` | yes | Resend API key |
| `DIGEST_TO_EMAIL` | yes | JSON array or comma-separated recipients |
| `ROUTING_LLM_API_KEY` | yes (if routing on) | Legacy fallbacks: `NVIDIA_API_KEY`, `OPENAI_API_KEY` |
| `ROUTING_LLM_MODEL` | yes (if routing on) | Model id — not committed (private) |
| `DIGEST_LLM_MODEL` | no | Digest tagging/summary model; defaults to `ROUTING_LLM_MODEL` in CI |
| `DIGEST_LLM_API_KEY` | no | Falls back to `ROUTING_LLM_API_KEY` in code |
| `DIGEST_FROM_EMAIL` | no | Default `onboarding@resend.dev` |
| `DIGEST_SUBJECT_PREFIX` | no | Default `Paper Digest` |

The workflow sets `ROUTE_LIFE_SCIENCE=1`. Non-secret routing settings (endpoint, batch size, token limits) live in [`config/routing.json`](config/routing.json).

After the first successful run, open the commit on `main` or download the `papers-{date}` artifact from the Actions run to inspect collected data.

### Local environment

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG_NORMALIZED` | off | `1` or `true` for verbose pipeline logs |
| `ROUTE_LIFE_SCIENCE` | off locally | `1` to run Phase 2a routing (CI enables this in `daily.yml`) |
| `ROUTING_LLM_API_KEY` | — | When routing is on; or legacy `NVIDIA_API_KEY` / `OPENAI_API_KEY` |
| `ROUTING_LLM_MODEL` | — | **Required** when routing is on; keep in `.env` only |
| `RESEND_API_KEY` | — | For `send-digest` |
| `DIGEST_TO_EMAIL` | — | Recipients for digest email |
| `DIGEST_FROM_EMAIL` | `onboarding@resend.dev` | Sender address |
| `DIGEST_SUBJECT_PREFIX` | `Paper Digest` | Email subject prefix |

Routing logs are prefixed with `[routing]` and print even when `DEBUG_NORMALIZED` is off.

### Debug routing LLM (single Science paper)

```bash
npm run test-routing-llm
npm run test-routing-llm -- --model your-model-id
npm run test-routing-llm -- --fixture physics
npm run test-routing-llm -- --title "Your paper title here"
```

Prints config, request params, raw API response, and parsed verdict. Uses `.env` for API key and model; endpoint/batch settings from `config/routing.json`. Does not run the full RSS pipeline.

One-off without editing `.env`:

```bash
DEBUG_NORMALIZED=1 npm run dev
```
