# Tasks: Hito 4 — ZAI Monitor Endpoints

Slices per `design.md` §Removal Sequencing: S1 additive foundation → S2 atomic monitor swap → S3 popup + removals. Strict TDD (RED→GREEN per unit). Commands: `npm --prefix extension run test`, `run typecheck`, `run build`.

## Slice 1 (Phase 1): Foundation — additive (S1)

- [x] 1.1 RED `extension/src/core/credentials.test.ts` + `extension/src/storage/key-store.test.ts` (raw validation: empty rejected, non-empty ok; raw read/mask round-trip) → GREEN `extension/src/core/provider.ts` (`'raw'` in `CredentialType`, token arm `'bearer' | 'openai-admin-read' | 'raw'`, `UsageQuery.zaiPlatform?`), `extension/src/storage/key-store.ts` (`MaskedCredential` + `'raw'`), `extension/src/core/credentials.ts` docs, `extension/src/testing/provider-refresh.ts` (`TEST_CREDENTIALS` raw entry — `Record<CredentialType,…>` is exhaustive) (provider-framework §Credential Attach Modes)
- [x] 1.2 RED `extension/src/core/usage.test.ts` (badge `137%` uncapped; absent pct → level; both absent → `''`; monetary regressions) → GREEN `extension/src/core/usage.ts`: add `UsageWindow`/`McpToolUsage`/`McpWindow`/`MonitorWindows`, `windows?`, make `value`/`currency` optional, `formatBadgeText` windows branch first (usage-badge §Badge Rendering). **n3**: the monetary branch now needs a `value !== undefined` type guard once value is optional
- [x] 1.3 RED `extension/src/storage/snapshot-store.test.ts` (windows validation accept/reject; value/currency-absent usage accepted) → GREEN `extension/src/storage/snapshot-store.ts`: `isMonitorWindows` beside `isBudgetReport`. **n1**: `isNormalizedUsage`'s currently-REQUIRED `value`/`currency` checks (lines 77–78) RELAX to optional in S1 — implementer must not leave them required
- [x] 1.4 RED new `extension/src/core/zai-platforms.test.ts` (union, labels, `zaiMonitorBaseUrl` per platform) → GREEN create `extension/src/core/zai-platforms.ts` (zai-monitor §Platform Binding; AD-28)
- [x] 1.5 RED new `extension/src/storage/zai-platform-store.test.ts` (`qd:pref:zai-platform` round-trip unmasked; default `'zai'` on absent/invalid; invalid write rejected; credential namespace unaffected — write pref, re-read key + mask) → GREEN create `extension/src/storage/zai-platform-store.ts` (key-storage §ZAI Platform Preference)
- [x] 1.6 RED `extension/src/network/client.test.ts` (raw attach verbatim, no Bearer, + `Accept-Language` on the then-allowlisted zai host `bigmodel.cn` — S2 re-pins to `api.z.ai`; raw off-host → `NetworkRejectionError`, zero transport I/O) → GREEN `extension/src/network/client.ts` raw branch + monitor-host scoping; docs-only `extension/src/network/request.ts` (raw joins the token scan arm, no rule change) (network-allowlist §Raw attach scoped to monitor hosts)
- [x] 1.7 Pin `extension/src/network/fetch-transport.test.ts`: `json()`-rejecting stubs behind `ok:false` 401/403/429/500 → exact `HttpStatusError(status)`, never `ResponseParseError`; classify auth/rate-limit/server (zai-monitor §Status-First Error Classification; AD-30 — structural, expected green immediately)
- [x] 1.8 Verify slice: full suite + typecheck green; old ZAI surface untouched, nothing removed

## Slice 2 (Phase 2): Monitor swap — atomic (S2)

ONE commit — the five-way coupled lock (allowlist/manifest/spike + provider rewrite + fixtures + engine/background rewiring); tests move with their subject.

