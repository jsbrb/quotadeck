# Tasks: hito-8-qwen-hybrid

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~800–950 total (~400 per slice; tests dominate) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 site+parse+allowlist+manifest+selector → PR 2 dual credential+probe+cache+plan line |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Site routing + tolerant parse + allowlist/manifest/doc + site selector | PR 1 (base `feature/hito-8-qwen-hybrid`) | `npm --prefix extension run test` | Maintainer live E2E (3.2a): intl AK/SK → balance from ap-southeast-1 host | Revert PR 1 — additive pref key only, CN behavior restorable via selector |
| 2 | Dual credential + probe + TTL cache + popup plan line | PR 2 (base PR 1 branch) | `npm --prefix extension run test` | Maintainer live E2E (3.2b): real `sk-sp-` → plan line; badge still balance | Revert PR 2 — new storage keys additive and inert when unread |

## Phase 1: Site Routing + Tolerant Parse (Slice 1 = PR 1)

- [x] 1.1 RED — `extension/src/core/qwen-sites.test.ts` + `extension/src/storage/qwen-site-store.test.ts`: site table (international default, china) with base-URL mapping; `qd:pref:qwen-site` round-trip unmasked, invalid → default, `qd:key:*` untouched.
- [x] 1.2 GREEN — create `extension/src/core/qwen-sites.ts` (QwenSite, QWEN_SITES, `qwenBssBaseUrl`) + `extension/src/storage/qwen-site-store.ts` (AD-28 mirror of zai-platform-store).
- [x] 1.3 RED — `extension/src/providers/qwen.test.ts`: `qwenSite` threading (default → `business.ap-southeast-1.aliyuncs.com`, china → `business.aliyuncs.com`, invalid throws pre-dispatch); international envelope (string amounts, `Code` `"200"`, `Success` true) parses normalized; `Success` false / non-200 `Code` → explicit body-level error; existing CN fixture stays green. Add `extension/src/fixtures/qwen/query-account-balance--intl-ok.json`.
- [x] 1.4 GREEN — `extension/src/providers/qwen.ts`: site-selected `firstRequest` + tolerant envelope validation.
- [x] 1.5 — `docs/spike/endpoints.md` (qwen section + allowlist JSON block += intl BSS host), `extension/src/network/allowlist.ts`, `extension/public/manifest.json` (`host_permissions` += `https://business.ap-southeast-1.aliyuncs.com/*`) — `allowlist.source.test.ts` + `manifest.hosts.test.ts` prove union equality.
- [x] 1.6 RED — `extension/src/background.test.ts`: `refreshTick` reads `qd:pref:qwen-site` per tick and the recorded qwen request hits the site-selected host.
- [x] 1.7 GREEN — `extension/src/background.ts`: `buildTickQuery` gains qwenSite (read via the store, AD-28 mirror).
- [x] 1.8 RED — `extension/src/popup/view.test.ts` + `extension/src/popup/controller.test.ts`: qwen site selector in settings (International default / China), persists the preference.
- [x] 1.9 GREEN — `extension/src/popup/view.ts` (selector from QWEN_SITES, `PopupState.qwenSite`) + `extension/src/popup/controller.ts` persistence.

## Phase 2: Dual Credential + Plan Probe (Slice 2 = PR 2)

- [x] 2.1 RED — `extension/src/core/credentials.test.ts`: `'qwen-plan'` type requires non-empty `sk-sp-` prefix; violations rejected with plan-key guidance.
- [x] 2.2 GREEN — `extension/src/core/provider.ts` (token union += `'qwen-plan'`) + `extension/src/core/credentials.ts` (guidance constant); `extension/src/network/client.ts` Bearer branch covers it (pin in `client.test.ts`).
- [x] 2.3 RED — `extension/src/storage/key-store.test.ts`: plan slot `qd:key:qwen-plan` save/read/mask (≤4 suffix)/revoke, independent of `qd:key:qwen` both directions.
- [x] 2.4 GREEN — `extension/src/storage/key-store.ts`: per-slot storage key.
- [x] 2.5 RED — `extension/src/storage/qwen-plan-store.test.ts`: `qd:qwen-plan-status` `{status, resetAt?, probedAt}` round-trip; shape-invalid bytes read as undefined.
- [x] 2.6 GREEN — create `extension/src/storage/qwen-plan-store.ts` (SnapshotStore validation pattern).
- [x] 2.7 RED — `extension/src/providers/qwen-plan-probe.test.ts`: request shape (POST `token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions`, body `qwen3.6-flash`/max_tokens 1/stream false, Bearer via client); mapping 200 → available; 429 `HttpStatusError` message with `reset at 09-06 10:00:00 UTC` → exhausted + resetAt incl. year rollover; 401/403 → key-rejected. Fixture `extension/src/fixtures/qwen/plan-probe--ok.json`.
- [x] 2.8 GREEN — create `extension/src/providers/qwen-plan-probe.ts` (pure build + status-first map, clock-derived year).
- [x] 2.9 RED — `extension/src/network/client.test.ts` (where `assertNoCredentialMaterial` is pinned): `AccessKeyId` in query rejected on the probe host (BSS-only scoping tightened).
- [x] 2.10 GREEN — `extension/src/network/request.ts` scopes the AccessKeyId exception to the two BSS hosts; probe host joins `docs/spike/endpoints.md` + `extension/src/network/allowlist.ts` + `extension/public/manifest.json` (1.5 pattern).
- [x] 2.11 RED — `extension/src/core/usage.test.ts`, `extension/src/storage/snapshot-store.test.ts`, `extension/src/background.test.ts`: `NormalizedUsage.plan` shape + snapshot validation; tick reuses cache within TTL (120/15/15 — no probe recorded), probes once on expiry, no plan key → no probe; plan merges into ok/absent entries (error arm wins); badge text unchanged; probe transport failure keeps cache.
- [x] 2.12 GREEN — `extension/src/core/usage.ts` (plan field; `formatBadgeText` untouched), `extension/src/storage/snapshot-store.ts` validation, create `extension/src/refresh/qwen-plan.ts` (TTL cache + tick composition), wire into `extension/src/background.ts`.
- [x] 2.13 RED — `extension/src/popup/view.test.ts` + `extension/src/popup/controller.test.ts`: plan line (three statuses, countdown via `formatResetCountdown`); plan-only qwen card renders; `Plan key (sk-sp-)` settings group (save/mask/revoke isolation); updated qwen guidance copy.
- [x] 2.14 GREEN — `extension/src/popup/view.ts` + `extension/src/popup/controller.ts` + `SETTINGS_GUIDANCE` qwen row.

## Phase 3: Verification

- [x] 3.1 Full gate from workspace root: `npm --prefix extension run test`, then `npm --prefix extension run typecheck`, then `npm --prefix extension run build`.
- [x] 3.2 Maintainer live E2E: (a) intl AK/SK → balance renders from the ap-southeast-1 host (no `AuthSiteFail`); (b) real `sk-sp-` → plan line available/exhausted; (c) badge still renders balance only.
