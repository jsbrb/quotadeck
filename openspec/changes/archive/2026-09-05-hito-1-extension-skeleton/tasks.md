# Tasks: Hito 1 — Extension Skeleton

## Review Workload Forecast

- Estimated changed lines: ~2,000–2,500 (~28 source files + tests/fixtures/docs)
- Exceeds 400-line budget → chained PRs; slices: core+network → providers+fixtures → worker+docs

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Work Units

| Unit | PR | Focused test | Runtime harness | Rollback |
|------|----|--------------|-----------------|----------|
| Scaffold+doc+core+doubles+network+storage | 1 | `npm --prefix extension run test` | N/A — worker not wired yet | `extension/src/{core,network,storage,testing}` + `docs/spike/` |
| Providers+fixtures | 2 | `npm --prefix extension run test -- src/providers` | N/A — fixture parsing only | `extension/src/{providers,fixtures}` |
| Engine+platform+worker+docs | 3 | `npm --prefix extension run build` | Unpacked load → badge per 1-min tick | `extension/src/{refresh,platform}`, `extension/src/background.ts`, `README.md`, `LICENSE` |

## Phase 1: Scaffolding & Spike Doc

- [x] 1.1 Create `extension/package.json` (typescript, esbuild, vitest, @types/chrome; scripts build/test/typecheck), `extension/tsconfig.json` (strict, noEmit), `extension/vitest.config.ts` (node, `src/**/*.test.ts`), `extension/build.mjs` (esbuild → dist/background.js, copy manifest)
- [x] 1.2 Create `extension/public/manifest.json` — MV3; `storage`+`alarms` permissions; no `host_permissions` (AD-7)
- [x] 1.3 Create `docs/spike/endpoints.md` — per-provider evidence + ```json allowlist block (AD-4): ZAI `bigmodel.cn` (not `api.z.ai`), Qwen `business.aliyuncs.com`, OpenAI `api.openai.com`, Kimi `api.moonshot.cn` (§Domain Allowlist)

## Phase 2: Core, Storage & Doubles

- [x] 2.1 Create `extension/src/core/provider.ts` (Provider, PageParse, ids; §Contract) + `extension/src/core/clock.ts` (Clock port)
- [x] 2.2 Create `extension/src/core/registry.ts` + `registry.test.ts` — throws duplicate/unknown id (§Registration). Annotation: `createDefaultRegistry()` lives in `providers/index.ts`; core stays provider-dep-free
- [x] 2.3 Create `extension/src/core/usage.ts` + `usage.test.ts` — `formatBadgeText`: `¥12`, `<10` decimal, `≥1000` → `1.2k` symbol dropped, `ERR`; deterministic (usage-badge §Rendering)
- [x] 2.4 Create `extension/src/core/credentials.ts` + `credentials.test.ts` — Qwen rejects `sk-`; AK/SK (RAM `bss:DescribeAcccount`) guidance (§Qwen)
- [x] 2.5 Create `extension/src/storage/key-store.ts` + `key-store.test.ts` — save/read/masked ≤4/revoke, `qd:key:{id}` on injected `storage.local`; isolation; `.sync` never called (key-storage). Annotation: comment excludes `.sync` + `localStorage`: no key material outside wrapper
- [x] 2.6 Create `extension/src/testing/fake-browser.ts`, `fake-clock.ts`, `recording-transport.ts` — not imported by background.ts (AD-1)

## Phase 3: Network Layer

- [x] 3.1 Create `extension/src/network/allowlist.ts` — typed doc copy; suffix match `host===p || host.endsWith('.'+p)`, per-provider (AD-5)
- [x] 3.2 Create `extension/src/network/allowlist.source.test.ts` — doc ```json block `deepStrictEqual` code (AD-4; after 1.3)
- [x] 3.3 Create `extension/src/network/request.ts` (ProviderRequest + placement guard) + `extension/src/network/transport.ts` (Transport port, FixtureTransport)
- [x] 3.4 Create `extension/src/network/client.ts` — host check → credential scan (url/query/body) → attach `Authorization` → transport (AD-3). Annotation: comment gives structural no-cookie case: request type has no cookie/header field; only client sets headers
- [x] 3.5 Create `extension/src/network/client.test.ts` — RecordingTransport: admit `bigmodel.cn`; reject `evil.example.com`, cross-provider host, `api.z.ai`, query-param key; zero transport I/O (network-allowlist)

## Phase 4: Providers & Fixtures

- [x] 4.1 Create `extension/src/fixtures/` — `zai/expense-bill-list--{page-1..3,code-string-200,code-500}.json` (pages span `total`; dup `billingNo`), `qwen/query-account-balance--ok.json`, `openai/costs--{page-1,page-2-final}.json`, `kimi/users-me-balance--ok.json` + `index.ts` (AD-8)
- [x] 4.2 Create `extension/src/providers/zai.ts` + test — Σ `costPrice/1000×deductUsage`, tier=`tokenResourceName`, numeric-200 only, `billingNo` dedupe, delay `[500,2000]` (§ZAI)
- [x] 4.3 Create `extension/src/providers/qwen.ts` + test — `Data.AvailableAmount`/`Currency`; `ak-sk` (§Qwen)
- [x] 4.4 Create `extension/src/providers/openai.ts` + test — Σ `amount.value`, model+usage_type buckets, `next_page` cursor, `start_time` + `bucket_width=1d` pre-dispatch validation (§OpenAI)
- [x] 4.5 Create `extension/src/providers/kimi.ts` + test — `data.available_balance`, CNY (§Kimi)
- [x] 4.6 Create `extension/src/providers/index.ts` — `createDefaultRegistry()` wiring zai, qwen, openai, kimi (AD-6)

## Phase 5: Engine, Worker & Docs

- [x] 5.1 Create `extension/src/refresh/engine.ts` + test — opaque-state pagination, `Clock.sleep` jitter (FakeClock: 500–2000 ms, N−1 sleeps), fold, error marker (AD-2)
- [x] 5.2 Create `extension/src/platform/browser-api.ts` — BrowserApi + ChromeBrowserApi; sole other `chrome` toucher (AD-1)
- [x] 5.3 Create `extension/src/background.ts` — composition root; `usage-refresh` alarm (1-min) on install/startup when absent; tick → refreshAll → badge; failure → `ERR` (usage-badge)
- [x] 5.4 Create `extension/src/background.test.ts` — via FakeBrowser + FixtureTransport: alarm registered, deterministic badge, `ERR`→recovery, fixture-only (usage-badge)
- [x] 5.5 Create `LICENSE` (MIT), `README.md` (unpacked load, scripts); verify `.gitignore` covers extension/node_modules/ and extension/dist/ (unanchored `node_modules/`+`dist/` already match; add explicit only if missing)

## Phase 6: Verification

- [x] 6.1 `npm --prefix extension run typecheck` + `npm --prefix extension run build` green; dist/background.js emitted
- [x] 6.2 `npm --prefix extension run test` — all green; hermetic, zero outbound I/O (§Fixture-Only)
- [x] 6.3 Manual E2E: unpacked load → badge per 1-min tick (usage-badge)
