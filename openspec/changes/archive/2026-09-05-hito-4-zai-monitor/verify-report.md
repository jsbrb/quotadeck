```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:764152b4db9d46bf8927500dab28c62d14fe409bf5eef42cfcf5b100a61eb50d
verdict: pass
blockers: 0
critical_findings: 0
requirements: 18/18
scenarios: 40/40
test_command: npm --prefix extension run test
test_exit_code: 0
test_output_hash: sha256:4f9ce8b752a6454f123903a0412fc6565062bf859e80126682767ad197bbff84
build_command: npm --prefix extension run build
build_exit_code: 0
build_output_hash: sha256:18b1ebfa684911e10e74cb7301729fe63ef5de0464507c31c4e9925d8709562a
```

## Verification Report

**Change**: hito-4-zai-monitor
**Version**: N/A (change-level verification against openspec/changes/hito-4-zai-monitor + main specs)
**Mode**: Strict TDD
**Branch/HEAD**: `feature/hito-4-zai-monitor` @ `7dc2fec` (clean tree)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 22 |
| Tasks complete | 21 |
| Tasks incomplete | 1 (3.6 — maintainer live E2E, human-owned; known-open) |

### Runtime Gates

**Typecheck**: ✅ `npm --prefix extension run typecheck` (tsc --noEmit) — exit 0.

**Build**: ✅ `npm --prefix extension run build` — exit 0; both entries produced (`dist/background.js` 34.0 kb, `dist/popup.js` 22.0 kb). `dist/manifest.json` `host_permissions` = exactly 5 hosts: `api.moonshot.cn`, `api.openai.com`, `api.z.ai`, `business.aliyuncs.com`, `open.bigmodel.cn`; apex `bigmodel.cn` ABSENT (AD-29; pinned by `manifest.hosts.test.ts` and the union sync test).

**Tests**: ✅ 274 passed / 0 failed / 0 skipped — 24 files, vitest 5.0.0, exit 0.

**Coverage**: ➖ Not available — no coverage tooling configured (`openspec/config.yaml`: `coverage: null`).

### Spec Compliance Matrix

zai-monitor (new capability — 8 requirements / 14 scenarios):

| Requirement | Scenario | Test evidence | Result |
|-------------|----------|---------------|--------|
| Single-Shot Monitor Query | One request per refresh | `providers/zai.test.ts` "issues exactly one GET…no query, no body"; `refresh/engine.test.ts` "exactly one dispatch and zero sleeps" | ✅ COMPLIANT |
| Level and Window Discrimination | Discriminated windows parsed | `zai.test.ts` "maps unit 3/number 5…unit 6/number 1" (Pro level, both windows strict-equal) | ✅ COMPLIANT |
| Level and Window Discrimination | Positional fallback | `zai.test.ts` "falls back to position when entries omit unit/number" | ✅ COMPLIANT |
| Level and Window Discrimination | MCP-only fixture | `zai.test.ts` "reports the MCP window alone…without error" | ✅ COMPLIANT |
| Percentage Passthrough and Used Derivation | Uncapped percentage with derived used | `zai.test.ts` 137 uncapped / used 16440 = round(12000×137/100) | ✅ COMPLIANT |
| Percentage Passthrough and Used Derivation | Null percentage is absent | `zai.test.ts` null pct → `{ total }` only (no pct, no used) | ✅ COMPLIANT |
| Reset Countdown | Countdown derived | `zai.test.ts` resetAt verbatim (epoch ms) + `popup/view.test.ts` `formatResetCountdown` from injected now | ✅ COMPLIANT |
| Reset Countdown | Graceful absence | `zai.test.ts` "keeps windows reporting when nextResetTime is absent" | ✅ COMPLIANT |
| Monthly MCP Window | MCP block parsed | `zai.test.ts` used 3 / ceiling 60 / both tools name-sorted, no pct/countdown (key-set assertion) | ✅ COMPLIANT |
| Platform Binding | Default platform | `zai.test.ts` default → api.z.ai; `background.test.ts` "defaults to api.z.ai when no platform preference is stored" | ✅ COMPLIANT |
| Platform Binding | Selection switches base URL | `zai.test.ts` zhipu → open.bigmodel.cn; `background.test.ts` stored zhipu pref routes the tick there | ✅ COMPLIANT |
| Platform Binding | Wrong-platform key guidance | `popup/view.test.ts` + `popup/controller.test.ts` zai+auth → static guidance (AD-13 class-only snapshot intact) | ✅ COMPLIANT |
| Raw Authorization | Raw header on both platforms | `network/client.test.ts` "attaches raw credentials on both monitor hosts" (verbatim, no Bearer, Accept-Language); `zai.test.ts` provider-path verbatim | ✅ COMPLIANT |
| Status-First Error Classification | Plain-text auth errors | `network/fetch-transport.test.ts` AD-30 pins (401/403 auth, json() never called); `background.test.ts` plain-text 401 → `auth` snapshot | ✅ COMPLIANT |

