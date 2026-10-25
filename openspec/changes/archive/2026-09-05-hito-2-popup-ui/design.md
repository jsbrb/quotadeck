# Design: Hito 2 — Popup UI (Fixture-Only)

## Technical Approach

Extend the hito-1 skeleton (AD-1..AD-9) with a second MV3 page: `popup.html` + bundled `popup.js`. The worker becomes the single writer of a key-free cycle snapshot under `qd:snapshot` — written once per completed refresh cycle, next to the unchanged badge updates. The popup is a pure reader plus key-management surface over the SAME injected ports (`BrowserApi.storage.local`), rendering through pure string-producing view functions with a thin controller wiring DOM events. No runtime dependencies; `happy-dom` is added as a dev-only test environment for the controller suite via a per-file pragma. Zero `BrowserApi` surface change, zero `FakeBrowser` change — the snapshot flows through the existing `StorageArea` port, preserving hermeticity by construction.

Maps to proposal §Approach ("UI-first over the existing core") and implements every `popup-ui` delta-spec requirement; consumes `key-storage`, `provider-framework`, `usage-badge` unmodified.

## Architecture Decisions

Numbering continues the project sequence (hito-1 = AD-1..AD-9).

### AD-10: Popup data = worker-persisted cycle snapshot; no runtime messaging

**Choice**: `refreshTick` collects per-provider outcomes and writes ONE `CycleSnapshot` to `storage.local` key `qd:snapshot` after each completed cycle. The popup reads that key directly on open. Badge callbacks untouched.
**Alternatives**: (a) `runtime.sendMessage` popup→worker — rejected: the worker currently discards per-provider results, so messaging still needs persistent state or a re-run; waking a dead MV3 worker adds keep-alive complexity, and the ZAI jitter window (500–2000 ms/page) would stall popup open behind a spinner. (b) Popup imports `RefreshEngine` and refreshes itself — rejected: a popup-run cycle is a DIFFERENT cycle than the badge's, breaking "displayed data equals that cycle's normalized results"; it also gives the popup a scheduling/network path the spec forbids. (c) `storage.onChanged` live updates while open — rejected: no spec scenario requires it; reopening reads fresh data anyway (staleness bounded by the 1-minute alarm period).
**Rationale**: popup-ui §Current Cycle Data on Open pins "most recent completed cycle, without waiting for a new cycle" — the snapshot IS that cycle. The `storage` permission is already granted; worker-writes/page-reads is the standard MV3 answer to the worker-asleep reality. A single-key write makes cycle semantics atomic — a reader can never observe half a cycle.

### AD-11: Pure string view + injected-document controller; happy-dom as DEV-only test environment

**Choice**: `popup/view.ts` = pure functions (`renderPopup(state): string`, formatters, `escapeHtml`) tested in the existing node environment. `popup/controller.ts` = `startPopup({ browser, document })` owning state and events, tested under happy-dom via a `// @vitest-environment happy-dom` file pragma. `popup/main.ts` is the boot-guarded entry (same `typeof chrome !== 'undefined'` pattern as `background.ts`). No runtime deps; `happy-dom` lands in devDependencies only — esbuild never bundles it (the popup imports only its own code).
**Alternatives**: (a) jsdom — rejected: heavier and slower; happy-dom covers everything a popup needs (no layout). (b) Hand-rolled fake `Document` — rejected: reinvents a DOM to avoid one dev dependency. (c) Render-to-string only, mount layer untested — rejected: the riskiest logic (validation flow, persistence calls, input clearing, masked re-render) lives in event handlers; leaving them untested guts strict TDD. (d) `environmentMatchGlobs`/projects in `vitest.config.ts` — avoided: the per-file pragma is stable across vitest versions and leaves the config byte-identical for the existing 13 suites.
**Rationale**: strict_tdd demands RED→GREEN per unit; DOM units need a real DOM to dispatch submit/click. The split keeps view tests in node (determinism = `strictEqual` on strings) and confines the DOM environment to exactly one file. `tsconfig.json` gains `"DOM"` in `lib` (types-only; no runtime effect on worker code).

### AD-12: BrowserApi unchanged; SnapshotStore is a storage wrapper, not a port extension

**Choice**: The popup's entire browser surface is `BrowserApi.storage.local` — already on the port. New `storage/snapshot-store.ts` (beside `key-store.ts`) defines `CycleSnapshot` + `SnapshotStore` over the injected `StorageArea`. `platform/browser-api.ts` and `testing/fake-browser.ts` are NOT modified.
**Alternatives**: (a) Extend BrowserApi with `runtime` messaging (sendMessage/onMessage) plus a FakeRuntimeMessaging double — rejected: unnecessary once AD-10 picks storage; every port member is test surface to maintain. (b) Read/write the raw key `qd:snapshot` inline in popup and worker — rejected: bypasses a typed wrapper; `key-store.ts` already establishes the wrapper-per-namespace pattern.
**Rationale**: hermeticity is preserved by construction — `FakeStorageArea` already implements `StorageArea` with recording, and its `snapshot()` hook proves WHERE data lives (`qd:snapshot` vs `qd:key:*`). Smallest possible diff on the AD-1 seam; the popup also stays off `.sync` (assertable via the existing fake).

