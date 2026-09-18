# GitNexus Engineering Plan

> Task: Prevent fast but unsupported answers when live structured/RSS sources are slow, empty, or noisy.
> Evidence verified at commit f61a41a069652e96e5c7f59fc9a9fa9d962ceda5; GitNexus index refreshed with PDG.
> Evidence provenance schema 2; global dirty digest f3c242e3167781bef58492e48ea5db29715613d3c0181d1f8969d908715d428c; cited-path manifest 9 sorted entries; exact generated plan path excluded.

## Objective (§1)

Guarantee that volatile claims use matching, current evidence; preserve structured results across slower RSS work; and fail closed instead of letting the LLM fill missing facts.

## Current Behaviour (§2–3)

- [verified] `searchRealtimeNews` races the complete pipeline against 5 seconds, so a ready structured result can be discarded while RSS/web work is still pending.
- [verified] admin/member orchestration only requires evidence when planner intent equals `fact_check`; `realtime_news` remains permissive.
- [verified] category filters accept any snippet longer than 25 characters, allowing tangential finance/sports articles through.
- [verified] API-Football fetches all fixtures for one UTC-derived date and the generic words “hôm nay/lịch thi đấu” allow every fixture through.
- [graph] `searchRealtimeNews` is CRITICAL with three direct callers; `getOfficialLiveDataContext` is HIGH with `getStructuredRealtimeContext` as its direct caller.

## Findings (§4–5)

- [verified] Structured data is awaited only after RSS/web ranking (`realtime-search.ts:1107`), despite starting at function entry.
- [verified] nested 5s/6s races return empty arrays/strings and do not cancel their warning timers.
- [verified] `finalizeGroundedAnswer` already contains the correct fail-closed behavior when `evidenceRequired=true`; orchestration is not invoking it for all volatile requests.
- [inferred] Preserve the public string interface and change internal ordering/gating to minimize blast radius.

## Proposed Changes (§6)

1. `bot/src/official-live-data.ts`: normalize Vietnam date windows and filter sports by requested competition/team; label structured output as sufficient evidence.
2. `bot/src/realtime-search.ts`: collect structured data under its own deadline, tighten lexical relevance for finance/sports, preserve structured output if RSS times out, and expose evidence status consistently.
3. `bot/src/admin-assistant.ts` and `bot/src/member-assistant.ts`: require evidence for volatile realtime/fact requests; cancel outer timeout logs; never ask Gemini to improvise when context is insufficient.
4. Tests: pin La Liga filtering, gold-topic isolation, structured-before-RSS behavior, and realtime fail-closed behavior.

## Implementation Sequence (§7)

1. Add regression tests for structured sports filtering and evidence-required realtime output.
2. Fix structured sports routing/date window and structured evidence metadata.
3. Fix realtime pipeline deadlines and topic relevance without changing the exported return type.
4. Apply the same evidence/timeout orchestration to admin and member paths.
5. Run targeted tests, backend build, live API probe, GitNexus detect-changes, commit and push.

## Test Strategy (§8)

- Query La Liga today → only La Liga fixtures, never arbitrary global matches.
- Structured provider resolves while RSS stalls → structured block survives the deadline.
- Gold query with unrelated long finance snippet → unrelated snippet excluded.
- Volatile realtime intent with insufficient evidence → refusal, not model prose.
- Successful search → no delayed false timeout warning.

## Implementation Context (§11)

