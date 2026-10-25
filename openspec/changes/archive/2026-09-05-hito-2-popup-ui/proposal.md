# Proposal: Hito 2 — Popup UI (Fixture-Only)

## Intent

Hito 1 renders a fixture-driven badge, but clicking the action does nothing (expected hito-1 behavior). Hito 2 gives the action a popup: four providers with current usage, key management (add/masked/revoke), per-provider error state — fixture-only; live calls are hito 3.

## Scope

### In Scope
- Popup opened via the action (`action.default_popup`, second esbuild entry).
- Provider list: usage/value from the last refresh cycle, tier when available, per-provider error state.
- Key management: add (validated via `core/credentials.ts`), masked display (≤4-char suffix), revoke per provider.
- Popup opens with current data reflecting the badge cycle (mechanism = design decision).
- Qwen: BSS balance semantics + AK/SK hint (DashScope `sk-` rejected) from existing validation guidance.

### Out of Scope
- Live API calls (hito 3), options page, i18n beyond English, theming beyond minimal styling, Firefox/Edge.

## Capabilities

### New Capabilities
- `popup-ui`: action popup — provider usage/tier/error over last-cycle data, masked key management with validation and revoke, Qwen AK/SK hint, fixture-only.

### Modified Capabilities
None. The popup consumes `key-storage` (masked read/revoke), `provider-framework` (validation guidance), and `usage-badge` (cycle data) without changing spec-level requirements.

## Approach

UI-first over the existing core: a popup entry renders the registry (zai, qwen, openai, kimi) from last-cycle results and obtains fresh data from the worker via an extended `BrowserApi` port (messaging not yet in the port; design decides). Vanilla TypeScript DOM, no new runtime deps. Security invariants: keys masked everywhere except the input while typing/pasting; full key never in DOM/logs; persistence only via `storage/key-store.ts` (`chrome.storage.local`, `qd:key:{id}`).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `extension/public/manifest.json` | Modified | `action.default_popup` |
| `extension/build.mjs` | Modified | second entry → popup bundle |
| `extension/src/popup/` | New | provider list, key management, Qwen hint |
| `extension/src/platform/browser-api.ts`, `src/testing/fake-browser.ts` | Modified | port surface for popup↔worker data |
| `extension/src/background.ts` | Modified | expose last-cycle results |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Full key leaks into DOM/logs | Medium | Tests assert full key absent from rendered output |
| Worker asleep when popup opens → stale data | Medium | Capability pins "opens with current cycle data"; design picks mechanism + fallback |
| Port extension breaks hermetic suite | Low | Follow AD-1 injected-port pattern; extend FakeBrowser |
| Review budget overrun (UI + tests) | Medium | Tasks phase forecasts 400-line budget; chain PRs if High |

## Rollback Plan

Stacked branch, nothing merged. Revert: remove `default_popup` from the manifest, drop the popup entry from `build.mjs`, delete `extension/src/popup/` plus port/worker additions. No storage-schema change — `qd:key:{id}` entries survive.

## Dependencies

- Base branch `feature/hito-1-spike-y-esqueleto`.
- Specs (source of truth): `key-storage`, `provider-framework`, `usage-badge`, `network-allowlist`.
- esbuild multi-entry; vitest (strict TDD: `npm --prefix extension run test`).

## Success Criteria

- [ ] Tests green; popup suites prove masked display, validation surfacing (empty + Qwen `sk-` → AK/SK guidance), revoke isolation, last-cycle render with tier/error.
- [ ] Build emits popup entry + manifest with `default_popup`; typecheck clean.
- [ ] Full key never appears in rendered popup output (test-asserted).
- [ ] Unpacked load: action click opens popup with fixture data matching the badge cycle.
