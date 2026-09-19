# GitNexus Plan: Hybrid Agent Routing

## 1. Objective
Add an opt-in hybrid execution layer to the existing Zalo bot so Gemini Flash Lite remains the fast semantic planner, current RSS/API evidence remains the grounding layer, 9Router can provide stronger text synthesis, and Hermes can handle deep/agentic work without becoming a second Zalo listener.

## 2. Scope
- Preserve the current Zalo listener, sender, database, search/evidence pipeline, and Gemini fallback behavior.
- Extend the planner contract with domain-neutral execution signals: freshness/risk, complexity, and tool need.
- Add four reusable response modes: `fast`, `grounded`, `deep`, and `action`.
- Add authenticated OpenAI-compatible clients for local 9Router and Hermes endpoints.
- Keep all new routing disabled by default until local services and explicit model aliases are configured.
- Limit heavy work for a 16 GB daily-use Mac mini and prevent non-owner users from gaining Hermes owner actions.
- Exclude wholesale installation of `2anh-zalo-bot` or `abs-zalo-bot`, a second Zalo session, local generative models/ComfyUI, and any automatically enabled paid API.
- Defer Codex Image execution until a verified Hermes tool/artifact contract exists; ChatGPT Plus is not treated as an API credential.

## 3. Current architecture
The shared `planSearchQueries` function uses Gemini Flash Lite to decide whether external evidence is required and produces search queries. Both member/group and admin/direct flows collect RSS/API/structured evidence, assemble a domain-neutral grounded prompt, and then call either `callGemini` or the existing narrow `callGeminiAgentLoop`. `finalizeGroundedAnswer` remains the final evidence gate.

`callGemini` is also used by summaries, JSON helpers, AI news, tests, and the agent loop. Its PDG shows that non-Lite model selections are currently rewritten to Flash Lite, so it is not a safe provider-routing seam.

## 4. GitNexus findings
- `planSearchQueries`: CRITICAL at depth 3; two direct callers and five affected flows across group and direct chat.
- `handleHistoryQA`: HIGH; it is the main member/group answer orchestrator.
- `handleAdminDirectInteraction`: LOW as an edit seam, but it is an authorization boundary and must retain its early command/auth guards.
- `callGemini`: CRITICAL; eight direct callers, ten affected processes, and five modules. It will remain unchanged.
- `callGeminiAgentLoop`: CRITICAL at depth 3; it is shared by member and admin answer paths. It will remain the fallback for existing local file/chart tools.
- All five symbol-context results are epistemically exact. Repository process discovery itself was truncated, so process absence is still treated as a lower bound.
- Persisted taint analysis reported no findings on the three inspected boundaries, but closure/property/implicit-flow blind spots mean endpoint and authorization checks are still required.

## 5. Target architecture and invariants

| Mode | Planner meaning | Execution target | Invariant |
| --- | --- | --- | --- |
| `fast` | Stable/simple answer | Existing Gemini path | No extra network hop |
| `grounded` | Fresh or high-stakes fact using collected evidence | 9Router configured synthesis model | Evidence pipeline runs first; fallback is existing Gemini |
| `deep` | Multi-step analysis or high complexity | Hermes first, then 9Router deep model | One bounded heavy task; no Zalo ownership |
| `action` | Explicit tool/state-changing request | Hermes only for an authorized owner; otherwise existing local agent loop | Planner recommendation alone can never grant tool authority |

Core invariants:
- The current bot remains the only Zalo listener and the only component allowed to send Zalo messages/files.
- Provider failure, timeout, missing configuration, open circuit, unsupported media, or authorization failure always returns to the existing callback.
- A model-produced `action` classification is advisory only; deterministic explicit-tool and owner checks are mandatory.
- Dynamic/fresh answers continue through `finalizeGroundedAnswer`; stronger models do not bypass evidence validation.
- No prompt, API key, bearer token, or raw Zalo identifier is logged. Hermes session IDs are hashed locally.

