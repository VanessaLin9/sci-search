# Paper Digest

Daily paper digest prototype for RSS/API based science monitoring.

## Pipeline

1. Load sources and keywords
2. Fetch RSS/API metadata
3. Normalize to a shared `Paper` schema (per-source normalizers)
4. Dedupe and filter by report date (Asia/Taipei, default yesterday)
5. Enrich missing metadata (e.g. Nature Methods abstract from article HTML)
6. Tag keywords and classify section
7. Write `data/processed/{reportDate}/papers.json`
8. (Optional) **Life-science routing** — `life-science-only` sources pass; `broad-science` sources get a title-only LLM gate (`yes` / `no` / `not_sure`; `no` excluded)
9. (Optional) Send HTML digest email via [Resend](https://resend.com)

## Commands

```bash
npm run dev
npm run send-digest
npm run daily          # dev + send-digest in one shot
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
- Steps: `npm run dev` → `npm run send-digest` → commit `data/processed/{date}/papers.json` → upload artifact.

Add these **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Required | Example |
|--------|----------|---------|
| `RESEND_API_KEY` | yes | `re_...` |
| `DIGEST_TO_EMAIL` | yes | `["you@example.com","mentor@example.com"]` |
| `DIGEST_FROM_EMAIL` | no | `onboarding@resend.dev` (default if omitted) |
| `DIGEST_SUBJECT_PREFIX` | no | `Paper Digest` |

After the first successful run, open the commit on `main` or download the `papers-{date}` artifact from the Actions run to inspect collected data.

Environment variables (optional `.env`, see `.env.example`):

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG_NORMALIZED` | off | Set to `1` or `true` for verbose logs (`console.table`, classified samples). `0` or unset for cron-friendly output. |
| `ROUTE_LIFE_SCIENCE` | off | Set to `1` to run Phase 2a routing after collect. Requires `ROUTING_LLM_API_KEY`, `NVIDIA_API_KEY`, or `OPENAI_API_KEY`. |
| `ROUTING_LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible endpoint (e.g. NVIDIA `https://integrate.api.nvidia.com/v1`). |
| `ROUTING_LLM_MODEL` | `gpt-4o-mini` | Model id (e.g. NVIDIA `z-ai/glm-5.1`). |
| `ROUTING_LLM_ENABLE_THINKING` | off on NVIDIA | Set `1` only if your NVIDIA model needs thinking mode (routing keeps it off by default). |
| `RESEND_API_KEY` | — | Resend API key |
| `DIGEST_FROM_EMAIL` | `onboarding@resend.dev` | Sender address |
| `DIGEST_TO_EMAIL` | — | Recipient(s): JSON array `["a@b.com","c@d.com"]` or comma-separated |
| `DIGEST_SUBJECT_PREFIX` | `Paper Digest` | Email subject prefix |

One-off without editing `.env`:

```bash
DEBUG_NORMALIZED=1 npm run dev
```
