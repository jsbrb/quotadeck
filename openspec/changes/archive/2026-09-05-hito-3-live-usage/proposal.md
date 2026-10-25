# Proposal: Hito 3 — Live Usage

## Intent

Live calls for all four providers replace fixture-only data; popup gets gear-based key management plus per-model view. ZAI reference parity: trailing 5h window, SUM(apiUsage), percentage vs configurable tier limits, reset countdown.

## Scope

### In Scope

- Live fetch via allowlist client; fixtures test-only
- ZAI: two-month fetch on straddle; billingNo epoch-ms time; tier from latest `tokenResourceName`; configurable limits (2400/12000/48000 per 5h); countdown from `timeWindow` end (graceful absence)
- Qwen AK/SK pair + Alibaba RPC HMAC (secret never transmitted); `sk-` rejected
- UI: settings gear replaces inline key forms; per-model view
- Live errors (401/403/5xx/rate-limit) → error state + ERR badge
- First `host_permissions` (allowlisted domains)

### Out of Scope

Android/iOS, store publishing, i18n, cert pinning, telemetry, Qwen Coding-Plan quota, `api.z.ai`.

## Capabilities

### New Capabilities

- `tier-budget`: ZAI parity — trailing window, configurable limits, percentage, countdown

### Modified Capabilities

- `provider-framework`: ZAI parsing → window semantics; Fixture-Only Data → hermetic tests + live transport; Qwen pair
- `usage-badge`: drop No-Live-Calls; clock-derived queries; error taxonomy
- `popup-ui`: gear replaces inline forms; per-model view; drop Fixture-Only
- `key-storage`: persist + mask Qwen AK/SK pair
- `network-allowlist`: credential placement covers RPC signing (secret never in URLs); host_permissions

## Approach

`background.ts` swaps to real fetch behind the unchanged `AllowlistNetworkClient` seam; Bearer placeholder becomes per-type auth (Bearer/OpenAI admin/Alibaba HMAC). Window math pure. Strict TDD, hermetic tests.

Design-deferred: host_permissions shape (supersedes AD-7), AK/SK convention, usage-shape, error mapping, popup layout. Carry-overs: dead URLs; Enter backstop.

## Affected Areas

All Modified, `extension/`: `public/manifest.json` (host_permissions); `src/network/` (transport, auth, HMAC); `src/providers/zai.ts`, `core/usage.ts` (window semantics); `src/background.ts` (live wiring); `src/popup/` (gear, per-model); `src/storage/key-store.ts`, `core/credentials.ts` (AK/SK pair).

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| ZAI month-boundary straddle | High | Fetch both months |
| ZAI endpoint community-verified | Med | Fixtures; graceful errors |
| `host_permissions` exfiltration surface | Med | Allowlist-only; secret never in URL |
| Timezone/compare pitfalls | Med | Single timezone |
| MV3 worker lifetime vs page jitter | Med | Alarm wakes worker |

## Rollback Plan

Stacked branch `feature/hito-3-live-usage` on hito-2; revert = close PR / delete branch; shipped state stays hito-2 fixtures. Partial merges revert per unit.

## Dependencies

- Live-check creds: ZAI (stored), OpenAI `sk-admin-` read, Kimi, Alibaba AK/SK (RAM `bss:DescribeAcccount`); evidence: `docs/spike/endpoints.md`, research memory, hito-1/2 specs

## Success Criteria

- [ ] test/typecheck/build exit 0; hermetic
- [ ] Unit-proven: ZAI window math (straddle, billingNo epoch, apiUsage sum, percentage, countdown-absence), HMAC, AK/SK validation, gear, per-model rendering
- [ ] Maintainer live E2E: stored ZAI key → live 5h percentage in one tick; bad key → error + ERR badge; other creds → values; revoke → skipped