Deltas (ADDED + MODIFIED blocks; tier-budget REMOVED counts 0):

| Requirement (delta) | Scenario | Test evidence | Result |
|---------------------|----------|---------------|--------|
| provider-framework ADDED: Credential Attach Modes | ZAI declares raw attach | `provider-metadata.test.ts` type pins; `zai.test.ts` credentialType 'raw'; `client.test.ts` bearer/admin/raw attach forms | ✅ COMPLIANT |
| provider-framework MODIFIED: Provider Contract | Contract compliance of the four stubs | `registry/index/provider-metadata` suites; `UsageQuery` carries no months/tierLimits (pinned `background.test.ts` "no months, no tier limits") | ✅ COMPLIANT |
| provider-framework MODIFIED: ZAI Parsing (monitor quota/limit) | Monitor fixture parsed | `zai.test.ts` pro-plan fixture → level + 5h/weekly/MCP | ✅ COMPLIANT |
| provider-framework MODIFIED: ZAI Parsing (monitor quota/limit) | Superseded surface absent | Zero production references (grep); `client.test.ts` rejects the retired expenseBillList URL; no billing fixtures registered | ✅ COMPLIANT |
| provider-framework MODIFIED: Hermetic Tests with Live Transport Contract | Suites are hermetic | `background.test.ts` full 4-provider tick with global fetch forbidden | ✅ COMPLIANT |
| provider-framework MODIFIED: Hermetic Tests with Live Transport Contract | Live request contract asserted | `zai.test.ts` recorded request → platform-selected host, raw Authorization, no Bearer | ✅ COMPLIANT |
| network-allowlist MODIFIED: Per-Provider Domain Allowlist | Allowlisted host admitted | `client.test.ts` api.z.ai + open.bigmodel.cn admitted (suffix cases too) | ✅ COMPLIANT |
| network-allowlist MODIFIED: Per-Provider Domain Allowlist | Non-allowlisted host rejected | `client.test.ts` evil.example.com → `NetworkRejectionError`, zero I/O | ✅ COMPLIANT |
| network-allowlist MODIFIED: Per-Provider Domain Allowlist | Cross-provider host rejected | `client.test.ts` ZAI→api.moonshot.cn rejected | ✅ COMPLIANT |
| network-allowlist MODIFIED: Per-Provider Domain Allowlist | Removed apex host rejected | `client.test.ts` apex bigmodel.cn rejected; `allowlist.source.test.ts` apex-absent pin | ✅ COMPLIANT |
| network-allowlist MODIFIED: Credentials Only in Authorization Header | Key placement | `client.test.ts` bearer: Authorization-only, URL clean | ✅ COMPLIANT |
| network-allowlist MODIFIED: Credentials Only in Authorization Header | RPC signature exception scoped to Qwen | `client.test.ts` signed query, no Authorization header | ✅ COMPLIANT |
| network-allowlist MODIFIED: Credentials Only in Authorization Header | Signed-style credentials rejected off the Qwen host | `client.test.ts`/`request` scan rejection | ✅ COMPLIANT |
| network-allowlist MODIFIED: Credentials Only in Authorization Header | Non-header key suppressed | `client.test.ts` query- and body-smuggling rejections (incl. raw key) | ✅ COMPLIANT |
| network-allowlist MODIFIED: Credentials Only in Authorization Header | Raw attach scoped to monitor hosts | `client.test.ts` raw off-host → `credential-placement`, zero transport I/O | ✅ COMPLIANT |
| network-allowlist REMOVED: Unverified Variant Excluded | (superseded) | `allowlist.source.test.ts` api.z.ai admitted + pinned; old "unverified api.z.ai rejected" pin gone | ✅ REMOVED-VERIFIED |
| usage-badge MODIFIED: Badge Rendering | Deterministic text | `core/usage.test.ts` determinism; `background.test.ts` stable across repeated ticks | ✅ COMPLIANT |
| usage-badge MODIFIED: Badge Rendering | ZAI 5h percentage badge | `usage.test.ts` 137% uncapped; `background.test.ts` tick renders `137%` | ✅ COMPLIANT |
| usage-badge MODIFIED: Badge Rendering | Absent percentage falls back to level | `usage.test.ts` + `background.test.ts` null-pct → `Lite` | ✅ COMPLIANT |
| popup-ui ADDED: ZAI Platform Selector | Selector defaults and persists | `controller.test.ts` ZHIPU persists + reopens selected; `background.test.ts` pref → open.bigmodel.cn routing | ✅ COMPLIANT |
| popup-ui ADDED: ZAI Platform Selector | Wrong-platform guidance surfaced | `view.test.ts`/`controller.test.ts` zai+auth guidance; non-auth classes show none | ✅ COMPLIANT |
| popup-ui MODIFIED: Provider List Rendering | Usage and tier rendered | `view.test.ts` monetary + tier-only-where-present; ZAI section carries no monetary line | ✅ COMPLIANT |
| popup-ui MODIFIED: Provider List Rendering | Per-provider error state | `view.test.ts` per-class error labels | ✅ COMPLIANT |
| popup-ui MODIFIED: Provider List Rendering | Deterministic rendering | `view.test.ts` identical state → identical output, both views | ✅ COMPLIANT |
| popup-ui MODIFIED: Provider List Rendering | ZAI budget block rendered | `view.test.ts` "5h: 137% · 16440 / 12000 · Resets in 1h 30m", Weekly, MCP per-tool rows | ✅ COMPLIANT |
| key-storage ADDED: ZAI Platform Preference | Preference round-trip unmasked | `storage/zai-platform-store.test.ts` round-trip under `qd:pref:zai-platform` | ✅ COMPLIANT |
| key-storage ADDED: ZAI Platform Preference | Credential namespace unaffected | `zai-platform-store.test.ts` key re-read + mask unchanged; `controller.test.ts` switch never touches `qd:key:*` | ✅ COMPLIANT |
| tier-budget REMOVED (all 7 requirements) | (7 removals) | `core/tier-budget.ts`/`.test.ts` and `storage/limit-store.ts`/`.test.ts` deleted (glob-verified absent); zero production references (grep); `BudgetReport` gone from `usage.ts`/`snapshot-store.ts` | ✅ REMOVED-VERIFIED |