### AD-13: refreshTick writes the snapshot post-cycle; error entries carry no payload

**Choice**: The `refreshAll` callbacks accumulate `results[providerId]`; after `refreshAll` resolves, one `SnapshotStore.write({ results })`. Success entry: `{ status: 'ok', usage }`. Error entry: `{ status: 'error' }` — the thrown value is dropped.
**Alternatives**: (a) Write per-provider entries as they arrive — rejected: mid-cycle readers could see half a cycle; N writes instead of 1. (b) Store `error.toString()` — rejected: error text is an untrusted surface; anything that leaks into it would flow into storage and then into rendered DOM (AD-3 defense-in-depth spirit).
**Rationale**: badge behavior stays byte-identical (badges still stream per result during the cycle); the snapshot adds exactly one storage write per cycle. Unkeyed providers simply have no entry — the popup renders its own "no key" state from `KeyStore`, independent of the snapshot. A provider keyed AFTER the last cycle shows "stored key, awaiting next cycle" — accurate, not stale.

### AD-14: Build = second esbuild entry + static popup.html; MV3 CSP means zero inline script

**Choice**: `build.mjs` gains a second `build()` call: `src/popup/main.ts` → `dist/popup.js` (iife, `chrome120`, bundle, `minify: false` — same flags as the worker). `public/popup.html` (copied to `dist/`) is a static shell: `<main id="app">` + `<script src="popup.js"></script>` + an inline `<style>` block (CSP-legal). Manifest gains `action.default_popup: "popup.html"`.
**Alternatives**: (a) One multi-entry build with `outdir`/`outbase` — rejected vs two explicit calls: keeps the existing single-outfile call untouched and yields a flat `dist/popup.js` without path-restructuring surprises. (b) Inline `<script>` in popup.html — FORBIDDEN: the MV3 extension-page CSP (`script-src 'self'`) blocks inline scripts AND inline event-handler attributes; all behavior must live in the bundled file. (c) Separate `popup.css` — rejected: one more copy step for ~15 lines; inline `<style>` elements are CSP-permitted.
**Rationale**: the proposal pins `default_popup` + second entry; CSP compliance is structural (there is no inline code to review). No new permissions — popup pages need none beyond the existing `storage`.

### AD-15: Key-handling invariants are structural, not conventions

**Choice**: (1) The popup's ONLY credential reads go through `KeyStore.readMaskedKey` — the controller never calls `readKey`. (2) The full key lives exclusively in `<input type="password" autocomplete="off">` while entering; on SUCCESSFUL submit the input is cleared (invalid submissions keep the text — the user is still editing — which stays within "during entry"). (3) Masked display comes solely from the storage wrapper's display read (`••••` + ≤4-char suffix via existing `MASK_SUFFIX_LENGTH`). (4) The `CycleSnapshot` type contains no credential field — keys cannot leak through it. (5) The controller logs nothing.
**Alternatives**: render-time regex scrubbing of full keys — rejected as a PRIMARY mechanism (a convention can be forgotten); kept only as TEST assertions ("full key absent from rendered output").
**Rationale**: popup-ui §Masked Key Display + proposal risk table; mirrors AD-3's structural-first, scan-second defense-in-depth.

## Data Flow

    alarm tick ──▶ refreshTick ──write──▶ qd:snapshot        (worker; key-free, atomic per cycle)
    popup open ──▶ SnapshotStore.read() ───────────┐
             └───▶ KeyStore.readMaskedKey(id) × 4 ─┴─▶ PopupState ──▶ view.ts (pure) ──▶ #app

    qd:key:{id} ◀──save / revoke── popup controller (same KeyStore wrapper the worker reads)

## Sequence Diagram — popup open → render → key management (config rule)

