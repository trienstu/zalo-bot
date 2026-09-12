# GitNexus Engineering Plan

> Task: Build a domain-neutral evidence pipeline so time-sensitive questions are answered from relevant, dated, attributable sources or fail closed.
> Evidence verified at commit c0070b410ffc665bdd1c1eb101be954571202e69; GitNexus index fresh (schema 4, current workspace commit, PDG available).
> Evidence provenance schema 2; global dirty digest 409c29624c42e044d07857f1cbdf84819b6da8b6135f3b2ab321eb048328c6d5; cited-path manifest 10 sorted entries; exact generated plan path excluded.

## 1. Objective

- [verified] Replace the current best-effort string aggregation with a reusable evidence contract for all volatile domains: public office, business leadership, law, finance, technology, sports, health, education, science, and news.
- [inferred] Improve correctness without promising an impossible 100% truth guarantee: an answer may assert a current fact only when search evidence passes relevance, provenance, and temporal sufficiency checks; otherwise it must disclose that it cannot verify the fact.
- [verified] Do not encode the reported person, province, answer, or any single-domain exception in production logic.

## 2. Current Behaviour

- [verified] `planSearchQueries` correctly routes current leadership questions to `fact_check` and produces concise Vietnamese queries (`bot/src/query-planner.ts:40`).
- [verified] `handleHistoryQA` and `handleAdminDirectInteraction` discard the plan intent and call `searchRealtimeNews` with only query strings (`bot/src/member-assistant.ts:1619`, `bot/src/admin-assistant.ts:1209`).
- [verified] Google News filtering accepts a result when any meaningful token occurs, so a polysemous/common token can admit unrelated articles (`bot/src/realtime-search.ts:420`).
- [verified] the open-web RSS adapter labels undated results as `Mới nhất`, assigns `Date.now()`, and gives them age one hour (`bot/src/realtime-search.ts:534`).
- [verified] candidate ordering prefers a long snippet before publication time or query relevance (`bot/src/realtime-search.ts:868`).
- [verified] `webSearch` lets four concurrent producers mutate a shared result array; the first `maxResults` therefore depends on network completion order, then sorting only distinguishes rich snippets (`bot/src/tools/vertical-tools.ts:18`).
- [verified] Wikipedia selection accepts a preferred generic page or the first hit without a minimum relevance check (`bot/src/realtime-search.ts:437`, `bot/src/tools/vertical-tools.ts:128`).
- [verified] rich snippets omit the actual URL and publication date from the model context, and the dated news list can be suppressed whenever rich snippets exist (`bot/src/realtime-search.ts:889`, `bot/src/realtime-search.ts:1035`).
- [verified] member and admin prompts demand free-form source names/dates even when the retrieved context does not supply them, creating pressure to fabricate a plausible citation (`bot/src/member-assistant.ts:1647`, `bot/src/admin-assistant.ts:1329`).
- [verified] the temporal prompt asserts that the current year is real but does not explicitly prohibit rewriting a source publication/event date to that year (`bot/src/temporal.ts:7`).

## 3. Relevant Architecture

- [verified] Planner boundary: `query-planner.ts` classifies intent and returns up to three query strings.
- [verified] Acquisition boundary: `vertical-tools.ts:webSearch` aggregates DuckDuckGo, Bing RSS, Google News, Wikipedia, and fallbacks into `SearchResultItem[]`.
- [verified] Context boundary: `realtime-search.ts:searchRealtimeNews` adds category RSS, Wikipedia, vertical search, sports extraction, and market tools, then serializes one prompt string.
- [verified] Answer boundary: member/admin assistants inject that string into a direct Gemini call with search disabled (`bot/src/member-assistant.ts:1747`; `bot/src/admin-assistant.ts:1358`).
- [graph] Direct consumers of `searchRealtimeNews` are member QA, admin direct interaction, and daily AI news; direct consumers of `webSearch` are realtime search, Gemini tool execution/agent loop, and arXiv fallback.
- [inferred] The compatibility seam should preserve existing exported signatures while adding optional metadata/options and pure helpers; this avoids forcing unrelated agent tools and daily-news callers through a migration.