**Compliance summary**: 40/40 scenarios compliant (38 COMPLIANT + 2 REMOVED-VERIFIED removal proofs); 18/18 requirements covered.

### Correctness (Static Evidence)

| Item | Status | Notes |
|------|--------|-------|
| ZAI provider rewrite | ✅ Implemented | `providers/zai.ts`: single-shot GET, numeric-code-200 discipline, unit3/5 + unit6/1 discriminators, positional fallback, TIME_LIMIT→MCP, uncapped pct, derived used, resetAt verbatim, invalid platform throws pre-dispatch |
| Raw attach | ✅ Implemented | `network/client.ts`: `Authorization: <key>` verbatim + `Accept-Language: zh-CN`; scoped via `isHostAllowed('zai', host)` → `NetworkRejectionError('credential-placement')` before I/O |
| Allowlist/manifest/spike triple | ✅ Implemented | `allowlist.ts` = spike JSON block (deep-equal test); manifest = union (sync test); 5 hosts; apex absent |
| Platform module + store + selector | ✅ Implemented | `core/zai-platforms.ts`, `storage/zai-platform-store.ts` (`qd:pref:zai-platform`, validated, default 'zai'), selector in settings gear, controller change-delegation |
| Removals | ✅ Implemented | tier-budget, limit-store, BudgetReport/budget/isBudgetReport, billingMonths/tierLimits/interPageDelayMs, expenseBillList fixtures — all absent |
| README + copy pins | ✅ Implemented | monitor description, 4→5 host note, selector/guidance docs; `copy.test.ts` pins |

### Coherence (Design AD-25..AD-30)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| AD-25 raw attach via Credential type | ✅ Yes | `'raw'` in `CredentialType`/token arm; ZAI flips via `credentialType`; `ProviderRequest` stays header-less; scoping mirrors ak-sk qwen-only pattern; scan unchanged (raw joins token arm) |
| AD-26 MonitorWindows model | ✅ Yes | Interfaces exactly as designed; value/currency optional; badge windows-first (`Math.round` display only, uncapped model); snapshot `isMonitorWindows` validation; `formatResetCountdown` render-time derivation |
| AD-27 provider rewrite + platform plumbing | ✅ Yes | Query option (c) chosen: `zaiPlatform` in `UsageQuery`, set by `refreshTick` from the store; guidance view-side static — snapshot error arm class-only (AD-13 intact, verified `background.ts` L101) |
| AD-28 platform preference | ✅ Yes | Pure popup-safe table; `qd:pref:*` namespace distinct from `qd:key:*`; validated read (default 'zai') and write; selector in gear; read on load |
| AD-29 triple lock | ✅ Yes | zai hosts `[api.z.ai, open.bigmodel.cn]` verification `community` (honest); apex retired; spike ZAI section rewritten with triple-source evidence; sync tests re-pinned 4→5 |
| AD-30 status-first, proof not rework | ✅ Yes | `FetchTransport` structurally unchanged (`!ok` → `HttpStatusError` before `json()`); new pins with `json()`-rejecting stubs assert `jsonCalls === 0` + classification; taxonomy untouched |

