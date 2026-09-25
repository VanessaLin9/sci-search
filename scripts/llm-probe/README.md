# LLM probe toolkit

營運用（非正式 CI）：NVIDIA / Gemini endpoint 會換、會下架，這裡集中 **可進 git、可累積** 的試戳腳本與固定測資。

金鑰只讀專案根目錄 `.env`；log 只印 mask，**不要把 raw key 貼進聊天或 commit**。

正式實驗結論寫 Notion；本機草稿可放 `notes/`（已 gitignore）。

## Scripts

| npm | 用途 |
| --- | --- |
| `npm run probe:endpoint` | `/models` 目錄 + 最小 chat smoke |
| `npm run probe:routing` | 正式 routing prompt（生醫／physics fixture） |
| `npm run probe:summarize` | featured 繁中摘要（正式 summarize prompt） |
| `npm run probe:translate` | overflow 標題翻譯（正式 translate prompt；**無 production fallback**） |

舊別名仍可用：`probe-llm` → endpoint；`test-routing-llm` → routing。

## 常用指令

預設都吃 `fixtures/`，**不必再找 `data/processed/{date}`**：

```bash
# 目錄還在嗎？
npm run probe:endpoint -- --list --grep muse,gemini,gpt-oss

# 候選還活著？
npm run probe:endpoint -- meta/muse-glimmer-30b
npm run probe:endpoint -- --use-digest-fallback

# ROUTING（分類；中文不重要，要快 + JSON）
npm run probe:routing -- --model meta/muse-glimmer-30b
npm run probe:routing -- --model meta/muse-glimmer-30b --fixture physics
npm run probe:routing -- --use-digest-fallback

# DIGEST summarize（fixture：短／中／長 abstract）
npm run probe:summarize -- --model meta/muse-glimmer-30b --limit 2
npm run probe:summarize -- --use-digest-fallback --limit 2

# DIGEST translate（fixture：overflow 標題）
npm run probe:translate -- --model meta/muse-glimmer-30b
npm run probe:translate -- --limit 5
npm run probe:translate -- --use-digest-fallback
```

可選覆寫：

```bash
# 臨時用某日 processed（可能已被 prune）
npm run probe:summarize -- --date 2026-09-19 --limit 2
npm run probe:summarize -- --file path/to/papers.json
npm run probe:translate -- --file path/to/papers.json --limit 3
```

## Fixtures

見 [`fixtures/README.md`](./fixtures/README.md)。

| 檔案 | 預設給 |
| --- | --- |
| `fixtures/routing-samples.json` | `probe:routing` |
| `fixtures/summarize-samples.json` | `probe:summarize` |
| `fixtures/translate-samples.json` | `probe:translate` |

## 選型提醒

- **ROUTING**：速度 + JSON verdict；中文品質次要
- **Summarize／Translate**：繁中品質重要。兩邊失敗都會走 `DIGEST_LLM_FALLBACK_*`；`--use-digest-fallback` 是讓 probe 一開始就打 fallback endpoint
- NVIDIA free 下架很常見：先 `probe:endpoint`，再打對應階段 probe
- 單篇／短樣 OK ≠ daily 連打 OK（留意 429／503）

## 本機筆記

```bash
# 草稿（不進 git）
scripts/llm-probe/notes/
```
