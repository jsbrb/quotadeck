```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:e9ed4dff9e41f839d838ed2a69293fbdc0163cf640f68df66c686e3be3fac106
verdict: pass
blockers: 0
critical_findings: 0
requirements: 19/19
scenarios: 30/30
test_command: npm --prefix extension test -- --run
test_exit_code: 0
test_output_hash: sha256:d32cd1f9a59c5a658ddb279e8c338a0c6155ba7f4ee2ea7b1f1fb76c36768e47
build_command: npm --prefix extension run build
build_exit_code: 0
build_output_hash: sha256:4a6d76c52c9d03bc48e676c13f433327367e8adf58e721aabb7e815aa928552b
```

# Verification Report

**Change**: hito-1-extension-skeleton
**Version**: N/A (greenfield delta specs)
**Mode**: Standard (config `strict_tdd: false`)
**Date**: 2026-09-05 · **Branch**: `feature/hito-1-spike-y-esqueleto` (verified)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 28 |
| Tasks complete | 28 |
| Tasks incomplete | 0 |

Task 6.3 (manual E2E, unpacked load) is maintainer-confirmed external evidence per the design's testing strategy ("E2E: Manual; no automation in this milestone").

### Build & Tests Execution

**Typecheck**: ✅ Passed — `npm --prefix extension run typecheck` (tsc --noEmit, strict) → exit 0.
**Build**: ✅ Passed — `npm --prefix extension run build` → exit 0; `dist/background.js` (29,691 B) + `dist/manifest.json` (304 B) emitted and verified on disk.

```text
dist\background.js  29.0kb
Done in 9ms
built dist/background.js + dist/manifest.json
```

**Tests**: ✅ 74 passed / 0 failed / 0 skipped — `npm --prefix extension test -- --run` → exit 0.

```text
Test Files  13 passed (13)
     Tests  74 passed (74)
```

**Coverage**: ➖ Not available (no coverage command configured; `coverage_threshold: 0`).
**Hermeticity**: verified by inspection — test imports are vitest + `node:fs/path/url/assert` (local reads only) + local modules; the only `fetch(` occurrences are Transport ports/doubles (RecordingTransport/FixtureTransport); FakeBrowser/FakeClock elsewhere. `background.test.ts > full four-provider tick with global fetch disabled` proves zero outbound network I/O at runtime. Bundle grep: 0 hits for `host_permissions`/`XMLHttpRequest`; manifest requests only `storage`+`alarms`.

### Spec Compliance Matrix

