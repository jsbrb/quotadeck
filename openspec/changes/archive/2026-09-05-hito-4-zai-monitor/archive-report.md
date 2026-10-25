# Archive Report: hito-4-zai-monitor

**Change**: hito-4-zai-monitor — ZAI Monitor Endpoints
**Archive folder**: `openspec/changes/archive/2026-09-05-hito-4-zai-monitor/` (series date 2026-09-05, matching the hito-1..3 archives and the maintainer live-E2E confirmation date; archive operation performed 2026-09-06 per orchestrator instruction)
**Branch**: `feature/hito-4-zai-monitor`
**Commit range**: proposal `6c5f77b` → `b540e32` (HEAD at archive time), 21 commits: 3 SDD planning docs (`0b9f0ba` specs, `593ff4c` design, `0a749ce` tasks) + 13 implementation commits (7 × S1 foundation, 1 × S2 atomic monitor swap, 5 × S3 popup + removals) + verify-report `a75d531` + 3 post-verify remediation commits (`076d146`, `1e8e8cf`, `bc1b2df`) + live-E2E confirmation `b540e32`.
**Commit-count note (recorded, not silently resolved)**: the orchestrator's launch account characterized this as "15 apply work-unit commits across 3 slices + 3 remediation commits". Directly countable in git: 13 implementation commits; the "15" reading appears to additionally count the verify-report commit and the live-E2E confirmation commit inside the apply→close window. Both accounts are recorded here.

## Final State

- **Tasks**: 22/22 complete in the persisted `tasks.md` — including task 3.6 (maintainer live E2E), closed 2026-09-05 by maintainer confirmation. No unchecked tasks remain (Task Completion Gate passed before spec sync and archive move).
- **Mandatory requirement DELIVERED**: the popup renders REAL plan data from the official monitor endpoint `GET /api/monitor/usage/quota/limit` — observed live: `Level: pro`, `5h: 37% · Resets in 2h 53m` with the percentage live-updating between captures (32% → 37%), and `MCP: 0 / 1000` with per-tool rows (`search-prime`, `web-reader`, `zread`).
- **Final suite**: 279/279 tests green (vitest 5.0.0), `tsc --noEmit` clean, `esbuild` build green. (Verify-time figures were 274/274; the five additional tests come from the post-verify remediation below — final numbers carried per final-state authority.)
- **Cross-platform behavior**: the maintainer's account returns 200 on BOTH `api.z.ai` and `open.bigmodel.cn` with the same data — the key works cross-platform in practice; the platform selector (default Z.AI) verified working.

## Spec Sync (main specs updated at archive)

| Domain | Action | Details |
|--------|--------|---------|
| `zai-monitor` | Created (mechanical copy, SHA256-verified) | Full new-capability spec: 8 requirements / 15 scenarios, including the live-capture wire-shape pin in the Purpose note |
| `provider-framework` | Updated | ADDED Credential Attach Modes; RENAMED+MODIFIED ZAI Parsing (bigmodel.cn expenseBillList) → ZAI Parsing (monitor quota/limit); MODIFIED Provider Contract and Hermetic Tests with Live Transport Contract; Purpose refreshed |
| `network-allowlist` | Updated | MODIFIED Per-Provider Domain Allowlist (zai hosts → `api.z.ai`, `open.bigmodel.cn`; apex out) and Credentials Only in Authorization Header (raw-attach exception scoped to monitor hosts); REMOVED Unverified Variant Excluded; Purpose refreshed |
| `usage-badge` | Updated | MODIFIED Badge Rendering (ZAI 5h percentage uncapped, level fallback); Purpose refreshed |
| `popup-ui` | Updated | ADDED ZAI Platform Selector; MODIFIED Provider List Rendering (ZAI budget block); Purpose refreshed |
| `key-storage` | Updated | ADDED ZAI Platform Preference (`qd:pref:zai-platform`, non-secret, unmasked); Purpose refreshed |
| `tier-budget` | REMOVED entirely | All 7 requirements removed — destructive delta explicitly instructed and approved by the orchestrator. The full spec text is retained in this repository: `openspec/changes/archive/2026-09-05-hito-3-live-usage/specs/tier-budget/spec.md` (the change that created it) and in git history (deletion lands in this archive commit), as the reference for a future pay-as-you-go billing revival |

## The E2E Story

