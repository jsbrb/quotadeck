# Archive Report: hito-8-qwen-hybrid

> Terminal record of the SDD cycle, reflecting the state of the change AT CLOSE (2026-09-06).
> Intermediate snapshots (`verify-report.md` FAIL revision committed as 90f9d84) are history; where they disagree with final state, final state is reported below with the superseding evidence cited.

```yaml
schema: gentle-ai.archive-report/v1
change: hito-8-qwen-hybrid
archived_on: "2026-09-06"
archive_commit_base: 8450433
tasks_complete: 25/25
verdict_final: pass
critical_findings: 0
requirements: 13/13
scenarios: 44/44
tests: 426/426 across 29 files
artifact_store: openspec
spec_domains_synced: 5
```

## Final State

- **Tasks**: 25/25 complete (`tasks.md`, all `- [x]`) — Task Completion Gate passed with zero reconciliation.
- **Verification**: PASS (re-verify at HEAD `8450433`, report admitted by `gentle-ai sdd-verify-validate`: valid, verdict pass). 426/426 tests across 29 files, typecheck exit 0, build exit 0, 25/25 tasks, 44/44 scenarios compliant across 13/13 requirements, 0 critical findings. The sole WARNING is informational store topology (no apply-progress artifact; RED/GREEN structure lives in `tasks.md` pairs), carried from the prior verify and compensated by direct verification.
- **Gates at close**: all three gates exit 0 per the admitted verify report; no code changed after `8450433` — this archive is docs/openspec-only.
- **Success criteria**: 3/3 ticked in `proposal.md`. Criterion 1 (hermetic suite green incl. pins) was ticked at archive settlement — see Reconciliation Record.

## Remediation Chain (post-failed-verify, all in the final suite)

The FAIL verify (90f9d84, evidence head 622a2b3: 422 tests, 1 critical — task 3.2 open; 1 partial — determinism gap) was followed by four commits, each re-verified in source at the PASS re-verify:

1. `cf9a037` — plan-carrying render determinism pin (closes W1/PARTIAL): +1 test.
2. `676d735` — `Format=JSON` on the BSS `QueryAccountBalance` query: the international site's POP endpoint defaults to XML; the live 400 this caused is gone. Pinned by exact query equality on both sites (`qwen.test.ts:82,89`).
3. `f16e919` — probe silent arms now `console.error` on the worker console (transport failure; unmapped status). This diagnostic is what exposed the live 400 that `24a0e0c` fixed. +2 tests.
4. `24a0e0c` — `Content-Type: application/json` on every dispatched JSON body (single non-credential header; bodyless requests carry none). The token-plan probe endpoint rejects unlabeled bodies with HTTP 400 — observed live. +1 test; the network-allowlist delta was amended accordingly and the AMENDED text is what this archive synced.

Suite delta vs the failed verify: 422 → 426 (+1 determinism, +2 probe diagnostics, +1 Content-Type).

## Maintainer Live E2E (task 3.2 — confirmed 2026-09-06)

- (a) International balance rendered **$0.00** from `business.ap-southeast-1.aliyuncs.com` — no `AuthSiteFail` (site fix + `Format=JSON`).
- (b) Real `sk-sp-` key → popup **"Plan: Available"**; `chrome.storage` `qd:qwen-plan-status` = `{"status":"available"}` after a 2xx probe (the labeled JSON body per `24a0e0c` works against the real endpoint).
- (c) Badge remains balance-only with plan status present (also pinned hermetically: `background.test.ts:557`, `usage.test.ts:64`).

Known informational (non-blocking, recorded per orchestrator handoff): live E2E exercised the `available` probe arm only; `exhausted`/`key-rejected` arms remain hermetic-only. The maintainer's qwen AK/SK pair is currently revoked in their browser (balance card absent) — irrelevant to this archive; the balance path was E2E-proven earlier the same day.

## Spec Sync Record

| Domain | Action | Details |
|--------|--------|---------|
| `key-storage` | Updated | 2 ADDED requirements (§Qwen Site Preference, §Qwen Plan Key (Dual Credential)); 6 existing untouched → 8 total |
| `network-allowlist` | Updated | 2 MODIFIED requirements (§Per-Provider Domain Allowlist, §Credentials Only in Authorization Header — including the post-verify amendment: JSON bodies labeled `Content-Type: application/json`, bodyless requests carry none); 0 added/removed → 6 total |
| `provider-framework` | Updated | 3 MODIFIED (§Provider Contract, §Qwen Parsing, §Credential Attach Modes) + 1 ADDED (§Qwen Plan Probe) → 10 total |
| `popup-ui` | Updated | 1 MODIFIED (§Settings Guidance qwen row: balance/plan/site distinction) + 3 ADDED (§Qwen Site Selector, §Qwen Plan Line, §Qwen Plan Key Settings Group) → 14 total |
| `usage-badge` | Updated | 1 ADDED (§Qwen Plan Probe Cadence — TTL bounds 120/15/15, badge unchanged) → 6 total |