- [x] 2.1 RED `extension/src/network/allowlist.source.test.ts` + `extension/src/network/manifest.hosts.test.ts` (zai hosts exactly `api.z.ai` + `open.bigmodel.cn`; apex `bigmodel.cn` ABSENT; suffix re-pins: bare apex rejected, cross-provider `open.bigmodel.cn` under kimi rejected; manifest pinned list four → five) → GREEN `extension/src/network/allowlist.ts`, `extension/public/manifest.json`, `docs/spike/endpoints.md` (ZAI section + fenced JSON block, triple-source evidence) — same commit (network-allowlist §Per-Provider Domain Allowlist; AD-29)
- [x] 2.2 Create 7 fixtures `extension/src/fixtures/zai/monitor--pro-plan.json`, `monitor--over-100.json`, `monitor--null-pct.json`, `monitor--mcp-only.json`, `monitor--fallback-position.json`, `monitor--code-string-200.json`, `monitor--plain-text-401.json`; rewrite `extension/src/fixtures/index.ts`: 7 monitor routes in, 8 `expense-bill-list--*` routes + imports out
- [x] 2.3 RED rewrite `extension/src/providers/zai.test.ts` (one GET, no query/body; platform-selected base; `TOKENS_LIMIT` unit 3/number 5 → 5h, unit 6/number 1 → weekly, positional fallback; `TIME_LIMIT` → MCP from `currentValue`/`usage`/`usageDetails` name-sorted; 137 uncapped with used 16440 derived; null pct absent; `nextResetTime` → `resetAt` verbatim; MCP never synthesized; numeric-200 discipline, string `"200"` → `ProviderApiError`; invalid `zaiPlatform` throws pre-dispatch) → GREEN rewrite `extension/src/providers/zai.ts`; flip `extension/src/core/provider-metadata.ts` (+ `.test.ts`) ZAI `credentialType: 'raw'` (zai-monitor all requirements; provider-framework §ZAI Parsing, §Hermetic Tests with Live Transport Contract)
- [x] 2.4 Strip `extension/src/core/provider.ts`: remove `billingMonths`, `tierLimits`, `interPageDelayMs` + contract docs (provider-framework §Provider Contract — query MUST NOT carry tier limits or billing months)
- [x] 2.5 RED→GREEN `extension/src/refresh/engine.ts` + `extension/src/refresh/engine.test.ts`: drop `sleepBetweenPages`/`rng`/`interPageDelayMs` handling; pivot multi-page proof to OpenAI `next` walking
- [x] 2.6 RED→GREEN `extension/src/background.ts` + `extension/src/background.test.ts`: `buildTickQuery(clock, platform)` → `{ zaiPlatform, now, startTime, endTime }`; `readZaiPlatform` in; months/limits/rng out; routes keyed at platform-selected monitor URLs; badge `137%`/level/ERR; snapshot carries windows; plain-text 401 → `auth`. **n2**: the `cstEpoch` import lives in `background.test.ts` (line 11, from `./core/tier-budget`), NOT in `background.ts` — remove it in the test file
- [x] 2.7 Re-pin `extension/src/network/client.test.ts` raw-attach host from `bigmodel.cn` (S1 interim) to `api.z.ai`
- [x] 2.8 Verify slice: suite + typecheck + build + manifest sync green; `core/tier-budget` and `storage/limit-store` have ZERO production references (standalone tests stay green until S3)

## Slice 3 (Phase 3): Popup + removals (S3)

- [x] 3.1 RED `extension/src/popup/view.test.ts` (monitor block: level, 5h pct/used/total/countdown, weekly, MCP per-tool rows; selector rendering unmasked; zai auth guidance; optional-`value` guard in `formatUsageText`) → GREEN `extension/src/popup/view.ts`: monitor block + platform selector, delete `budgetBlock`; styles in `extension/public/popup.html` (popup-ui §Provider List Rendering, §ZAI Platform Selector)
- [x] 3.2 RED `extension/src/popup/controller.test.ts` (selector `change`-delegated → `writeZaiPlatform` → re-render; preference read on load; wrong-platform guidance when `results.zai.status === 'error' && errorClass === 'auth'`) → GREEN `extension/src/popup/controller.ts` wiring
- [x] 3.3 Delete `extension/src/core/tier-budget.ts` + `extension/src/core/tier-budget.test.ts`, `extension/src/storage/limit-store.ts` + `extension/src/storage/limit-store.test.ts` (tier-budget delta: all seven requirements REMOVED)
- [x] 3.4 Remove `BudgetReport`/`budget`/`isBudgetReport` from `extension/src/core/usage.ts` + `extension/src/storage/snapshot-store.ts` (+ tests); `formatResetCountdown` stays (render-time countdown from `windows.*.resetAt`)
- [x] 3.5 Update `README.md` (ZAI monitor description, host surface 4 → 5 note) + extend `extension/src/copy.test.ts` pins to monitor language
- [x] 3.6 Verify: full suite + build; maintainer live E2E unpacked load — real key → plan level + real 5h pct in one tick; wrong-platform key → ERR + auth guidance; ZHIPU key + selector → `open.bigmodel.cn` success

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1700 (S1 ~350 · S2 ~900 · S3 ~450) |
| 400-line budget risk | High — S2 alone exceeds the budget even after S1/S3 carve-outs |
| Chained PRs recommended | Yes — S1 → S2 → S3 |
| Suggested split | PR 1 (S1 foundation) → PR 2 (S2 atomic swap) → PR 3 (S3 popup + removals) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — maintainer chooses stacked-to-main vs feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 = S1 | Additive foundation: raw attach + scoping, platform module/store, MonitorWindows model, AD-30 pins | PR 1 | `npm --prefix extension run test` | N/A — no user-visible surface change; hermetic suite is the harness | Revert S1 commit — purely additive, old ZAI intact |
| 2 = S2 | Atomic monitor swap: allowlist/manifest/spike + provider rewrite + fixtures + engine/background | PR 2 | `npm --prefix extension run test && npm --prefix extension run build` | Maintainer unpacked load: real key → level + 5h pct badge in one tick | Revert S2 commit (restores expenseBillList + apex host); ultimate fallback hard-reset to hito-3 head `6c537be` |
| 3 = S3 | Popup monitor block/selector/guidance + tier-budget/limit-store deletions | PR 3 | `npm --prefix extension run test && npm --prefix extension run build` | Unpacked popup: selector persists ZHIPU unmasked; monitor block renders; auth guidance shows | Revert S3 commit — restores budget block + tier modules |

If feature-branch-chain is chosen: PR 1 base = `feature/hito-4-zai-monitor`; PR 2 base = PR 1 branch; PR 3 base = PR 2 branch — retarget/rebase until child diffs show only their own slice.