1. **"Algo falla"** — after the S2 build, the maintainer's first live reaction was that something was off: the popup did not show the expected plan data. The hermetic suite was green, so the defect lived at the seam between community-pinned evidence and the real wire.
2. **SW-console diagnosis playbook** — diagnosis proceeded through the extension service worker console: load unpacked, open the SW console, watch the 1-minute refresh tick, and inspect the actual network traffic and errors rather than the popup surface. This playbook is the reusable lesson: when hermetic tests are green and the extension is not, read the live wire first.
3. **Wrong-surface discovery chain** — the failure chain pointed back to hito-3's conclusion: `expenseBillList` was the wrong surface (live probes had returned `total: 0` during active GLM Coding Plan usage; recorded in the hito-3 archive). Hito-4 existed precisely to replace it.
4. **Monitor endpoint research** — triple-source community evidence (`zai-org/zai-coding-plugins` — the vendor org's own plugin, `ecerutti/glm-usage-monitor`, `guyinwonder168/opencode-glm-quota`) identified `GET /api/monitor/usage/quota/limit` with raw `Authorization: <key>` (Bearer fails) as the official monitor surface, yielding plan level, 5h/weekly token windows, and the monthly MCP window.
5. **S2 build** — the atomic five-way coupled swap landed as one commit (`6bc7cb2`): allowlist/manifest/spike triple lock, provider rewrite, 7 monitor fixtures in / 8 billing fixtures out, engine/background rewiring.
6. **Shape drift** — the live-captured payload revealed three shape defects vs the community evidence: the entries array is `data.limits` (not `tokenLimits`); a `TOKENS_LIMIT` entry may carry ONLY `percentage` + `nextResetTime` with no `total` (total is now optional in the model and validator); and `usageDetails` is an ARRAY of `{modelCode, usage}` entries (not an object map).
7. **Live capture pinned** — the verbatim live payload (maintainer plan `pro`, `api.z.ai`, 2026-09-05) was pinned as the golden fixture `extension/src/fixtures/zai/monitor--pro-plan.json` and as inline tests, and recorded in the `zai-monitor` spec Purpose note (commit `076d146`). This satisfies the verify-report's suggestion to "record the observed live payload shape next to the spike evidence" — via the remediation spec delta.
8. **Remediation (3 commits)** — `076d146` spec pin, `1e8e8cf` parser fix (`data.limits`, usageDetails array), `bc1b2df` validator/view (total-less windows accepted in snapshot validation and view).
9. **CONFIRMED** — 2026-09-05 maintainer live E2E: the popup renders real plan data with the 5h percentage live-updating between captures (32% → 37%), the reset countdown ticking down, and MCP per-tool rows. The mandatory requirement — plan detection + 5h percentage + countdown — is delivered against the official monitor endpoints.

## Verification Outcome and Warning Disposition

Per `verify-report.md` (at verification time, `7dc2fec`): **PASS WITH WARNINGS**, 0 CRITICAL, 18/18 requirements, 40/40 scenarios, typecheck/build/tests green, manifest pinned to exactly 5 hosts.

- **W1 (task 3.6 open — maintainer live E2E)**: CLOSED after verification by the maintainer confirmation of 2026-09-05 recorded above (commit `b540e32`); the persisted tasks artifact shows 22/22. The live-shape concern W1 raised was real and was resolved by the remediation: fixtures re-pinned from the live capture, exactly as W1's contingency prescribed.
- **W2 (strict-TDD evidence format — no standalone apply-progress artifact; per-unit RED→GREEN ledger embedded in `tasks.md`)**: STANDING. Substance was verified at verify time (RED files exist, all green at runtime); the format deviation from the module's expected artifact remains a known, accepted deviation for this cycle.
- **Suggestion 1 (configure `@vitest/coverage-v8`)**: not addressed in this change — carried to future changes.
- **Suggestion 2 (record observed live payload shape next to spike evidence)**: SATISFIED by the remediation spec delta — the live capture is pinned in the `zai-monitor` spec Purpose note (now synced into the main spec) and as the golden fixture.

## Ledger Accounting

5 work units settled **passed**: S1 foundation 666 · S2 atomic monitor swap 1736 · S3 popup + removals 1062 · verify 175 · post-verify remediation 472 (raw lines). Plus **4 maintainer resets**, every one honestly declared with actor Javier; all overages were test depth, mandated deletions, or fixture golden JSON — no silent scope growth.

## Next Steps (hito-5 candidates)

- **Popup UX redesign** — the monitor block works but the surface was built for correctness first; visual hierarchy, density, and the settings flow are open for a dedicated design pass.
- **Qwen settings info text** — guidance copy for the Qwen AK/SK credential entry (DashScope `sk-` rejection hint exists; richer contextual info text does not).
- Carried from this change's out-of-scope: 24h `model-usage`/`tool-usage` endpoints, `dev.bigmodel.cn` mirror, auth-failure backoff, coverage tooling (verify suggestion 1).

## Mechanical Audit

- zai-monitor main spec created via shell copy to temp → `git diff --no-index` readback (empty diff, exit 0) → atomic rename; source vs destination SHA256 identical (`CD0AF9BA8682BCBA69B21DCEF13170083C790F7BE8A6246A34ED3196D93EEE4C`).
- Change folder moved with `git mv` after a pre-move recursive snapshot; source confirmed absent; `git diff --no-index` recursive readback snapshot vs destination: empty diff, exit 0; independent SHA256 check: 11/11 files byte-identical.
- This `archive-report.md` is additive (did not exist in the source snapshot) and is excluded from the copy comparison by design.
- Readiness basis: 22/22 tasks in the persisted artifact, verify verdict PASS WITH WARNINGS (0 CRITICAL), orchestrator-instructed archive with explicit approval of the tier-budget destructive delta.
