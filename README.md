# Paper Digest

Daily paper digest prototype for RSS/API based science monitoring.

## First goals

1. Read source definitions from `config/sources.json`.
2. Fetch RSS/API metadata.
3. Normalize papers into one schema.
4. Filter by date and keywords.
5. Render static HTML into `docs/`.

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
