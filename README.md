# quotadeck

A browser extension badge that tracks AI provider usage and balances. The
public Chrome Web Store release is a **GLM-only build**: only the ZAI (Zhipu
AI) provider — the GLM Coding Plan — ships. The Qwen (Alibaba Cloud), OpenAI
and Kimi (Moonshot AI) implementations are retained in source but stay
unshipped: they never register in the worker, never render in the popup, and
are granted no host permissions.

**Status: v0.2.0 — GLM-only store release.** The extension is a working
Manifest V3 service worker plus action popup that fetches real usage data
every minute through an allowlist-constrained network client. ZAI usage comes
from the official monitor endpoint (`GET /api/monitor/usage/quota/limit`):
plan level, the 5h and weekly token windows with an uncapped percentage, and
the monthly MCP window. The vitest suite stays
hermetic (recorded fixtures + injected transports — no network in tests); live
behavior is proven by contract tests over the request shapes and by a short
maintainer live check. See the `openspec/` change ledgers for the change
specs and design.

## Load unpacked

1. Build once (dependencies are dev-only; installs are local):
   ```sh
   npm --prefix extension install
   npm --prefix extension run build
   ```
2. Open `chrome://extensions`, enable **Developer mode**, click **Load
     unpacked**, and select the `extension/dist` directory. The shipped
     `host_permissions` cover exactly the two ZAI monitor hosts (`api.z.ai`
     and `open.bigmodel.cn` — see Security posture below); if you upgrade
     from an earlier multi-provider build, reload the extension so Chrome
     re-prompts for the narrowed host permissions.
3. The worker registers a `usage-refresh` alarm (1-minute period) on install
   and on startup. Each tick fetches live usage for every shipped provider
   with a stored credential, with all time windows derived from an injectable
   clock; the badge shows the last successful result — for ZAI the 5h
   percentage (uncapped above 100) with the plan level as fallback.
4. The badge background is threshold-colored from that 5h percentage, so the
   state reads at a glance: neutral slate `#334155` below 50%, orange
   `#F97316` from 50%, deep orange `#EA580C` from 80%, red `#DC2626` from 90%
   (uncapped — 137% is still red). Badge text renders white on every band; a
   failed refresh shows `ERR` on the neutral slate until the next successful
   tick (≤1 minute).
5. Clicking the toolbar action opens the popup on the consumption view: the
   ZAI monitor block (plan level, the 5h window with its uncapped percentage,
   used/total and reset countdown, the weekly window, and the MCP window with
   per-tool rows) — exactly the data the badge rendered for that cycle.
   Failed refreshes show a per-class error label (`Auth failed`,
   `Rate limited`, …) in the card while the badge shows `ERR` — a bad or
   revoked key surfaces this way within one tick. A ZAI auth failure also
   shows the wrong-platform guidance, since a Z.AI key under the ZHIPU
   selection (or vice versa) is the most likely cause.
6. Manage keys through the **Settings** gear in the popup header (no console
   needed): paste the ZAI credential and **Save key**, or press **Enter** in
   the input. Invalid input is rejected with guidance, and stored keys
   display masked (`••••` + at most 4 trailing characters). **Revoke**
   removes the key. The ZAI section also carries the **platform selector**
   (Z.AI ↔ ZHIPU, default Z.AI): the choice persists as a non-secret local
   preference and switches the base URL of every ZAI monitor request
   (`api.z.ai` ↔ `open.bigmodel.cn`). The main view renders no key forms.

## Popup security notes

- The popup displays keys exclusively in masked form
  (`KeyStore.readMaskedCredential` — the popup never reads a full
  credential), clears the input fields the moment a credential is accepted,
  and keeps full keys out of rendered output at all times (enforced by
  DOM-sweep tests).
- The popup has no network path: it reads the worker-persisted cycle snapshot
  from `chrome.storage.local` (`qd:snapshot`) and imports no transport,
  fixture-reading or provider code (enforced by a structural import test —
  provider metadata comes from a popup-safe module, so no endpoint URLs ship
  to the page).
- `popup.html` is CSP-legal for MV3: external `popup.js` only, no inline
  script or event-handler attributes.

## npm scripts

Run from the repository root:

| Command | Description |
| --- | --- |
| `npm --prefix extension run build` | esbuild: bundle `extension/src/background.ts` → `extension/dist/background.js` and `extension/src/popup/main.ts` → `extension/dist/popup.js`, copy the MV3 manifest + `popup.html` + `icons/` |
| `npm --prefix extension run test` | vitest: hermetic unit suite (no Chrome runtime, no network) |
| `npm --prefix extension run typecheck` | `tsc --noEmit` (strict) |
| `npm --prefix extension run zip` | package the *contents* of `extension/dist` into `extension/quotadeck-v0.2.0.zip` for Chrome Web Store upload (`manifest.json` at the zip root). Windows PowerShell only: it uses the .NET `System.IO.Compression` API and writes every entry with a forward-slash path (`icons/icon16.png`), avoiding the backslash-separator hazard of `Compress-Archive`. The zip is gitignored — never commit it. |

## Security posture

- **Zero runtime npm dependencies** — the toolchain (TypeScript, esbuild,
  vitest, happy-dom for the DOM test environment) is dev-only and nothing is
  bundled but first-party code.
- **`host_permissions` = exactly the two shipped hosts** (`api.z.ai`,
  `open.bigmodel.cn`) — the ZAI (GLM) allowlist entries only. Live usage
  requires cross-origin fetch from the worker, so the manifest grants the
  per-provider allowlist **filtered to the shipped providers**
  (`SHIPPED_PROVIDER_IDS`) and nothing more: a sync test derives the expected
  patterns from that shipped-filtered union and fails the build if the
  manifest ever diverges, while the full multi-provider allowlist stays
  single-sourced in [`docs/spike/endpoints.md`](docs/spike/endpoints.md).
  Requests are additionally suffix-checked per provider at dispatch time.
- **Credentials only in `chrome.storage.local`** under `qd:key:{providerId}`
  — never `storage.sync`, never `localStorage`. Bearer and admin keys attach
  exclusively as the `Authorization` header; the Qwen AccessKeySecret never
  leaves the signing boundary (only the derived BSS signature is
  transmitted). The ZAI monitor key attaches as a raw key — the stored value
  verbatim in `Authorization` with no `Bearer` prefix, plus
  `Accept-Language` — and only on the two ZAI monitor hosts (`api.z.ai`,
  `open.bigmodel.cn`); anywhere else the client rejects the request before
  any network I/O. Both invariants are enforced structurally by the request
  types and dynamically by a credential-placement scan over every dispatched
  request.
- **Typed transport errors** — HTTP status and parse failures carry no
  response body text, and failed refreshes persist only their taxonomy class
  (`auth`, `rate-limit`, `server`, `network`, `unknown`) into the cycle
  snapshot.

## Documentation

- [`docs/spike/endpoints.md`](docs/spike/endpoints.md) — per-provider endpoint
  evidence and the machine-readable host allowlist.
- [`openspec/`](openspec/) — specifications, change proposals, designs and
  task ledgers (spec-driven workflow).
- [`LICENSE`](LICENSE) — MIT.

---

Built by [The North Code](https://www.thenorthcode.es/).
