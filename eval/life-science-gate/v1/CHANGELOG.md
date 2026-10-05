# Life-science gate eval dataset v1

## Changelog

- **1.0.0** (2026-10-03): 100 broad-science historical cases with AI drafts. Gold is **pending Vanessa review**. Official scores must exclude these cases until `annotationStatus=reviewed`.
- **1.0.0** (2026-10-04): Pin `fallbackPolicy` (keyword-fallback snapshot + hash) so rescoring cannot silently drift with live `routing-keywords.json`. Gold is still pending review; version stays `1.0.0`.

## Hashes

Recorded after `npm run eval:life-science-gate -- validate`:

- datasetVersion: `1.0.0`
- file SHA-256: `892f9d17c7a0d3df5a94fef166ed7d246c29e6f5e36681214421d1fe8863b65c`
- policyId: `life-science-routing-title-only-v1`
- policyHash (SHA-256 of `ROUTING_SYSTEM_PROMPT`): `5a1015a109b66daf15874701ca385d687826cb63efc5a06728192bc9abe60bc1`
- fallbackPolicy.id: `routing-keyword-fallback-v1`
- fallbackPolicy.hash: `5c0fb9bf8984088b622517e9b123acdab0d3b61f62a51287916c69757241d7f7`

Changing gold, adding cases, or editing the routing prompt requires a new dataset version and a fresh hash. Do not mix scores across versions. Changing `routing-keywords.json` without updating this snapshot fails score with `fallback_policy_hash_mismatch`.
