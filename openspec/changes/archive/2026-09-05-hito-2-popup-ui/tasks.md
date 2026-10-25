# Tasks: Hito 2 — Popup UI (Fixture-Only)

## Review Workload Forecast

Estimated changed lines: 600–700 authored (design; controller suite dominates) — +200–300 over the 400-line budget.
Chained PRs: Yes — two slices per design pre-plan.
Delivery strategy: ask-on-risk.
Feature-branch-chain suggested; user decides.

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Work Units

- Unit 1 (Slice 1 / PR 1): SnapshotStore + worker write; badge byte-identical. Test: `npm --prefix extension run test -- src/storage/snapshot-store.test.ts src/background.test.ts`. Harness: N/A — hermetic vitest; E2E manual per design. Rollback: revert snapshot-store.* + background.*.
- Unit 2 (Slice 2 / PR 2): popup view + controller + wiring. Test: `npm --prefix extension run test -- src/popup/view.test.ts src/popup/controller.test.ts`. Harness: manual unpacked load: popup opens, matches badge cycle. Rollback: delete src/popup/ + public/popup.html; revert build/manifest/tsconfig/package/usage.

## Phase 1: SnapshotStore + Worker Write (Slice 1)

- [x] 1.1 RED — create `extension/src/storage/snapshot-store.test.ts` (§Current Cycle): round-trip at `qd:snapshot`; malformed → `undefined`; absent → `undefined`. Verify fakes in `extension/src/testing/fake-browser.ts` (read-only; verified: `snapshot()`, `fire()`)
- [x] 1.2 GREEN — create `extension/src/storage/snapshot-store.ts` (AD-10/AD-12): `SNAPSHOT_STORAGE_KEY`, `ProviderSnapshotEntry`, `CycleSnapshot`, `SnapshotStore` over injected `StorageArea`
- [x] 1.3 RED — extend `extension/src/background.test.ts`: fire `usage-refresh`; assert ONE `qd:snapshot` write per tick (ok entries carry usage; failed → error entry; unkeyed absent); badge assertions unchanged
- [x] 1.4 GREEN — modify `extension/src/background.ts` `refreshTick` (AD-13): accumulate results; single `SnapshotStore.write` after `refreshAll`; badge path byte-identical

## Phase 2: Popup View (Slice 2)

- [x] 2.1 RED — create `extension/src/popup/view.test.ts` (§Provider List, §Masked Display): 4 providers, value+currency; tier only when present; per-provider error; strictEqual determinism; masked `••••cdef`; empty state; `escapeHtml` on `tier`
- [x] 2.2 GREEN — create `extension/src/popup/view.ts` (`renderPopup`, `formatUsageText`, `escapeHtml`, `PopupState`); export `currencySymbol` in `extension/src/core/usage.ts` (logic unchanged)

## Phase 3: Popup Controller (Slice 2)

- [x] 3.1 Add devDependency `happy-dom` to `extension/package.json` (dev-only)
- [x] 3.2 RED — create `extension/src/popup/controller.test.ts` with `// @vitest-environment happy-dom` pragma (§Current Cycle, §Key Addition, §Revocation): open renders snapshot; valid openai key → wrapper persists, input cleared, masked shown, full key absent from `document.body.textContent`; empty or qwen `sk-` → guidance, nothing persisted; revoke `kimi` → absence; revoke `zai` keeps `kimi`. Invalid submit MAY retain input text — spec bars full key only outside input
- [x] 3.3 GREEN — create `extension/src/popup/controller.ts` `startPopup(deps)` (AD-15): reads via `readMaskedKey` ONLY — no `readKey` import; wires submit/revoke; re-renders; logs nothing
- [x] 3.4 GREEN — create `extension/src/popup/main.ts`: boot guard + `startPopup(new ChromeBrowserApi(), document)`

## Phase 4: Wiring + Docs (Slice 2)

- [x] 4.1 Create `extension/public/popup.html` (AD-14): `<main id="app">` + external `popup.js` + inline `<style>`; no inline script/handlers
- [x] 4.2 Modify `extension/build.mjs`: second `build()` — `src/popup/main.ts` → `dist/popup.js`; copy `popup.html`
- [x] 4.3 Modify `extension/public/manifest.json` (`action.default_popup: "popup.html"`) + `extension/tsconfig.json` (lib += `DOM`)
- [x] 4.4 Update `README.md`: popup surface, key management, masked display, fixture-only scope
- [x] 4.5 Gate (§Fixture-Only): `npm --prefix extension run test` (original 74 green) + `typecheck` + `build`; no popup import of network/ or fixtures/ code