## 4. GitNexus Findings

- [graph] `impact(repo:zalo-bot,target:searchRealtimeNews,direction:upstream,maxDepth:3,summaryOnly:true)` reports CRITICAL, 3 direct dependents, 8 impacted symbols, 6 processes. Quote: `direct: 3, processes_affected: 6`.
- [graph] The depth-1 impact names `handleHistoryQA`, `handleAdminDirectInteraction`, and `getDailyAiNewsBriefing`; all must retain string-return compatibility.
- [graph] `impact(...target:webSearch...)` reports CRITICAL, 4 direct dependents, 10 impacted symbols, 8 processes. Quote: `direct: 4, processes_affected: 8`.
- [graph] The depth-1 `webSearch` dependents are `searchRealtimeNews`, `executeAgentTool`, `callGeminiAgentLoop`, and `arxivSearch`; added fields must remain optional and existing `title/snippet/url/date` semantics must remain consumable.
- [graph] `impact(...target:planSearchQueries...)` reports CRITICAL transitively (2 direct, 5 processes); depth-1 callers are the two assistants.
- [graph] `impact(...target:getSystemTemporalPrompt...)` reports CRITICAL (6 direct, 10 processes); temporal wording changes affect planner, Gemini, summaries, both assistants, and the temporal test script.
- [graph] `impact(...target:handleHistoryQA...)` reports HIGH transitively; its only direct caller is `handleMemberInteraction`.
- [verified] The configured test command is `npm test` and the compile gates are `npm run typecheck` and `npm run build` in `bot/package.json`.
- [verified] Existing tests do not cover search relevance, evidence sufficiency, source URL integrity, or multi-domain current facts; `bot/scripts/test-temporal-factcheck.ts` only scans one live LLM response for time-conflict phrases.

## 5. Statement-Level PDG Findings

- [graph] `pdg_query(target:searchRealtimeNews,mode:controls)` shows the rich-snippet collection is guarded by network success and snippet-length branches around lines 914–938; the dated-news output is separately guarded at line 1036. Planning consequence: ranking and sufficiency must happen before either representation-specific branch, not inside one branch.
- [graph] `pdg_query(target:webSearch,mode:flows,variable:results)` traces the shared `results` definition at line 19 to concurrent producer mutation, early return at line 186, fallback guards, and final truncation at line 328. Planning consequence: producers should return independent arrays and deterministic merge/rank must precede truncation.
- [graph] `pdg_query(target:fetchOpenWebRss,mode:flows,variable:timestamp)` returned no named-binding edge for the object literal. [verified] Source verification at lines 562–568 confirms the false timestamp assignment; source is authoritative over the empty slice.
- [inferred] The high-leverage invariant is: unknown publication time remains unknown through acquisition, ranking, formatting, and answer generation; no later layer may infer freshness from retrieval time.

## 6. Proposed Changes

### 6.1 Shared evidence primitives

- File: `bot/src/search-evidence.ts` (new).
- Symbols: `SearchEvidence`, `SearchIntent`, `normalizeSearchText`, `scoreEvidence`, `rankEvidence`, `assessEvidenceSufficiency`, `formatEvidenceContext`, `finalizeGroundedAnswer`.
- [inferred] Responsibility: centralize accent-tolerant token/phrase coverage, deterministic scoring, generic authority classification, known-date recency, de-duplication, evidence IDs, fail-closed state, and citation sanitization.
- [inferred] Constraints: no person/event/topic-specific constants; unknown dates are `null`; retrieval time is separate; stable tie-break by normalized title and URL; official/government/primary-source classification uses generic source metadata/domain patterns rather than named answers.
- [inferred] `finalizeGroundedAnswer` removes model-created source footer lines, appends only URLs present in the accepted evidence context, and replaces the answer with a concise verification warning when a required fact-check has insufficient evidence.

### 6.2 Deterministic vertical search