## 6. Planner contract
- Extend `QueryPlanResult` with optional validated values for `responseMode`, `complexity`, `toolIntent`, and `riskLevel`.
- Ask Flash Lite for these signals in the same JSON response, avoiding a second planner call.
- Normalize untrusted planner output through a pure deterministic function.
- Fresh/high-stakes questions cannot be downgraded below `grounded`.
- `deep` requires complexity signals; `action` requires a separate explicit tool request at execution time.
- The deterministic fallback derives the same fields from general properties of the request, not a project/person/product-specific rule.
- Preserve the current strict entity/query normalization unchanged.

## 7. Provider adapter and security design
- Use the official Hermes OpenAI-compatible API server at `http://127.0.0.1:8642/v1/chat/completions` with bearer authentication.
- Use 9Router's OpenAI-compatible API at `http://127.0.0.1:20128/v1/chat/completions` with an explicit dashboard API key and explicit model/combo aliases.
- Permit only loopback endpoints by default. Remote endpoints require an explicit opt-in and HTTPS.
- Apply provider-specific timeout, bounded response size, a small failure-threshold circuit breaker, and a cooldown.
- Use one in-process heavy-work semaphore by default. Hermes/9Router must also be configured for global concurrency one when both bot processes share the same Mac.
- Return only final text to the bot. Existing file callbacks remain on the current Gemini agent loop until a verified Hermes artifact response is implemented.

## 8. Implementation sequence
1. Add a pure `hybrid-routing` module containing types, planner-signal normalization, deterministic route selection, and authorization-safe route downgrades.
2. Extend `query-planner.ts` to emit and normalize execution signals while preserving query generation and fallback semantics.
3. Add a `hybrid-agent` runtime with local-endpoint validation, OpenAI response parsing, timeout, semaphore, circuit breaker, telemetry, Hermes/9Router selection, and fail-open fallback.
4. Add centralized opt-in environment configuration and `.env.example` documentation. Do not put credentials or guessed model aliases in source.
5. Integrate only at the final synthesis points in `handleHistoryQA` and `handleAdminDirectInteraction`; leave media/file fast paths and the current agent loop intact.
6. Add unit tests for routing, authorization, endpoint security, provider selection, parsing, timeout/circuit behavior, concurrency, and fallback.
7. Run targeted tests, full bot tests, typecheck/build, GitNexus re-index, `detect_changes`, and change review before any commit.
8. After code verification, install/start Hermes and 9Router separately only with approved local configuration, then enable one route at a time (`grounded`, then `deep`, then owner actions).

## 9. Failure, fallback, and resource behavior
- `HYBRID_ROUTING_ENABLED=false`: zero behavioral change and zero extra request.
- 9Router unavailable/misconfigured: log provider, route, latency, and status only; execute current Gemini callback.
- Hermes unavailable/misconfigured: try the explicitly configured 9Router deep model if eligible, otherwise execute current callback.
- Circuit open: skip the unhealthy provider immediately until cooldown expires.
- Timeout: abort the request; never allow a late response to produce a second Zalo reply.
- Media/file requests: stay on the current Gemini/media/tool code path in this phase.
- Action from non-owner: never reaches Hermes owner capabilities.
- Missing grounded evidence: existing evidence policy and finalizer remain authoritative; the router cannot manufacture a source.

## 10. Files
Modify:
- `bot/src/query-planner.ts`
- `bot/src/query-planner.test.ts`
- `bot/src/member-assistant.ts`
- `bot/src/admin-assistant.ts`
- `bot/src/config.ts`
- `bot/.env.example`

Add:
- `bot/src/hybrid-routing.ts`
- `bot/src/hybrid-routing.test.ts`
- `bot/src/hybrid-agent.ts`
- `bot/src/hybrid-agent.test.ts`

Explicitly avoid modifying:
- `bot/src/gemini.ts`
- Zalo listener/session code
- web dashboard/build artifacts
- current evidence ranking/finalization internals

