# quotadeck

A browser extension badge that tracks AI provider usage and balances — ZAI
(Zhipu AI), Qwen (Alibaba Cloud), OpenAI and Kimi (Moonshot AI).

**Status: live usage.** The extension is a working Manifest V3 service worker
plus action popup that fetches real usage data from the four providers every
minute through an allowlist-constrained network client. ZAI usage comes from
the official monitor endpoint (`GET /api/monitor/usage/quota/limit`): plan
level, the 5h and weekly token windows with an uncapped percentage, and the
monthly MCP window. The vitest suite stays
hermetic (recorded fixtures + injected transports — no network in tests); live
behavior is proven by contract tests over the request shapes and by a short
maintainer live check. See
[`openspec/changes/hito-4-zai-monitor/`](openspec/changes/hito-4-zai-monitor/)
for the change specs and design.

## Load unpacked

1. Build once (dependencies are dev-only; installs are local):
   ```sh
   npm --prefix extension install
   npm --prefix extension run build
   ```
2. Open `chrome://extensions`, enable **Developer mode**, click **Load
    unpacked**, and select the `extension/dist` directory. The first load
    after this milestone grants the new cross-origin host permissions
    (`api.z.ai` and `open.bigmodel.cn` replace the retired `bigmodel.cn`
    apex — see Security posture below) — reload the extension if you upgraded
    from an earlier build; Chrome re-prompts for the host-permission change.
3. The worker registers a `usage-refresh` alarm (1-minute period) on install
   and on startup. Each tick fetches live usage for every provider with a
   stored credential, with all time windows derived from an injectable clock;
   the badge shows the last successful result — for ZAI the 5h percentage
   (uncapped above 100) with the plan level as fallback.
4. Clicking the toolbar action opens the popup on the consumption view: the
   ZAI monitor block (plan level, the 5h window with its uncapped percentage,
   used/total and reset countdown, the weekly window, and the MCP window with
   per-tool rows), OpenAI spend with per-model rows, and Qwen/Kimi balances —
   exactly the data the badges rendered for that cycle. Failed providers show
   a per-class error label (`Auth failed`, `Rate limited`, …) and the badge
   shows `ERR` until the next successful refresh — a bad or revoked key
   surfaces this way within one tick (≤1 minute). A ZAI auth failure also
   shows the wrong-platform guidance, since a Z.AI key under the ZHIPU
   selection (or vice versa) is the most likely cause.
5. Manage keys through the **Settings** gear in the popup header (no console
   needed): paste a credential and **Save key**, or press **Enter** in the
   input. Invalid input is rejected with guidance — notably, DashScope `sk-`
   keys are rejected for Qwen with the Alibaba Cloud AK/SK (RAM
   `bss:DescribeAcccount`) hint — and stored keys display masked (`••••` +
   at most 4 trailing characters per secret part; Qwen takes TWO fields,
   AccessKeyId and AccessKeySecret). **Revoke** removes one provider's key
   without touching the others. The ZAI section also carries the **platform
   selector** (Z.AI ↔ ZHIPU, default Z.AI): the choice persists as a
   non-secret local preference and switches the base URL of every ZAI monitor
   request (`api.z.ai` ↔ `open.bigmodel.cn`). The main view renders no key
   forms.

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
| `npm --prefix extension run build` | esbuild: bundle `extension/src/background.ts` → `extension/dist/background.js` and `extension/src/popup/main.ts` → `extension/dist/popup.js`, copy the MV3 manifest + `popup.html` |
| `npm --prefix extension run test` | vitest: hermetic unit suite (no Chrome runtime, no network) |
| `npm --prefix extension run typecheck` | `tsc --noEmit` (strict) |

## Security posture

- **Zero runtime npm dependencies** — the toolchain (TypeScript, esbuild,
  vitest, happy-dom for the DOM test environment) is dev-only and nothing is
  bundled but first-party code.
- **`host_permissions` = exactly the five provider hosts** (`api.z.ai`,
  `open.bigmodel.cn`, `business.aliyuncs.com`, `api.openai.com`,
  `api.moonshot.cn`). Live usage requires cross-origin fetch from the worker,
  so the manifest grants the union of the per-provider allowlists and nothing
  more; a sync test fails the build if the manifest and the allowlist ever
  diverge. Requests are additionally suffix-checked per provider at dispatch
  time.
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
