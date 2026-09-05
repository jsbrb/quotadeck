# quotadeck

A browser extension badge that tracks AI provider usage and balances — ZAI
(Zhipu AI), Qwen (Alibaba Cloud), OpenAI and Kimi (Moonshot AI).

**Status: skeleton, fixture-only.** The extension is a working Manifest V3
service worker plus action popup whose refresh data comes entirely from
recorded fixtures bundled into the worker. No live provider calls are made in
this milestone; live transport arrives in a later milestone behind the same
seam. See
[`openspec/changes/hito-1-extension-skeleton/`](openspec/changes/hito-1-extension-skeleton/)
and
[`openspec/changes/hito-2-popup-ui/`](openspec/changes/hito-2-popup-ui/)
for the change specs and designs.

## Load unpacked

1. Build once (dependencies are dev-only; installs are local):
   ```sh
   npm --prefix extension install
   npm --prefix extension run build
   ```
2. Open `chrome://extensions`, enable **Developer mode**, click **Load
   unpacked**, and select the `extension/dist` directory.
3. The worker registers a `usage-refresh` alarm (1-minute period) on install
   and on startup. Only providers with a stored credential refresh.
4. Clicking the toolbar action opens the popup. It shows the last completed
   refresh cycle — per-provider usage with currency, the ZAI tier when
   present, and an error indication for failed providers — exactly the data
   the badges rendered for that cycle (fixture-driven in this milestone).
5. Manage keys from the popup itself (no console needed): paste a credential
   and **Save key**. Invalid input is rejected with guidance — notably,
   DashScope `sk-` keys are rejected for Qwen with the Alibaba Cloud AK/SK
   (RAM `bss:DescribeAcccount`) hint — and stored keys display masked
   (`••••` + at most 4 trailing characters). **Revoke** removes one
   provider's key without touching the others.

## Popup security notes

- The popup displays keys exclusively in masked form (`KeyStore.readMaskedKey`
  — the popup never reads a full key), clears the input field the moment a
  key is accepted, and keeps the full key out of rendered output at all times
  (enforced by DOM-sweep tests).
- The popup has no network path: it reads the worker-persisted cycle snapshot
  from `chrome.storage.local` (`qd:snapshot`) and imports no transport or
  fixture-reading code (enforced by a structural import test).
- `popup.html` is CSP-legal for MV3: external `popup.js` only, no inline
  script or event-handler attributes.

## npm scripts

Run from the repository root:

| Command | Description |
| --- | --- |
| `npm --prefix extension run build` | esbuild: bundle `extension/src/background.ts` → `extension/dist/background.js` (fixtures inlined) and `extension/src/popup/main.ts` → `extension/dist/popup.js`, copy the MV3 manifest + `popup.html` |
| `npm --prefix extension run test` | vitest: hermetic unit suite (no Chrome runtime, no network) |
| `npm --prefix extension run typecheck` | `tsc --noEmit` (strict) |

## Security posture

- **Zero runtime npm dependencies** — the toolchain (TypeScript, esbuild,
  vitest, happy-dom for the DOM test environment) is dev-only and nothing is
  bundled but first-party code and fixture JSON.
- **No `host_permissions`** — the manifest requests only `storage` and
  `alarms`. Provider hosts are constrained by the allowlist in
  [`docs/spike/endpoints.md`](docs/spike/endpoints.md), which is
  single-sourced by that document and enforced by a sync test.
- **Credentials only in `chrome.storage.local`** under `qd:key:{providerId}`
  — never `storage.sync`, never `localStorage` — and attached to requests
  exclusively as the `Authorization` header (enforced structurally by the
  request types and dynamically by a credential-placement scan).
- **Fixture-only network path** — the worker's transport serves recorded
  fixtures; unrouted URLs throw rather than fall back to the network.

## Documentation

- [`docs/spike/endpoints.md`](docs/spike/endpoints.md) — per-provider endpoint
  evidence and the machine-readable host allowlist.
- [`openspec/`](openspec/) — specifications, change proposals, designs and
  task ledgers (spec-driven workflow).
- [`LICENSE`](LICENSE) — MIT.