- File: `bot/src/tools/vertical-tools.ts`; symbol: `webSearch`, interface `SearchResultItem`.
- [verified] Preserve required fields and add optional `publishedAt`, `retrievedAt`, `sourceType`, and `sourceName`.
- [inferred] Make each source producer return an array, flatten in fixed source order after `Promise.allSettled`, normalize/dedupe/rank once, and only then slice to `maxResults`.
- [inferred] Parse real RSS publication dates where present. Do not synthesize dates for DuckDuckGo, Bing web, or Wikipedia.
- [inferred] Reject low-coverage hits for specific queries; keep a lower threshold only for genuinely broad news queries.

### 6.3 Evidence-aware realtime context

- File: `bot/src/realtime-search.ts`; symbols: `ParsedNewsItem`, `fetchGoogleNewsRss`, `fetchWikipediaSummary`, `fetchOpenWebRss`, `searchRealtimeNews`.
- [inferred] Add optional `{ intent, requireEvidence }` options while preserving all existing one-argument calls.
- [inferred] Map RSS/web/wiki items into the shared evidence model, rank by relevance → authority → real publication time → snippet richness, and use a single deterministic dedupe pass.
- [verified] Replace `Mới nhất`/`Date.now()` for undated open-web results with unknown-date semantics.
- [inferred] Apply the same minimum relevance policy to Wikipedia; do not use a first hit merely because it exists.
- [inferred] Always include accepted evidence as `[E#]` records with title, actual URL, source type, and publication date when known. Never suppress dated records because rich snippets exist.
- [inferred] For `fact_check`, return an explicit insufficient-evidence marker unless there is one strongly relevant primary/official source or corroboration from at least two independent domains.

### 6.4 Carry intent and enforce citations at answer boundaries

- Files: `bot/src/member-assistant.ts`, `bot/src/admin-assistant.ts`; symbols: `handleHistoryQA`, `handleAdminDirectInteraction`.
- [inferred] Pass `plan.intent` into realtime search, retain whether evidence was required, and finalize the model answer with the shared citation guard.
- [inferred] Replace free-form “name a prestigious source” instructions with a compact evidence contract: use only supplied `[E#]` records, preserve their dates, cite their exact URL, do not invent an organization/date, and abstain when marked insufficient.
- [verified] Keep fast-path direct Gemini calls and existing user-visible persona/format behavior outside grounding rules.

### 6.5 Neutral temporal rules and regression coverage

- File: `bot/src/temporal.ts`; symbol: `getSystemTemporalPrompt`.
- [inferred] Retain the correct current clock anchor but add explicit rules that current time is not evidence of an event date, source dates must be preserved verbatim, later evidence supersedes earlier evidence only when it addresses the same entity/attribute, and missing dates must remain unknown.
- Files: `bot/src/search-evidence.test.ts` (new), `bot/src/realtime-search.test.ts` (new or pure-helper coverage), optionally update `bot/scripts/test-temporal-factcheck.ts` to stop claiming correctness from phrase absence.

## 7. Implementation Sequence

1. Add `search-evidence.ts` with pure normalization, scoring, deterministic ranking, sufficiency, evidence formatting, and answer-finalization functions; add table-driven unit tests before integration.
2. Extend `SearchResultItem` and refactor `webSearch` producers to collect independently, preserve real dates/source metadata, rank deterministically, and maintain compatibility for Gemini/arXiv callers.
3. Integrate the shared evidence model into `realtime-search.ts`; eliminate false timestamps, weak any-token admission, representation-specific output suppression, and unverified Wikipedia selection.
4. Pass planner intent through member/admin callers; replace citation pressure with evidence-ID rules and run final citation/fail-closed enforcement after Gemini returns.
5. Harden the temporal prompt and update/add tests across public office, company leadership, sports role, law/regulation, product version, health guidance, and financial data scenarios.
6. Run tests, typecheck, build, GitNexus `detect_changes(scope:all)`, inspect every affected process and fix regressions before commit.

## 8. Test Strategy

