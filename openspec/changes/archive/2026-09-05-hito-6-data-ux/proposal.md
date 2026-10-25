# Proposal: Data-First Popup — Hero Percentage, Manual Refresh, Keyless Filtering

## Intent

The popup buries its key number: the ZAI 5h percentage renders mid-card in normal weight, data can lag the badge by up to a minute with no way to force a refresh, and keyless providers render "No cycle data yet" noise cards. Ship the three maintainer-ratified decisions with zero data-flow, badge, or dependency changes.

## Scope

### In Scope

- **Dual percentage hero** (ratified): the card's primary usage percentage (ZAI: the 5h window) renders BOTH as the card's largest, boldest element above all other content AND inside/over its threshold bar — the same number twice. Secondary info (window label, used/total, countdown) renders below in normal weight. Applies only where a percentage exists — monetary cards keep the balance as leading figure (no synthesized percentages, existing rule intact). The maintainer may later trim to one variant; each element is independently assertable, so trimming is a light spec edit.
- **Manual refresh** (ratified): a main-view header affordance triggers a one-shot `chrome.alarms.create('refresh-now', { when: now + 1ms })` handled by the existing worker `onAlarm` tick path — no new messaging architecture; AD-10 storage-snapshot design preserved. The popup then re-reads the snapshot (short-delay re-read vs storage-change listener is pinned in the design phase; keep it simple).
- **Keyless filtering** (ratified): providers without a stored credential render no card on the main view ("No cycle data yet" dies); Settings keeps showing all four providers unchanged — that is where keys are entered.

### Out of Scope

Qwen remediation (separate change, blocked on maintainer diagnostics), dark mode, new dependencies, data-flow/architecture changes, badge behavior changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `popup-ui`: MODIFIED §Provider List Rendering — dual hero-percentage layout, and main-view card set limited to providers with a stored credential (reconciles "one card per registered provider"); ADDED §Manual Refresh Control — header affordance → immediate refresh via the one-shot alarm → snapshot re-read
- `usage-badge`: ADDED requirement — the one-shot `refresh-now` alarm drives the same refresh tick as the periodic alarm; periodic `usage-refresh` registration and 1-minute cadence unchanged

## Approach

Markup and wiring only. `view.ts` stays pure (AD-22): `renderMain` filters on `state.keyStates` (already loaded via `KeyStore.readMaskedCredential` — no new reads); hero and in-bar percentages are deterministic markup. Controller wires `data-action="refresh"` through the injected `BrowserApi.alarms`; `background.ts` adds a `refresh-now` branch to the existing `onAlarm` listener calling the same `refreshTick`. `BrowserAlarms.create` widens to accept `{ when }` (port, `ChromeBrowserApi`, `FakeAlarms`); `manifest.json` already grants `alarms`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `extension/src/popup/view.ts` | Modified | Hero %, in-bar %, keyless main-view filter |
| `extension/src/popup/controller.ts` | Modified | Refresh action → one-shot alarm → snapshot re-read |
| `extension/src/background.ts` | Modified | `refresh-now` alarm branch → same `refreshTick` |
| `extension/src/platform/browser-api.ts` | Modified | `create` info type accepts one-shot `{ when }` |
| `extension/src/testing/fake-browser.ts` | Modified | `FakeAlarms` one-shot support |
| `extension/public/popup.html` | Modified | Hero + refresh button styles |
| `extension/src/popup/view.test.ts`, `popup/controller.test.ts`, `background.test.ts` | Modified | New assertions for all three behaviors |
| `openspec/changes/hito-6-data-ux/specs/{popup-ui,usage-badge}/spec.md` | New | Spec-phase deltas |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Dual % crowds the 320px card | Med | Maintainer trims visually later; hero and in-bar % are separately assertable |
| Re-read timing (delay vs storage-change) unpinned | Low | Ratified as a design-phase decision; both options preserve AD-10 |
| One-shot alarm disturbs the periodic schedule | Low | Distinct alarm name; spec scenario + tests pin registration and cadence unchanged |
| Exceeds 400-line review budget | Med | Six source/test files touched; tasks phase forecasts, chained PR fallback |

## Rollback Plan

All work sits unmerged on `feature/hito-6-data-ux` (no remote), stacked on hito-5: revert or reset the branch to the hito-5 base. No storage, snapshot, provider, or manifest changes; main specs untouched until archive — nothing to migrate.

## Dependencies

None — no new packages; the `alarms` permission already exists in `manifest.json`.

## Success Criteria

- [ ] View tests: hero element renders the uncapped 5h percentage as the card's largest bold figure above card content, and the threshold bar carries the same percentage
- [ ] View tests: keyless provider absent from main-view output; still present in settings output
- [ ] Controller tests: refresh click creates the one-shot alarm (`refresh-now`, `{ when: now + 1ms }`); the snapshot re-read follows
- [ ] Background tests: firing `refresh-now` runs one refresh tick plus snapshot write; periodic alarm registration and 1-minute period unchanged
- [ ] Determinism: identical `PopupState` → byte-identical output, both views
- [ ] `npm --prefix extension run test` / `typecheck` / `build` green; `package.json` dependencies unchanged
