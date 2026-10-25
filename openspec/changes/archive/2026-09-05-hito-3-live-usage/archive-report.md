# Archive Report: hito-3-live-usage

**Archived**: 2026-09-05 · **Branch**: `feature/hito-3-live-usage` · **HEAD at close**: 2eb35b3 (verify-report commit, clean tree) · **Classification**: intentional-with-warnings (partial archive, maintainer-ratified)

## Final State

- **20/21 tasks complete.** Task 3.8 (maintainer live E2E) FAILED PARTIALLY and is recorded as such — it is intentionally left unchecked in `tasks.md`. It is neither a stale checkbox nor pending work: its outcome is settled (see Partial 3.8 Outcome) and its residue is routed to hito 4.
- **232/232 tests green** (`npm --prefix extension run test`), **typecheck and build exit 0** at HEAD.
- **Verification: PASS WITH WARNINGS** — 0 CRITICAL, 2 WARNING (`verify-report.md`, evidence revision `sha256:792477f0…`, committed as 2eb35b3; 18/18 requirements, 42/42 scenarios).
- **Ledger at close**: 3 slices settled passed + 1 reset (1,771 supersession-deletion lines, actor Javier) + verify settled.
- **Commit range**: proposal 6e11a09 … verify report 2eb35b3 — 19 apply work-unit commits across 3 slices (network+auth+signer; ZAI window semantics + tier budget; live wiring + popup + copy).

## Task Completion Gate: Intentional Partial Archive

Task 3.8 is the only unchecked task. It is NOT a stale-checkbox reconciliation case (the work was attempted and partially failed); it is a documented partial failure. The 0-CRITICAL verify verdict, the maintainer-ratified supersession decision, and the orchestrator's explicit archive instruction together satisfy the intentional-partial-archive policy: the residue is accepted with cause identified and recorded here. `sdd-verify` WARNING 1 explicitly allowed this path ("settlement/archive should wait for it or explicitly accept the residue") — the residue is now explicitly accepted.

## Partial 3.8 Outcome (2026-09-05, maintainer live E2E)

State evolution, per the final-state hierarchy: the verify-report (at its snapshot time, HEAD 2f44df2) recorded 3.8's live half as "pending, human-owned". The maintainer then ran the live E2E on 2026-09-05. Final outcome:

- **OpenAI / Kimi / Qwen live wiring: verified structurally.**
- **ZAI live E2E FAILED its own success criterion** ("stored ZAI key → live 5h percentage in one tick"):
  - **Empty-bill evidence**: the maintainer's GLM Coding Plan has ZERO rows in the bigmodel.cn `expenseBillList` endpoint. Live-probed billing months 2026-08 and 2026-09 — both responses returned `total: 0, code: 200`. Conclusion: the endpoint bills **pay-as-you-go usage, NOT Coding Plan usage**, so the hito-3 criterion is unachievable against a Coding Plan account through this endpoint.
  - **Live-found defect (pageNum)**: the real `expenseBillList` response has NO `pageNum` field. The hito-3 provider demanded it, producing a plain `Error` that classified as errorClass `unknown` (not a mapped taxonomy class). The real top-level response shape is `{total, rows, code, msg}`.
  - Design Open Question O3 (`data.customerId` field pinning) is thereby moot for Coding Plans — never live-confirmable through an empty bill.

## Supersession Decision (maintainer-ratified)

ZAI Coding-Plan usage moves to the **official monitor endpoints**, verified through three independent community implementations (`zai-org/zai-coding-plugins`, `ecerutti/glm-usage-monitor`, `guyinwonder168/opencode-glm-quota`):

- `https://api.z.ai/api/monitor/usage/quota/limit` (plus model-usage / tool-usage endpoints)
- ZHIPU mirror on `open.bigmodel.cn`
- **RAW-key Authorization (no Bearer prefix)**
- Token windows 5h / weekly, plus monthly MCP; percentage, total, and `nextResetTime` come from the API itself

This is **hito 4 (`hito-4-zai-monitor`)**. The hito-3 ZAI `expenseBillList` provider and the tier-budget call-count model are **SUPERSEDED for Coding Plans** — potential future value for pay-as-you-go accounts only. The `network-allowlist` requirement "Unverified Variant Excluded" (`api.z.ai`) intentionally STAYS as-is in the main specs: its supersession belongs to hito 4, not this archive.