| # | Requirement | Scenario | Implementation | Covering test (passed) | Result |
|---|-------------|----------|----------------|------------------------|--------|
| 1 | pf/Provider Contract | Contract compliance of the four stubs | `core/provider.ts`, `providers/{zai,qwen,openai,kimi}.ts` | `providers/index.test.ts` (contract fields + documented shapes) | ✅ COMPLIANT |
| 2 | pf/Provider Registration | Duplicate id rejected | `core/registry.ts` | `core/registry.test.ts > rejects a duplicate id…` | ✅ COMPLIANT |
| 3 | pf/Provider Registration | Unknown id rejected | `core/registry.ts` | `core/registry.test.ts > rejects an unknown id…` | ✅ COMPLIANT |
| 4 | pf/ZAI Parsing | Fixture page parsed | `providers/zai.ts` | `zai.test.ts > collects every page…` (value 39, tier GLM-4.5-Air) | ✅ COMPLIANT |
| 5 | pf/ZAI Parsing | Non-numeric or non-200 code rejected | `providers/zai.ts` | `zai.test.ts > rejects a string "200"…` + `> rejects a non-200 numeric code` | ✅ COMPLIANT |
| 6 | pf/ZAI Parsing | Pagination plan with jitter and dedupe | `providers/zai.ts`, `refresh/engine.ts` | `zai.test.ts > requires all 3 pages…` + `> sleeps exactly N−1 times… [500,2000]` (dup billingNo counted once) | ✅ COMPLIANT |
| 7 | pf/Qwen Parsing | Balance fixture parsed | `providers/qwen.ts` | `qwen.test.ts > parses Data.AvailableAmount…` (100.28 CNY) | ✅ COMPLIANT |
| 8 | pf/Qwen Parsing | DashScope key rejected | `core/credentials.ts`, `providers/qwen.ts` | `qwen.test.ts > declares ak-sk…` + `credentials.test.ts` (AK/SK + `bss:DescribeAcccount` guidance) | ✅ COMPLIANT |
| 9 | pf/OpenAI Parsing | Costs fixture aggregated | `providers/openai.ts` | `openai.test.ts > aggregates amount.value…` (20 + per-bucket totals) | ✅ COMPLIANT |
| 10 | pf/OpenAI Parsing | Cursor pagination terminated | `providers/openai.ts` | `openai.test.ts > consumes exactly two pages…` (next_page until absent) | ✅ COMPLIANT |
| 11 | pf/OpenAI Parsing | Request validation | `providers/openai.ts` (`buildCostsRequest`) | `openai.test.ts > rejects… missing start_time` + `> rejects… bucket_width other than 1d` | ✅ COMPLIANT |
| 12 | pf/Kimi Parsing | Balance fixture parsed | `providers/kimi.ts` | `kimi.test.ts > parses data.available_balance as a CNY balance` (88.88) | ✅ COMPLIANT |
| 13 | pf/Fixture-Only Data | Suites are hermetic | `src/fixtures/**`, `network/transport.ts`, `src/testing/**` | all 13 files + `background.test.ts > …global fetch disabled` | ✅ COMPLIANT |
| 14 | na/Per-Provider Domain Allowlist | Allowlisted host admitted | `network/allowlist.ts`, `network/client.ts` | `client.test.ts > admits an allowlisted host…` (+ subdomain AD-5) | ✅ COMPLIANT |
| 15 | na/Per-Provider Domain Allowlist | Non-allowlisted host rejected | `network/client.ts` | `client.test.ts > rejects non-allowlisted host…` (zero transport I/O) | ✅ COMPLIANT |
| 16 | na/Per-Provider Domain Allowlist | Cross-provider host rejected | `network/allowlist.ts` (per-provider scope) | `client.test.ts > rejects cross-provider host` + `allowlist.source.test.ts > is scoped per provider` | ✅ COMPLIANT |
| 17 | na/Unverified Variant Excluded | Unverified domain rejected | `network/allowlist.ts` (zai: `bigmodel.cn` only) | `allowlist.source.test.ts > pins… NOT api.z.ai` + `client.test.ts > rejects… api.z.ai` | ✅ COMPLIANT |
| 18 | na/Credentials Only in Authorization Header | Key placement | `network/request.ts` (no header/cookie fields), `network/client.ts` | `client.test.ts > admits…` — headers exactly `{Authorization: Bearer …}`, URL/key-free | ✅ COMPLIANT |
| 19 | na/Credentials Only in Authorization Header | Non-header key suppressed | `network/request.ts` (placement guard) | `client.test.ts > rejects a credential smuggled as a query parameter` (+ body case) | ✅ COMPLIANT |
| 20 | na/Injectable Transport | Hermetic network tests | `network/transport.ts` (Transport port) | `client.test.ts` entirely via RecordingTransport | ✅ COMPLIANT |
| 21 | ks/Local-Only Persistence | Save and read round-trip | `storage/key-store.ts` | `key-store.test.ts > round-trips… under qd:key:{id}` in local area | ✅ COMPLIANT |
| 22 | ks/Local-Only Persistence | Sync never used | `storage/key-store.ts` (no `.sync` path) | `key-store.test.ts > never calls chrome.storage.sync…` | ✅ COMPLIANT |
| 23 | ks/Masked Display | Masked read | `storage/key-store.ts` (`readMaskedKey`) | `key-store.test.ts > masked read reveals at most the last 4…` (short key → `••••`) | ✅ COMPLIANT |
| 24 | ks/Revocation | Revoke removes key | `storage/key-store.ts` (`revokeKey`) | `key-store.test.ts > revocation removes the key…` + `engine.test.ts > unkeyed providers are skipped` (auth stops) | ✅ COMPLIANT |
| 25 | ks/Per-Provider Isolation | Isolated revoke | `storage/key-store.ts` (`qd:key:{id}`) | `key-store.test.ts > per-provider isolation…` | ✅ COMPLIANT |
| 26 | ub/One-Minute Alarm Schedule | Alarm registered | `background.ts` (`ensureAlarm`) | `background.test.ts > registers… on install` + `> on startup when absent` + `> does not re-register` | ✅ COMPLIANT |
| 27 | ub/One-Minute Alarm Schedule | Badge refresh per tick | `background.ts` (`refreshTick`) | `background.test.ts > updates the badge on every tick…` | ✅ COMPLIANT |
| 28 | ub/Badge Rendering | Deterministic text | `core/usage.ts` (`formatBadgeText`) | `usage.test.ts` (¥12 / ¥9.9 / 1.2k / determinism) + repeated-tick stability in background.test.ts | ✅ COMPLIANT |
| 29 | ub/Error State | Failed refresh shows marker and retries | `background.ts` (onError → `ERR`) | `background.test.ts > shows ERR… next successful tick replaces it` (+ same-tick replacement) | ✅ COMPLIANT |
| 30 | ub/No Live Calls in Milestone | Fixture-driven tick | `background.ts` (FixtureTransport), `fixtures/index.ts` (AD-8) | `background.test.ts > full four-provider tick with global fetch disabled` | ✅ COMPLIANT |

