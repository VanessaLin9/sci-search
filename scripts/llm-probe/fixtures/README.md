# Probe fixtures（進 git）

固定測資，**不依賴** `data/processed/{date}/`（會被 prune／換日）。

| 檔案 | 給誰用 | 內容 |
| --- | --- | --- |
| `routing-samples.json` | `probe:routing` | 生醫／physics 短樣 |
| `summarize-samples.json` | `probe:summarize` | featured 3 篇：短／中／長 abstract |
| `translate-samples.json` | `probe:translate` | overflow 標題短樣（`featured=false`） |

預設指令不需加 `--date`／`--file`：

```bash
npm run probe:summarize -- --model meta/muse-glimmer-30b --limit 2
npm run probe:translate -- --model meta/muse-glimmer-30b
```

仍可用 `--file` 覆寫；summarize 也可用 `--date YYYY-MM-DD` 讀當日 `data/processed/`（可選）。
