# Design: Hito 1 — Extension Skeleton

## Technical Approach

Layered MV3 skeleton under `extension/`: pure TypeScript core (providers, network, storage, badge logic) that depends only on injected ports; a thin `platform/` adapter binds those ports to the real `chrome.*` globals; `src/background.ts` is the composition root (service worker). Stub providers parse recorded fixtures through a generic `RefreshEngine`; the engine talks to an allowlist-enforcing network client whose transport is injected (fixture-backed, both in tests and in the shipped worker). Zero runtime npm dependencies; esbuild bundles the single entry to `dist/background.js`.

## Architecture Decisions

### AD-1: Ports-and-adapters with a single composition root
**Choice**: Core modules depend on `Clock`, `Transport`, `BrowserApi` interfaces; only `platform/browser-api.ts` and `background.ts` touch the `chrome` global.
**Alternatives**: (a) `webextension-polyfill` everywhere — rejected: adds a runtime dep and does not remove the mock problem for vitest. (b) `jest-chrome`/`sinon-chrome` — rejected: hand-rolled fakes are ~60 lines, fully typed, no dep.
**Rationale**: Spec obligation #2 — hermetic vitest without a Chrome runtime; also keeps the future live-calls milestone a transport swap, not a rewrite.

### AD-2: Pagination via opaque provider state, jitter via injected clock
**Choice**: `Provider.parsePage(body, state)` returns `{ state, usage, next?, error? }`; `RefreshEngine` treats `state` as opaque, sleeps via `Clock.sleep(ms)` between pages when the provider declares `interPageDelayMs: [500, 2000]`.
**Alternatives**: (a) Provider drives its own fetch loop — rejected: re-implements allowlist/jitter per provider and hides the seam. (b) Generic cursor machinery — rejected: framework smell for a skeleton.
**Rationale**: Spec obligation #1 — the engine is the single injection point for both the jitter clock and the transport; ZAI dedupe (`billingNo` set) and OpenAI cursor folding live inside their own opaque state. Hermetic tests assert recorded sleep durations without wall-clock waiting.

### AD-3: Network layer attaches credentials; callers never see the key in requests
**Choice**: `AllowlistNetworkClient.send(providerId, request, credential)` validates host against the provider's allowlist, scans URL/query/body for credential material (reject on hit), attaches `Authorization` itself, then delegates to `Transport`.
**Alternatives**: (a) Callers set headers freely — rejected: cannot structurally guarantee "keys only in Authorization header". (b) Scan-only enforcement — rejected as sole mechanism; defense in depth = structural + scan.
**Rationale**: `network-allowlist` spec scenarios (non-allowlisted host, cross-provider host, `api.z.ai`, query-param key) all become unit tests against a recording transport with zero network I/O.

