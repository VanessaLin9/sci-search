# Life-science policy inventory (PR-3.5)

**Purpose:** Baseline inventory of every codebase binding to life-science domain knowledge, as input for PR-4 (policy extraction).  
**RFC:** [paper digest RFC](https://www.notion.so/RFC-paper-digest-36edf30cc71c801596c5cada8baef3f7) — §6 B0, §7 PR-3.5.  
**Method:** Independent scan of `origin/main` at implementation time (not copied from RFC §5.4).  
**Scope of this PR:** Documentation only; no `src/`, `test/`, or `config/` changes.

**Entry count:** **52** numbered binding points (`INV-001`–`INV-052`).

---

## How to read each entry

| Column | Meaning |
|--------|---------|
| **Location** | File path and line range, or exported symbol |
| **Binding** | What domain-specific rule or vocabulary is encoded |
| **Strength** | `hardcoded` · `config-driven` · `type-level constraint` |
| **Extraction hint** | Suggested PR-4 target (one line) |

---

## 1. Type-level contracts

### INV-001 — `SourceScope`

| | |
|---|---|
| **Location** | `src/types.ts` L3–L4 |
| **Binding** | Two feed classes: `life-science-only` (skip routing LLM) vs `broad-science` (title-only life-science gate). |
| **Strength** | type-level constraint |
| **Extraction hint** | Move enum + docs to `src/domain/life-science/sourceScope.ts`. |

### INV-002 — `PaperSection`

| | |
|---|---|
| **Location** | `src/types.ts` L6 |
| **Binding** | Keyword buckets: `single-cell-spatial`, `biology`, `other` (maps to digest line-a fallback). |
| **Strength** | type-level constraint |
| **Extraction hint** | Colocate with keyword policy in `src/domain/life-science/sections.ts`. |

### INV-003 — `DigestLine`

| | |
|---|---|
| **Location** | `src/types.ts` L8–L9 |
| **Binding** | Email main-line taxonomy: `line-a`, `line-b`, `preprint`, `skip`. |
| **Strength** | type-level constraint |
| **Extraction hint** | Move to `src/domain/life-science/digestLines.ts` and re-export from `types.ts` during migration. |

### INV-004 — `LifeScienceRoutingVerdict` / `LifeScienceRoutingMethod` / `LifeScienceRouting`

| | |
|---|---|
| **Location** | `src/types.ts` L13–L21 |
| **Binding** | Phase 2a verdicts (`yes`/`no`/`not_sure`) and pass method (`scope-default`/`llm`). |
| **Strength** | type-level constraint |
| **Extraction hint** | Move routing result types to `src/domain/life-science/routing/types.ts`. |

### INV-005 — `Source.scope` field

| | |
|---|---|
| **Location** | `src/types.ts` L30; validated in `src/config.ts` L13 |
| **Binding** | Each feed carries routing scope used by `routeLifeSciencePapers`. |
| **Strength** | type-level constraint + config-driven values |
| **Extraction hint** | Keep on `Source` but load scope table from domain policy module fed by config. |

### INV-006 — `Paper.lifeScienceRouting`

| | |
|---|---|
| **Location** | `src/types.ts` L45–L46 |
| **Binding** | Optional routing outcome attached after Phase 2a. |
| **Strength** | type-level constraint |
| **Extraction hint** | Same module as INV-004. |

### INV-007 — `ClassifiedPaper` digest fields

| | |
|---|---|
| **Location** | `src/types.ts` L49–L61 (`section`, `digestLine`, `digestTaggingMethod`, `featured`, zh copy, `topicTags`) |
| **Binding** | Persisted shape for keyword section + digest line + featured selection + email copy. |
| **Strength** | type-level constraint |
| **Extraction hint** | Split domain fields into `LifeSciencePaperView` interface composed onto `Paper`. |

### INV-008 — `BroadScienceRoutingInput` / routing result types

| | |
|---|---|
| **Location** | `src/routing/types.ts` L3–L32 |
| **Binding** | LLM routing I/O; exclusion reason literal `life-science-routing`. |
| **Strength** | type-level constraint |
| **Extraction hint** | Move under `src/domain/life-science/routing/`. |

### INV-009 — Digest LLM I/O types

| | |
|---|---|
| **Location** | `src/digest/types.ts` L4–L38 (`DigestTaggingInput.scope`, `DigestSummarizeInput.digest_line`, selection `lineA`/`lineB`/`preprint`/`skip`) |
| **Binding** | LLM payloads and stats keyed to main-line buckets. |
| **Strength** | type-level constraint |
| **Extraction hint** | Move digest policy types next to prompts in domain module. |

### INV-010 — Processed JSON Zod mirrors

| | |
|---|---|
| **Location** | `src/processedData.ts` L6–L73 (`lifeScienceRoutingSchema`, `section`, `digestLine`, `excludedPaperSchema.reason`, selection line counts) |
| **Binding** | On-disk schema enforces same life-science vocabulary as runtime types. |
| **Strength** | hardcoded (schema literals) |
| **Extraction hint** | Generate Zod from shared domain const objects to avoid drift. |

### INV-011 — CLI / test digest line schema

| | |
|---|---|
| **Location** | `src/commands/testDigestLlm.ts` L40; `src/digest/tagTitles.ts` L13–L19 |
| **Binding** | Duplicate `z.enum(["line-a", "line-b", "preprint", "skip"])` for LLM JSON parsing. |
| **Strength** | hardcoded |
| **Extraction hint** | Import single `digestLineSchema` from domain policy module. |

---

## 2. Config data (`config/`)

### INV-012 — Per-source `scope` assignments

| | |
|---|---|
| **Location** | `config/sources.json` (all entries, e.g. L9, L18, L27 … L153) |
| **Binding** | **Broad-science** (LLM gate): `nature`, `science`, `science-advances`, `pnas`, `nature-communications`. **Life-science-only** (auto-yes): all other configured feeds including `cell`, Nature verticals, `elife`, `plos-biology`, `biorxiv`. |
| **Strength** | config-driven |
| **Extraction hint** | Move to `src/domain/life-science/sources.scope.json` or TS table; keep `config/sources.json` as re-export during transition. |

### INV-013 — Source catalog = life-science journals

| | |
|---|---|
| **Location** | `config/sources.json` (full file); `src/pipeline.ts` `DEFAULT_RSS_SOURCE_IDS` L23–L39 |
| **Binding** | Curated list of life-science (and adjacent) journals/preprint feed IDs used by default pipeline. |
| **Strength** | config-driven + hardcoded default ID list |
| **Extraction hint** | Single `lifeScienceSources` registry; pipeline reads IDs from config only. |

### INV-014 — Primary keywords (single-cell / spatial)

| | |
|---|---|
| **Location** | `config/keywords.json` L2–L28 |
| **Binding** | English tokens (MERFISH, Visium, scRNA-seq, spatial omics, …) defining `single-cell-spatial` section. |
| **Strength** | config-driven |
| **Extraction hint** | `src/domain/life-science/keywords.primary.ts` (or JSON) consumed by classify step. |

### INV-015 — Biology keywords

| | |
|---|---|
| **Location** | `config/keywords.json` L30–L42 |
| **Binding** | Tokens (neuroscience, immunology, CRISPR, cancer, …) defining `biology` section (line-b fallback). |
| **Strength** | config-driven |
| **Extraction hint** | `src/domain/life-science/keywords.biology.ts`. |

### INV-016 — `maxFeatured` cap

| | |
|---|---|
| **Location** | `config/digest.json` L2; consumed `src/digest/runDigestPhase.ts` L77 |
| **Binding** | Product rule: at most 12 featured cards in life-science digest email. |
| **Strength** | config-driven |
| **Extraction hint** | `src/domain/life-science/digestPolicy.ts` (`maxFeatured: 12`). |

### INV-017 — Email product branding

| | |
|---|---|
| **Location** | `config/email.json` L3–L5; override `DIGEST_SUBJECT_PREFIX` in `src/email/config.ts` L40 |
| **Binding** | Traditional Chinese product name **每日科學期刊摘要** and subject prefix (life-science digest branding). |
| **Strength** | config-driven |
| **Extraction hint** | `src/domain/life-science/emailBranding.ts` (or locale bundle). |

---

## 3. Routing (Phase 2a)

### INV-018 — `routeLifeSciencePapers`

| | |
|---|---|
| **Location** | `src/routing/routeLifeScience.ts` L26–L117 (`routeLifeSciencePapers`) |
| **Binding** | Splits papers by scope; auto-includes life-science-only; LLM-classifies broad-science; excludes `no` verdicts. |
| **Strength** | hardcoded (control flow + log strings) |
| **Extraction hint** | Thin orchestrator calling `src/domain/life-science/routing/route.ts`. |

### INV-019 — Scope-default auto-yes

| | |
|---|---|
| **Location** | `src/routing/routeLifeScience.ts` L54–L57 |
| **Binding** | `life-science-only` feeds never call LLM; verdict forced to `yes` / `scope-default`. |
| **Strength** | hardcoded |
| **Extraction hint** | Policy function `passesScopeDefault(scope)`. |

### INV-020 — `classifyBroadSciencePapers`

| | |
|---|---|
| **Location** | `src/routing/classifyBroadScience.ts` L84–L127 (`classifyBroadSciencePapers`) |
| **Binding** | Batched LLM life-science gate for broad-science titles. |
| **Strength** | hardcoded |
| **Extraction hint** | Keep transport here; move verdict merge rules to domain. |

### INV-021 — `ROUTING_SYSTEM_PROMPT`

| | |
|---|---|
| **Location** | `src/routing/routingPrompt.ts` L5–L19 (`ROUTING_SYSTEM_PROMPT`) |
| **Binding** | Defines life sciences vs non-life-sciences (physics, CS, geology, …) and `not_sure` for vague titles. |
| **Strength** | hardcoded |
| **Extraction hint** | `src/domain/life-science/prompts/routing.system.ts`. |

### INV-022 — `buildSourceScopeById` / `getSourceScope`

| | |
|---|---|
| **Location** | `src/routing/sourceScope.ts` L3–L16 |
| **Binding** | Resolves `sourceId` → `SourceScope`; unknown ID throws. |
| **Strength** | hardcoded (lookup only; values from config) |
| **Extraction hint** | Inject scope map from domain registry. |

### INV-023 — `isLifeScienceRoutingEnabled`

| | |
|---|---|
| **Location** | `src/routing/config.ts` L3–L6, L38–L40 |
| **Binding** | Feature flag `ROUTE_LIFE_SCIENCE`; error text names life-science routing. |
| **Strength** | hardcoded |
| **Extraction hint** | Domain feature flag wrapper (env name can stay). |

### INV-024 — Pipeline wires routing before classify

| | |
|---|---|
| **Location** | `src/pipeline.ts` L13–L14, L81–L86 |
| **Binding** | `runPipeline` calls `routeLifeSciencePapers` then enriches only `routing.included`. |
| **Strength** | hardcoded |
| **Extraction hint** | Pipeline imports domain routing service interface only. |

---

## 4. Keyword / section classification (pre–digest line)

### INV-025 — `classifyPaperSection`

| | |
|---|---|
| **Location** | `src/filterPapers.ts` L33–L37 (`classifyPaperSection`) |
| **Binding** | Priority: primary keyword hits → `single-cell-spatial`; else biology keywords → `biology`; else `other`. |
| **Strength** | hardcoded |
| **Extraction hint** | `classifySection(matches)` in domain keyword module. |

### INV-026 — `SECTIONS` constant

| | |
|---|---|
| **Location** | `src/filterPapers.ts` L5 |
| **Binding** | Fixed list of `PaperSection` values for counting/debug. |
| **Strength** | hardcoded |
| **Extraction hint** | Export `PAPER_SECTIONS` from domain. |

### INV-027 — `classifyPaper` / `classifyPapers`

| | |
|---|---|
| **Location** | `src/pipeline.ts` L103–L117 (`classifyPaper`, `classifyPapers`) |
| **Binding** | Applies `config/keywords.json` to title+abstract; sets `matchedKeywords` and `section`. |
| **Strength** | config-driven + hardcoded |
| **Extraction hint** | Domain `classifyPaperKeywords(paper, keywordPolicy)`. |

---

## 5. Digest line classification (Phase 2b)

### INV-028 — `digestLineFromKeywords`

| | |
|---|---|
| **Location** | `src/digest/keywordDigestLine.ts` L4–L11 (`digestLineFromKeywords`) |
| **Binding** | `biorxiv` → `preprint`; `single-cell-spatial` section → `line-a`; else `line-b`. |
| **Strength** | hardcoded |
| **Extraction hint** | `fallbackDigestLine(paper)` in domain digest policy. |

### INV-029 — `DIGEST_TAGGING_SYSTEM_PROMPT`

| | |
|---|---|
| **Location** | `src/digest/taggingPrompt.ts` L5–L20 (`DIGEST_TAGGING_SYSTEM_PROMPT`) |
| **Binding** | Line-a/b definitions (single-cell/spatial omics vs other life-science); preprint= bioRxiv; skip= non-LS/editorial/physics; prefer line-b when unsure. |
| **Strength** | hardcoded |
| **Extraction hint** | `src/domain/life-science/prompts/tagging.system.ts`. |

### INV-030 — `tagTitlesWithLlm` + keyword fallback

| | |
|---|---|
| **Location** | `src/digest/tagTitles.ts` L44–L108, L183–L193; `src/digest/runDigestPhase.ts` L12–L29, L107–L108 |
| **Binding** | LLM assigns `digest_line`; missing rows fall back to `digestLineFromKeywords`; logs line-a/b/preprint/skip counts. |
| **Strength** | hardcoded |
| **Extraction hint** | Domain `resolveDigestLines(papers, llmResults, fallbackPolicy)`. |

### INV-031 — Scope passed into tagging/summarize inputs

| | |
|---|---|
| **Location** | `src/digest/toTaggingInput.ts` L10–L17; `src/digest/toSummarizeInput.ts` L10–L18 |
| **Binding** | Default scope `life-science-only` when unknown; `digest_line` forwarded to summarize LLM. |
| **Strength** | hardcoded default |
| **Extraction hint** | `resolveSourceScope(sourceId, scopeMap)` in domain. |

### INV-032 — `runDigestPhase` orchestration

| | |
|---|---|
| **Location** | `src/digest/runDigestPhase.ts` L71–L197 (`runDigestPhase`) |
| **Binding** | Tag → select featured → summarize featured → translate overflow; filters `digestLine !== "skip"`. |
| **Strength** | hardcoded |
| **Extraction hint** | Pipeline stage calls domain digest orchestrator. |

### INV-033 — `isDigestLlmEnabled`

| | |
|---|---|
| **Location** | `src/digest/config.ts` L6–L9 |
| **Binding** | `ENABLE_LLM_DIGEST` toggles LLM tagging/summarize/translate for life-science digest. |
| **Strength** | hardcoded |
| **Extraction hint** | Feature flag next to routing flag in domain config. |

---

## 6. LLM prompts (summarize / translate)

### INV-034 — `DIGEST_SUMMARIZE_SYSTEM_PROMPT`

| | |
|---|---|
| **Location** | `src/digest/summarizePrompt.ts` L5–L16 |
| **Binding** | "daily life-science email digest"; topic tag examples (`single-cell`, `cancer`, `neuroscience`). |
| **Strength** | hardcoded |
| **Extraction hint** | `src/domain/life-science/prompts/summarize.system.ts`. |

### INV-035 — `DIGEST_TRANSLATE_SYSTEM_PROMPT`

| | |
|---|---|
| **Location** | `src/digest/translatePrompt.ts` L5–L15 |
| **Binding** | Overflow title translation for digest list (product context: Traditional Chinese digest). |
| **Strength** | hardcoded |
| **Extraction hint** | `src/domain/life-science/prompts/translate.system.ts`. |

---

## 7. Selection and ranking

### INV-036 — `LINE_RANK` featured ordering

| | |
|---|---|
| **Location** | `src/digest/selectFeatured.ts` L4–L9, L28–L31 (`LINE_RANK`, `compareForFeatured`) |
| **Binding** | Featured sort priority: line-a < line-b < preprint < skip; then source `priority`; then title. |
| **Strength** | hardcoded |
| **Extraction hint** | `digestLineRank` map in domain selection policy. |

### INV-037 — `selectFeaturedPapers`

| | |
|---|---|
| **Location** | `src/digest/selectFeatured.ts` L40–L76 (`selectFeaturedPapers`) |
| **Binding** | Candidates exclude `skip`; top `maxFeatured` by digest rank; tracks lineA/lineB/preprint/skip counts. |
| **Strength** | hardcoded + config-driven (`maxFeatured`) |
| **Extraction hint** | Domain `selectFeatured(papers, policy)`. |

### INV-038 — Default line-b for unknown digest line in HTML

| | |
|---|---|
| **Location** | `src/email/renderDigestHtml.ts` L185–L191 |
| **Binding** | Featured papers with missing/unknown `digestLine` bucketed into line-b. |
| **Strength** | hardcoded |
| **Extraction hint** | Shared `normalizeDigestLine(line)` in domain used by renderer. |

---

## 8. Email renderer and metadata

### INV-039 — `LINE_SECTIONS` (badges + headings)

| | |
|---|---|
| **Location** | `src/email/renderDigestHtml.ts` L11–L35 (`LINE_SECTIONS`) |
| **Binding** | 主線 A「單細胞 / 空間組學」; 主線 B「當日其他重要生物學發現」; 預印本「bioRxiv / medRxiv」; badge labels 主線 A/B, 預印本. |
| **Strength** | hardcoded |
| **Extraction hint** | `src/domain/life-science/email/lineSections.ts` (i18n table). |

### INV-040 — Page title and header subtitle

| | |
|---|---|
| **Location** | `src/email/renderDigestHtml.ts` L218, L223–L224 (`renderDigestHtml`) |
| **Binding** | `<title>每日科學期刊摘要</title>`; subtitle「單細胞/空間組學 + 重要生物學發現」. |
| **Strength** | hardcoded |
| **Extraction hint** | Same branding module as INV-017. |

### INV-041 — Preprint empty-state copy

| | |
|---|---|
| **Location** | `src/email/renderDigestHtml.ts` L95–L98 (`renderDigestLineSection`) |
| **Binding** | 「本期無 preprint 精選。」 |
| **Strength** | hardcoded |
| **Extraction hint** | i18n strings keyed by `DigestLine`. |

### INV-042 — `buildDigestSubject`

| | |
|---|---|
| **Location** | `src/email/renderDigestHtml.ts` L239–L245; used `src/email/sendDigest.ts` L27–L34 |
| **Binding** | Subject `${subjectPrefix} · ${date} (${n} papers)`; visible count excludes `skip`. |
| **Strength** | hardcoded format + config-driven prefix |
| **Extraction hint** | `buildSubject(branding, date, stats)` in domain email module. |

### INV-043 — `visiblePapers` filter

| | |
|---|---|
| **Location** | `src/email/renderDigestHtml.ts` L44–L46; duplicate `src/email/sendDigest.ts` L27–L29 |
| **Binding** | Email body omits papers with `digestLine === "skip"`. |
| **Strength** | hardcoded |
| **Extraction hint** | Domain `isVisibleInDigest(paper)`. |

---

## 9. Orchestration, persistence, observability

### INV-044 — CLI index logging (sections + digest lines)

| | |
|---|---|
| **Location** | `src/index.ts` L68–L89 |
| **Binding** | Logs routing inclusion, section summary, line-a/b/preprint/skip selection stats. |
| **Strength** | hardcoded |
| **Extraction hint** | Log formatters consume domain stats DTOs. |

### INV-045 — `logRoutingSummary`

| | |
|---|---|
| **Location** | `src/debug.ts` L51–L61 (`logRoutingSummary`) |
| **Binding** | User-facing "Life-science routing" message and `ROUTE_LIFE_SCIENCE=1` hint. |
| **Strength** | hardcoded |
| **Extraction hint** | Keep in debug; strings from domain constants. |

### INV-046 — Routing phase logs

| | |
|---|---|
| **Location** | `src/routing/routeLifeScience.ts` L59–L64; `src/routing/routingLog.ts` L1; `src/routing/classifyBroadScience.ts` L112 |
| **Binding** | Log vocabulary: `life-science-only`, `broad-science`, batch classify. |
| **Strength** | hardcoded |
| **Extraction hint** | Optional; low priority for extraction. |

### INV-047 — `papers.json` routing/digest stats shape

| | |
|---|---|
| **Location** | `src/index.ts` L104–L121; `src/processedData.ts` L91–L103 |
| **Binding** | Persisted `routing.stats`, `digest.selection.lineA|lineB|preprint|skip`, `excludedPapers` with `life-science-routing`. |
| **Strength** | hardcoded |
| **Extraction hint** | Versioned schema generated from domain types. |

### INV-048 — Enricher contract comment

| | |
|---|---|
| **Location** | `src/enrichers/index.ts` L40 |
| **Binding** | Documents enrich runs after life-science routing (ordering assumption). |
| **Strength** | hardcoded (comment) |
| **Extraction hint** | Architecture doc in domain README after extraction. |

---

## 10. Source-specific normalizers (feed hygiene adjacent to LS product)

### INV-049 — RSS skip rules registry

| | |
|---|---|
| **Location** | `src/normalizers/rss/index.ts` L41–L50, L69–L72 (`RSS_SKIP_RULES`, `shouldSkipRssItem`) |
| **Binding** | Per–life-science-journal skip rules (PNAS "In This Issue", Nature corrections, etc.). |
| **Strength** | hardcoded (per-source modules) |
| **Extraction hint** | `src/domain/life-science/feeds/rssSkipRules.ts` mapping `sourceId` → rule. |

### INV-050 — Nature encoded skip (corrections / replies)

| | |
|---|---|
| **Location** | `src/normalizers/rss/nature-encoded.ts` L30–L36 (`isNatureEncodedSkippedItem`) |
| **Binding** | Skips non-research Nature RSS items (Author/Publisher Correction, Reply to). |
| **Strength** | hardcoded |
| **Extraction hint** | Shared Nature skip policy used by multiple Nature vertical normalizers. |

### INV-051 — Journal-specific normalizer modules

| | |
|---|---|
| **Location** | `src/normalizers/rss/nature-*.ts`, `plos-biology.ts`, `pnas.ts`, etc.; wired `src/normalizers/rss/index.ts` L52–L67 |
| **Binding** | Abstract extractors tuned to life-science journal RSS/HTML shapes (not generic news). |
| **Strength** | hardcoded per publisher |
| **Extraction hint** | Keep under `src/ingest/` or `src/normalizers/`; register via domain source catalog—not core policy. |

### INV-052 — Enricher map for same sources

| | |
|---|---|
| **Location** | `src/enrichers/index.ts` L12–L26 (`PAPER_ENRICHERS`) |
| **Binding** | HTML/Crossref enrichers keyed by life-science `sourceId` list. |
| **Strength** | hardcoded |
| **Extraction hint** | Register enrichers from source catalog metadata (`enricher: "nature-methods"`). |

---

## 11. Module and symbol naming (cross-cutting)

These names embed the life-science product boundary and should be renamed only after policy modules exist:

| Symbol / path | Location |
|---------------|----------|
| `routeLifeSciencePapers` | `src/routing/routeLifeScience.ts` |
| `LifeScienceRouting*` types | `src/types.ts`, `src/routing/types.ts` |
| `classifyBroadSciencePapers` | `src/routing/classifyBroadScience.ts` |
| `keywordDigestLine.ts` / `digestLineFromKeywords` | `src/digest/` |
| `ROUTE_LIFE_SCIENCE` env | `src/routing/config.ts` |
| `buildSourceScopeById` | `src/routing/sourceScope.ts` |

**Extraction hint (batch):** Rename after `src/domain/life-science/` exports stable APIs; avoid rename-only PR before extraction.

---

## Prioritization for PR-4 extraction

Recommended order (highest leverage / lowest coupling risk first):

1. **Config → domain tables (INV-012–INV-015, INV-016–INV-017)**  
   Move `scope`, keyword lists, `maxFeatured`, and email branding into `src/domain/life-science/` with thin loaders in `src/config.ts`. Unblocks tests to assert policy without touching LLM code.

2. **Type literals + Zod single source (INV-001–INV-011, INV-010–INV-011)**  
   One module exports `SourceScope`, `DigestLine`, `PaperSection`, verdict enums and shared `z.enum` schemas. Prevents drift between `types.ts`, `processedData.ts`, and `tagTitles.ts`.

3. **Prompt corpus (INV-021, INV-029, INV-034–INV-035)**  
   Extract all system prompts verbatim into `prompts/` under domain. Easiest review surface for domain experts; no runtime behavior change if imports only.

4. **Keyword + digest-line fallback policy (INV-025–INV-028, INV-031)**  
   Centralize `classifyPaperSection`, `digestLineFromKeywords`, and scope defaults. Routing and LLM layers then consume the same policy object.

5. **Routing orchestration (INV-018–INV-020, INV-022–INV-024)**  
   Move scope-default vs LLM gate rules and exclusion reason into domain; keep `callRoutingCompletion` as infrastructure.

6. **Digest tagging + selection (INV-030–INV-032, INV-036–INV-037)**  
   Depends on stable `DigestLine` policy and prompts from step 3–4.

7. **Email presentation (INV-039–INV-043, INV-038)**  
   Move `LINE_SECTIONS`, zh copy, and visibility rules after digest line policy is centralized (renderer should not invent line-b defaults).

8. **Feed-specific skip/enrich registries (INV-049–INV-052)**  
   Last: publisher-specific ingest logic is large but loosely coupled; register via source catalog rather than hardcoded `Record<sourceId, …>`.

**Rationale:** Policy tables and types first reduce silent revert risk; prompts and fallbacks second; orchestration third; presentation fourth; per-publisher ingest last because it is voluminous but not the semantic core of "what counts as life science / which main line."

---

## Out of scope for this inventory

- **Test fixtures / mocks** (`test/**`) — excluded per PR-3.5 scope; mocks mirror production prompts but are not product policy.
- **Generated preview HTML** (`docs/archive/*.html`) — output artifacts, not policy sources.
- **LLM endpoint tuning** (`config/routing.json`, `config/digest.json` batch/token limits) — operational caps, not domain taxonomy.
- **README.md** — documents the pipeline but does not enforce policy; update after PR-4, not duplicated here.

---

*Inventory produced for PR-3.5 (doc-only). PR-4 should treat this file as the completeness checklist and tick off entries as they move under `src/domain/life-science/`.*