```mermaid
sequenceDiagram
    participant BG as background.refreshTick
    participant ST as storage.local (BrowserApi)
    participant PU as popup/main.ts
    participant CT as popup/controller.ts
    participant SS as SnapshotStore
    participant KS as KeyStore

    Note over BG,ST: every alarm tick (badge path unchanged)
    BG->>ST: set("qd:snapshot", { results }) — one write per completed cycle

    Note over PU,CT: user clicks the action
    PU->>CT: startPopup({ browser: ChromeBrowserApi, document })
    CT->>SS: read()
    SS->>ST: get("qd:snapshot")
    ST-->>CT: CycleSnapshot | undefined (undefined ⇒ empty state)
    CT->>KS: readMaskedKey(id) × 4 (registry order)
    KS-->>CT: "••••cdef" | undefined
    CT->>CT: renderPopup(state) → #app.innerHTML (pure view)
    Note over CT: full key exists only in the input while typing

    CT->>CT: submit(value)
    CT->>CT: validateCredential(provider.credentialType, value)
    alt invalid (empty / qwen "sk-…")
        CT->>CT: render guidance (QWEN_AK_SK_GUIDANCE via result) — no storage write
    else valid
        CT->>KS: saveKey(id, value)
        CT->>KS: readMaskedKey(id)
        CT->>CT: clear input; re-render masked — full key leaves the DOM
    end

    CT->>CT: revoke(id)
    CT->>KS: revokeKey(id)
    CT->>KS: readMaskedKey × remaining (isolation)
    CT->>CT: re-render — other providers untouched
```

## Project Layout (additions)

```
extension/
├── build.mjs                        # + second entry src/popup/main.ts → dist/popup.js; copy popup.html
├── tsconfig.json                    # lib += "DOM" (types for popup code; typecheck script unchanged)
├── package.json                     # + devDependency happy-dom (test-only, never bundled)
├── public/
│   ├── manifest.json                # action.default_popup = "popup.html"
│   └── popup.html                   # NEW static shell: #app + external popup.js + inline <style>
└── src/
    ├── popup/                       # NEW
    │   ├── main.ts                  # entry; boot guard; startPopup(new ChromeBrowserApi(), document)
    │   ├── controller.ts            # startPopup(deps): state, snapshot+masked loads, submit/revoke wiring
    │   ├── view.ts                  # pure: renderPopup(state), formatUsageText, escapeHtml
    │   ├── view.test.ts             # node env (default)
    │   └── controller.test.ts       # happy-dom via file pragma
    ├── storage/
    │   ├── snapshot-store.ts        # NEW CycleSnapshot + SnapshotStore ("qd:snapshot")
    │   └── snapshot-store.test.ts   # NEW
    ├── background.ts                # refreshTick collects results → one snapshot write
    ├── background.test.ts           # + snapshot assertions (badge assertions unchanged)
    └── core/usage.ts                # export the currency-symbol helper for popup display reuse
```

Explicitly unchanged: `platform/browser-api.ts`, `testing/fake-browser.ts`, `storage/key-store.ts`, `core/credentials.ts`, `vitest.config.ts`, all providers/fixtures (AD-12).

## Interfaces / Contracts

```ts
// storage/snapshot-store.ts
export const SNAPSHOT_STORAGE_KEY = 'qd:snapshot';

export type ProviderSnapshotEntry =
  | { readonly status: 'ok'; readonly usage: NormalizedUsage }
  | { readonly status: 'error' };                       // no payload (AD-13)

export interface CycleSnapshot {
  readonly results: Readonly<Partial<Record<ProviderId, ProviderSnapshotEntry>>>;
}                                                       // absent id ⇔ no key at cycle time

export class SnapshotStore {
  constructor(local: StorageArea);                      // same injected-area pattern as KeyStore
  write(snapshot: CycleSnapshot): Promise<void>;        // single set() — atomic cycle
  read(): Promise<CycleSnapshot | undefined>;           // shape-validated; undefined = no cycle yet
}

// popup/view.ts (pure; no imports beyond core types + usage helpers)
export interface PopupState {
  readonly snapshot: CycleSnapshot | undefined;
  readonly keyStates: Readonly<Record<ProviderId, string | undefined>>; // masked form or absent
  readonly guidance: Readonly<Partial<Record<ProviderId, string>>>;     // last validation message per row
}
export function renderPopup(state: PopupState): string;  // deterministic; escapes dynamic text (tier)
export function formatUsageText(usage: NormalizedUsage): string; // reuses exported currency-symbol map

// popup/controller.ts
export interface PopupDeps { readonly browser: BrowserApi; readonly document: Document; }
export function startPopup(deps: PopupDeps): void;       // renders; wires submit + revoke; re-renders

// background.ts (refreshTick, extended)
//   callbacks also accumulate results; after refreshAll: await new SnapshotStore(browser.storage.local).write({ results })
```

