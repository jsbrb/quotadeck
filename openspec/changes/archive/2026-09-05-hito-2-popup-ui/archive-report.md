# Archive Report: hito-2-popup-ui

**Archived**: 2026-09-05 · **Branch**: `feature/hito-2-popup-ui` · **HEAD at close**: 59a2d64
**Artifact store**: openspec · **Archive path**: `openspec/changes/archive/2026-09-05-hito-2-popup-ui/`

## Final State at Close

| Fact | Value | Source |
|---|---|---|
| Tasks complete | **15/15** (`tasks.md`: 15 × `[x]`, 0 × `[ ]`) | persisted tasks artifact (top authority) |
| Verification verdict | **PASS WITH WARNINGS** — 0 CRITICAL, 1 WARNING, 3 SUGGESTIONS; 6/6 requirements, 12/12 scenarios compliant | `verify-report.md` (committed as 59a2d64), admitted by `gentle-ai sdd-verify-validate --requirements 6 --scenarios 12` |
| Verify WARNING 1 | Format-level only: strict-TDD evidence lives in `tasks.md` per-unit RED→GREEN pairs plus commit pairing (test+impl in every work unit; no impl-only commit) instead of a standalone "TDD Cycle Evidence" table. Substance verified positive by `sdd-verify`; deviation recorded there for the pipeline owner | `verify-report.md` §TDD Compliance |
| Verify evidence | typecheck exit 0; build exit 0 (`background.js` 31,941 B, `popup.js` 21,831 B, manifest with `action.default_popup`, `popup.html`); tests exit 0 — **112 passed / 0 failed / 16 files** (74 hito-1 + 38 new: snapshot-store 13, view 12, controller 10, background +3) | `verify-report.md` (evidence collected at 503fdf0, clean tree) |
| Manual E2E (maintainer) | **CONFIRMED WORKING** — popup opens on action click, accepted a real ZAI key, rendered fixture data (static 39 CNY, exactly as designed for the fixture-only milestone). Closes proposal success criterion 4 and verify SUGGESTION 3 | orchestrator final-state handoff (maintainer session, 2026-09-05) — post-verify evidence outranking the report's "remains maintainer-side" snapshot phrasing |
| Maintainer "algo falla" report | **RESOLVED as expectation mismatch, NOT a malfunction** — the maintainer expected live usage data; live calls are hito-3 scope per his own ratified deferral. No defect found, no code change made. Resolution and the maintainer's UI feedback are recorded below as hito-3 product input | orchestrator final-state handoff |
| Post-verify changes | **None.** No remediation followed the verify report; the only commit after verification evidence (collected at 503fdf0) is the verify report's own commit (59a2d64). Ledger: all attempts settled passed. Working tree clean before archive | orchestrator final-state handoff, corroborated by clean `git status` at archive time |
| Commit range | bd7e2de (proposal) … 59a2d64 (verify report): 11 commits — 4 planning docs (proposal, delta spec, design, tasks), **6 apply work-unit commits** (3c9b736, a8e803f, 17b2724, f72493a, 9ebaef8, 503fdf0), 1 verify report | git history |
| Delivery | Single stacked feature branch `feature/hito-2-popup-ui` on `feature/hito-1-spike-y-esqueleto`, nothing merged (rollback plan intact). `tasks.md` forecast said `Chain strategy: pending` with High 400-line budget risk — stale snapshot detail; actual delivery kept the 6 apply commits as reviewable work units on the stacked branch | git history + orchestrator handoff |

## Specs Synced (source of truth: `openspec/specs/`)

| Domain | Action | Requirements | Scenarios | Details |
|---|---|---|---|---|
| `popup-ui` | Created | 6 | 12 | Provider List Rendering (3), Current Cycle Data on Open (1), Key Addition with Validation (3), Masked Key Display (2), Revocation from the Popup (2), Fixture-Only Operation (1) — greenfield full spec copied verbatim |

### Destructive-Delta Assessment

`openspec/config.yaml` archive rule "Warn before merging destructive deltas": **not triggered — no destructive delta applies.** `popup-ui` did not exist under `openspec/specs/`; the delta contains no `MODIFIED`, `REMOVED`, or `RENAMED` sections. The sync was purely additive: one new `spec.md`; the four hito-1 specs (`key-storage`, `provider-framework`, `usage-badge`, `network-allowlist`) are byte-untouched.