**Compliance summary**: 30/30 scenarios compliant (pf = provider-framework 13, na = network-allowlist 7, ks = key-storage 5, ub = usage-badge 5).

### Correctness (Static Evidence)

All 19 requirements have implementation code (matrix above). Verified arithmetic against fixtures: ZAI 10/1000×2000=20 + 5/1000×1000=5 + 8/1000×1500=12 + 2/1000×500=1 + 4/1000×250=1 → 39 with the page-2 duplicate `BL202608010001` counted once; OpenAI 10.50+4.25+2.00+3.25 = 20; Qwen 100.28 CNY; Kimi 88.88 CNY — all match test assertions.

### Coherence (Design AD-1…AD-9)

| Decision | Followed? | Evidence |
|----------|-----------|----------|
| AD-1 ports + single composition root | ✅ | grep: `chrome` global referenced only in `platform/browser-api.ts` (ChromeBrowserApi) and `background.ts` (typeof guard); core depends on Clock/Transport/BrowserApi ports |
| AD-2 opaque state + injected-clock jitter | ✅ | `refresh/engine.ts` treats `PageParse.state` as opaque; FakeClock asserts N−1 sleeps in [500,2000] |
| AD-3 network layer attaches credentials | ✅ | `network/client.ts` host check → credential scan (url/query/body) → attaches `Authorization` → transport |
| AD-4 doc is allowlist single source + sync test | ✅ | `allowlist.source.test.ts` deep-strict-equals doc json block vs `PROVIDER_ALLOWLIST`; values match `docs/spike/endpoints.md` exactly |
| AD-5 suffix matching, per-provider scope | ✅ | `isHostAllowed`: `host === p || host.endsWith('.'+p)`, scoped per providerId |
| AD-6 Map registry, fail-fast, fixed order | ✅ | `core/registry.ts` + `providers/index.ts` (zai, qwen, openai, kimi — test-pinned) |
| AD-7 zero host_permissions | ✅ | `public/manifest.json` + emitted `dist/manifest.json`: permissions `["storage","alarms"]` only |
| AD-8 fixtures bundled into worker | ✅ | `fixtures/index.ts` json imports inlined; self-contained 29 kB `dist/background.js` |
| AD-9 self-contained dev-only package | ✅ | `extension/package.json`: devDependencies only, zero runtime deps |

### Proposal Conformance

In scope — all delivered: endpoints doc (4 providers, verification status, sources, allowlist block); MV3+TS+esbuild+vitest skeleton; Provider interface + 4 fixture-tested stubs; allowlist layer (official domains, Authorization-only); storage.local wrapper (no `.sync`, masked, revoke); badge + 1-min alarms worker; MIT LICENSE; README. Out of scope respected: no live calls (fixture-only bundle, no `host_permissions`, no real-key paths); Qwen balance-only (Coding Plan quota documented as blocked); no Android/store/cert-pinning/telemetry. Rollback plan viable (greenfield paths).

### Issues Found

**CRITICAL**: None
**WARNING**: None
**SUGGESTION**:
1. Design §Interfaces sketch omits `runtime` (onInstalled/onStartup) on BrowserApi; the implementation adds `BrowserRuntime` to satisfy usage-badge §One-Minute Alarm Schedule (spec-driven, documented in `platform/browser-api.ts`). Update the design sketch if the doc is revised.
2. Design §Project Layout says `core/registry.ts` hosts `createDefaultRegistry()`; implementation (per task 2.2 annotation) places it in `providers/index.ts` so core stays provider-free (AD-1). The design layout line is stale.
3. ZAI/OpenAI providers keep per-instance cycle fields (`cycleMonth`/`cycleStart`) for next-page request rebuilds; safe under the sequential engine but would race if one instance were refreshed concurrently — move into `ProviderState` at the live milestone.
4. Qwen requests currently carry a Bearer-style `Authorization` (documented in `network/client.ts`); real Alibaba AK/SK HMAC signing is deferred to the live milestone — track it there.

### Verdict

**PASS**
30/30 scenarios compliant with passing runtime evidence; 28/28 tasks complete; typecheck/build/tests all exit 0; hermeticity and out-of-scope constraints verified; 0 critical, 0 warning, 4 suggestion findings.
