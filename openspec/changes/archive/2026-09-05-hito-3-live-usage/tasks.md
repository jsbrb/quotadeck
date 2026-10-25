# Tasks: Hito 3 — Live Usage

Forecast: High risk, chained PRs, decision needed — see end. Strict TDD: every unit RED → GREEN via `npm --prefix extension run test`.

## Slice 1: Network + Auth + Signer (PR 1)

- [x] 1.1 RED→GREEN `extension/src/network/manifest.hosts.test.ts`: `host_permissions` deep-strict-equals `PROVIDER_ALLOWLIST` union; add 4 hosts to `extension/public/manifest.json` (AD-16)
- [x] 1.2 RED→GREEN `extension/src/refresh/error-taxonomy.test.ts` → `error-taxonomy.ts` (`classifyRefreshError`, full AD-21 mapping → auth/rate-limit/server/network/unknown); typed errors in new `extension/src/network/fetch-transport.ts` (`HttpStatusError`, `ResponseParseError`; class itself is 3.1) and `extension/src/core/provider.ts` (`ProviderApiError`) (AD-21)
- [x] 1.3 RED→GREEN `extension/src/core/provider-metadata.test.ts` + `extension/src/providers/index.test.ts`: `PROVIDER_METADATA` (AD-6 order + `credentialType`); `createDefaultRegistry` in `extension/src/providers/index.ts` builds from it (AD-24)
- [x] 1.4 RED→GREEN `extension/src/core/credentials.test.ts`: `ak-sk` pair mode rejects empty parts and `sk-` either part (`QWEN_AK_SK_GUIDANCE`); `Credential` union in `extension/src/core/provider.ts` (AD-17)
- [x] 1.5 RED→GREEN `extension/src/storage/key-store.test.ts`: pair round-trip, per-part masking (≤4 suffix), atomic revoke, legacy qwen string → `undefined`, token bytes unchanged; type-aware save/read/readMasked/revoke over `Credential` in `extension/src/storage/key-store.ts` (`qd:key:qwen` JSON pair) (AD-17)
- [x] 1.6 RED→GREEN `extension/src/network/rpc-signer.test.ts`: pinned vector `xmAUc1KiUFczd0HBbplKPgXLEDU=`, encoding edges, secret absent from outputs; `signBssQuery` in `extension/src/network/rpc-signer.ts` (RFC-3986, sorted, `GET&%2F&`, Web-Crypto HMAC-SHA1) (AD-18)
- [x] 1.7 RED→GREEN `extension/src/network/client.test.ts`: `send` takes `Credential`; ak-sk qwen-only → signed query, NO `Authorization` header, AK-in-query only on `business.aliyuncs.com`, off-host → `NetworkRejectionError('credential-placement')`; bearer/admin unchanged; kind-aware `assertNoCredentialMaterial` in `extension/src/network/request.ts`; clock timestamp + rng nonce injected. O2: secret-scan test asserts ALL surfaces explicitly — url, query, body, headers, cookies (AD-19)
- [x] 1.8 RED→GREEN `extension/src/refresh/engine.test.ts`: `refreshAll` uses `readCredential(id, type)`, threads `Credential` to `send` (`extension/src/refresh/engine.ts`)

## Slice 2: ZAI Window Semantics + Tier Budget (PR 2)

- [x] 2.1 RED→GREEN `extension/src/core/tier-budget.test.ts` → pure `extension/src/core/tier-budget.ts`: `epochFromBillingNo` (± customerId), `billingMonthsFor` (straddle/no-straddle), `evaluateBudget` (window sum, latest-tier, default/overridden limits, unknown tier → no percent, rounding, cap 100, countdown ±), `DEFAULT_TIER_LIMITS`, `cstEpoch`/`cstParts` (+08:00 only, epoch ordering) (AD-20)
- [x] 2.2 RED→GREEN `extension/src/storage/limit-store.test.ts` → `extension/src/storage/limit-store.ts`: `qd:tier-limits` override; absent/invalid → defaults (AD-20)
- [x] 2.3 RED→GREEN `extension/src/core/usage.test.ts`: `BudgetReport` + optional `budget` on `NormalizedUsage` (`extension/src/core/usage.ts`) (AD-22)
- [x] 2.4 Re-record five `extension/src/fixtures/zai/*.json` to community shape (`apiUsage`, epoch-bearing `billingNo`, `~` timeWindow, `data.customerId`); add straddle + unextractable fixtures; register in `extension/src/fixtures/index.ts` (AD-23). O3: `customerId` field is community-pinned — maintainer live E2E confirms; success criterion, not a test
- [x] 2.5 RED→GREEN `extension/src/providers/zai.test.ts` → rewrite `extension/src/providers/zai.ts`: months queue in opaque state, `apiUsage` window sum, dedupe, latest-record tier, cost informational, non-numeric/non-200 → `ProviderApiError`, straddle walks both months (N−1 sleeps), unextractable epoch excluded (budget absent, cost intact), final fold `evaluateBudget` → `usage.budget`; `UsageQuery` gains `billingMonths`/`now`/`tierLimits` (`extension/src/core/provider.ts`) (AD-23)