## Task Completion Gate

**Passed.** `tasks.md` shows 15/15 implementation tasks checked, zero unchecked. No archive-time reconciliation was needed and none was performed. (The four `- [ ]` markers in `proposal.md` §Success Criteria are proposal-phase checkboxes, not tasks-artifact items — left untouched in the audit trail, same treatment as hito-1.)

## Verification Summary

Per `verify-report.md` (verdict `pass_with_warnings`, blockers 0, critical 0, warning 1, suggestion 3), verified on `feature/hito-2-popup-ui` on 2026-09-05: typecheck, build, and tests all exit 0; spec compliance 12/12 with every matrix row backed by a named passing test; AD-10…AD-15 all followed with evidence (snapshot at `qd:snapshot`, no messaging; pure view + happy-dom dev-only; BrowserApi/FakeBrowser unchanged; error entries payload-free; CSP-legal static popup shell; structural key invariants — no `readKey`, no console, masked-only reads); badge behavior byte-identical to hito-1 proven against the base diff; hermeticity verified structurally (no `network/`/`fixtures/` import in `src/popup/`) and at bundle level (0 `fetch`/XHR/transport hits in `dist/popup.js`).

The WARNING is report-format only (TDD evidence table absent; substance corroborated by git work-unit pairing). Suggestions at verification time: (1) slim provider-metadata export to shrink the popup bundle — it currently bundles four full provider classes for `displayName`/`credentialType`, dead URL constants included; (2) the controller's `submit`-event backstop for Enter-key double-processing is unexercised by tests; (3) manual unpacked-load E2E — **closed by the maintainer's post-verify confirmation** (Final State table above). Nothing changed after the verify report except its own commit, so these results are the final state of the change.

## Hito-3 Product Feedback (recorded, NOT implemented)

From the maintainer's manual session (2026-09-05), carried as product input for the live-calls milestone:

1. **Settings gear for key management** — replace the inline per-provider key forms with a gear button opening a dedicated key-management surface.
2. **Main click view = per-model consumption** — the popup's primary view should show per-model usage breakdown, not only per-provider totals.
3. **Live ZAI with 5-hour-window percentage** — live ZAI data with a consumption percentage over a 5-hour window against hardcoded tier limits, matching the maintainer's reference GLM Coding Plan plugin.
4. **Existing stored key** — the maintainer's real ZAI key now lives in `chrome.storage.local` (`qd:key:zai`), local-only by design and never transmitted in hito 2; hito 3 must account for this existing key when live calls begin.

Also carried forward: hito-1's four follow-ups (archive report `2026-09-05-hito-1-extension-skeleton`) and verify SUGGESTION 1 above, which gains weight if the popup surface grows.

## Mechanical Copy Audit

All copies and moves were shell-only (`Copy-Item`, `git mv`); no artifact content passed through model Read/Write. Independent byte-level recursive diffs (`git diff --no-index`, recursive over directories; LF/CRLF notices are working-copy warnings, not diff content):

- Spec sync (delta `specs/popup-ui/spec.md` vs `openspec/specs/popup-ui/spec.md`): **empty diff, exit 0** (copied via temp + readback before final placement).
- Archive move (pre-move recursive snapshot of the change folder vs archived tree, all 5 files): **empty diff, exit 0**; source directory confirmed gone after `git mv`; destination collision guard passed (destination did not pre-exist).
- `archive-report.md` is additive (authored after the readback; not part of the source snapshot) and is excluded from the comparison by convention.

## Archive Contents

- `proposal.md` ✅
- `specs/` ✅ (1 delta spec: `popup-ui`)
- `design.md` ✅
- `tasks.md` ✅ (15/15 complete)
- `verify-report.md` ✅ (PASS WITH WARNINGS: 0 critical / 1 warning / 3 suggestions)
- `archive-report.md` ✅ (this file, additive)

## SDD Cycle Complete

The change has been fully planned (proposal, delta spec, design AD-10…AD-15, tasks), implemented (6 apply work-unit commits, 3c9b736…503fdf0), verified (PASS WITH WARNINGS; evidence at 503fdf0, report at 59a2d64), maintainer-confirmed (manual E2E), and archived. `openspec/specs/popup-ui/spec.md` is now the source of truth for the popup capability. Ready for the next change: hito 3 (live calls), which carries the product feedback above.
