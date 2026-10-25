# Proposal: GLM-only Chrome Web Store Release

## Intent

Ship the first public Chrome Web Store release of quotadeck scoped to the GLM (ZAI) provider, with threshold-colored badge alerting and the packaging assets the store requires (icons, store metadata, zip).

## Scope

### In Scope
- `SHIPPED_PROVIDER_IDS = ['zai']` as the single shipping filter: default registry, popup provider list, and manifest `host_permissions` derive from it. Other provider implementations are retained in source, not shipped.
- Badge alerting: pure `badgeBackgroundColor(percentage)` (neutral <50, orange ≥50 `#F97316`, deep orange ≥80 `#EA580C`, red ≥90 `#DC2626`; uncapped input) wired through `BrowserApi` `setBadgeBackgroundColor`/`setBadgeTextColor` on every tick; ERR renders neutral.
- Manifest: zai-only `host_permissions` (derived from the filtered `PROVIDER_ALLOWLIST` union), `icons` + `action.default_icon`, user-facing English description (≤132 chars), version 0.2.0.
- Packaging: `make-icons.ps1` (one-time System.Drawing generator), `public/icons/icon{16,32,48,128}.png`, `build.mjs` icon copy, `zip` npm script (Compress-Archive, manifest at zip root).
- README posture update (GLM-only build, shipped hosts, badge thresholds).

### Out of Scope
- Deleting non-zai provider code; dark mode; i18n; options page; popup redesign changes; hito-9 qwen console session (parked on its branch); multi-provider store listings.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `usage-badge`: badge background color follows usage thresholds; error badge neutral.
- `popup-ui`: rendered provider list is the shipped-provider subset (`SHIPPED_PROVIDER_IDS`), currently zai only.
- `network-allowlist`: shipped `host_permissions` equals the allowlist union filtered to shipped providers (full allowlist remains single-sourced by `docs/spike/endpoints.md`).
- `provider-framework`: `createDefaultRegistry` registers only shipped providers in pinned order.

## Approach

Filter at composition, never delete: `SHIPPED_PROVIDER_IDS` lives in `core/provider-metadata.ts` (impl-free) and is consumed by the registry, popup controller composition, and the manifest hosts sync test derivation. Badge color is a pure core function over the uncapped 5h-window percentage; the browser adapter gains `setBadgeBackgroundColor`/`setBadgeTextColor` and `refreshTick` sets them beside the existing badge text. Icons are generated once and committed; the build copies them to `dist/`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `extension/src/core/usage.ts` | Modified | `badgeBackgroundColor` pure fn |
| `extension/src/core/provider-metadata.ts` | Modified | `SHIPPED_PROVIDER_IDS` export |
| `extension/src/providers/index.ts` | Modified | filtered `createDefaultRegistry` |
| `extension/src/popup/controller.ts` | Modified | shipped-provider list composition |
| `extension/src/platform/browser-api.ts` | Modified | badge color adapter methods |
| `extension/src/background.ts` | Modified | badge color wiring per tick |
| `extension/public/manifest.json` | Modified | hosts, icons, description, 0.2.0 |
| `extension/build.mjs`, `extension/package.json` | Modified | icon copy, `zip` script |
| `extension/scripts/make-icons.ps1`, `extension/public/icons/` | New | icon generation + assets |
| Pinned tests across the touched surfaces | Modified | reflect shipped subset + colors |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Pinned four-provider tests break broadly | High | Minimal composition-point filter; update pins with evidence |
| Allowlist zai hosts differ from assumption | Low | Derive from `PROVIDER_ALLOWLIST`; stop and report on mismatch |
| Badge text color API availability | Low | `setBadgeTextColor` ships Chrome 110+; build targets chrome120 |
| Zip contents malformed for CWS | Med | Verify manifest.json at zip root after packaging |

## Rollback Plan

All work sits on `feature/hito-10-glm-store-release` (no remote). Revert commits or reset to develop @ 6316a4f. No storage or provider data-flow changes; main specs untouched until archive.

## Dependencies

None — no new npm packages; icons come from PowerShell System.Drawing.

## Success Criteria

- [ ] Badge background thresholds pinned by unit + wiring tests (49/50, 79/80, 89/90, 137, undefined, ERR)
- [ ] Registry and popup render only zai; qwen/openai/kimi code intact and unshipped
- [ ] Manifest `host_permissions` deep-strict-equals the filtered allowlist union; sync tests green
- [ ] `dist/` loads unpacked with icons; `quotadeck-v0.2.0.zip` has `manifest.json` at root
- [ ] `typecheck`/`test`/`build` green; work-unit commits recorded