## Slice 3: Live Wiring + Popup + Copy (PR 3)

- [x] 3.1 RED→GREEN `extension/src/network/fetch-transport.test.ts`: 2xx passthrough, 401/429/500 → `HttpStatusError(status)`, malformed JSON → `ResponseParseError`, `TypeError` propagates; `FetchTransport` (injectable `fetchImpl`) in `extension/src/network/fetch-transport.ts`; docs-only note in `extension/src/network/transport.ts` (AD-19)
- [x] 3.2 RED→GREEN `extension/src/storage/snapshot-store.test.ts` + `extension/src/background.test.ts`: error arm requires `errorClass`, `budget` validated when present; `onError` classifies via `classifyRefreshError`, badge `ERR` every class, one write incl. budget, recovery replaces `ERR`. O1: snapshot shape-validation extension and background write-shape change stay in the SAME slice — never straddle a slice boundary red
- [x] 3.3 RED→GREEN `extension/src/background.test.ts` → `extension/src/background.ts`: `buildTickQuery(clock)` derives `billingMonths`/`now`/`startTime`/`endTime`, limit-store feeds `tierLimits`, `FetchTransport` default, `FIXTURE_QUERY`/`FIXTURE_ROUTES` removed
- [x] 3.4 RED→GREEN `extension/src/popup/view.test.ts` → `extension/src/popup/view.ts`: `renderMain`/`renderSettings`, gear/back `data-action`, ZAI budget block + pure `formatResetCountdown` (omitted when absent), OpenAI per-model rows sorted (model, usageType), per-class error labels, no key forms in main, deterministic (AD-22)
- [x] 3.5 RED→GREEN `extension/src/popup/controller.test.ts` → `extension/src/popup/controller.ts`: view switching, settings forms incl. qwen AK+SK pair, keydown-Enter submit (replaces submit backstop), revoke isolation, full pair never in DOM, imports `PROVIDER_METADATA`; boundary regex extends to `../(network|fixtures|providers)` (AD-22/24)
- [x] 3.6 Restyle `extension/public/popup.html`: gear/back header, budget line, model rows, settings view
- [x] 3.7 Copy: `README.md` drops fixture-only language (live posture, `host_permissions`, gear/per-model); `extension/public/manifest.json` description → "Provider usage and balance badge" (AD-24)
- [ ] 3.8 Gate: `npm --prefix extension run test` + `typecheck` + `build`; maintainer live E2E: stored ZAI key → live 5h percentage in one tick, bad key → `ERR` + auth class, other creds → values, revoke → skipped, confirm O3 `customerId`

## Review Workload Forecast

Estimated changed lines: ~1,300–1,700.

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Delivery strategy: ask-on-risk. If feature-branch-chain: PR 1 base = `feature/hito-3-live-usage`; PR 2 base = PR 1; PR 3 base = PR 2.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test | Runtime harness | Rollback boundary |
|------|------|-----------|--------------|-----------------|-------------------|
| 1 | Foundations | PR 1 | `npm --prefix extension run test -- manifest.hosts rpc-signer client key-store` | N/A — hermetic | Revert PR 1 → hito-2 intact |
| 2 | ZAI + budget | PR 2 | `npm --prefix extension run test -- tier-budget limit-store zai usage` | N/A — hermetic | Revert PR 2 → cost-primary ZAI |
| 3 | Wiring + popup + copy | PR 3 | `npm --prefix extension run test` + `typecheck` + `build` | Maintainer unpacked load (3.8 live E2E) | Revert PR 3 → fixture tick + inline popup |