```yaml
implementation_context:
  task_summary: "Make realtime answers fail closed and preserve relevant structured evidence under RSS/web timeouts."
  evidence_provenance:
    schema_version: 2
    head_commit: "f61a41a069652e96e5c7f59fc9a9fa9d962ceda5"
    generated_plan_path: "docs/plans/2026-09-18-gitnexus-plan-realtime-evidence-gating.md"
    global_dirty_digest:
      algorithm: "sha256"
      canonicalization: "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records"
      value: "f3c242e3167781bef58492e48ea5db29715613d3c0181d1f8969d908715d428c"
    cited_path_manifest:
      - { path: "bot/package.json", state: "clean", head_digest: "sha256:82089f80a295d54ca0297400e7f98f92dc1226a388e7bdd14b109ca3bc3c0086", index_digest: "sha256:82089f80a295d54ca0297400e7f98f92dc1226a388e7bdd14b109ca3bc3c0086", worktree_digest: "sha256:82089f80a295d54ca0297400e7f98f92dc1226a388e7bdd14b109ca3bc3c0086", untracked_digest: "absent", rename_from: null, rename_to: null, object_kind: { head: regular, index: regular, worktree: regular, untracked: absent } }
      - { path: "bot/src/admin-assistant.ts", state: "clean", head_digest: "sha256:9f496b09e65f87ec72f21aed6edc7c997a98408cd0e6cbb41425dcd5546eae35", index_digest: "sha256:9f496b09e65f87ec72f21aed6edc7c997a98408cd0e6cbb41425dcd5546eae35", worktree_digest: "sha256:9f496b09e65f87ec72f21aed6edc7c997a98408cd0e6cbb41425dcd5546eae35", untracked_digest: "absent", rename_from: null, rename_to: null, object_kind: { head: regular, index: regular, worktree: regular, untracked: absent } }
      - { path: "bot/src/member-assistant.ts", state: "clean", head_digest: "sha256:e3683b7497f48ae69303197f834920ee7d124a4389e2efe74cb102c1e89963cd", index_digest: "sha256:e3683b7497f48ae69303197f834920ee7d124a4389e2efe74cb102c1e89963cd", worktree_digest: "sha256:e3683b7497f48ae69303197f834920ee7d124a4389e2efe74cb102c1e89963cd", untracked_digest: "absent", rename_from: null, rename_to: null, object_kind: { head: regular, index: regular, worktree: regular, untracked: absent } }
      - { path: "bot/src/official-live-data.test.ts", state: "clean", head_digest: "sha256:5c0365b97afd8165edbe4ceb4936874dac645a59421cb413580d3a5e002892f9", index_digest: "sha256:5c0365b97afd8165edbe4ceb4936874dac645a59421cb413580d3a5e002892f9", worktree_digest: "sha256:5c0365b97afd8165edbe4ceb4936874dac645a59421cb413580d3a5e002892f9", untracked_digest: "absent", rename_from: null, rename_to: null, object_kind: { head: regular, index: regular, worktree: regular, untracked: absent } }
      - { path: "bot/src/official-live-data.ts", state: "clean", head_digest: "sha256:4916be2b6825076f140b59c5d97959bb7b1e7f3b78d589756e3ef2da9f4b5c12", index_digest: "sha256:4916be2b6825076f140b59c5d97959bb7b1e7f3b78d589756e3ef2da9f4b5c12", worktree_digest: "sha256:4916be2b6825076f140b59c5d97959bb7b1e7f3b78d589756e3ef2da9f4b5c12", untracked_digest: "absent", rename_from: null, rename_to: null, object_kind: { head: regular, index: regular, worktree: regular, untracked: absent } }
      - { path: "bot/src/realtime-search.test.ts", state: "clean", head_digest: "sha256:9facd16ca8e431aad1706cb11bbb1b2397ba92fa7ada320e3c8a463675a791bd", index_digest: "sha256:9facd16ca8e431aad1706cb11bbb1b2397ba92fa7ada320e3c8a463675a791bd", worktree_digest: "sha256:9facd16ca8e431aad1706cb11bbb1b2397ba92fa7ada320e3c8a463675a791bd", untracked_digest: "absent", rename_from: null, rename_to: null, object_kind: { head: regular, index: regular, worktree: regular, untracked: absent } }
      - { path: "bot/src/realtime-search.ts", state: "clean", head_digest: "sha256:423f9606cd69a1c9ddfc30f9b1a4a4e5040d7177783403a7622e9f87bfea5b66", index_digest: "sha256:423f9606cd69a1c9ddfc30f9b1a4a4e5040d7177783403a7622e9f87bfea5b66", worktree_digest: "sha256:423f9606cd69a1c9ddfc30f9b1a4a4e5040d7177783403a7622e9f87bfea5b66", untracked_digest: "absent", rename_from: null, rename_to: null, object_kind: { head: regular, index: regular, worktree: regular, untracked: absent } }
      - { path: "bot/src/search-evidence.test.ts", state: "clean", head_digest: "sha256:1452dbc82c63467a3656a5a3ccd045377842b17ef5c48741308ea879812aad89", index_digest: "sha256:1452dbc82c63467a3656a5a3ccd045377842b17ef5c48741308ea879812aad89", worktree_digest: "sha256:1452dbc82c63467a3656a5a3ccd045377842b17ef5c48741308ea879812aad89", untracked_digest: "absent", rename_from: null, rename_to: null, object_kind: { head: regular, index: regular, worktree: regular, untracked: absent } }
      - { path: "bot/src/search-evidence.ts", state: "clean", head_digest: "sha256:802b3d6c8137eb1af7a0fe774cf0e0c054152acfb04b717236f3c48d6e5ab1a3", index_digest: "sha256:802b3d6c8137eb1af7a0fe774cf0e0c054152acfb04b717236f3c48d6e5ab1a3", worktree_digest: "sha256:802b3d6c8137eb1af7a0fe774cf0e0c054152acfb04b717236f3c48d6e5ab1a3", untracked_digest: "absent", rename_from: null, rename_to: null, object_kind: { head: regular, index: regular, worktree: regular, untracked: absent } }
  files_to_modify:
    - { file: "bot/src/official-live-data.ts", symbols: ["fetchSportsFixtures", "getOfficialLiveDataContext"], intended_change: "Filter structured sports by competition/team/date window." }
    - { file: "bot/src/realtime-search.ts", symbols: ["searchRealtimeNews", "doSearchRealtimeNews"], intended_change: "Preserve structured context and tighten relevance/deadlines." }
    - { file: "bot/src/admin-assistant.ts", symbols: ["handleAdminDirectInteraction"], intended_change: "Require evidence for volatile queries and cancel timeout." }
    - { file: "bot/src/member-assistant.ts", symbols: ["handleMemberInteraction"], intended_change: "Mirror admin evidence and timeout behavior." }
  tests:
    - { file: "bot/src/official-live-data.test.ts", scenarios: ["La Liga query -> only matching league fixtures", "Vietnam date boundary -> correct API date window"] }
    - { file: "bot/src/realtime-search.test.ts", scenarios: ["structured success + slow RSS -> structured survives", "gold query -> tangential finance excluded"] }
    - { file: "bot/src/search-evidence.test.ts", scenarios: ["volatile insufficient context -> refusal"] }
  verification_commands:
    - "cd bot && node --import tsx --test src/official-live-data.test.ts src/realtime-search.test.ts src/search-evidence.test.ts src/structured-data.test.ts"
    - "cd bot && npm run build"
  assumptions:
    - "API-Football key remains configured on both VPS bots; verify with an authenticated probe."
  open_questions: []
  avoid:
    - "Do not hardcode a specific club, league result, gold price, or one-off entity answer."
    - "Do not change the public string return type of searchRealtimeNews."
    - "Do not allow the LLM to answer volatile claims after insufficient evidence."
```

## Assumptions and Open Questions (§12)

- [assumed] API-Football free tier supports date/league filtering used by the adapter; verify through its current endpoint response.
- Deferred: stable official structured gold/HNX/VBPL adapters remain separate source-access work.

## Definition of Done (§13)

- Relevant structured data survives slower RSS/web requests.
- Volatile claims without sufficient evidence fail closed in direct and member flows.
- Sports and finance evidence is entity/attribute relevant.
- No delayed false timeout logs after successful completion.
- Targeted tests and backend build pass; GitNexus reports accounted-for changes.