## 11. Test scenarios
- Stable greeting/knowledge stays `fast`.
- Fresh or high-stakes facts cannot be downgraded by malformed planner JSON and route `grounded`.
- High-complexity grounded analysis routes `deep` only after evidence collection.
- Planner-suggested `action` without an explicit tool request is downgraded safely.
- Non-owner explicit action never calls Hermes.
- Disabled integration performs no fetch and calls the existing fallback exactly once.
- 9Router grounded success returns parsed text; malformed/empty response falls back.
- Hermes deep success uses a hashed session ID and does not expose raw Zalo identifiers.
- Loopback HTTP is accepted; remote HTTP and unapproved remote HTTPS are rejected.
- Timeout, 429/5xx, and repeated failures open the circuit; cooldown permits a later probe.
- Heavy concurrency never exceeds the configured limit inside a bot process.
- Existing planner, realtime search, evidence, admin, and member-related test suites continue to pass.

## 12. Risks and open questions
- The working tree already contains unrelated user changes in the main integration files. Patches must be minimal and commits must stage only this implementation.
- The refreshed GitNexus index reports truncated process discovery; source verification and full tests are required in addition to graph checks.
- Two bot processes have separate in-process semaphores. Global concurrency one must ultimately be enforced by the single Hermes/9Router services or a later shared lock.
- Hermes and 9Router are not currently listening locally, and Hermes is not installed. New paths must remain off until runtime setup is completed.
- Model/combo names are user configuration. Guessing them could select a paid or unavailable provider.
- Hermes artifact delivery and Codex Image entitlement are not yet verified end-to-end, so this phase must not claim file/image completion through Hermes.

## 13. Definition of Done
- The planner and next execution stage share one validated, reusable, domain-neutral routing contract.
- Existing behavior is byte-for-byte reachable through the fallback callback and remains the default.
- 9Router/Hermes calls are opt-in, authenticated, bounded, loopback-only by default, circuit-protected, and concurrency-limited.
- Both group and 1:1 flows use the same orchestration policy without adding a second Zalo listener.
- No entity-specific or real-estate-specific routing patch is added.
- Targeted and full tests, typecheck/build, GitNexus re-index, `detect_changes`, and review pass with no unresolved HIGH/CRITICAL regression.

