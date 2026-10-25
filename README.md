# quotadeck

A browser extension badge that tracks AI provider usage and balances. This
hito-12 feature branch re-ships the Qwen (Alibaba Cloud Model Studio)
provider alongside ZAI (Zhipu AI, the GLM Coding Plan) so the token-plan
quota flow can be exercised end to end in a real browser. The OpenAI and
Kimi (Moonshot AI) implementations are retained in source but stay
unshipped: they never register in the worker, never render in the popup, and
are granted no host permissions. (The GLM-only Chrome Web Store release lives
on develop.)

**Status: v0.3.0 — restyled ZAI + Qwen branch build (hito-12).** The extension is a
working Manifest V3 service worker plus action popup that fetches real usage
data every minute through an allowlist-constrained network client. ZAI usage
comes from the official monitor endpoint (`GET /api/monitor/usage/quota/limit`):
plan level, the 5h and weekly token windows with an uncapped percentage, and
the monthly MCP window. Qwen usage is quota-only (the BSS account-balance
dispatch is suspended — for a coding plan the $0.00 balance is noise): the
plan probe and the token-plan quota two-hop flow merge into the cycle
snapshot. The vitest suite stays
hermetic (recorded fixtures + injected transports — no network in tests); live
behavior is proven by contract tests over the request shapes and by a short
maintainer live check. See the `openspec/` change ledgers for the change
specs and design.

The popup now wears the ratified **Neo-Brutalist Developer Instrument** design
system (`docs/design/stitch/`): warm-paper/ink palette, 2px borders, hard
offset shadows and pressed states, uppercase mono chips, segmented threshold
bars with 25/50/75/90% ticks, and a real two-tab footer nav (QUOTAS / KEYS).
Type is set with local OFL woff2 fonts (Space Grotesk + JetBrains Mono, latin
subsets bundled under `extension/public/fonts/`) — the shipped popup has zero
remote references. The one data-honest telemetry addition is the **LAST KNOWN**
card: when a refresh fails, the popup shows that provider's most recent
successful usage dimmed under a real `T-<age>` chip, persisted per provider in
the cycle snapshot. No invented surfaces: no logs, stats, latency or
encryption claims.

## Load unpacked

1. Build once (dependencies are dev-only; installs are local):
   ```sh
   npm --prefix extension install
   npm --prefix extension run build
   ```
2. Open `chrome://extensions`, enable **Developer mode**, click **Load
    unpacked**, and select the `extension/dist` directory. The shipped
    `host_permissions` cover exactly the seven hosts of the two shipped
    providers — the ZAI monitor hosts (`api.z.ai` and `open.bigmodel.cn`)
    plus the five Qwen BSS/token-plan hosts (see Security posture below);
    if you previously loaded the GLM-only build, reload the extension so
    Chrome re-prompts for the widened host permissions.
3. The worker registers a `usage-refresh` alarm (1-minute period) on install
   and on startup. Each tick fetches live usage for every shipped provider
   with a stored credential, with all time windows derived from an injectable
   clock; the toolbar badge renders exactly **one provider — the one you
   choose** in Settings (the **Badge provider** selector, persisted as the
   non-secret preference `qd:pref:badge-provider`, default ZAI): ZAI shows the
   5h percentage (uncapped above 100) with the plan level as fallback, Qwen
   shows the token-plan quota percentage when present (rendered like the 5h
   figure) and clears otherwise. A chosen provider that did not
   run — or is not shipped in this build — clears the badge rather than
   showing a stale figure.
4. The badge background is threshold-colored from the chosen figure — the ZAI
   5h percentage, or the Qwen quota percentage — so the state reads at a
   glance: light slate `#E2E8F0` below 50% with near-black text `#0F172A`,
   orange `#F97316` from 50%, deep orange `#EA580C` from 80%, and red
   `#DC2626` from 90% (uncapped — 137% is still red), with white text from 50%
   upward. A failed refresh of the chosen provider shows `ERR` on the same
   light band with near-black text until the next successful tick (≤1 minute).