Totals across the five main specs: 13 delta requirements synced, 44 requirement-level scenarios carried. Merged main specs now count 44 requirements / 115 scenarios.

### Sync mechanics and evidence

- Merge performed by a deterministic block-splice script (`### Requirement:` heading anchors; MODIFIED blocks replaced in place by heading match, ADDED blocks appended at end). No artifact content passed through model Read/Write transcription.
- Post-merge verification, per block: extraction from delta vs extraction from merged main, compared with `diff -u` and `sha256sum`.
  - ADDED requirements: byte-identical to the delta (sha256 match) — except `Qwen Plan Key Settings Group`, whose only delta-side difference is the dropped `## MODIFIED Requirements` scaffolding line.
  - MODIFIED requirements: every block diff shows ONLY the documented transforms (below) and nothing else.
  - Untouched requirements: present unchanged (git diff hunks confined to replaced/appended regions; Purpose sections and all non-delta requirements untouched).
- Archive folder moved mechanically with `git mv` after a recursive pre-move snapshot; `diff -r` snapshot vs destination: **empty output, exit 0** (byte-identical). The only post-diff addition is this `archive-report.md` (additive by contract).

### Documented sync transforms (delta → main spec)

1. `(Previously: …)` annotation lines (one per MODIFIED requirement, 6 total) were dropped — they are delta change-tracking metadata; main specs carry no such annotations (hito-1..7 convention).
2. `## ADDED|MODIFIED Requirements` scaffolding headings inside delta bodies were dropped (2 instances).
3. **Mojibake normalization (one line)**: the network-allowlist delta's §Credentials Only in Authorization Header body contained two double-encoded em-dashes (`â€”`, bytes `C3 A2 C2 80 C2 9D`) introduced by amendment commit `24a0e0c` (verified: the 3ba56d6 original delta was clean). The merged main spec carries the intended em-dash (`E2 80 94`, matching the requirement's own pre-existing text style). The archived delta is preserved verbatim — mojibake included — as the audit trail.

## Archive-Time Reconciliation Record (exceptional, documented)

- **proposal.md success criterion 1** (`Hermetic suite green … incl. intl-string envelope, probe mapping, cache-TTL, and BSS-scoping pins`) was `- [ ]` at HEAD `8450433` (git history: `8450433` ticked criterion 3 only; criterion 2 was ticked at `b2cab15`; criterion 1 was never ticked). Reconciled to `- [x]` immediately before the archive snapshot. Basis: the admitted PASS verify report's SUGGESTION 1 explicitly delegates this tick to "archive settlement (docs-only, orchestrator-owned)" with the criterion evidenced by the 426/426 verification, and the orchestrator's archive handoff asserts the all-ticked final state. One-character docs-only change; no code touched.
- No task-checkbox reconciliation was needed: `tasks.md` showed 25/25 `- [x]` at HEAD.

## Archive Readiness Gates

- Task Completion Gate: 25/25 `- [x]` in the persisted `tasks.md` — no stale unchecked tasks.
- CRITICAL gate: 0 critical findings in the admitted verify report (`verdict: pass`).
- Verify report resolves at its locator and was admitted by `gentle-ai sdd-verify-validate` (valid: true, verdict: pass).
- Native `gentle-ai sdd-status` DAG reports `dependencies.archive: blocked` — a structural artifact of this compressed planning run (no `design.md` artifact → design/apply/verify/archive edges read "blocked" while the artifacts themselves report done: verifyReport `done`, tasks 25/25). The archive phase instruction's own conditions ("verify report resolves at locator + every task complete") are satisfied; same topology as the hito-7 compressed run, archived as `2026-09-06-hito-7-qwen-bss-fix`. Orchestrator authority: archive-ready, PASS admitted.
- `rules.archive` (config): "Warn before merging destructive deltas" — not triggered: zero REMOVED/RENAMED requirements across all five deltas; every MODIFIED replacement is a semantic superset preserving or extending its scenario set.

## Intentional Omissions (Recorded)

- **No `design.md`** — intentional compressed planning run per the proposal header; Design Notes §1–5 in `proposal.md` are the decision record (dual-credential model, probe composition outside `RefreshEngine`, cache bounds, reset-from-error-text, plan-on-card semantics). Coherence verified against code in the verify report.
- **No separate apply-progress artifact** — RED/GREEN evidence lives as task pairs inside `tasks.md` (carry-over convention from hito-6/7); store-topology WARNING in the verify report is informational only.

## SDD Cycle Complete

Planned (proposal + 5 delta specs + tasks, compressed) → implemented (strict TDD, two chained slices PR 1/PR 2) → verified (FAIL 90f9d84 → remediation `cf9a037`/`676d735`/`f16e919`/`24a0e0c` → PASS `8450433`, live E2E confirmed) → archived (this folder, 2026-09-06).