## Evidence provenance
```json
{
  "schema_version": 2,
  "head_commit": "d486c77f32d8b79e9edec65cb905f831deba2679",
  "generated_plan_path": "docs/plans/2026-09-19-gitnexus-plan-hybrid-agent-routing.md",
  "global_dirty_digest": {
    "algorithm": "sha256",
    "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
    "value": "b63cf98309b6a51d8358e4414f5ed5e1af4df7f0c66df9d03d3a7b26273a4294"
  },
  "cited_path_manifest": [
    {
      "path": "bot/.env.example",
      "object_kind": { "head": "regular", "index": "regular", "worktree": "regular", "untracked": "absent" },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:b9172de3816270b8563743898428122ef3b13d5858a5a37fba6dd639251e90a7",
      "index_digest": "sha256:b9172de3816270b8563743898428122ef3b13d5858a5a37fba6dd639251e90a7",
      "worktree_digest": "sha256:b9172de3816270b8563743898428122ef3b13d5858a5a37fba6dd639251e90a7",
      "untracked_digest": "absent"
    },
    {
      "path": "bot/package.json",
      "object_kind": { "head": "regular", "index": "regular", "worktree": "regular", "untracked": "absent" },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:82089f80a295d54ca0297400e7f98f92dc1226a388e7bdd14b109ca3bc3c0086",
      "index_digest": "sha256:82089f80a295d54ca0297400e7f98f92dc1226a388e7bdd14b109ca3bc3c0086",
      "worktree_digest": "sha256:82089f80a295d54ca0297400e7f98f92dc1226a388e7bdd14b109ca3bc3c0086",
      "untracked_digest": "absent"
    },
    {
      "path": "bot/src/admin-assistant.ts",
      "object_kind": { "head": "regular", "index": "regular", "worktree": "regular", "untracked": "absent" },
      "state": "unstaged",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:1752a0e1f9dfe0b8917ebf3ff731902ce7146f18af3b9511be344288b3053cd5",
      "index_digest": "sha256:1752a0e1f9dfe0b8917ebf3ff731902ce7146f18af3b9511be344288b3053cd5",
      "worktree_digest": "sha256:304b1676d900bb8838fa6011caafecd142ee5e21630ba2367304b707ebc29e78",
      "untracked_digest": "absent"
    },
    {
      "path": "bot/src/config.ts",
      "object_kind": { "head": "regular", "index": "regular", "worktree": "regular", "untracked": "absent" },
      "state": "unstaged",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:5a4bac9f9e0b9b5b285374d4787c1e533bb983a2e26144a30032f63599ee9e76",
      "index_digest": "sha256:5a4bac9f9e0b9b5b285374d4787c1e533bb983a2e26144a30032f63599ee9e76",
      "worktree_digest": "sha256:4201fcfdd3422098d9e5a59f9f1c8b49e5b34ceac9ac4b4898539962f35b6a6a",
      "untracked_digest": "absent"
    },
    {
      "path": "bot/src/gemini.ts",
      "object_kind": { "head": "regular", "index": "regular", "worktree": "regular", "untracked": "absent" },
      "state": "unstaged",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:d434e8eb31a3b6e199dfcf947bce1bdb5fcb0ef6b8f896ae458af94776f01109",
      "index_digest": "sha256:d434e8eb31a3b6e199dfcf947bce1bdb5fcb0ef6b8f896ae458af94776f01109",
      "worktree_digest": "sha256:f117b274c9bc2661f42c3a49a277b6839e2fea45c745fd6ad2ec5a3e2ab2e2de",
      "untracked_digest": "absent"
    },
    {
      "path": "bot/src/member-assistant.ts",
      "object_kind": { "head": "regular", "index": "regular", "worktree": "regular", "untracked": "absent" },
      "state": "unstaged",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:b3810730d7aad0834763f9f5108109a075187caf5b2bd50d0113740c350a4d13",
      "index_digest": "sha256:b3810730d7aad0834763f9f5108109a075187caf5b2bd50d0113740c350a4d13",
      "worktree_digest": "sha256:85858bc369522a09ee0bf814c48e347b173b04c3a57bef9ab9e128e15d87c98c",
      "untracked_digest": "absent"
    },
    {
      "path": "bot/src/query-planner.test.ts",
      "object_kind": { "head": "regular", "index": "regular", "worktree": "regular", "untracked": "absent" },
      "state": "clean",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:52fc54bf1b04a9f63714b716f32ef01e4877240ca17f7d6d48628361e78786ce",
      "index_digest": "sha256:52fc54bf1b04a9f63714b716f32ef01e4877240ca17f7d6d48628361e78786ce",
      "worktree_digest": "sha256:52fc54bf1b04a9f63714b716f32ef01e4877240ca17f7d6d48628361e78786ce",
      "untracked_digest": "absent"
    },
    {
      "path": "bot/src/query-planner.ts",
      "object_kind": { "head": "regular", "index": "regular", "worktree": "regular", "untracked": "absent" },
      "state": "unstaged",
      "rename_from": null,
      "rename_to": null,
      "head_digest": "sha256:6cf750939e3ac559789c8beb57ad1a489a9a35423740f263508363c5806738aa",
      "index_digest": "sha256:6cf750939e3ac559789c8beb57ad1a489a9a35423740f263508363c5806738aa",
      "worktree_digest": "sha256:98a72e844aaf118f0d3007d33dfe52cb8cf55af9b78b5a690dfc95314c3b442b",
      "untracked_digest": "absent"
    }
  ]
}
```
