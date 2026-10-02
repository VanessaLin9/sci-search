# Life-science gate eval dataset v1

## Changelog

- **1.0.0** (2026-10-03): 100 broad-science historical cases with AI drafts. Gold is **pending Vanessa review**. Official scores must exclude these cases until `annotationStatus=reviewed`.

## Hashes

Recorded after `npm run eval:life-science-gate -- validate`:

- datasetVersion: `1.0.0`
- file SHA-256: `dcdc989475ea23f58b9c9167f301de300a1c00c9c71953bef4a94fe46924709c`
- policyId: `life-science-routing-title-only-v1`
- policyHash (SHA-256 of `ROUTING_SYSTEM_PROMPT`): `5a1015a109b66daf15874701ca385d687826cb63efc5a06728192bc9abe60bc1`

Changing gold, adding cases, or editing the routing prompt requires a new dataset version and a fresh hash. Do not mix scores across versions.
