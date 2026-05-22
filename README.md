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

## Commands

```bash
npm run dev
npm run check
```

Environment variables (optional `.env`, see `.env.example`):

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG_NORMALIZED` | off | Set to `1` or `true` for verbose logs (`console.table`, classified samples). `0` or unset for cron-friendly output. |

One-off without editing `.env`:

```bash
DEBUG_NORMALIZED=1 npm run dev
```
