```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:fb55cc4a65fc3d9cc5c42c1a24a99c35c26de6117e24c17e90e0c11bfecc75df
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 6/6
scenarios: 12/12
test_command: npm --prefix extension run test
test_exit_code: 0
test_output_hash: sha256:008a9b092863fcc664bfd1f9bb3cce4b8bc9744861f4d27b40940e72075cfb95
build_command: npm --prefix extension run build
build_exit_code: 0
build_output_hash: sha256:06bf7720468c168ec7ef762cdc738452b920d05368fe3f1ca49ffe8e79269efd
```

# Verification Report

**Change**: hito-2-popup-ui
**Version**: N/A (greenfield delta spec `popup-ui`)
**Mode**: Strict TDD (config `strict_tdd: true`)
**Date**: 2026-09-05 · **Branch**: `feature/hito-2-popup-ui` · **HEAD**: 503fdf0 (clean tree)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 15 |
| Tasks complete | 15 |
| Tasks incomplete | 0 |

Changed footprint vs base `feature/hito-1-spike-y-esqueleto`: 17 files, +1,144/−25 — matches design §File Changes exactly; `platform/browser-api.ts`, `testing/fake-browser.ts`, `storage/key-store.ts`, `core/credentials.ts`, `vitest.config.ts` absent from the diff (design "explicitly unchanged" honored).

### Build & Tests Execution

**Typecheck**: ✅ Passed — `npm --prefix extension run typecheck` (tsc --noEmit, strict) → exit 0.
**Build**: ✅ Passed — `npm --prefix extension run build` → exit 0; dist emits `background.js` (31,941 B), `popup.js` (21,831 B), `manifest.json` (339 B, `action.default_popup: "popup.html"`, permissions still `storage`+`alarms` only), `popup.html` (1,320 B).

```text
dist\background.js  31.2kb   dist\popup.js  21.3kb
built dist/background.js + dist/popup.js + dist/manifest.json + dist/popup.html
```

**Tests**: ✅ 112 passed / 0 failed / 0 skipped — `npm --prefix extension run test` → exit 0.

```text
Test Files  16 passed (16)
     Tests  112 passed (112)
```

74 hito-1 tests + 38 new (snapshot-store 13, view 12, controller 10, background +3).
**Coverage**: ➖ Not available (no coverage tool; config `coverage: null`, threshold 0).
**Hermeticity**: popup production files (`view.ts`, `controller.ts`, `main.ts`) import only core/providers/storage/platform types — no `network/`, no `fixtures/`, no happy-dom (import audit + `controller.test.ts` structural guard-scan test with non-empty `sources` check). Bundle sweep on `dist/popup.js`: 0 hits for `happy-dom`, `FIXTURE_`, `AllowlistNetworkClient`, `FixtureTransport`, `fetch(`, `XMLHttpRequest`, `console.log`. The 3 host-string hits (`bigmodel.cn`, `aliyuncs`, `moonshot`) are dead URL constants from the pure provider classes pulled in via `createDefaultRegistry()` — anticipated by design ("provider modules are pure… adds no I/O"); zero network call sites exist in the bundle.

### Spec Compliance Matrix