## Verify Warnings Disposition

| # | Warning (per verify-report, at verification time) | Final disposition |
|---|---------------------------------------------------|-------------------|
| W1 | Task 3.8 incomplete: maintainer live E2E pending | **RESOLVED AS PARTIAL FAIL with cause identified** — empty `expenseBillList` probes (2026-08, 2026-09) prove the endpoint does not bill Coding Plans; supersession to hito 4 ratified; residue explicitly accepted |
| W2 | Strict-TDD reporting format gap: no standalone apply-progress "TDD Cycle Evidence" table | Standing format-level finding (same as hito-2); substance corroborated — per-unit RED→GREEN pairs embedded in `tasks.md`, all named test files exist and passed at verification |

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| tier-budget | Created (new capability) | Full spec mechanically copied from the delta (7 requirements: trailing-window, tier derivation, configurable limits, percentage, countdown, month-straddle, timezone discipline) — **superseded for Coding Plans by hito 4; pay-as-you-go potential only** |
| provider-framework | Updated | ADDED Qwen AK/SK Pair Handling; MODIFIED ZAI Parsing (window semantics, 4 scenarios); RENAMED+MODIFIED Fixture-Only Data → Hermetic Tests with Live Transport Contract; Purpose rewritten to live posture |
| usage-badge | Updated | ADDED Error Taxonomy Mapping; MODIFIED One-Minute Alarm Schedule (live refresh per tick); REMOVED No Live Calls in Milestone; Purpose rewritten to live posture |
| popup-ui | Updated | ADDED Settings Gear Surface + Per-Model Consumption View; MODIFIED Current Cycle Data on Open; REMOVED Fixture-Only Operation; Purpose rewritten to live posture |
| network-allowlist | Updated | ADDED Manifest Host Permissions Consistency; MODIFIED Credentials Only in Authorization Header (Qwen-scoped RPC exception); Purpose rewritten to live posture; Unverified Variant Excluded untouched by design |
| key-storage | Updated | ADDED Qwen AK/SK Pair Persistence (round-trip, per-part masking, atomic revoke) |

Required refresh flagged by the spec phase was applied: the four listed Purpose paragraphs no longer say "fixture-only / no live calls".

Destructive-merge warning rule (`openspec/config.yaml` → `rules.archive`): the two REMOVED requirements (usage-badge §No Live Calls in Milestone; popup-ui §Fixture-Only Operation) are planned, delta-documented removals with recorded Reason/Migration, confirmed genuinely gone by `sdd-verify`, and were explicitly part of the orchestrator-approved sync — recorded here rather than silently applied.

## Mechanical Integrity

- `openspec/specs/tier-budget/spec.md` created by mechanical shell copy (Copy-Item → `diff` → Move-Item); readback diff empty, exit 0.
- Change folder moved with `git mv` after a recursive pre-move snapshot; `diff -r` snapshot vs `openspec/changes/archive/2026-09-05-hito-3-live-usage/` produced empty output, exit 0 (byte-identical). Source directory absent after the move.
- This `archive-report.md` is additive (did not exist in the source snapshot) and is excluded from the comparison by convention.

## Hito-4 Handoff Facts (`hito-4-zai-monitor`)

- Target endpoints: `https://api.z.ai/api/monitor/usage/quota/limit` + model-usage/tool-usage; ZHIPU mirror on `open.bigmodel.cn`.
- Auth: RAW key in `Authorization` (no Bearer prefix) — differs from every hito-3 credential attach mode.
- Semantics: 5h and weekly token windows + monthly MCP; percentage / total / `nextResetTime` provided by the API (no client-side window math, unlike tier-budget).
- Community verification sources: `zai-org/zai-coding-plugins`, `ecerutti/glm-usage-monitor`, `guyinwonder168/opencode-glm-quota`.
- Carry-over defect knowledge for any future `expenseBillList` (pay-as-you-go) work: real top-level response shape is `{total, rows, code, msg}` with NO `pageNum` field; the hito-3 provider's `pageNum` demand caused plain `Error` → errorClass `unknown`.

## Source Artifacts (audit trail)

All in this folder: `proposal.md`, `specs/` (6 domain deltas), `design.md` (AD-16…AD-24), `tasks.md` (20/21, 3.8 intentionally unchecked), `verify-report.md`.