### Proposal Conformance

- All In-Scope items delivered (provider rewrite, raw auth + per-credential strategy, allowlist/manifest union, platform selector default Z.AI, popup ZAI block, removals). Success criteria 1 and 2 met; criterion 3 (maintainer live E2E) = open task 3.6.
- Out-of-scope respected: no 24h `model-usage`/`tool-usage` endpoints, no backoff machinery, no `dev.bigmodel.cn`, no reset cards (grep-verified zero matches).
- Rollback plan intact (branch-only; hito-3 head `6c537be` present in history).

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ⚠️ | No standalone apply-progress artifact in the openspec store; evidence lives as per-unit RED→GREEN rows in the apply-updated `tasks.md` (each task names its RED test file and GREEN subject) |
| All tasks have tests | ✅ | Every production unit named in tasks 1.1–3.5 has a covering test file |
| RED confirmed (tests exist) | ✅ | All named RED test files exist on disk (glob-verified) |
| GREEN confirmed (tests pass) | ✅ | 274/274 pass at runtime, exit 0 |
| Triangulation adequate | ✅ | Multi-scenario behaviors carry multiple, value-varied cases (e.g. windows: discriminated/fallback/MCP-only/null-pct/over-100) |
| Safety Net for modified files | ⚠️ | Not separately reportable without the apply-progress table; suite-wide green at base and after each slice (commit history) is the available proxy |

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 274 | 24 | vitest 5.0.0 (node + happy-dom environments) |
| Integration | — (covered as unit-level composition) | — | happy-dom controller tests |
| E2E | 0 (manual maintainer live check = task 3.6, open) | 0 | not installed (by design: hermetic suite) |

### Changed File Coverage

Coverage analysis skipped — no coverage tool detected (`openspec/config.yaml`: `coverage: null`; informational, not a failure).

### Assertion Quality

Spot-check across `zai.test.ts`, `client.test.ts`, `fetch-transport.test.ts`, `background.test.ts`, `view.test.ts`, `controller.test.ts`, `zai-platform-store.test.ts`: assertions are behavioral and value-varied (strict-equal window objects, exact badge strings, `jsonCalls === 0` counters, zero-I/O lengths, DOM-sweep negatives). No tautologies, no ghost loops, no smoke-only renders, no type-only assertions, no mock-heavy files found.

**Assertion quality**: ✅ All assertions verify real behavior (0 CRITICAL, 0 WARNING)

### Quality Metrics

**Linter**: ➖ Not available (none configured). **Type Checker**: ✅ No errors (`tsc --noEmit`, exit 0).

### Issues Found

**CRITICAL**: None

**WARNING**:
1. Task 3.6 unchecked — maintainer live E2E (real key → plan level + real 5h pct; wrong-platform → ERR + guidance; ZHIPU key → open.bigmodel.cn). Human-owned, known-open (hito-3 W1 precedent); hermetic equivalents are green, but the live-shape confirmation (community-pinned `tokenLimits` discriminators, `data.level` spelling) remains pending. Fixtures re-pin if the live shape differs.
2. Strict-TDD evidence format: no standalone apply-progress artifact with a "TDD Cycle Evidence" table exists in the openspec store; the per-unit RED→GREEN ledger embedded in `tasks.md` was used instead and cross-validated against the repository (RED files exist; all green at runtime). Substance verified; format deviates from the module's expected artifact.

**SUGGESTION**:
1. Configure `@vitest/coverage-v8` and a coverage script so future verifies can report changed-file coverage numerically.
2. When task 3.6 completes, record the observed live payload shape next to the spike evidence to harden the community-pinned fixture basis.

### Verdict

**PASS WITH WARNINGS**

All 18 requirements and 40 scenarios verified compliant with passing runtime evidence; all runtime gates green (typecheck, build with exact 5-host manifest, 274/274 tests); design AD-25..AD-30 and proposal scope fully honored; security sweep clean. Warnings are the known-open human-owned live E2E task (3.6) and the TDD-evidence format deviation — neither blocks the change's hermetic correctness.
