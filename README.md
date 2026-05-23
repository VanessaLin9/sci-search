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
8. (Optional) Send HTML digest email via [Resend](https://resend.com)

## Commands

```bash
npm run dev
npm run send-digest
npm run check
```

### Email digest (Resend)

After `npm run dev` writes `papers.json`, send the digest:

```bash
npm run send-digest
npm run send-digest -- --date 2026-05-22
npm run send-digest -- --dry-run
```

Requires `RESEND_API_KEY`, `DIGEST_TO_EMAIL`, and `DIGEST_FROM_EMAIL` in `.env` (see `.env.example`). Free Resend accounts can use `onboarding@resend.dev` as the sender until a domain is verified.

Environment variables (optional `.env`, see `.env.example`):

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG_NORMALIZED` | off | Set to `1` or `true` for verbose logs (`console.table`, classified samples). `0` or unset for cron-friendly output. |
| `RESEND_API_KEY` | — | Resend API key |
| `DIGEST_FROM_EMAIL` | `onboarding@resend.dev` | Sender address |
| `DIGEST_TO_EMAIL` | — | Recipient(s): JSON array `["a@b.com","c@d.com"]` or comma-separated |
| `DIGEST_SUBJECT_PREFIX` | `Paper Digest` | Email subject prefix |

One-off without editing `.env`:

```bash
DEBUG_NORMALIZED=1 npm run dev
```
