# GitNexus Plan: Official Live Data Adapters

## 1. Objective
Extend the shared structured-data gateway with free, official-first adapters for Vietnamese gold, fuel, legal documents, exchange data, lottery results, and an optional free-key sports feed.

## 2. Scope
- No-key sources: SJC, Ministry of Industry and Trade, VBPL, HNX public data, Vietlott/public lottery pages.
- Optional key: API-Football free tier, disabled when no key is configured.
- Preserve RSS/open-web fallback and keep Google Search Grounding disabled by default.
- Exclude undocumented private endpoints, paid-only feeds, betting/forecast lottery sources, and guessed facts.

## 3. Current architecture
The Gemini planner sends fresh-data questions to `searchRealtimeNews`, which invokes `getStructuredRealtimeContext` in parallel with RSS/open-web retrieval. The gateway already supports weather/AQI, crypto/forex, npm, PyPI and GitHub releases.

## 4. GitNexus findings
- `getStructuredRealtimeContext` has HIGH upstream impact with direct caller `doSearchRealtimeNews` and reaches group chat, direct chat and daily AI briefings.
- The safe seam is the existing structured-data gateway; `callGemini` and the agent loop remain unchanged.
- Index is current at `c8836da`; process discovery is truncated, so absent flows are not interpreted as absence.

## 5. Design
- Add an official-source adapter registry with query predicates, strict timeouts, source labels and bounded output.
- Parse only recognizable structured fields; schema mismatch returns empty.
- Cache successful official responses briefly to reduce load.
- API-Football runs only when `API_FOOTBALL_KEY` exists and query intent is fixtures/live scores.
- Feed results into the existing structured context; RSS remains fallback.

## 6. Source policy
- Gold: SJC official page.
- Fuel: Ministry of Industry and Trade official notices.
- Law: National Database of Legal Documents (VBPL).
- Securities: HNX official public market pages; no claim of tick-level realtime.
- Lottery: Vietlott and official lottery-company/council pages only.
- Sports: API-Football with explicit source disclosure; official federation pages remain corroboration.

## 7. Implementation sequence
1. Add reusable official HTML fetching, text normalization, cache and adapters with fixture-based parser tests.
2. Add optional API-Football adapter and quota-safe date query.
3. Register adapters in `getStructuredRealtimeContext` using domain-neutral intent predicates.
4. Verify fail-closed behavior, build, targeted tests and GitNexus change impact.

## 8. Failure behavior
- Timeout, HTTP failure or schema drift returns no structured claim.
- Existing RSS/evidence ranking continues.
- No API key means sports API is skipped without error.
- Every returned block includes source name, source URL and retrieval time.

## 9. Files
- Modify `bot/src/structured-data.ts` and `bot/src/structured-data.test.ts`.
- Add `bot/src/official-live-data.ts` and `bot/src/official-live-data.test.ts`.

## 10. Test scenarios
- Parse representative official gold, fuel, legal, HNX and lottery markup.
- Reject incomplete or malformed source markup.
- Route only matching queries.
- Skip sports API without key; format valid fixture payload with key.
- Provider failure does not suppress other providers.

## 11. Implementation context
```yaml
generated_plan_path: docs/plans/2026-09-18-gitnexus-plan-official-live-data-adapters.md
head_commit: c8836da29147a070fe180fea66e3d28d269cafbe
primary_symbols:
  - bot/src/structured-data.ts:getStructuredRealtimeContext
files_to_modify:
  - bot/src/structured-data.ts
  - bot/src/structured-data.test.ts
files_to_add:
  - bot/src/official-live-data.ts
  - bot/src/official-live-data.test.ts
verification_commands:
  - node --import tsx --test src/official-live-data.test.ts src/structured-data.test.ts src/realtime-search.test.ts src/search-evidence.test.ts
  - npm run build
avoid:
  - undocumented private APIs
  - entity-specific answer rules
  - betting or prediction sources
```

## 12. Risks and open questions
- Official sites may render data client-side; adapters must fail closed until stable public HTML is observed.
- HNX public pages may be delayed; output must say market-page data, not realtime ticks.
- API-Football requires the user to create a free key.
- Flight APIs are deferred until a key/provider is selected.

## 13. Definition of Done
- Supported official queries return bounded, sourced structured context.
- Unsupported/schema-drift cases fall back without fabricated values.
- No paid dependency is introduced.
- Tests and build pass; graph change report contains only expected retrieval flows.

## Evidence provenance
```json
{"schema_version":2,"head_commit":"c8836da29147a070fe180fea66e3d28d269cafbe","generated_plan_path":"docs/plans/2026-09-18-gitnexus-plan-official-live-data-adapters.md","global_dirty_digest":{"algorithm":"sha256","canonicalization":"gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records","value":"f3c242e3167781bef58492e48ea5db29715613d3c0181d1f8969d908715d428c"},"cited_paths":["bot/package.json","bot/src/realtime-search.ts","bot/src/structured-data.test.ts","bot/src/structured-data.ts","bot/src/tools/finance-tools.ts","bot/src/weather.ts"]}
```