- `bot/src/search-evidence.test.ts`:
  - current public official: stale high-snippet result + newer relevant official result → newer official ranks first;
  - company CEO and sports coach: entity/attribute coverage beats generic same-name pages;
  - law amendment and product release: undated web result is never treated as newest;
  - finance/health: one generic token match is rejected for a specific query;
  - deterministic input permutations → identical ranked output;
  - fact-check with one official source or two independent corroborating domains → sufficient;
  - one weak/encyclopedic/irrelevant source or conflicting weak evidence → insufficient;
  - citation finalization → only provided URLs remain; fabricated source footer is removed;
  - insufficient marker → generated factual answer is replaced by transparent abstention.
- `bot/src/realtime-search.test.ts`:
  - parse dated RSS versus undated Bing RSS;
  - formatted `[E#]` includes URL and a real publication date only when supplied;
  - current/fact-check context retains dated news even when rich web snippets exist.
- `bot/scripts/test-temporal-factcheck.ts`: revise success language so absence of “future/simulation” is not reported as proof of factual correctness.
- Verification commands: `cd bot && npm test`; `cd bot && npm run typecheck`; `cd bot && npm run build`.
- [assumed] Live-network smoke tests remain optional/non-blocking because provider ordering and availability are nondeterministic; deterministic mocked/pure tests are the release gate.

## 9. Risk and Impact Analysis

- [graph] `searchRealtimeNews` CRITICAL: member QA, admin direct responses, and daily AI briefings consume it directly. Preserve string output and default behavior for non-fact-check callers.
- [graph] `webSearch` CRITICAL: realtime search, Gemini agent/tool paths, and arXiv search consume `SearchResultItem`. Only add optional fields; retain required fields.
- [graph] `getSystemTemporalPrompt` CRITICAL: planner, both answer paths, Gemini utilities, summary, and temporal script use it. Wording must not cause all historical queries to search or abstain.
- [graph] `planSearchQueries` CRITICAL transitively: avoid schema-breaking required properties; use existing `intent` instead of expanding the planner JSON contract in this change.
- [graph] `handleHistoryQA` HIGH transitively: finalization must preserve Zalo formatting and not modify non-search answers.
- [inferred] Performance risk: additional scoring is in-memory and linear over a small candidate set; independent acquisition remains parallel, so latency should remain near current network-bound latency.
- [inferred] Recall risk: a strict threshold can reject legitimate sparse results. Thresholds must be intent-aware and tests must include accented Vietnamese, English, acronyms, and short entity names.
- [inferred] Citation risk: redirected aggregator URLs may be less useful than publisher URLs. Retain actual returned URL and source metadata; do not invent a publisher URL during normalization.
- [verified] Working tree already contains unrelated user changes in `AGENTS.md` and untracked `.agents/skills/`; do not stage, rewrite, or delete them.
- [inferred] Observability: log intent, accepted/rejected evidence counts, sufficiency reason, and elapsed search time without logging private chat history.

## 10. Files Expected to Change

| File | Symbols | Reason |
| ---- | ------- | ------ |
| `bot/src/search-evidence.ts` | new evidence primitives | Shared domain-neutral ranking, sufficiency, formatting, citations |
| `bot/src/search-evidence.test.ts` | new tests | Multi-domain deterministic regression matrix |
| `bot/src/tools/vertical-tools.ts` | `SearchResultItem`, `webSearch` | Deterministic aggregation and real metadata |
| `bot/src/realtime-search.ts` | `ParsedNewsItem`, source adapters, `searchRealtimeNews` | Evidence-aware retrieval and fail-closed context |
| `bot/src/member-assistant.ts` | `handleHistoryQA` | Carry intent and enforce grounded citations |
| `bot/src/admin-assistant.ts` | `handleAdminDirectInteraction` | Carry intent and enforce grounded citations |
| `bot/src/temporal.ts` | `getSystemTemporalPrompt` | Separate current clock from source/event dates |
| `bot/src/realtime-search.test.ts` | new tests | Adapter/context regression coverage |
| `bot/scripts/test-temporal-factcheck.ts` | `runTest` | Remove false correctness claim |

## 11. Reusable Implementation Context

