# Proposal: hito-8-qwen-hybrid — Qwen hybrid monitor (BSS site fix + sk-sp- plan probe)

> **Compressed planning run (declared openly)**: proposal + spec deltas + tasks produced in ONE pass; no separate design phase — one real architectural decision (the dual-credential model) plus forced composition choices, documented in Design Notes below.

## Intent

Live evidence (maintainer, INTERNATIONAL account): `business.aliyuncs.com` answers HTTP 400 `AuthSiteFail`; `business.ap-southeast-1.aliyuncs.com` answers 200 with amounts as STRINGS, `Code` `"200"` as a string, and `Success` as a bool (CN site returns numbers). Coding-plan quota exposes no percentage/total on ANY key surface — only a binary probe: `POST https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions` with the `sk-sp-` inference key (200 → available; 429 → exhausted, reset in the error text; 401/403 → key rejected). **Ratified**: Qwen becomes a HYBRID — (1) BSS balance (site-fixed) + (2) binary plan probe. NO cookie/session model (security posture).

## Scope

### In Scope

- Site selector: `qwenSite` preference (international → `business.ap-southeast-1.aliyuncs.com`, DEFAULT; china → `business.aliyuncs.com`), mirroring the `zaiPlatform` pattern (AD-28); allowlist + manifest + endpoints doc gain the intl host; `UsageQuery.qwenSite` read per tick; parse tolerates string amounts, string `Code`, `Success` bool.
- Dual credential model (Design Notes §1): optional `sk-sp-` plan key under `qd:key:qwen-plan` alongside the existing AK/SK pair; per-credential masking/revoke; second settings field group.
- Probe flow: cached plan status (`available | exhausted(resetAt) | key-rejected`) merged into the qwen cycle result; popup plan line; badge UNCHANGED (balance as today).
- Out of scope: cookies/console gateway, percentages (impossible on any surface), CN probe endpoint (unverified), other providers.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `key-storage`: + §Qwen Site Preference, + §Qwen Plan Key (dual credential) (ADDED).
- `network-allowlist`: qwen hosts += intl BSS host + probe host; RPC-signing exception re-scoped to the two BSS hosts; Bearer reuse for `sk-sp-` (MODIFIED ×2).
- `provider-framework`: §Provider Contract + §Qwen Parsing + §Credential Attach Modes (MODIFIED); + §Qwen Plan Probe (ADDED).
- `popup-ui`: + §Qwen Site Selector, + §Qwen Plan Line, + §Qwen Plan Key Settings Group (ADDED); §Settings Guidance qwen row (MODIFIED).
- `usage-badge`: + §Qwen Plan Probe Cadence — cache bounds, badge unchanged (ADDED).

## Design Notes (the decisions)

1. **Dual credential model (THE decision)**. Two independent OPTIONAL qwen credentials: AK/SK pair (`qd:key:qwen`, BSS balance, RPC-signed) and `sk-sp-` plan key (`qd:key:qwen-plan`, bearer). Alternatives: (a) one credential union — rejected: keys come from different consoles with different shapes; forcing a mode pick loses the hybrid; (b) a second provider id `qwen-plan` — rejected: registry/badge order is last-wins, so a second card would corrupt badge semantics and card identity. Chosen: `KeyStore` gains a per-provider credential *slot*; a new `CredentialType` `'qwen-plan'` rides the existing token union so the client attaches it via the existing Bearer branch (sanctioned form, no new attach mode).
2. **Probe composition**. Tick-level step (`extension/src/refresh/qwen-plan.ts`) after `refreshAll`, before the snapshot write — NOT inside `RefreshEngine.refresh`, which is credential-agnostic and single-credential-per-provider by design. The pure request builder/outcome mapper lives in `extension/src/providers/qwen-plan-probe.ts` (fixtures, parse discipline). Plan status merges into the qwen snapshot entry only when it is `ok` or absent — the error arm wins (something IS broken; AD-13 class-only stays).
3. **Caching bounds**. Available → reuse 120 min; exhausted → 15 min; key-rejected → 15 min (floor: never more than one probe per 15 min). Each probe costs one 1-token inference; the research pattern (~2h/~15min) is honored. Cache: `qd:qwen-plan-status` `{status, resetAt?, probedAt}`, shape-validated read (SnapshotStore pattern).
4. **Reset source: error message, not Retry-After**. `TransportResponse` carries no headers; widening the transport port for one field is not worth the surface. Hito-7 §Error Body Surfacing already embeds the 429 body snippet (`reset at MM-DD HH:MM:SS UTC`) in the `HttpStatusError` message — parse it, year from the injected clock, past-derived instants roll to the next year.
5. **Plan-on-card semantics**. `NormalizedUsage.plan` is optional like `windows`; `formatBadgeText` ignores it (badge = balance, unchanged). A plan-only user (no AK/SK) still gets a qwen card: value-less ok entry, plan line only.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `extension/src/core/qwen-sites.ts`, `storage/qwen-site-store.ts` | New | Site table + `qd:pref:qwen-site` (AD-28 mirror) |
| `extension/src/providers/qwen.ts` (+fixtures) | Modified | Site-selected base; tolerant envelope |
| `extension/src/network/allowlist.ts`, `request.ts`, `public/manifest.json`, `docs/spike/endpoints.md` | Modified | 3 qwen hosts; BSS-scoped signing exception |
| `extension/src/core/provider.ts`, `credentials.ts`, `usage.ts` | Modified | `'qwen-plan'` type; `plan` field |
| `extension/src/storage/key-store.ts`, `qwen-plan-store.ts` | Mod/New | Plan slot; probe cache |
| `extension/src/providers/qwen-plan-probe.ts`, `refresh/qwen-plan.ts` | New | Probe build/map; TTL composition |
| `extension/src/background.ts`, `popup/view.ts`, `popup/controller.ts` | Modified | qwenSite threading; selector; plan line + field group |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Probe endpoint is community-verified only | Med | Marked `community` in allowlist/doc; mapping is status-first and hermetically pinned; wrong shape → honest error |
| Allowlist widening leaks the signing exception to the probe host | Med | Spec pins BSS-only scoping; RED test on the probe host (2.9) |
| Reset-parse brittleness (message format drift) | Med | Regex pinned to the observed format; unparseable 429 → exhausted WITHOUT resetAt (still honest) |
| Review size | High | Two chained slices (see tasks forecast) |

## Rollback Plan

Revert PR 1 then PR 2 on `feature/hito-8-qwen-hybrid`. No migrations: new keys (`qd:pref:qwen-site`, `qd:key:qwen-plan`, `qd:qwen-plan-status`) are additive and inert when unread; CN-site users regain `business.aliyuncs.com` behavior immediately (it remains the china-site host).

## Dependencies

- Maintainer live E2E: intl AK/SK against `business.ap-southeast-1.aliyuncs.com`; a real `sk-sp-` key against the probe.

## Success Criteria

- [x] Hermetic suite green (`npm --prefix extension run test`), incl. intl-string envelope, probe mapping, cache-TTL, and BSS-scoping pins.
- [x] Live E2E: intl balance renders (no `AuthSiteFail`); plan line shows available/exhausted; badge stays balance-only.
- [x] No credential outside its sanctioned placement; manifest equals the allowlist union.
