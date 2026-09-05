# quotadeck

A browser extension badge that tracks AI provider usage and balances — ZAI
(Zhipu AI), Qwen (Alibaba Cloud), OpenAI and Kimi (Moonshot AI).

**Status: skeleton, fixture-only.** The extension is a working Manifest V3
service worker whose refresh data comes entirely from recorded fixtures
bundled into the worker. No live provider calls are made in this milestone;
live transport arrives in a later milestone behind the same seam. See
[`openspec/changes/hito-1-extension-skeleton/`](openspec/changes/hito-1-extension-skeleton/)
for the change spec and design.

## Load unpacked

1. Build once (dependencies are dev-only; installs are local):
   ```sh
   npm --prefix extension install
   npm --prefix extension run build
   ```
2. Open `chrome://extensions`, enable **Developer mode**, click **Load
   unpacked**, and select the `extension/dist` directory.
3. The worker registers a `usage-refresh` alarm (1-minute period) on install
   and on startup. Only providers with a stored credential refresh — there is
   no options UI yet, so seed a key from the service worker console
   (chrome://extensions → quotadeck → "service worker" link):
   ```js
   chrome.storage.local.set({ 'qd:key:kimi': 'fixture-milestone-key' });
   ```
4. The badge updates on every alarm tick from fixture data (e.g. `¥89` for
   Kimi). A failed refresh shows `ERR` until the next successful tick.

## npm scripts

Run from the repository root:

| Command | Description |
| --- | --- |
| `npm --prefix extension run build` | esbuild: bundle `extension/src/background.ts` → `extension/dist/background.js` (fixtures inlined) and copy the MV3 manifest |
| `npm --prefix extension run test` | vitest: hermetic unit suite (no Chrome runtime, no network) |
| `npm --prefix extension run typecheck` | `tsc --noEmit` (strict) |

## Security posture

- **Zero runtime npm dependencies** — the toolchain (TypeScript, esbuild,
  vitest) is dev-only and nothing is bundled but first-party code and fixture
  JSON.
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
