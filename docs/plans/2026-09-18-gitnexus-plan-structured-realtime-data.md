# GitNexus Plan: Structured Realtime Data Gateway

## 1. Objective
Build a domain-neutral realtime evidence gateway that prefers free structured/public APIs, falls back to official/category RSS and open-web evidence, and temporarily disables Google Search Grounding by default through a reversible feature flag.

## 2. Scope
- In scope: grounding feature flag, structured routing, weather/AQI, crypto/forex, public software package/release metadata, RSS integration, provenance labels, tests.
- Out of scope: paid APIs, scraping behind authentication, hardcoded answers/entities, replacing the existing LLM provider.

## 3. Current architecture
`planSearchQueries` identifies fresh-information needs. Group and direct-chat paths call `searchRealtimeNews`; that function gathers Google News/category RSS, Bing RSS, Wikipedia and existing finance summaries. `callGemini` separately enables Google Search Grounding when `canUseGrounding()` returns true. Weather and finance already have free structured providers, but they are not coordinated through one reusable pre-search gateway.

## 4. GitNexus findings
- `callGemini`, `executeAgentTool`, and `canUseGrounding` are CRITICAL blast-radius symbols used by group/direct chat and agent flows; changes there must be minimal.
- `searchRealtimeNews` is the shared evidence edge for the assistant flows and is the safer integration point.
- The refreshed graph contains 19,986 nodes, 59,868 edges and 451 flows. Process discovery reported truncation, so missing graph paths are not treated as absence.
- The CLI exposes context/query/impact but not statement-level `pdg_query`; source inspection is therefore used for branch-level verification.

## 5. Design
1. Add `structured-data.ts` with a deterministic, domain-neutral router returning a bounded context string and source metadata.
2. Reuse existing free providers for weather/AQI and crypto/forex; add public npm, PyPI and GitHub release lookups only when an explicit package/repository can be extracted.
3. Run structured lookup in parallel with RSS at the `searchRealtimeNews` edge and prepend verified structured context without suppressing RSS evidence.
4. Add `SEARCH_GROUNDING_ENABLED`; only literal truthy values enable Grounding. Default is off. Quota reporting distinguishes configuration-disabled from quota exhaustion.
5. Preserve current RSS/open-web fallback for domains without stable free structured APIs.

## 6. Data flow
User question → Gemini Flash Lite planner → structured router + RSS/open-web retrieval → evidence ranking/profile extraction → answer model. Google Search Grounding remains bypassed unless explicitly re-enabled.

## 7. Failure and fallback behavior
- Each structured adapter has a short timeout and returns empty on network/schema failure.
- No adapter result means the existing RSS/open-web pipeline continues unchanged.
- Ambiguous package/repository names do not trigger a guessed API call.
- Grounding can be restored with `SEARCH_GROUNDING_ENABLED=true` without code changes.

## 8. Implementation sequence
1. Add feature-flag/status logic and unit tests for disabled/enabled/quota-exhausted states.
2. Add the structured router with injected fetch/provider dependencies for deterministic tests.
3. Integrate it into realtime search in parallel, maintaining the outer five-second budget.
4. Extend tests for weather, finance, npm/PyPI/GitHub routing, no-match behavior and context composition.
5. Run targeted tests, build/typecheck, GitNexus detect-changes and regression review.

## 9. Files
- Modify `bot/src/grounding-quota.ts`: reversible configuration gate and truthful report.
- Add `bot/src/structured-data.ts`: routing/adapters/formatting.
- Add `bot/src/structured-data.test.ts`: adapter and routing tests.
- Modify `bot/src/realtime-search.ts`: parallel structured lookup and evidence composition.
- Modify `bot/src/realtime-search.test.ts`: category/integration coverage.
- Add or modify grounding quota tests as appropriate.

## 10. Test scenarios
- Grounding is off when env is unset/false and on only when true and under quota.
- Weather query uses weather provider; crypto/forex query uses finance provider.
- Explicit npm/PyPI/GitHub identifiers produce timestamped official API context.
- General news or ambiguous names do not invoke unrelated structured APIs.
- Adapter timeout/failure leaves RSS output intact.
- Both group and direct assistant paths continue receiving the same shared evidence contract.

## 11. Risks and mitigations
- CRITICAL central symbols: minimize changes to `canUseGrounding`; do not restructure `callGemini` or agent loop.
- Latency: structured and RSS work runs concurrently with strict adapter timeouts.
- False routing: require domain cues plus explicit identifiers and never infer project-specific facts.
- Provider drift: validate response shape and fail closed to RSS.

## 12. Acceptance criteria
- Search Grounding is disabled by default and clearly reported.
- Structured sources appear for supported live-data questions without paid keys.
- Unsupported domains still use official RSS/open-web evidence.
- No project/person/event-specific rules are introduced.
- Targeted tests and backend build pass; any pre-existing failures are reported separately.

## 13. Evidence provenance
```json
{
  "schema_version": 2,
  "head_commit": "429d70058fdc5036c99af2f164cbe8ff5cb78f92",
  "generated_plan_path": "docs/plans/2026-09-18-gitnexus-plan-structured-realtime-data.md",
  "global_dirty_digest": {
    "algorithm": "sha256",
    "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
    "value": "1fa5194fa8911d3142bccf575659b0e557f6b4cf818f8ecfd06b224ff17e941a"
  },
  "cited_paths": [
    "bot/package.json",
    "bot/src/grounding-quota.ts",
    "bot/src/query-planner.ts",
    "bot/src/query-planner.test.ts",
    "bot/src/realtime-search.ts",
    "bot/src/realtime-search.test.ts",
    "bot/src/tools/finance-tools.ts",
    "bot/src/weather.ts"
  ]
}
```
