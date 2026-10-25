```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:792477f06ccaeec9476e5317e77634914eb95f3baf930331d20b55ae34210b1d
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 18/18
scenarios: 42/42
test_command: npm --prefix extension run test
test_exit_code: 0
test_output_hash: sha256:6a720463f961b2b693529655dd733b275701436f6d65484464472e405861afc8
build_command: npm --prefix extension run build
build_exit_code: 0
build_output_hash: sha256:99fd34b268e89497bff7f83d7542fdca236a3ede603d2eaeee4623c6ad2f5a75
```

# Verification Report

**Change**: hito-3-live-usage · **Mode**: Strict TDD (config `strict_tdd: true`) · **Version**: N/A (new capability `tier-budget` + 5 deltas)
**Date**: 2026-09-05 · **Branch**: `feature/hito-3-live-usage` · **HEAD**: 2f44df2 (clean tree)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 21 |
| Tasks complete | 20 |
| Tasks incomplete | 1 (3.8 — automated half re-proven green; maintainer live E2E pending, human-owned) |

Footprint vs base `feature/hito-2-popup-ui` (merge-base 683ccba): 56 files under `extension/`+`README.md`, +3,202/−644, zero file deletions; matches design §File Changes; design-declared-unchanged files (`qwen.ts`, `openai.ts`, `kimi.ts`, `platform/browser-api.ts`, `build.mjs`, `testing/fake-browser.ts`) absent from the diff. `package.json` description copy also updated (fixture-only → live usage).

### Build & Tests Execution