### AD-4: Allowlist single-sourced by the spike doc, enforced by a sync test
**Choice**: `docs/spike/endpoints.md` embeds a fenced ```json block containing the canonical allowlist (provider id → hosts + verification status); `src/network/allowlist.ts` holds the typed copy; `src/network/allowlist.source.test.ts` parses the doc block and `deepStrictEqual`s it against the code constant.
**Alternatives**: (a) Build-time codegen from the doc — rejected: adds a generator step for 4 entries. (b) Code as source of truth, doc narrative-only — rejected: spec names the doc as the reference; drift would be invisible.
**Rationale**: Spec obligation #3 — the doc stays the single source; any drift (e.g., someone re-adding `api.z.ai`) fails the build. Initial values: ZAI `bigmodel.cn` (NOT `api.z.ai`), Kimi `api.moonshot.cn`, OpenAI `api.openai.com`, Qwen `business.aliyuncs.com` (BSS OpenAPI 2017-12-14), all per spike evidence.

### AD-5: Host-suffix allowlist matching, scoped per provider
**Choice**: `host === pattern || host.endsWith('.' + pattern)`; a request declares its `providerId` and is checked only against that provider's list.
**Rationale**: Admits `open.bigmodel.cn` under `bigmodel.cn`; structurally rejects the cross-provider scenario (ZAI → `api.moonshot.cn`).

### AD-6: Registry = Map with fail-fast semantics
**Choice**: `ProviderRegistry.register()` throws on duplicate id; `.get()` throws on unknown id; `createDefaultRegistry()` wires the four stubs in fixed order `zai, qwen, openai, kimi`.
**Rationale**: Exactly the two spec scenarios; no DI container — the fixed order also makes badge "last result wins" deterministic.

### AD-7: Zero host_permissions in MV3 manifest
**Choice**: Manifest requests only `storage` + `alarms` (badge via `action` needs no permission); no `host_permissions`.
**Rationale**: Fixture-only milestone makes cross-origin permissions pure risk; the live milestone will add exactly the allowlisted hosts.

### AD-8: Fixtures bundled into the worker bundle
**Choice**: `src/fixtures/index.ts` imports fixture JSON via esbuild's json loader, so `FixtureTransport` works in the unpacked-load worker without shipping loose files.
**Rationale**: `usage-badge` spec requires real badge updates from fixture data with no live calls; self-contained `dist/` keeps loading trivial.

### AD-9: Self-contained npm package at `extension/`
**Choice**: `extension/package.json` with dev-only deps (`typescript`, `esbuild`, `vitest`, `@types/chrome`); zero runtime deps; repo root stays clean for the future Android app.
**Rationale**: Minimal surface, fast installs, clear ownership boundary.

## Data Flow

    chrome.alarms ──onAlarm──▶ background.ts ──▶ RefreshEngine
                                                     │
              ┌──────────────────────────────────────┼──────────────────┐
              ▼                                      ▼                  ▼
        KeyStore (storage.local)            Provider.parsePage    AllowlistNetworkClient
              │                                      │                  │ check host +
              │ key ── attached here ───────────────────────────────────▶│ header-only key
              │                                      │                  ▼
              │                                      │            Transport (fixture)
              ▼                                      ▼                  │
        chrome.action.setBadgeText ◀── formatBadgeText(usage) ◀── fold state

## Sequence Diagram — alarm-tick refresh (config rule: complex flows)

```mermaid
sequenceDiagram
    participant AL as chrome.alarms
    participant BG as background.ts
    participant EN as RefreshEngine
    participant P as Provider (stub)
    participant NC as AllowlistNetworkClient
    participant TR as Transport (fixture)
    participant KS as KeyStore
    participant AC as chrome.action

    AL->>BG: onAlarm("usage-refresh")
    BG->>EN: refreshAll(registry order)
    loop each provider with a stored key
        EN->>KS: readKey(providerId)
        EN->>P: firstRequest(query, state=null)
        Note over EN,NC: request validated before dispatch (OpenAI start_time/bucket_width)
        EN->>NC: send(providerId, request, credential)
        NC->>NC: allowlist + credential-placement checks
        NC->>TR: fetch(request)
        TR-->>NC: response page (fixture)
        NC-->>EN: response
        EN->>P: parsePage(body, state)
        alt page continues (ZAI total not reached / OpenAI next_page present)
            EN->>EN: clock.sleep(jitter 500–2000 ms) — ZAI only
            EN->>NC: send(next request, credential)
        end
        EN-->>EN: fold into NormalizedUsage (dedupe by billingNo via state)
        EN->>AC: setBadgeText(formatBadgeText(usage))
        Note over EN,AC: on failure: setBadgeText("ERR"); next success replaces it
    end