5. Clicking the toolbar action opens the popup on the consumption view: the
   ZAI monitor block (plan level, the 5h window with its uncapped percentage,
   used/total and reset countdown, the weekly window, and the MCP window with
    per-tool rows) and the Qwen card — the visual twin of the ZAI monitor
    (hito-12): the token-plan quota percentage as the hero figure and again
    inside its threshold bar (uncapped text, capped fill), the `Token Plan:`
    line keeping only the countdown — e.g. `Token Plan: Resets in 1h 30m` —
    plus the binary plan line; a quota without a percentage renders the
    resets line alone, with no hero; the card carries no balance figure) —
    the same
   data the tick persisted for that
   cycle. Failed refreshes show a per-class error label (`Auth failed`,
   `Rate limited`, …) in the card — the badge shows `ERR` only when the
   failing provider is the chosen one — a bad or revoked key surfaces this
   way within one tick. A ZAI auth failure also shows the wrong-platform
   guidance, since a Z.AI key under the ZHIPU selection (or vice versa) is
   the most likely cause.
6. Manage keys through the **Settings** gear in the popup header (no console
   needed): paste the ZAI credential — or the Qwen AccessKeyId/AccessKeySecret
   pair plus the optional `sk-sp-` plan key — and press **Save key**, or
   press **Enter** in the input. Invalid input is rejected with guidance, and
   stored keys display masked (`••••` + at most 4 trailing characters).
   **Revoke** removes the key. The settings view opens with the **Badge
   provider** selector (ZAI ↔ Qwen, default ZAI) — the single provider whose
   figure the toolbar badge renders; the choice persists as a non-secret
    local preference (`qd:pref:badge-provider`). Clicking a card's big hero
    percentage chooses that provider for the badge as well — the same store,
    both paths stay in sync, and the owning card carries a small `badge`
    chip (beside its hero, or beside the provider name while the card has no
    hero yet). The ZAI section carries the
   **platform selector** (Z.AI ↔ ZHIPU, default Z.AI): the choice persists as
   a non-secret local preference and switches the base URL of every ZAI
   monitor request (`api.z.ai` ↔ `open.bigmodel.cn`); the Qwen section carries
   the same selector for the BSS site (International ↔ China). The main view
   renders no key forms. The Qwen **token-plan quota** window (the
   `Token Plan:` card line and the Qwen badge figure) reads the monthly quota
   through a minted console session token, and needs BOTH account
   authorizations: a RAM custom policy allowing the action
   `modelstudio:GenerateCLIAccessToken` (the read-only system policy does not
   include it) and Model Studio workspace membership for the RAM user.

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
| `npm --prefix extension run build` | esbuild: bundle `extension/src/background.ts` → `extension/dist/background.js` and `extension/src/popup/main.ts` → `extension/dist/popup.js`, copy the MV3 manifest + `popup.html` + `icons/` + local `fonts/` |
| `npm --prefix extension run test` | vitest: hermetic unit suite (no Chrome runtime, no network) |
| `npm --prefix extension run typecheck` | `tsc --noEmit` (strict) |
| `npm --prefix extension run zip` | package the *contents* of `extension/dist` into `extension/quotadeck-v0.3.0.zip` for Chrome Web Store upload (`manifest.json` at the zip root). Windows PowerShell only: it uses the .NET `System.IO.Compression` API and writes every entry with a forward-slash path (`icons/icon16.png`), avoiding the backslash-separator hazard of `Compress-Archive`. The zip is gitignored — never commit it. |

Beyond these, `scripts/live-contract.ps1` is the opt-in **live contract publish gate**: it runs the real builder → signer → allowlist client → transport → parser pipeline against the live Qwen endpoints (credentials extracted in memory, never printed). Its test skips silently in the hermetic suite and only runs when the script opts it in via `QUOTADECK_LIVE=1` — run it green before any publish decision on the qwen token-plan feature.

## Security posture

- **Zero runtime npm dependencies** — the toolchain (TypeScript, esbuild,
  vitest, happy-dom for the DOM test environment) is dev-only and nothing is
  bundled but first-party code.
- **`host_permissions` = exactly the seven shipped hosts** — the ZAI (GLM)
  monitor entries (`api.z.ai`, `open.bigmodel.cn`) plus the five Qwen
  BSS/token-plan entries (`business.aliyuncs.com`,
  `business.ap-southeast-1.aliyuncs.com`,
  `token-plan.ap-southeast-1.maas.aliyuncs.com`,
  `bailian-singapore-cs.alibabacloud.com`,
  `modelstudio.ap-southeast-1.aliyuncs.com`). Live usage
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