| # | Requirement | Scenario | Implementation | Covering test (passed) | Result |
|---|-------------|----------|----------------|------------------------|--------|
| 1 | Provider List Rendering | Usage and tier rendered | `popup/view.ts` (`renderPopup`, `formatUsageText`) | `view.test.ts > renders every provider with usage value and currency; tier only…` (+ controller open test asserts same over DOM) | ✅ COMPLIANT |
| 2 | Provider List Rendering | Per-provider error state | `popup/view.ts` (`refresh-error`) | `view.test.ts > shows a per-provider error indication…` (qwen only; kimi clean) | ✅ COMPLIANT |
| 3 | Provider List Rendering | Deterministic rendering | `popup/view.ts` (pure functions) | `view.test.ts > is deterministic…` (`strictEqual` on two renders) | ✅ COMPLIANT |
| 4 | Current Cycle Data on Open | Open reflects last cycle | `storage/snapshot-store.ts` + `background.ts` (`refreshTick` write) + `popup/controller.ts` (read-on-open) | `controller.test.ts > open renders the last completed cycle…` + `background.test.ts > tick writes exactly one snapshot…` (cycle: zai 39+tier, qwen 100.28, openai 20, kimi 88.88) | ✅ COMPLIANT |
| 5 | Key Addition with Validation | Valid key persisted via wrapper | `popup/controller.ts` (`validateCredential` → `KeyStore.saveKey`) | `controller.test.ts > a valid openai key persists through the wrapper…` (asserts `qd:key:openai` in storage) | ✅ COMPLIANT |
| 6 | Key Addition with Validation | Empty input rejected | `core/credentials.ts` via controller | `controller.test.ts > an empty input is rejected…` (guidance shown, key absent) | ✅ COMPLIANT |
| 7 | Key Addition with Validation | Qwen sk- key rejected with hint | `core/credentials.ts` (`QWEN_AK_SK_GUIDANCE`) | `controller.test.ts > a Qwen DashScope sk- key is rejected…` (`bss:DescribeAcccount` verbatim, nothing persists) | ✅ COMPLIANT |
| 8 | Masked Key Display | Stored key rendered masked | `KeyStore.readMaskedKey` (suffix ≤4) + `view.ts` | `controller.test.ts > a stored key renders masked…` (spec's exact key `sk-test-1234567890abcdef` → `••••cdef`) | ✅ COMPLIANT |
| 9 | Masked Key Display | Full key absent from rendered output | `popup/controller.ts` (input-only key; cleared on valid submit) | `controller.test.ts` L116/L144/L176 — `documentElement.textContent` sweeps on all three submit/reveal paths | ✅ COMPLIANT |
| 10 | Revocation from the Popup | Post-revoke absence | `popup/controller.ts` (`revokeKey` → re-render) | `controller.test.ts > revoking kimi removes its stored key…` | ✅ COMPLIANT |
| 11 | Revocation from the Popup | Revoke isolation | per-key `qd:key:{id}` storage | `controller.test.ts > revoking zai leaves kimi stored and displayed…` (storage + DOM both asserted) | ✅ COMPLIANT |
| 12 | Fixture-Only Operation | No live network from popup | no network/fixture import in `src/popup/` (by construction) | `controller.test.ts > popup sources import no network or fixture module…` + verifier bundle sweep (0 fetch/XHR/transport in `popup.js`) | ✅ COMPLIANT |

**Compliance summary**: 12/12 scenarios compliant (6/6 requirements).

### Correctness (Static Evidence)

All 6 requirements have implementation code (matrix above). Fixture arithmetic re-verified: popup full-precision forms (`¥39.00`/`$20.00`/`¥88.88`) derive from the same normalized values the badge renders compactly (`¥39`/`$20`/`¥89`); Qwen error entry renders no usage; absent snapshot ⇒ per-provider "No cycle data yet".

### Coherence (Design AD-10…AD-15, hito-1 AD-1…AD-9 preserved)

| Decision | Followed? | Evidence |
|----------|-----------|----------|
| AD-10 snapshot at `qd:snapshot`, no messaging | ✅ | `SNAPSHOT_STORAGE_KEY = 'qd:snapshot'`; worker writes once post-`refreshAll`; popup reads directly on open; no `runtime.sendMessage` anywhere |
| AD-11 pure view + injected-document controller, happy-dom dev-only | ✅ | `view.ts` pure (node-env `strictEqual` tests); `// @vitest-environment happy-dom` pragma only in `controller.test.ts` L1; `main.ts` boot guard mirrors `background.ts`; `vitest.config.ts` byte-unchanged; `happy-dom` in devDependencies only |
| AD-12 BrowserApi/FakeBrowser unchanged; wrapper not port extension | ✅ | both files absent from base..HEAD diff; `SnapshotStore` injects the existing `StorageArea` port beside `key-store.ts` |
| AD-13 post-cycle write; error entries carry no payload | ✅ | `refreshTick` accumulates then single `write`; `{ status: 'error' }` — thrown value dropped (`background.ts` L108-111); tests assert bare entry (`Object.keys` = `['status']`) |
| AD-14 second esbuild entry + static CSP-legal popup.html | ✅ | second `build()` with identical flags → flat `dist/popup.js`; `popup.html`: `#app` + external `<script src="popup.js">` + inline `<style>` only — no inline script/handler attributes; manifest gains only `default_popup` |
| AD-15 structural key invariants | ✅ | zero `.readKey(`/`console.*` in `controller.ts`; input `type="password" autocomplete="off"`; masking solely via `MASK_SUFFIX_LENGTH=4` wrapper; `CycleSnapshot` has no credential field (compile-level proof in `snapshot-store.test.ts`); full-key DOM-sweep tests |
| Badge byte-identical (AD-13 side-clause) | ✅ | `background.test.ts` diff vs base is additions-only (+78/−0); pre-existing badge assertions (`['¥39','¥100','$20','¥89']`, `['ERR','¥89']`, repeated-tick) unchanged and green; `refreshTick` diff adds only results accumulation |
| AD-1/3/6/7/8/9 (hito-1, spot) | ✅ | `chrome` global only via adapter + boot guards; `escapeHtml` on all dynamic strings (tier, guidance, masked keys); registry single-sourced for popup metadata; permissions still `storage`+`alarms`; fixtures still worker-bundle-only; zero runtime deps added |

### Proposal Conformance

In scope — all delivered: popup via `action.default_popup` + second entry; provider list with usage/currency, tier-when-present, per-provider error; key add (validated via `core/credentials.ts`) / masked ≤4-char suffix / per-provider revoke; popup opens with current-cycle data (`qd:snapshot`); Qwen `sk-` → Alibaba AK/SK (RAM `bss:DescribeAcccount`) hint rendered verbatim from `validateCredential`. Out of scope respected: no live calls (FixtureTransport only in worker; popup has no network path), no new runtime deps (`happy-dom` dev-only, 0 hits in bundle), no options page/i18n/theming/Firefox. Rollback plan intact (additive `qd:snapshot`; `qd:key:{id}` untouched).

### TDD Compliance (Strict)

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ⚠️ | No standalone apply-progress artifact with canonical "TDD Cycle Evidence" table; store-native apply artifact `tasks.md` embeds per-unit RED→GREEN pairs — see WARNING 1 |
| All tasks have tests | ✅ | 4/4 RED tasks → `snapshot-store.test.ts` (new), `background.test.ts` (+78), `view.test.ts`, `controller.test.ts` |
| RED confirmed (tests exist) | ✅ | 4/4 test files verified on disk |
| GREEN confirmed (tests pass) | ✅ | 4/4 pass at runtime (112/112 suite) |
| Triangulation adequate | ✅ | snapshot malformed shapes: 8-case `it.each`; submit paths: valid/empty/qwen-`sk-`; revoke: absence + isolation (matches the 2 spec scenarios) |
| Safety Net for modified files | ✅ | `background.test.ts` extended in place; task 4.5 gate re-ran the original 74 green before the full 112 |

**TDD Compliance**: 5/6 checks passed, 1 format-level warning. Commit corroboration: every implementation commit (3c9b736, a8e803f, 17b2724, f72493a) lands its test file in the same work unit; no impl-without-test commit exists.

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 38 new (total 112) | 4 new/extended (16 total) | vitest 5 (controller file under happy-dom DOM unit) |
| Integration | 0 | 0 | not installed (capabilities: `[unit]`) |
| E2E | 0 | 0 | manual per design ("no automation this milestone") |

### Changed File Coverage

Coverage analysis skipped — no coverage tool detected (config `coverage: null`).

### Assertion Quality

**Assertion quality**: ✅ All assertions verify real behavior — 0 CRITICAL, 0 WARNING across the 3 new test files. Positives worth noting: the fixture-only structural test guards its file-scan loop against an empty collection (`sources.length` asserted > 0); storage-location proofs go through `FakeStorageArea.snapshot()` (proves WHERE bytes live, not just values); the no-credential-field proof is compile-level (`never` assignment) plus a behavioral JSON sweep; async flows settle via `vi.waitFor` on observable output, not sleeps.

### Quality Metrics

**Linter**: ➖ Not available (none configured) · **Type Checker**: ✅ 0 errors (`tsc --noEmit`, exit 0)

### Issues Found

**CRITICAL**: None
**WARNING**:
1. Strict-TDD reporting format gap: no standalone apply-progress artifact carrying the canonical "TDD Cycle Evidence" table (RED/GREEN/TRIANGULATE/SAFETY NET columns). The store-native apply artifact (`tasks.md`) embeds per-unit RED→GREEN task pairs, all ticked, and git history corroborates tests-first substance (test+impl paired in every work unit; no impl-only commit). Substance verified positive; deviation is in report format only — recorded so the pipeline owner can decide whether apply should emit the table going forward.

**SUGGESTION**:
1. `popup.js` (21,831 B) bundles the four full provider classes — dead URL-builder constants included — solely to reach `displayName`/`credentialType` through `createDefaultRegistry()` (AD-6 single source). A slim provider-metadata export would shrink the popup bundle at the live milestone.
2. The controller's `submit`-event backstop for Enter-key submission (controller.ts L118-127, `defaultPrevented`-guarded) is unexercised by tests — happy-dom does not fire form `submit` on button click (documented in source). A manually dispatched `submit` event would cover the double-processing guard.
3. Manual unpacked-load E2E (proposal success criterion 4; tasks.md Unit 2 harness note) remains maintainer-side external evidence, same treatment as hito-1's task 6.3 — no automation exists this milestone by design.

### Verdict

**PASS WITH WARNINGS**
12/12 scenarios compliant under passing runtime evidence (typecheck/build/test all exit 0); 15/15 tasks complete; AD-10…AD-15 conformance and badge byte-identity proven against the base diff; hermeticity and security invariants verified structurally and at bundle level; 0 critical, 1 warning (TDD evidence report-format gap, substance corroborated), 3 suggestions.
