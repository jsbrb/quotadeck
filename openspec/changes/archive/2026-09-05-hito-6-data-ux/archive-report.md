# Archive Report — hito-6-data-ux

**Change**: hito-6-data-ux — Data-First Popup: Hero Percentage, Manual Refresh, Keyless Filtering
**Archive location**: `openspec/changes/archive/2026-09-05-hito-6-data-ux/` (dated per maintainer acceptance day per orchestrator instruction, consistent with the hito-1..5 archives)
**Archive date**: 2026-09-06
**Branch**: `feature/hito-6-data-ux` @ `e8fad0e` (clean tree at archive start)

## Final State (authoritative at close)

- **Tasks**: 20/20 complete (`tasks.md` — every implementation task checked; no stale checkboxes, no archive-time reconciliation performed or needed). The unchecked boxes in `proposal.md` §Success Criteria are proposal checkboxes, not tasks; every criterion is evidenced as met in `verify-report.md`.
- **Verification**: PASS — 0 blockers, 0 CRITICAL, 0 WARNING; 2 SUGGESTIONS (`verify-report.md`, yaml verdict `pass`)
  - 325/325 tests (25 files, vitest), typecheck exit 0, build exit 0 with both entries emitted
  - 14/14 delta scenarios (11 popup-ui + 3 usage-badge) compliant, each backed by a passing test at runtime
- **Runtime gates at HEAD `e8fad0e`**: green — tests, typecheck, and build re-run green after the post-verify CSS amendment (below), per the orchestrator final-state handoff, which outranks the verify-time snapshot
- **Zero-reset ledger**: apply settled as 2 slices with ZERO ledger resets this change — slice 1 (port widening + worker branch, 338 lines) and slice 2 (popup view/controller/styles, 512 lines) both settled passed; verify settled passed
- **Cycle commits**: proposal `08fc6b6` → delta specs `38bd5fd` → tasks `0b02748` → apply/style work units `bb052be`, `f3ff2a0`, `77f976f`, `e2bd39d`, `56195a4`, `be503ee` (plus task-tick docs `546d12e`) → verify report `e8fad0e`

## Maintainer E2E — CONFIRMED 2026-09-05

The maintainer loaded the built extension and confirmed acceptance ("Todo bien"):

- **Dual hero percentage**: the 5h figure renders as the big bold hero above card content AND the same number inside the threshold bar
- **Manual refresh**: instant (~1s) data update via the header refresh affordance
- **Keyless filtering**: providers without a stored credential are hidden from the main view

### Visual iteration after E2E (post-verify amendment)

Per maintainer visual feedback the hero and bars were slimmed — CSS-only, commit `be503ee`: hero 24px/600 (from 28px/800), primary bar 10px (from 14px), in-bar percentage 9px/600. Presentation-only: no markup, logic, spec, or test changes, and the gates re-run green after it. Recorded here because `verify-report.md` predates `be503ee` (verification ran at HEAD `56195a4`); the verify report's static-evidence row citing 28px/800/14px describes the pre-slimming state.

## Verification Suggestions — Standing Notes

- **S1 (standing note, not a defect of this change)**: TDD cycle evidence lives as RED/GREEN rows in `tasks.md`; this workspace (openspec store) produces no separate apply-progress artifact. Verify cross-checked every cited RED/GREEN claim against real, currently-passing tests — all proved real. (Same standing note as the hito-5 archive.)
- **S2 (informational)**: actual changed footprint 810 lines (746+/64− across 10 files; 534 of them test lines) vs the 380–470 estimate; the 2-unit chain plan covered it, but future task forecasts should account for test-file growth.

## Artifact Set

| Artifact | Status |
|---|---|
| `proposal.md` | ✅ archived verbatim |
| `specs/popup-ui/spec.md` (delta) | ✅ archived verbatim |
| `specs/usage-badge/spec.md` (delta) | ✅ archived verbatim |
| `tasks.md` | ✅ archived verbatim — 20/20 checked |
| `verify-report.md` | ✅ archived verbatim |
| `design.md` | Intentionally absent for this change — recorded by verify-report (Coherence dimension): structural architecture-decision checks (AD-10, AD-15, AD-22, AD-24) were verified instead |

## Spec Sync (source of truth updated)

`openspec/specs/popup-ui/spec.md` — 10 → 11 requirements:

| Action | Requirement | Detail |
|---|---|---|
| MODIFIED | Provider List Rendering | Full replacement: one card per provider with a stored credential; keyless providers render no card (settings still lists all four); balance leads monetary cards with no synthesized percentages; dual hero — the primary percentage (ZAI 5h) renders as the card's largest, boldest element above all card content AND as the same number inside/over its threshold bar; secondary info in normal weight below; fill capped at 100 with uncapped text in both placements; determinism over cycle data + key states. Now 8 scenarios (added: Keyless provider renders no card). |
| ADDED | Manual Refresh Control | Header refresh affordance; activation registers a storage-change listener for the snapshot key and then creates the one-shot `refresh-now` alarm with immediate `when` via the injected alarms port; on storage change the popup re-reads the snapshot and re-renders; no other data path; 3 scenarios. |

`openspec/specs/usage-badge/spec.md` — 4 → 5 requirements:

| Action | Requirement | Detail |
|---|---|---|
| ADDED | One-Shot Refresh Alarm | `refresh-now` runs the same refresh tick as `usage-refresh` (live queries via the allowlist client with clock-derived parameters, plus the snapshot write); periodic registration and 1-minute period unchanged; unknown alarm names ignored; 3 scenarios. |

All other requirements preserved untouched (popup-ui: Current Cycle Data on Open; Key Addition with Validation; Masked Key Display; Revocation from the Popup; Settings Gear Surface; Per-Model Consumption View; ZAI Platform Selector; Settings Guidance; Branding Footer. usage-badge: One-Minute Alarm Schedule; Badge Rendering; Error State; Error Taxonomy Mapping).

Merge mechanics: every merged block was verified byte-identical to its delta source block by scripted line-level comparison; the delta-scoped "(Previously: …)" annotation line was dropped as change metadata, not spec content (same convention as the hito-5 archive); edited specs remain LF-only.

## Move Evidence (Mechanical Copy Contract)

- Pre-move recursive snapshot taken (5 files) before the move; destination-collision guard confirmed `2026-09-05-hito-6-data-ux` did not pre-exist
- `git mv openspec/changes/hito-6-data-ux openspec/changes/archive/2026-09-05-hito-6-data-ux` — exit 0; source absent after the move
- SHA256 manifest readback (pre-move snapshot vs destination): **5/5 files — all relative paths and all hashes identical**
- Recursive diff readback (`git diff --no-index <HEAD-extracted pre-move tree> <destination>`; git's `--no-index` diff is recursive by default, git has no `-r` switch): **empty output, exit 0**
- Blob-OID proof: staged archive blob OIDs identical to HEAD source blob OIDs for all 5 files
- This archive-report is additive and excluded from the comparisons per contract
- The active changes directory no longer contains `hito-6-data-ux`

## Next Steps

- **Qwen remediation** (carried from proposal Out-of-Scope): still pending the maintainer's Network diagnostic; separate change when unblocked
- **Publish the repository to a GitHub remote** (still local-only; feature branches have no remote)
- **Restart opencode** to activate the repaired `zaiprofile` agent config
- Merge decisions for the feature-branch chain: `feature/hito-6-data-ux` and earlier hito branches → integration strategy

## SDD Cycle Complete

The change has been fully proposed, specified, implemented, verified, and archived. The `popup-ui` and `usage-badge` main specs now reflect the shipped behavior.
