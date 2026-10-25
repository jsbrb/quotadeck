# Archive Report: hito-1-extension-skeleton

**Archived**: 2026-09-05 · **Branch**: `feature/hito-1-spike-y-esqueleto` · **HEAD at close**: bed1532
**Artifact store**: openspec · **Archive path**: `openspec/changes/archive/2026-09-05-hito-1-extension-skeleton/`

## Final State at Close

| Fact | Value | Source |
|---|---|---|
| Tasks complete | **28/28** (`tasks.md`: 28 × `[x]`, 0 × `[ ]`) | persisted tasks artifact (top authority) |
| Task 6.3 (manual E2E) | Maintainer loaded the extension unpacked in Chrome, seeded `qd:key:kimi` via the service worker console, and confirmed the badge updates on the 1-minute alarm tick (2026-09-05) | tasks artifact + orchestrator final-state handoff; commit 96b9c3c |
| Verification verdict | **PASS** — 0 CRITICAL, 0 WARNING, 4 SUGGESTION; 19/19 requirements, 30/30 scenarios compliant | `verify-report.md` at verification time (2026-09-05); figures remain final because nothing changed afterwards |
| Verify evidence | build `npm --prefix extension run build` → exit 0, output sha256:4a6d76c5…; tests `npm --prefix extension test -- --run` → exit 0 (74 passed / 13 files), output sha256:d32cd1f9… | `verify-report.md` (commit bed1532) |
| Post-verify changes | **None.** No remediation and no post-verify fixes followed the verify report; the only commit after verification evidence was collected is the verify report's own commit (bed1532). Working tree was clean before archive. | orchestrator final-state handoff, corroborated by clean `git status` at archive time |
| Commit range | f68245f (repo bootstrap) … bed1532 (verify report); 19 commits total, of which 12 are work-unit commits delivered across 3 chained PR slices (4 per slice) | git history |
| Delivery reconciliation | `tasks.md` forecast says `Chain strategy: pending` — stale snapshot detail. Actual delivery was 3 chained slices; the launch handoff (higher rank) and git history (slice commits 659d8b5…a726018) confirm it | orchestrator handoff outranks intermediate snapshot |

## Specs Synced (source of truth: `openspec/specs/`)

| Domain | Action | Requirements | Scenarios | Details |
|---|---|---|---|---|
| `provider-framework` | Created | 7 | 13 | Provider contract, registration, ZAI/Qwen/OpenAI/Kimi parsing, fixture-only data |
| `network-allowlist` | Created | 4 | 7 | Per-provider domain allowlist, unverified variant excluded, Authorization-only credentials, injectable transport |
| `key-storage` | Created | 4 | 5 | Local-only persistence, masked display, revocation, per-provider isolation |
| `usage-badge` | Created | 4 | 5 | One-minute alarm schedule, badge rendering, error state, no live calls in milestone |
| **Total** | 4 created | **19** | **30** | matches verify-report compliance matrix exactly |

### Destructive-Delta Assessment

`openspec/config.yaml` archive rule "Warn before merging destructive deltas": **not triggered — no destructive delta applies.** All four delta specs are greenfield full specs (no `MODIFIED`, `REMOVED`, or `RENAMED` sections); `openspec/specs/` contained no prior specs (only `.gitkeep`), so the sync was purely additive (4 new `spec.md` files, zero existing requirements touched).

## Task Completion Gate

**Passed.** `tasks.md` shows 28/28 implementation tasks checked, zero unchecked. No archive-time reconciliation was needed and none was performed.

## Verification Summary

Per `verify-report.md` (verdict **pass**, blockers 0, critical 0, warning 0, suggestion 4), verified on branch `feature/hito-1-spike-y-esqueleto` on 2026-09-05: typecheck, build, and tests all exit 0; hermeticity proven (`background.test.ts > full four-provider tick with global fetch disabled`); manifest requests only `storage`+`alarms` (no `host_permissions`); design decisions AD-1…AD-9 all followed with evidence. The orchestrator confirms nothing changed after the verify report except its own commit, so these results are the final state of the change.

### Proposal Success Criteria

All five criteria in `proposal.md` are met per verify-report evidence: build + all vitest suites green (criterion 1), network rejections test-proven (2), no `.sync` path + masked keys with revoke (3), badge per 1-min tick via unpacked load — task 6.3 (4), endpoints doc with verification status + allowlist block (5). The proposal's `- [ ]` markers are proposal-phase checkboxes, not the tasks artifact, and are left untouched in the archived audit trail.

## Follow-up Suggestions (recorded for the live-calls milestone)

1. **BrowserApi `runtime` addition vs design sketch** — design §Interfaces omits `runtime` (`onInstalled`/`onStartup`); implementation adds `BrowserRuntime` in `platform/browser-api.ts` to satisfy usage-badge §One-Minute Alarm Schedule. Update the design sketch if the doc is revised.
2. **Stale design layout line** — design §Project Layout places `createDefaultRegistry()` in `core/registry.ts`; the implementation (task 2.2 annotation) places it in `providers/index.ts` so core stays provider-free (AD-1). The design line is stale.
3. **ZAI/OpenAI per-instance cycle fields** — `cycleMonth`/`cycleStart` are safe under the sequential engine but would race if one instance were refreshed concurrently; move into `ProviderState` at the live milestone (before any concurrent refresh).
4. **Qwen Bearer placeholder** — Qwen requests currently carry a Bearer-style `Authorization` (documented in `network/client.ts`); real Alibaba AK/SK HMAC signing is deferred to the live milestone — track it there.

## Mechanical Copy Audit

All copies and moves were shell-only (`Copy-Item`, `git mv`); no artifact content passed through model Read/Write. Independent recursive diffs (`git diff --no-index`, byte-level):

- Spec sync, per domain (delta vs `openspec/specs/<domain>/spec.md`): **empty diff, exit 0** × 4.
- Archive move (pre-move recursive snapshot of the change folder vs archived tree): **empty diff, exit 0**; source directory confirmed gone after `git mv`; destination collision guard passed (destination did not pre-exist).
- `archive-report.md` is additive (authored after the readback; not part of the source snapshot) and is excluded from the comparison by convention.

## Archive Contents

- `proposal.md` ✅
- `specs/` ✅ (4 delta specs)
- `design.md` ✅
- `tasks.md` ✅ (28/28 complete)
- `verify-report.md` ✅ (PASS, 0 critical / 0 warning / 4 suggestion)
- `archive-report.md` ✅ (this file, additive)

## SDD Cycle Complete

The change has been fully planned (proposal, specs, design, tasks), implemented (12 work-unit commits across 3 chained slices, f68245f…bed1532), verified (PASS), and archived. `openspec/specs/` is now the source of truth for the four new capabilities. Ready for the next change (live-calls milestone carries the four follow-up suggestions above).
