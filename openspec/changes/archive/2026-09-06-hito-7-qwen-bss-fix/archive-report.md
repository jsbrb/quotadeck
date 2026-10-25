# Archive Report: hito-7-qwen-bss-fix

> Terminal record of the SDD cycle, reflecting the state of the change AT CLOSE (2026-09-06).
> Intermediate snapshots (`verify-report.md`) are history; where they disagree with final state, final state is reported below with the superseding evidence cited.

```yaml
schema: gentle-ai.archive-report/v1
change: hito-7-qwen-bss-fix
archived_on: "2026-09-06"
archive_commit_base: 667c47c
tasks_complete: 7/7
verdict_final: pass_with_warnings_resolved
critical_findings: 0
ledger_resets: 0
artifact_store: openspec
```

## Final State

- **Tasks**: 7/7 complete (`tasks.md`, all `- [x]`). The `verify-report.md` snapshot recorded 6/7 with task 4.2 (maintainer live E2E) pending; that snapshot claim is superseded by the persisted `tasks.md` (authoritative for completion) and commit `667c47c` (`chore(openspec): confirm hito-7 live E2E (acceptable outcome: self-explanatory AuthSiteFail surfaced)`).
- **Verification**: PASS WITH WARNINGS — 0 critical findings, 2/2 requirements and 7/7 scenarios compliant with runtime evidence. The single WARNING (task 4.2 live E2E) was subsequently RESOLVED: the maintainer's live run produced EXACTLY the task's ACCEPTABLE branch (see evidence chain below).
- **Gates at close**: 330/330 tests green (`npm --prefix extension run test`, exit 0), typecheck exit 0, build exit 0 (per `verify-report.md`, re-executed at verification HEAD `b3b3a3c`; no code changed after — only openspec bookkeeping commits `17f6374` and `667c47c` followed).
- **Ledger**: apply (197 authored changed lines — inside the ~150–250 forecast and under the 400-line review budget) and verify both settled `passed`, **zero resets**.

## Task 4.2 — ACCEPTABLE Outcome and the AuthSiteFail Evidence Chain

Task 4.2 defined three live outcomes: PASS (¥ balance), ACCEPTABLE (self-explanatory server error with visible `Code`), FAIL (bare `HTTP 400`, no body snippet). The maintainer's live run landed on **ACCEPTABLE** — by design, not by accident:

1. **Before hito-7**: `FetchTransport` threw `HttpStatusError: HTTP 400` before reading the body (AD-30 status-first), discarding the server's `Code`/`Message` — the original diagnostic blind spot.
2. **Timestamp root cause — FIXED and hermetically verified**: `toPopTimestamp()` strips the millisecond component before signing (`client.ts`), so the emitted `Timestamp` param and the StringToSign agree; pinned by zero-millis, nonzero-millis, and regex scenarios (3/3 compliant at runtime).
3. **After hito-7**: the live run surfaced `HttpStatusError: HTTP 400: <Error><Code>AuthSiteFail</Code>...` — the error-body capture (§Error Body Surfacing) working exactly as designed: text-only, capped ≤200 chars, verbatim, never JSON-parsed.
4. **Residual error diagnosed — NOT a hito-7 defect**: `AuthSiteFail` (readable only because of hito-7's error-body capture) points to site routing: the account is international and the CN endpoint (`business.aliyuncs.com`) rejects it. That discovery spawned **hito-8**; hito-7's own scope (timestamp format + error-body surfacing + permanent diagnostics) is complete and verified.

## Hito-8 Handoff (Follow-Up Facts)

- **Decisive two-endpoint signed probe**: CN endpoint → `400 AuthSiteFail`; `ap-southeast-1` endpoint → `200` with `AvailableAmount "0.00"` USD — amounts returned as JSON **strings**, success `Code` as the **string** `"200"`.
- **Usage-surface research (completed)**: no API-key quota surface exists on the target API; the usage/quota gateway is cookie+CSRF only; a binary `sk-sp-` probe is the sole key-based signal available.
- **Status**: hito-8 direction is with the maintainer (branch `feature/hito-8-qwen-site` carries hito-7's tick commit `667c47c` — stacked chain).

## Spec Sync Record

| Domain | Action | Details |
|--------|--------|---------|
| `network-allowlist` | Updated | 2 ADDED requirements (§RPC Timestamp Format, §Error Body Surfacing), 0 modified, 0 removed |

- Merged into `openspec/specs/network-allowlist/spec.md`: +54/−0 lines; the four pre-existing requirements untouched.
- Byte-identity of the appended requirement blocks against the delta verified with `diff -u` (empty output, exit 0).
- Archive folder moved mechanically (`git mv`) with pre-move recursive snapshot; `diff -r` snapshot vs destination: empty output, exit 0. The only post-diff addition is this `archive-report.md` (additive by contract).

## Archive Readiness Gates

- Task Completion Gate: 7/7 `- [x]` in the persisted `tasks.md` — no stale unchecked tasks, no reconciliation performed.
- CRITICAL gate: 0 critical findings in `verify-report.md`.
- Archived artifacts: `proposal.md`, `specs/network-allowlist/spec.md` (delta), `tasks.md`, `verify-report.md`.

## Intentional Omissions (Recorded)

- **No `design.md`** — intentional compressed planning run per the proposal header ("proposal, spec delta, and tasks in ONE pass; no design phase — zero architectural forks, both fixes are localized single-file changes"); coherence was covered by structural AD checks in verification (AD-13/AD-18/AD-19/AD-21 intact; AD-30 relaxation documented at all three required places).
- **No separate apply-progress artifact** — RED/GREEN evidence lives as rows inside `tasks.md` (carry-over from hito-6 convention); empirically re-proven during verification (11 documented RED failures reproduced at base `8516190`, 0 collateral).

## SDD Cycle Complete

Planned (proposal + delta + tasks, compressed) → implemented (strict TDD, 2f902ff / f229f62 / b3b3a3c) → verified (PASS WITH WARNINGS, warning resolved via live E2E `667c47c`) → archived (this folder, 2026-09-06).