```yaml
implementation_context:
  task_summary: 'Create a universal evidence-first pipeline for volatile facts; rank relevant dated authoritative sources deterministically, cite only supplied URLs, and abstain when evidence is insufficient.'
  acceptance_criteria:
    - 'No production rule contains the reported person, province, or expected answer.'
    - 'Unknown publication dates remain unknown and are never labelled latest.'
    - 'Specific-query results require meaningful entity/attribute coverage.'
    - 'Fact-check answers require sufficient evidence or fail closed.'
    - 'Final citations contain only URLs supplied by accepted evidence.'
    - 'Existing non-fact-check search consumers remain compatible.'
  evidence_provenance:
    schema_version: 2
    head_commit: 'c0070b410ffc665bdd1c1eb101be954571202e69'
    generated_plan_path: 'docs/plans/2026-09-12-gitnexus-plan-grounded-evidence-pipeline.md'
    global_dirty_digest:
      algorithm: 'sha256'
      canonicalization: 'gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records'
      value: '409c29624c42e044d07857f1cbdf84819b6da8b6135f3b2ab321eb048328c6d5'
    cited_path_manifest:
      - { path: 'AGENTS.md', object_kind: { head: 'regular', index: 'regular', worktree: 'regular', untracked: 'absent' }, state: 'unstaged', rename_from: null, rename_to: null, head_digest: 'sha256:06d9fb1eb63798fd1e10837fef1f41818e687d4aff3e8afcc04ea78635b2a942', index_digest: 'sha256:06d9fb1eb63798fd1e10837fef1f41818e687d4aff3e8afcc04ea78635b2a942', worktree_digest: 'sha256:028c82648db4c22654717da535ea76232f87dfcdb3bcbd9758c24234d47286f8', untracked_digest: 'absent' }
      - { path: 'bot/package.json', object_kind: { head: 'regular', index: 'regular', worktree: 'regular', untracked: 'absent' }, state: 'clean', rename_from: null, rename_to: null, head_digest: 'sha256:82089f80a295d54ca0297400e7f98f92dc1226a388e7bdd14b109ca3bc3c0086', index_digest: 'sha256:82089f80a295d54ca0297400e7f98f92dc1226a388e7bdd14b109ca3bc3c0086', worktree_digest: 'sha256:82089f80a295d54ca0297400e7f98f92dc1226a388e7bdd14b109ca3bc3c0086', untracked_digest: 'absent' }
      - { path: 'bot/scripts/test-temporal-factcheck.ts', object_kind: { head: 'regular', index: 'regular', worktree: 'regular', untracked: 'absent' }, state: 'clean', rename_from: null, rename_to: null, head_digest: 'sha256:39db5b63edf20a51e9aefb4cb7e88f49c6ccb1e0b15b2133398c17bc6d9f8001', index_digest: 'sha256:39db5b63edf20a51e9aefb4cb7e88f49c6ccb1e0b15b2133398c17bc6d9f8001', worktree_digest: 'sha256:39db5b63edf20a51e9aefb4cb7e88f49c6ccb1e0b15b2133398c17bc6d9f8001', untracked_digest: 'absent' }
      - { path: 'bot/src/admin-assistant.ts', object_kind: { head: 'regular', index: 'regular', worktree: 'regular', untracked: 'absent' }, state: 'clean', rename_from: null, rename_to: null, head_digest: 'sha256:252f4413dfc13bdaf487f3a3fad78ef765b27d54cf0a3fb6d0781412cfcd61b3', index_digest: 'sha256:252f4413dfc13bdaf487f3a3fad78ef765b27d54cf0a3fb6d0781412cfcd61b3', worktree_digest: 'sha256:252f4413dfc13bdaf487f3a3fad78ef765b27d54cf0a3fb6d0781412cfcd61b3', untracked_digest: 'absent' }
      - { path: 'bot/src/ai-news.ts', object_kind: { head: 'regular', index: 'regular', worktree: 'regular', untracked: 'absent' }, state: 'clean', rename_from: null, rename_to: null, head_digest: 'sha256:85254ad546023e7fca9f33bb6bf4b62d4ce27d8f4b89d0a32f7cd72ff2bd2aa4', index_digest: 'sha256:85254ad546023e7fca9f33bb6bf4b62d4ce27d8f4b89d0a32f7cd72ff2bd2aa4', worktree_digest: 'sha256:85254ad546023e7fca9f33bb6bf4b62d4ce27d8f4b89d0a32f7cd72ff2bd2aa4', untracked_digest: 'absent' }
      - { path: 'bot/src/gemini.ts', object_kind: { head: 'regular', index: 'regular', worktree: 'regular', untracked: 'absent' }, state: 'clean', rename_from: null, rename_to: null, head_digest: 'sha256:b85204023dab509b8e2b923f5c10a447460bd0bc5436280f23664e4d7bb0b113', index_digest: 'sha256:b85204023dab509b8e2b923f5c10a447460bd0bc5436280f23664e4d7bb0b113', worktree_digest: 'sha256:b85204023dab509b8e2b923f5c10a447460bd0bc5436280f23664e4d7bb0b113', untracked_digest: 'absent' }
      - { path: 'bot/src/member-assistant.ts', object_kind: { head: 'regular', index: 'regular', worktree: 'regular', untracked: 'absent' }, state: 'clean', rename_from: null, rename_to: null, head_digest: 'sha256:9e9ab53bcc561da48ae1564e7e31dc516a6cef66413a288b3ed8cbcff407e8a4', index_digest: 'sha256:9e9ab53bcc561da48ae1564e7e31dc516a6cef66413a288b3ed8cbcff407e8a4', worktree_digest: 'sha256:9e9ab53bcc561da48ae1564e7e31dc516a6cef66413a288b3ed8cbcff407e8a4', untracked_digest: 'absent' }
      - { path: 'bot/src/query-planner.ts', object_kind: { head: 'regular', index: 'regular', worktree: 'regular', untracked: 'absent' }, state: 'clean', rename_from: null, rename_to: null, head_digest: 'sha256:db468abddb97ee8d3772bb06a8bde425e9ba54ad044bf5c5d2e678f182258003', index_digest: 'sha256:db468abddb97ee8d3772bb06a8bde425e9ba54ad044bf5c5d2e678f182258003', worktree_digest: 'sha256:db468abddb97ee8d3772bb06a8bde425e9ba54ad044bf5c5d2e678f182258003', untracked_digest: 'absent' }
      - { path: 'bot/src/realtime-search.ts', object_kind: { head: 'regular', index: 'regular', worktree: 'regular', untracked: 'absent' }, state: 'clean', rename_from: null, rename_to: null, head_digest: 'sha256:d26d0f01241519ce3cb1a1dbafeae34329e53ba721eaaeb3b32a5e730ae76de4', index_digest: 'sha256:d26d0f01241519ce3cb1a1dbafeae34329e53ba721eaaeb3b32a5e730ae76de4', worktree_digest: 'sha256:d26d0f01241519ce3cb1a1dbafeae34329e53ba721eaaeb3b32a5e730ae76de4', untracked_digest: 'absent' }
      - { path: 'bot/src/temporal.ts', object_kind: { head: 'regular', index: 'regular', worktree: 'regular', untracked: 'absent' }, state: 'clean', rename_from: null, rename_to: null, head_digest: 'sha256:bd6fd1cb22b0e8e3a3325d6322d1446251cf57ba9b30d3f3a386cdab9cfb39b6', index_digest: 'sha256:bd6fd1cb22b0e8e3a3325d6322d1446251cf57ba9b30d3f3a386cdab9cfb39b6', worktree_digest: 'sha256:bd6fd1cb22b0e8e3a3325d6322d1446251cf57ba9b30d3f3a386cdab9cfb39b6', untracked_digest: 'absent' }
      - { path: 'bot/src/tools/vertical-tools.ts', object_kind: { head: 'regular', index: 'regular', worktree: 'regular', untracked: 'absent' }, state: 'clean', rename_from: null, rename_to: null, head_digest: 'sha256:e87cc9ffb07f0af6b0a675923f1073862ef6dfeefdaf6f6dfe9029cd97ffdfb5', index_digest: 'sha256:e87cc9ffb07f0af6b0a675923f1073862ef6dfeefdaf6f6dfe9029cd97ffdfb5', worktree_digest: 'sha256:e87cc9ffb07f0af6b0a675923f1073862ef6dfeefdaf6f6dfe9029cd97ffdfb5', untracked_digest: 'absent' }
  primary_symbols:
    - { symbol: 'searchRealtimeNews', file: 'bot/src/realtime-search.ts', lines: '630-1055', role: 'Acquire, rank, and serialize realtime context' }
    - { symbol: 'webSearch', file: 'bot/src/tools/vertical-tools.ts', lines: '18-329', role: 'Multi-engine web acquisition' }
    - { symbol: 'handleHistoryQA', file: 'bot/src/member-assistant.ts', lines: '937-1776', role: 'Member answer orchestration' }
    - { symbol: 'handleAdminDirectInteraction', file: 'bot/src/admin-assistant.ts', lines: '1206-1380+', role: 'Admin answer orchestration' }
    - { symbol: 'getSystemTemporalPrompt', file: 'bot/src/temporal.ts', lines: '7-44', role: 'Current-time instruction' }
  related_symbols:
    - { symbol: 'planSearchQueries', relationship: 'CALLS from both assistants before search', relevance: 'Produces fact_check/realtime_news intent currently discarded at search boundary' }
    - { symbol: 'getDailyAiNewsBriefing', relationship: 'CALLS searchRealtimeNews', relevance: 'Compatibility consumer' }
    - { symbol: 'executeAgentTool/callGeminiAgentLoop/arxivSearch', relationship: 'CALLS webSearch', relevance: 'Compatibility consumers' }
  execution_path:
    - 'Planner classifies question and emits queries.'
    - 'Assistants call realtime search without intent.'
    - 'Realtime search merges RSS, web, Wikipedia, and optional vertical data.'
    - 'String context is inserted into a direct LLM call with search disabled.'
    - 'LLM is currently asked to invent a free-form source footer.'
  pdg_constraints:
    - description: 'Rank/sufficiency must dominate both rich-snippet and dated-news formatting branches.'
      affected_statements: ['bot/src/realtime-search.ts:914', 'bot/src/realtime-search.ts:938', 'bot/src/realtime-search.ts:1036']
      implementation_consequence: 'Create one accepted evidence list before formatting.'
    - description: 'Concurrent producers must not mutate/truncate the shared result list.'
      affected_statements: ['bot/src/tools/vertical-tools.ts:19', 'bot/src/tools/vertical-tools.ts:171', 'bot/src/tools/vertical-tools.ts:186', 'bot/src/tools/vertical-tools.ts:328']
      implementation_consequence: 'Collect arrays independently and deterministically rank before slicing.'
  architectural_patterns:
    - { pattern: 'Optional backward-compatible result metadata', example_location: 'bot/src/tools/vertical-tools.ts:7', usage_guidance: 'Retain title/snippet/url/date and add only optional fields.' }
    - { pattern: 'Parallel network acquisition', example_location: 'bot/src/tools/vertical-tools.ts:170', usage_guidance: 'Keep Promise.allSettled but remove shared mutation.' }
    - { pattern: 'Fast direct answer after context prefetch', example_location: 'bot/src/member-assistant.ts:1747', usage_guidance: 'Keep one LLM answer call; enforce grounding before/after it.' }
  files_to_modify:
    - { file: 'bot/src/search-evidence.ts', symbols: ['new evidence helpers'], intended_change: 'Shared ranking/sufficiency/format/citation layer.' }
    - { file: 'bot/src/tools/vertical-tools.ts', symbols: ['SearchResultItem', 'webSearch'], intended_change: 'Deterministic metadata-preserving acquisition.' }
    - { file: 'bot/src/realtime-search.ts', symbols: ['ParsedNewsItem', 'fetchGoogleNewsRss', 'fetchWikipediaSummary', 'fetchOpenWebRss', 'searchRealtimeNews'], intended_change: 'Evidence-aware retrieval and fail-closed context.' }
    - { file: 'bot/src/member-assistant.ts', symbols: ['handleHistoryQA'], intended_change: 'Carry intent and constrain/finalize citations.' }
    - { file: 'bot/src/admin-assistant.ts', symbols: ['handleAdminDirectInteraction'], intended_change: 'Carry intent and constrain/finalize citations.' }
    - { file: 'bot/src/temporal.ts', symbols: ['getSystemTemporalPrompt'], intended_change: 'Preserve evidence dates; no inferred freshness.' }
    - { file: 'bot/scripts/test-temporal-factcheck.ts', symbols: ['runTest'], intended_change: 'Stop claiming phrase absence proves correctness.' }
  tests:
    - file: 'bot/src/search-evidence.test.ts'
      scenarios: ['multi-domain ranking', 'unknown date', 'irrelevant token', 'permutation determinism', 'sufficiency', 'citation allow-list', 'abstention']
    - file: 'bot/src/realtime-search.test.ts'
      scenarios: ['RSS date parsing', 'evidence formatting', 'dated evidence retention']
  verification_commands: ['cd bot && npm test', 'cd bot && npm run typecheck', 'cd bot && npm run build', 'node .gitnexus/run.cjs detect-changes --scope all --repo .']
  risks:
    - 'CRITICAL shared search and temporal symbols; preserve direct callers and defaults.'
    - 'Over-strict thresholds can reduce recall; use intent-aware table-driven tests.'
    - 'Provider URLs may be redirects; cite returned URLs rather than fabricating canonical links.'
  assumptions:
    - 'Verify Node 20 test runtime supports current Intl/URL APIs via npm test and typecheck.'
    - 'Verify live-network smoke only after deterministic tests; it is not a release gate.'
  open_questions: []
  avoid:
    - 'Do not repeat full repository discovery.'
    - 'Do not replace established patterns without evidence.'
    - 'Do not hardcode the reported person, province, expected answer, or a single-domain keyword patch.'
    - 'Do not treat retrieval time as publication time.'
    - 'Do not allow the LLM to create source names, dates, or URLs absent from accepted evidence.'
    - 'Do not stage or modify the user-owned AGENTS.md or .agents/skills changes.'
```