```

## Project Layout

```
extension/
├── package.json              # dev-only deps; scripts: build / test / typecheck
├── tsconfig.json             # strict, noEmit (esbuild emits), include src + vitest.config.ts
├── vitest.config.ts          # environment: node, include src/**/*.test.ts
├── build.mjs                 # esbuild: bundle src/background.ts → dist/background.js (iife), copy public/manifest.json
├── public/
│   └── manifest.json         # MV3; permissions: storage, alarms; service_worker: background.js
└── src/
    ├── background.ts         # composition root + alarm wiring
    ├── core/
    │   ├── provider.ts       # Provider contract, ProviderId, CredentialType, UsageQuery
    │   ├── registry.ts       # ProviderRegistry + createDefaultRegistry()
    │   ├── usage.ts          # NormalizedUsage + formatBadgeText (pure)
    │   ├── credentials.ts    # validateCredential (Qwen rejects sk-*, guidance incl. RAM bss:DescribeAcccount)
    │   └── clock.ts          # Clock port + SystemClock
    ├── network/
    │   ├── allowlist.ts      # typed AllowlistConfig (copy of doc block)
    │   ├── request.ts        # ProviderRequest types + credential-placement guard
    │   ├── client.ts         # AllowlistNetworkClient
    │   └── transport.ts      # Transport port + FixtureTransport
    ├── storage/
    │   └── key-store.ts      # KeyStore over an injected storage.local area
    ├── refresh/
    │   └── engine.ts         # RefreshEngine: pagination, jitter, fold, error marker
    ├── providers/
    │   ├── zai.ts  qwen.ts  openai.ts  kimi.ts   # four stubs
    │   └── index.ts          # createDefaultRegistry()
    ├── platform/
    │   └── browser-api.ts    # BrowserApi interface + ChromeBrowserApi adapter (globalThis.chrome)
    ├── testing/
    │   ├── fake-browser.ts   # in-memory BrowserApi; records sync access; fireable onAlarm
    │   ├── fake-clock.ts     # records sleeps, never waits
    │   └── recording-transport.ts  # queues responses, records requests
    └── fixtures/
        ├── index.ts          # imports all JSON (bundled by esbuild)
        ├── zai/   (expense-bill-list--page-1..3.json, --code-string-200.json, --code-500.json)
        ├── qwen/  (query-account-balance--ok.json)
        ├── openai/(costs--page-1.json, costs--page-2-final.json, costs--missing-start-time case via unit data)
        └── kimi/  (users-me-balance--ok.json)
```

Fixture naming: `{provider}/{endpoint}--{case}.json`. Testing doubles live in `src/testing/` (never referenced by `background.ts`, so esbuild never bundles them).

## Interfaces / Contracts

```ts
// core/provider.ts
type ProviderId = 'zai' | 'qwen' | 'openai' | 'kimi';
type CredentialType = 'bearer' | 'ak-sk' | 'openai-admin-read';

interface Provider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly credentialType: CredentialType;
  readonly interPageDelayMs?: readonly [min: number, max: number]; // ZAI only: [500, 2000]
  firstRequest(query: UsageQuery): ProviderRequest;        // throws before dispatch on invalid params
  parsePage(body: unknown, state: ProviderState | null): PageParse;
}

type PageParse =
  | { done: true;  usage: NormalizedUsage }
  | { done: false; state: ProviderState; next: ProviderRequest }; // usage emitted at fold time

// core/usage.ts
interface NormalizedUsage {
  readonly providerId: ProviderId;
  readonly kind: 'balance' | 'cost';
  readonly value: number;              // ZAI: sum(costPrice / 1000 * deductUsage); Qwen: Data.AvailableAmount; Kimi: data.available_balance; OpenAI: sum(results[].amount.value)
  readonly currency: string;           // from response (Qwen Data.Currency; Kimi 'CNY'; OpenAI amount.currency; ZAI 'CNY')
  readonly tier?: string;              // ZAI: tokenResourceName label
  readonly breakdown?: readonly LineItem[]; // OpenAI: per model+usage_type bucket
  readonly fetchedAt: number;          // epoch ms from injected Clock
}

// network/transport.ts + core/clock.ts
interface Transport { fetch(req: AuthorizedRequest): Promise<TransportResponse>; }
interface Clock { now(): number; sleep(ms: number): Promise<void>; } // SystemClock: Math.random jitter inside [min,max]