**Typecheck**: ✅ `npm --prefix extension run typecheck` (tsc --noEmit) → exit 0.
**Build**: ✅ `npm --prefix extension run build` → exit 0; emits `dist/background.js` (37.3 kb), `dist/popup.js` (17.9 kb / 18,313 B — shrank from hito-2's 21,831 B per AD-24), `dist/manifest.json`, `dist/popup.html`.
**Tests**: ✅ 232 passed / 0 failed / 0 skipped — 24 files → exit 0.
**Coverage**: ➖ Not available (config `coverage: null`, threshold 0).
**Hermeticity**: proven — the only global-fetch touchpoints in the suite are 4 `vi.stubGlobal('fetch', …)` sites in `background.test.ts` (default-transport paths); one test explicitly forbids network while an injected transport serves the full four-provider tick; every other suite injects `RecordingTransport`/`FixtureTransport`. Bundle sweep on `dist/popup.js`: 0 hits for any endpoint host (`bigmodel.cn`, `aliyuncs`, `openai.com`, `moonshot.cn`, `api.z.ai`), `FIXTURE_`, `AllowlistNetworkClient`, `FixtureTransport`, `fetch(`, `XMLHttpRequest`, provider classes.

### Spec Compliance Matrix (18 requirements / 42 scenarios; deltas verified against `openspec/specs/` source-of-truth text)

| # | Capability / Requirement | Scenario | Covering test (passed) | Result |
|---|--------------------------|----------|------------------------|--------|
| 1 | tier-budget · Trailing-Window Usage | Window sum | `tier-budget.test.ts > sums apiUsage for in-window records only…` | ✅ |
| 2 | 〃 | Epoch extraction from billingNo | `tier-budget.test.ts > extracts the 13 epoch-ms digits after the first customerId…` | ✅ |
| 3 | 〃 | Unextractable record excluded | `tier-budget.test.ts > excludes records whose billingNo lacks the customerId…` + `zai.test.ts > excludes the record from the budget while cost still reports` | ✅ |
| 4 | tier-budget · Tier Derivation | Latest record wins | `tier-budget.test.ts > derives the tier from the in-window record with maximum transaction_time` | ✅ |
| 5 | tier-budget · Configurable Tier Limits | Default limits | `tier-budget.test.ts > applies the default limits…` (Lite 2400/Pro 12000/Max 48000) | ✅ |
| 6 | 〃 | Overridden limit | `tier-budget.test.ts > uses an overridden limit over the default` + `limit-store.test.ts > returns a valid stored override` | ✅ |
| 7 | 〃 | Unknown tier | `tier-budget.test.ts > reports usage without a percentage…` | ✅ |
| 8 | tier-budget · Percentage Computation | Rounding | `tier-budget.test.ts > rounds used/limit × 100` (100/300 → 33) | ✅ |
| 9 | 〃 | Cap at 100 | `tier-budget.test.ts > caps the percentage at 100` (30000/12000 → 100) | ✅ |
| 10 | tier-budget · Reset Countdown | Countdown derived | `tier-budget.test.ts > derives resetAt from the latest in-window record timeWindow end` | ✅ |
| 11 | 〃 | Graceful absence | `tier-budget.test.ts > …countdown absent when the latest record has no timeWindow` | ✅ |
| 12 | tier-budget · Month-Straddle Fetching | Straddle | `tier-budget.test.ts > returns both billingMonths…` (+ year boundary) + `zai.test.ts > walks both months oldest-first…` + `background.test.ts > queues both billing months…` | ✅ |
| 13 | 〃 | No straddle | `tier-budget.test.ts > returns only the current month…` (incl. exact-boundary second) | ✅ |
| 14 | tier-budget · Timezone Discipline | Epoch ordering decides membership | `tier-budget.test.ts > decides window membership by epoch order where date strings disagree` + cstEpoch/cstParts tests | ✅ |
| 15 | provider-framework · Qwen AK/SK Pair Handling (ADDED) | Pair completeness validated | `credentials.test.ts > rejects empty/blank…` (it.each ×4, explicit guidance) | ✅ |
| 16 | 〃 | Secret confined to the signer | `client.test.ts > AccessKeySecret appears in NO surface: url, query, body, headers, cookies` + `rpc-signer.test.ts > secret never appears in any returned surface` | ✅ |
| 17 | provider-framework · ZAI Parsing (MODIFIED) | Fixture page parsed | `zai.test.ts > folds cost… evaluates the 5h budget` (apiUsage sum, epoch tier, informational cost) | ✅ |
| 18 | 〃 | Non-numeric or non-200 code rejected | `zai.test.ts > rejects a string "200" / non-200 numeric code` (ProviderApiError) | ✅ |
| 19 | 〃 | Pagination plan with jitter and dedupe | `zai.test.ts > requires all 3 pages…` + `sleeps exactly N−1 times… [500,2000]` (min & max rng) | ✅ |
| 20 | 〃 | Latest record selects the tier | `zai.test.ts` fold (tier `Lite` from newest in-window record) | ✅ |
| 21 | provider-framework · Hermetic Tests with Live Transport (MODIFIED/RENAMED) | Suites are hermetic | `background.test.ts > hermetic proof… global fetch forbidden` (232/232, injected transports) | ✅ |
| 22 | 〃 | Live request contract asserted | `background.test.ts > dispatches live-shaped requests whose time parameters derive from the clock` + `client.test.ts` Bearer placement on `bigmodel.cn` | ✅ |
| 23 | usage-badge · Error Taxonomy (ADDED) | Auth failure classified | `background.test.ts` it.each `auth` (ERR badge + snapshot class) + `view.test.ts`/`controller.test.ts` "Auth failed" label | ✅ |
| 24 | 〃 | Server and rate-limit classified | `background.test.ts` it.each `server`/`rate-limit` + `error-taxonomy.test.ts` table | ✅ |
| 25 | 〃 | Network failure and unmapped errors | `background.test.ts` it.each `network` (stubbed fetch TypeError)/`unknown` + taxonomy table (11 cases) | ✅ |
| 26 | usage-badge · One-Minute Alarm Schedule (MODIFIED) | Alarm registered | `background.test.ts` install/startup-when-absent/no-re-register (period 1) | ✅ |
| 27 | 〃 | Live refresh per tick | `background.test.ts > updates the badge on every tick…` + clock-derived route-keyed dispatch + `buildTickQuery` tests | ✅ |
| 28 | popup-ui · Settings Gear Surface (ADDED) | Gear replaces inline key forms | `view.test.ts > renders the settings gear… NO key forms or inputs` + `controller.test.ts > main view carries the gear… form/input null` | ✅ |
| 29 | 〃 | Key management inside the gear | `controller.test.ts > a valid openai key persists… masked…` | ✅ |
| 30 | 〃 | Isolation preserved in the gear | `controller.test.ts > revoking zai leaves kimi stored and displayed` | ✅ |
| 31 | popup-ui · Per-Model Consumption View (ADDED) | Per-model rows rendered | `view.test.ts > renders per-model rows… sorted by model then usageType` (others provider-level) | ✅ |
| 32 | 〃 | Deterministic per-model rendering | `view.test.ts > is deterministic… both views` (strictEqual) | ✅ |
| 33 | popup-ui · Current Cycle Data on Open (MODIFIED) | Open reflects last cycle | `controller.test.ts > opens on the main view…` (usage+budget+tier+error from seeded snapshot) | ✅ |
| 34 | key-storage · Qwen AK/SK Pair Persistence (ADDED) | Pair round-trip | `key-store.test.ts > round-trips a qwen AK/SK pair as one JSON object under qd:key:qwen` | ✅ |
| 35 | 〃 | Masked pair display | `key-store.test.ts > masks each pair part independently… ≤4 suffix` (full pair absent) | ✅ |
| 36 | 〃 | Pair revocation removes both parts | `key-store.test.ts > revoking removes both parts atomically; other providers stay readable` | ✅ |
| 37 | network-allowlist · Manifest Host Permissions (ADDED) | Manifest equals allowlist | `manifest.hosts.test.ts > deep-strict-equals the PROVIDER_ALLOWLIST union` (4 hosts) | ✅ |
| 38 | 〃 | Extra host fails the check | same deepStrictEqual + `pins the exact four shipped host patterns` (extra/missing ⇒ fail) | ✅ |
| 39 | network-allowlist · Credentials Only in Authorization Header (MODIFIED) | Key placement | `client.test.ts > admits an allowlisted host… only in the Authorization header` | ✅ |
| 40 | 〃 | RPC signature exception scoped to Qwen | `client.test.ts > signs the qwen BSS query… NO Authorization header` + scan admits AK-in-query only on BSS host | ✅ |
| 41 | 〃 | Signed-style credentials rejected off the Qwen host | `client.test.ts > rejects signed-style credentials off the Qwen host` (+ off-qwen ak-sk provider rejection, zero I/O) | ✅ |
| 42 | 〃 | Non-header key suppressed | `client.test.ts > rejects a credential smuggled as a query parameter / in the body` (zero I/O) | ✅ |

**REMOVED requirements genuinely gone**: usage-badge §No Live Calls in Milestone — `background.ts` defaults to `FetchTransport` (live); `FIXTURE_QUERY`/`FIXTURE_ROUTES` no longer exist; fixtures serve only via injected transports. popup-ui §Fixture-Only Operation — no code path promises fixture-driven data; the popup still has zero network surface (structural import test + bundle sweep), now by construction rather than by milestone constraint.

### Correctness (Static Evidence)

Fixture arithmetic re-verified: main-flow ZAI folds cost 39 (dedupe: page-2 repeat worth 20 counted once), budget `used 2400 / limit 2400 / 100%` with `resetAt` 17:00 +08:00; straddle folds 300+100 across `2026-07`+`2026-08` with tier `Max`; unextractable fixture (no `customerId`) yields budget-absent, cost 0.5 intact. Signer pinned vector `xmAUc1KiUFczd0HBbplKPgXLEDU=` matches design's RED example byte-for-byte; `StringToSign` canonicalization identical to design §AD-18.

### Coherence (Design AD-16…AD-24)

| Decision | Followed? | Evidence |
|----------|-----------|----------|
| AD-16 host_permissions = exact allowlist union, sync test | ✅ | manifest 4 hosts; `manifest.hosts.test.ts` derives expected set from `PROVIDER_ALLOWLIST`, deepStrictEqual (supersedes AD-7) |
| AD-17 AK/SK two fields, JSON pair, dual masking, atomic revoke | ✅ | view renders 2 password fields; `qd:key:qwen` one JSON object; legacy string → `undefined` (key-store + engine skip test) |
| AD-18 pure signer, injected ts/nonce, SubtleCrypto only | ✅ | `rpc-signer.ts`: `crypto.subtle` HMAC-SHA1, RFC-3986 encoder, sorted keys, `GET&%2F&`; secret confined; pinned + edge vectors |
| AD-19 live transport + per-type attach + qwen-scoped scan | ✅ | `FetchTransport` injectable, status-only errors; ak-sk qwen-only → signed query, `headers: {}`; scan kind-aware, AK query-only on BSS host; secret swept over ALL surfaces incl. structural no-cookie proof |
| AD-20 pure budget, injected clock, defaults + `qd:tier-limits`, UTC+8 | ✅ | `tier-budget.ts` zero I/O; `DEFAULT_TIER_LIMITS`; `limit-store.ts` invalid→defaults; fixed +08:00 `cstEpoch`/`cstParts`; epoch-only comparisons (no string dates anywhere) |
| AD-21 taxonomy signal→class, honest 429 pin | ✅ | `error-taxonomy.ts` exact design table; 429 = HTTP status only (documented extension point); badge ERR for every class |
| AD-22 popup main+settings views, extended snapshot | ✅ | `renderMain`/`renderSettings` + gear/back `data-action`; pure `formatResetCountdown` (omitted when absent); per-model sorted (model, usageType); per-class labels; snapshot validates `errorClass` + `budget` |
| AD-23 ZAI window semantics through opaque state | ✅ | months queue lives in `ProviderState` (test asserts `{month, monthsQueue, seen}`); engine never inspects state; final fold `evaluateBudget`; tier = latest in-window; cost informational; fixtures re-recorded (straddle ×2 + unextractable new) |
| AD-24 metadata module, keydown Enter, copy | ✅ | `PROVIDER_METADATA` → registry; popup imports metadata only — 0 endpoint URLs in `dist/popup.js`; boundary regex `../(network|fixtures|providers)`; keydown-Enter tested (submit backstop deleted); `copy.test.ts` + README/manifest/package copy verified |

### Proposal Conformance

In scope — all delivered: live fetch for all four providers behind the unchanged allowlist seam; ZAI trailing-5h SUM(apiUsage), billingNo epoch, tier from latest, configurable limits (2400/12000/48000), countdown from `timeWindow` end with graceful absence; Qwen AK/SK pair + HMAC (secret never transmitted), `sk-` rejected; gear replaces inline forms; per-model view; 401/403/5xx/429 taxonomy → error state + ERR; `host_permissions` exact 4-host union. Out of scope respected: no `api.z.ai` (allowlist test rejects it), no Coding-Plan quota (`qwen.ts` untouched, balance-only), no cert pinning/telemetry/i18n/store publishing (absent from diff).

### TDD Compliance (Strict)

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ⚠️ | No standalone apply-progress "TDD Cycle Evidence" table; `tasks.md` embeds per-unit RED→GREEN pairs — WARNING 2 |
| All tasks have tests | ✅ | every implementation task names its test file; all exist on disk |
| RED confirmed (tests exist) | ✅ | 19 new/extended test files verified |
| GREEN confirmed (tests pass) | ✅ | 232/232 at runtime, exit 0 |
| Triangulation adequate | ✅ | it.each tables (taxonomy 11, malformed snapshots 13, limits 8, pair validation 6); min/max rng; straddle incl. year boundary |
| Safety Net for modified files | ✅ | pre-existing suites extended in place (background, engine, key-store, snapshot-store); full 232 green |

### Test Layer Distribution

Unit: 232 tests / 24 files (vitest 5; `controller.test.ts` under happy-dom DOM unit). Integration: 0 (not installed). E2E: 0 automated — maintainer live check per design ("Manual unpacked load; hermetic suite stays network-free").

### Changed File Coverage

Coverage analysis skipped — no coverage tool detected (config `coverage: null`).

### Assertion Quality

**Assertion quality**: ✅ All assertions verify real behavior — 0 CRITICAL, 0 WARNING across all 19 changed test files. Notables: zero `vi.mock` anywhere (constructor injection + fakes instead); secret sweep asserts every surface explicitly with non-empty query param set plus whole-request JSON net; import-boundary test guards its scan against an empty file list; determinism via `strictEqual` on repeated renders; storage-location proofs via `FakeStorageArea.snapshot()`.

### Quality Metrics

**Linter**: ➖ Not available · **Type Checker**: ✅ 0 errors (exit 0)

### Issues Found

**CRITICAL**: None
**WARNING**:
1. Task 3.8 incomplete: the automated half (`npm --prefix extension run test` + `typecheck` + `build`) was independently re-executed by this verification — all exit 0 — but the maintainer live E2E (stored ZAI key → live 5h percentage in one tick; bad key → ERR + auth class; other creds → values; revoke → skipped; O3 `customerId` confirmation) is human-owned external evidence verification cannot substitute. Settlement/archive should wait for it or explicitly accept the residue.
2. Strict-TDD reporting format gap: no standalone apply-progress artifact with the canonical "TDD Cycle Evidence" table. Substance corroborated: `tasks.md` embeds RED→GREEN pairs per unit, all test files exist and pass, and commit history pairs tests with implementation in the same work units. Same format-level finding as hito-2.

**SUGGESTION**:
1. ZAI `data.customerId` is community-pinned (design Open Question O3); graceful degradation covers a live mismatch (budget absent, cost intact) — re-pin fixtures if the live E2E disagrees.
2. OpenAI trailing-24h window (`bucket_width=1d`) is a product default, not spec-pinned (design Open Question) — revisable without architectural change.
3. Record the maintainer live-E2E outcome (3.8) in the change folder before archive so the audit trail carries the external evidence, as hito-1 did.

### Verdict

**PASS WITH WARNINGS**
42/42 scenarios compliant across all 6 deltas under passing runtime evidence (typecheck/test/build exit 0; hermeticity and popup bundle purity proven); AD-16…AD-24 conformance verified incl. signer pinned vector, all-surfaces secret sweep, and manifest sync; 20/21 tasks complete — the pending 3.8 is the human-owned live E2E whose automatable half re-proved green; 0 critical, 2 warnings (pending live E2E; TDD evidence report-format gap), 3 suggestions.