## 12. Assumptions and Open Questions

- [assumed] Node 20 and the existing test runner are sufficient for the pure evidence helpers; verify with `npm test` and `npm run typecheck` before relying on this.
- [assumed] One highly relevant primary/official source is acceptable for a fact-check when a second source is unavailable; the implementation must expose this as a named sufficiency reason and tests must lock the behavior.
- [assumed] Live provider availability is not deterministic; release correctness is judged by deterministic mocked/pure tests plus one best-effort smoke run.
- Open questions: none blocking. Score thresholds may be tuned only from cross-domain fixtures, never from the reported question alone.
- Explicitly deferred: canonical redirect resolution and full article-level claim extraction could further improve attribution, but would add latency and a materially larger network/security surface.

## 13. Definition of Done

- No undated result receives a fabricated publication timestamp or “latest” label.
- Search ranking is deterministic under source completion-order permutations.
- Specific questions exclude unrelated any-token matches and irrelevant Wikipedia first hits.
- `fact_check` intent reaches the evidence layer and fails closed when sufficiency is not met.
- Accepted prompt evidence contains stable IDs, actual URLs, and only real publication dates.
- Member/admin source footers contain only accepted evidence URLs; fabricated footer text is removed.
- Multi-domain tests pass without production hardcoding for the reported incident.
- `npm test`, `npm run typecheck`, and `npm run build` pass in `bot/`.
- GitNexus `detect_changes(scope:all)` is complete (`partial`/`truncated` false) and all HIGH/CRITICAL affected processes are reviewed.
- User-owned `AGENTS.md` and `.agents/skills/` changes remain untouched and unstaged.
