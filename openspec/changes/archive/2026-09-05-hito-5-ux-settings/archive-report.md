# Archive Report — hito-5-ux-settings

**Change**: hito-5-ux-settings — Popup UX Redesign and Settings Guidance
**Archive location**: `openspec/changes/archive/2026-09-05-hito-5-ux-settings/` (dated per maintainer acceptance day per orchestrator instruction, consistent with the hito-1..4 archives)
**Archive date**: 2026-09-06
**Branch**: `feature/hito-5-ux-settings` @ `5011d7c` (clean tree at archive start)

## Final State (authoritative at close)

- **Tasks**: 18/18 complete (`tasks.md` — every implementation task checked; no stale checkboxes, no archive-time reconciliation performed or needed)
- **Verification**: PASS WITH WARNINGS — 0 blockers, 0 CRITICAL findings (`verify-report.md`, yaml verdict `pass`)
  - Suite 297/297 (24 files, vitest); typecheck exit 0; build exit 0 with both entries emitted
  - 11/11 delta scenarios compliant, each backed by a test that passed in the verification run
- **Markup-only contract proven byte-exact**: the authored diff vs base `db525c0` touches only `view.ts`, `view.test.ts`, `popup.html`, `README.md`, and the SDD ledger; `extension/src/popup/controller.test.ts` and `extension/package.json` are byte-untouched against the base
- **Cycle commits**: proposal `2f83e71` → delta spec `dda3333` → tasks `db525c0` → apply work units `f547af0`, `1c1bb21`, `ca40b8e`, `d63332d`, `22a7878` → verify report `5011d7c`

## Maintainer Visual E2E — CONFIRMED 2026-09-05

The maintainer loaded the built extension and accepted the result ("Se ve bien"):

- Popup redesign: provider cards, threshold-colored progress bars, prominent 5h countdown, consistent per-provider error cards
- Per-provider settings guidance (Qwen AK/SK fields + RAM `bss:DescribeAcccount` + DashScope `sk-` rejection note, OpenAI admin key with read scope, Kimi CN/international key separation, ZAI coding-plan key with platform-bound selector)
- Branding footer "Built by The North Code" → https://www.thenorthcode.es/ (README attribution included)

This closes the proposal's "Tests cannot prove visual quality" risk: the human-owned visual gate passed after verification.

## Verification Warnings — Resolution at Close

- **W1 (RESOLVED)**: the authored diff vs base is 603 lines (515 insertions + 88 deletions), above the 400-line review budget. Resolved before archive by the maintainer's prior single-slice ratification — the change ships as one reviewed slice; the ledger records apply at 603 lines within the ratified cap and no budget reset was needed. Delivery-shape concern only; no spec or test impact.
- **W2 (standing note, not a defect of this change)**: TDD cycle evidence lives as RED/GREEN rows in `tasks.md`; this workspace (openspec store) produces no separate apply-progress artifact. Verify cross-checked every cited RED/GREEN claim against real, currently-passing tests — all proved real.
- **S1 (informational)**: tasks.md row 1.3 reads "54/60 → 90% amber" — stale ledger wording only. The ratified bands pin ≥90 = red, and the implemented test and code correctly follow the spec (54/60 lands on the red band). The ledger is kept verbatim in this archive as history.
- **S2 (informational)**: recorded in `verify-report.md` alongside W2 — no separate apply-progress artifact exists in the openspec store.

## Artifact Set

| Artifact | Status |
|---|---|
| `proposal.md` | ✅ archived verbatim |
| `specs/popup-ui/spec.md` (delta) | ✅ archived verbatim |
| `tasks.md` | ✅ archived verbatim — 18/18 checked |
| `verify-report.md` | ✅ archived verbatim |
| `design.md` | Intentionally absent for this change — recorded by verify-report (Coherence dimension): proposal §Approach commitments were verified instead |

## Spec Sync (source of truth updated)

`openspec/specs/popup-ui/spec.md` — 8 → 10 requirements:

| Action | Requirement | Detail |
|---|---|---|
| MODIFIED | Provider List Rendering | Full replacement: one card per provider; threshold-colored bars in contiguous bands (green <70%, amber ≥70%, red ≥90%, every percentage mapped to exactly one band); visual fill capped at 100 with uncapped percentage text; MCP fill derived from used/ceiling, presentation only; distinct prominent 5h countdown; consistent per-provider error cards; byte-identical determinism. Now 7 scenarios (added: Threshold bands; Fill capped, text uncapped; MCP bar from used/ceiling). |
| ADDED | Settings Guidance | Static per-provider English guidance rendered before inputs, whether or not a key is stored, distinct from validation errors; normative copy table for Qwen, OpenAI, Kimi, ZAI; 3 scenarios. |
| ADDED | Branding Footer | "Built by The North Code" linking https://www.thenorthcode.es/ on both main and settings views, deterministic; 1 scenario. |

All other popup-ui requirements preserved untouched: Current Cycle Data on Open; Key Addition with Validation; Masked Key Display; Revocation from the Popup; Settings Gear Surface; Per-Model Consumption View; ZAI Platform Selector.

Merge mechanics: requirement blocks were spliced from the delta file byte-exactly by a self-verifying script (assertions: 10 requirement headings, 7+4 scenario counts, byte-identical block placement, preserved tail, LF-only, no CR). The delta-scoped "(Previously: …)" annotation line was dropped as change metadata, not spec content.

## Move Evidence (Mechanical Copy Contract)

- Pre-move recursive snapshot taken (4 files) before the move
- `git mv openspec/changes/hito-5-ux-settings openspec/changes/archive/2026-09-05-hito-5-ux-settings` — exit 0; source absent after the move
- `diff -r` readback (`git -c core.autocrlf=false diff --no-index <snapshot> <destination>`): **empty output, exit 0** — the archived tree is byte-identical to the pre-move snapshot. This archive-report is additive and excluded from the comparison per contract.
- The active changes directory no longer contains `hito-5-ux-settings`

## Next Steps (hito-6 candidates)

- Publish the repository to a GitHub remote (currently local-only; feature branches have no remote)
- Merge decisions for the feature-branch chain: `feature/hito-5-ux-settings` and earlier hito branches → develop → main integration strategy
- Eventual Android milestone, if the product roadmap extends beyond the Chrome extension
- Dark mode only if ever wanted (explicitly out of scope for this change; light theme shipped)

## SDD Cycle Complete

The change has been fully proposed, specified, implemented, verified, and archived. The `popup-ui` main spec now reflects the shipped behavior.