// network/client.ts
interface AllowlistNetworkClient {
  send(providerId: ProviderId, req: ProviderRequest, credential: string): Promise<TransportResponse>;
} // 1) host-suffix check vs provider's list 2) reject if credential substring appears in url/query/body 3) attach Authorization 4) transport.fetch

// platform/browser-api.ts
interface BrowserApi {
  readonly storage: { readonly local: StorageArea; readonly sync: StorageArea }; // sync exposed so tests can assert it is never called
  readonly alarms: { create(name: string, info: { periodInMinutes: number }): void;
                     get(name: string): Promise<{ name: string } | undefined>;
                     onAlarm: { listen(fn: (a: { name: string }) => void): void } };
  readonly action: { setBadgeText(o: { text: string }): Promise<void> };
}
```

**Badge format** (pure `formatBadgeText`, pinned by unit tests): success → `¥12` (symbol + integer when ≥10; one decimal `<10`; `≥1000` → `1.2k`, symbol dropped); error → `ERR`. Deterministic: identical input → identical text.

**Storage**: `KeyStore.saveKey/readKey/readMaskedKey (last 4 chars)/revokeKey(providerId)`, namespaced `qd:key:{providerId}` over an injected `storage.local` area — no `.sync` path exists in the wrapper's type; the fake records sync access for the "never used" test.

**Service worker**: on `onInstalled` and `onStartup`, `alarms.get('usage-refresh')` → create with `periodInMinutes: 1` when absent; `onAlarm('usage-refresh')` → `RefreshEngine.refreshAll()`; per provider (registry order, only when a key is stored): refresh → badge update; failure → `ERR`, replaced by the next success.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `extension/**` (tree above) | Create | MV3 skeleton: manifest, worker, core/network/storage/refresh/providers/platform, tests, fixtures |
| `extension/dist/` | Create (build output) | `background.js` + `manifest.json`; gitignored |
| `docs/spike/endpoints.md` | Create | Per-provider evidence + machine-readable allowlist json block (single source, AD-4) |
| `LICENSE` | Create | MIT |
| `README.md` | Create | Minimal: load unpacked, scripts |
| `.gitignore` | Modify | Add `extension/node_modules/`, `extension/dist/` |

## npm Scripts (exact)

Defined in `extension/package.json`, invoked from repo root as `npm --prefix extension run <script>`:

```json
{ "build": "node build.mjs", "test": "vitest run", "typecheck": "tsc --noEmit" }
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit — providers | All `provider-framework` scenarios: contract compliance, ZAI math/tier/`code`-string rejection/dedupe/jitter, Qwen balance + `sk-` rejection, OpenAI aggregation/cursor/pre-dispatch validation, Kimi CNY | Fixtures via `src/fixtures/`; hermetic (spec: no outbound I/O) |
| Unit — network | Allowlisted host admitted; `evil.example.com`, cross-provider host, `api.z.ai` rejected; key only in header; query-key rejected | `RecordingTransport` asserts requests; zero transport I/O on rejection |
| Unit — storage | Round-trip; masked read ≤ last 4 chars; revoke stops auth activity; per-provider isolation; `.sync` never called | `FakeBrowser` with sync-access recording |
| Unit — badge/refresh | Alarm registered when absent; tick → badge text deterministic; failure → `ERR` then recovery; allowlist/doc sync (AD-4) | Fire `onAlarm` on the fake; `FakeClock` recorded sleeps in [500,2000] with exactly N−1 sleeps for N pages |
| E2E | Unpacked load: badge updates per 1-min tick from fixture data | Manual (success criterion); no automation in this milestone |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. (The allowlist is an in-extension network gate covered by the network unit tests above.)

## Migration / Rollout

No migration required — greenfield on `feature/hito-1-spike-y-esqueleto`; rollback per proposal (delete paths).

## Open Questions

None blocking. Future work (not this milestone): per-provider badge rotation or popup UI instead of "last result wins"; live transport + `host_permissions` at the live-calls milestone.