Provider metadata (id order, `displayName`, `credentialType`) comes from `createDefaultRegistry()` — single source (AD-6); provider modules are pure, so importing them into the popup bundle adds no I/O. Validation messages (including the Qwen AK/SK hint) render verbatim from `validateCredential` — no duplicated guidance text.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `extension/src/popup/main.ts` | Create | Boot-guarded popup entry (mirrors background.ts guard) |
| `extension/src/popup/controller.ts` | Create | `startPopup(deps)`: load snapshot + masked keys, render, wire submit/revoke |
| `extension/src/popup/view.ts` | Create | Pure render functions + `escapeHtml` + usage formatting |
| `extension/src/popup/view.test.ts` | Create | Node-env render tests (list, tier, error, determinism, masking, empty state) |
| `extension/src/popup/controller.test.ts` | Create | happy-dom flow tests (open, submit paths, revoke isolation, key-absence sweep) |
| `extension/src/storage/snapshot-store.ts` | Create | `CycleSnapshot` + `SnapshotStore` over injected area |
| `extension/src/storage/snapshot-store.test.ts` | Create | Round-trip, key location, shape rejection, absent read |
| `extension/public/popup.html` | Create | Static shell; external script only (AD-14 CSP) |
| `extension/public/manifest.json` | Modify | `action.default_popup: "popup.html"` |
| `extension/build.mjs` | Modify | Second `build()` call → `dist/popup.js`; copy `popup.html` |
| `extension/src/background.ts` | Modify | `refreshTick` accumulates results + one snapshot write (badge path untouched) |
| `extension/src/background.test.ts` | Modify | Assert snapshot content + single write per tick; existing badge assertions stay green |
| `extension/src/core/usage.ts` | Modify | Export the currency-symbol helper (popup display reuses it; logic unchanged) |
| `extension/tsconfig.json` | Modify | `lib: ["ES2022", "DOM"]` |
| `extension/package.json` | Modify | devDependency `happy-dom` |

## Testing Strategy (strict TDD — RED→GREEN per unit)

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit — snapshot store | Round-trip; lives at `qd:snapshot` (via `FakeStorageArea.snapshot()`); malformed stored shape → `undefined`; absent → `undefined` | Node env, `FakeBrowser.local` |
| Unit — worker tick | Tick writes ONE snapshot: ok entries with usage, error entry for failed provider, unkeyed absent; badge texts unchanged from hito-1 | Fire `FakeAlarms.fire('usage-refresh')` on existing background test harness |
| Unit — view (pure) | All four providers rendered with value+currency; tier only when present; per-provider error indication; deterministic (render twice → `strictEqual`); masked `••••cdef` forms; empty-snapshot state; `escapeHtml` on fixture-sourced `tier` | Node env; string assertions |
| Unit — controller (DOM) | Open renders snapshot data; valid `openai` key persists via wrapper + input cleared + masked shown; empty input → guidance, nothing persisted; qwen `sk-` → AK/SK guidance, nothing persisted; revoke `kimi` → absence; revoke `zai` → `kimi` untouched; FULL KEY absent from `document.body.textContent` after submit | happy-dom pragma; `startPopup({ browser: FakeBrowser, document })`; dispatch real submit/click events |
| E2E | Unpacked load: action opens popup, fixture data matches the badge cycle | Manual (success criterion); no automation this milestone |

**What a RED UI unit looks like** — first controller test, before `controller.ts` exists:

```ts
// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { startPopup } from './controller';
import { FakeBrowser } from '../testing/fake-browser';

it('valid openai key persists via the wrapper; full key leaves the DOM', async () => {
  const browser = new FakeBrowser();
  document.body.innerHTML = '<main id="app"></main>';
  startPopup({ browser, document });
  const input = document.querySelector<HTMLInputElement]('#key-input-openai')!;
  input.value = 'sk-admin-abcdefgh1234';
  document.querySelector<HTMLButtonElement>('#key-add-openai')!.click();
  await Promise.resolve(); // flush async save/re-render
  expect(browser.local.snapshot()['qd:key:openai']).toBeDefined();
  expect(document.body.textContent).not.toContain('sk-admin-abcdefgh1234');
});
```

RED: `./controller` does not exist → import fails → suite red. GREEN: minimal `startPopup` + submit handler. Every unit follows this rhythm — the test file lands first in each task.

Hermeticity/no-network: the popup imports no transport/network module (structural — nothing in `src/popup/` may import `src/network/` or `src/fixtures/`), and the controller suite runs with zero network doubles, proving §Fixture-Only Operation by construction.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. (Key handling is covered by AD-15 structural constraints + the DOM sweep tests above.)

## Migration / Rollout

No migration. `qd:snapshot` is additive; `qd:key:{id}` entries are untouched. Rollback per proposal (remove `default_popup`, drop popup entry, delete `src/popup/` + snapshot additions).

## Review Budget Note

Estimated authored footprint ≈ 600–700 lines including tests (controller + its happy-dom suite dominate). Against the 400-line budget that is **Medium-High** — `sdd-tasks` must run the forecast and expect chained PRs. Natural slice: (1) `SnapshotStore` + worker write + background tests; (2) popup view/controller/build/manifest wiring.

## Open Questions

None blocking. Future work (explicitly out of scope): `storage.onChanged` live refresh while the popup is open; per-provider badge rotation.
