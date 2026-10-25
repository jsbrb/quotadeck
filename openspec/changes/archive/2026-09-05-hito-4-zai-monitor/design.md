# Design: Hito 4 — ZAI Monitor Endpoints

## Technical Approach

Hito-3's seams hold; hito-4 is a surface swap plus one new attach mode. The ZAI provider is rewritten from the dead `expenseBillList` pagination fold to a single-shot `GET /api/monitor/usage/quota/limit` with raw-key authorization, platform-selected base (`api.z.ai` default, `open.bigmodel.cn` for ZHIPU). The network client — still the only credential attacher — learns a third token attach form (`Authorization: <key>` verbatim + `Accept-Language`), scoped to the ZAI monitor hosts exactly the way ak-sk signing is scoped to the Qwen BSS host (AD-19 pattern). `BudgetReport` and its tier-budget/limit-store machinery are superseded by a `MonitorWindows` model (level, 5h/weekly windows, monthly MCP) carried on `NormalizedUsage`; the badge renders the 5h percentage uncapped with a plan-level fallback. The allowlist/manifest/spike triple lock moves from apex `bigmodel.cn` to the two monitor hosts (triple-source verified). Status-first error handling is verified as ALREADY structural in `FetchTransport` and pinned with new plain-text-error RED tests rather than rewritten. Removals are sequenced so every commit stays green: additive foundation first, one atomic swap commit, deletions last.

Maps to proposal §Approach; implements `zai-monitor` (new) and the six modified/removed capabilities (`provider-framework`, `network-allowlist`, `usage-badge`, `popup-ui`, `key-storage`, `tier-budget` REMOVED).

## Architecture Decisions

Numbering continues the project sequence (hito-1 = AD-1..AD-9, hito-2 = AD-10..AD-15, hito-3 = AD-16..AD-24).

### AD-25: Raw attach mode declared per-provider via the `Credential` type (client attaches by `credential.type`)

**Choice**: `CredentialType` gains `'raw'`; the `Credential` token arm widens to `'bearer' | 'openai-admin-read' | 'raw'`. A provider declares its attach mode exactly as before — through `credentialType` on the `Provider` contract and `PROVIDER_METADATA` — and ZAI flips to `'raw'`. `AllowlistNetworkClient.send` (unchanged signature) switches on `credential.type`: `'raw'` → headers `{ Authorization: <token verbatim>, 'Accept-Language': 'zh-CN' }`; bearer/admin unchanged; ak-sk unchanged. `ProviderRequest` stays header-less — the structural no-caller-header guarantee is untouched. Scoping: a `'raw'` credential is attached only when the target host passes `isHostAllowed('zai', host)` — after the AD-29 allowlist change that set is exactly `{api.z.ai, open.bigmodel.cn}`; anything else throws `NetworkRejectionError('credential-placement')` before any I/O, mirroring the ak-sk qwen-only check in `signedRequest`.
**Alternatives**: (a) A separate `attachMode: 'bearer' | 'openai-admin' | 'raw'` field on `Provider`, threaded engine→client as a new `send` parameter — rejected: attach decisions already key on `credential.type` in the client; a parallel field splits one truth into two and grows the `send` signature for information the credential already carries. (b) Client consults `PROVIDER_METADATA[providerId]` — rejected: a second id→mode mapping to keep in sync, and it drags a popup-safe metadata table into the network layer's attach path. (c) Hardcode the two monitor hosts in the scoping check — rejected: deriving from the zai allowlist entry keeps scoping and allowlist one fact (the spec phrases the exception as "scoped to the ZAI monitor hosts", which is exactly the zai allowlist after AD-29).
**Rationale**: `provider-framework` §Credential Attach Modes ("each provider SHALL declare exactly one attach mode; the ZAI provider SHALL declare `raw`") — `credentialType` IS that declaration, one per provider, already consumed type-aware by the engine (`readCredential(id, provider.credentialType)`) and key store. Storage needs zero migration: a stored ZAI key is a plain string under `qd:key:zai` and `readCredential('zai', 'raw')` returns `{ type: 'raw', token }` through the existing token path. The scan (`assertNoCredentialMaterial`) is UNCHANGED for raw: raw credentials join the token arm (key must not appear in url/query/body — the scan cannot see headers, by design). `Accept-Language` value pinned `'zh-CN'` (community-evidence default; presence is the contract — the server uses it only for localization — and the value is cosmetic). `network-allowlist` §Raw attach scoped to monitor hosts scenarios are client unit tests: raw on a monitor host passes, raw on any other host is rejected with zero transport I/O.

### AD-26: `MonitorWindows` data model — `BudgetReport` superseded; value/currency become optional

**Choice**: `core/usage.ts` replaces `BudgetReport`/`NormalizedUsage.budget` with:

```ts
interface UsageWindow { percentage?: number; used?: number; total: number; resetAt?: number }
interface McpToolUsage { name: string; used: number }
interface McpWindow { used: number; ceiling: number; tools: readonly McpToolUsage[] }
interface MonitorWindows { level?: string; fiveHour?: UsageWindow; weekly?: UsageWindow; mcp?: McpWindow }
```

`NormalizedUsage` gains `windows?: MonitorWindows`; `tier?: string` stays (generic "when available" — ZAI simply stops setting it; `level` supersedes it). `value` and `currency` become OPTIONAL: the monitor endpoint reports no monetary figure, and `popup-ui` distinguishes "the monetary providers with value and currency" from ZAI. Badge contract in `formatBadgeText`: when `usage.windows` is present → `fiveHour?.percentage !== undefined ? \`${Math.round(percentage)}%\`` (uncapped, integer display text) `: (windows.level ?? '')`; otherwise the existing monetary logic. `SnapshotStore` validation: `isBudgetReport` → `isMonitorWindows` (level optional string; windows require numeric `total`, optional numeric percentage/used/resetAt; mcp requires numeric used/ceiling and an array of `{ name: string, used: number }`).
**Alternatives**: (a) Keep `BudgetReport` and squeeze windows into it — rejected: the tier-budget delta REMOVES all seven requirements; the models disagree at every field (capped vs uncapped, derived vs passthrough, tier vs level). (b) ZAI emits `value: 0, currency: 'CNY'` sentinel — rejected: dishonest shape; the popup spec explicitly separates monetary providers from the ZAI block. (c) Badge fallback to `value` when percentage and level are both absent — rejected: ZAI has no value; the honest fallback is an empty badge string (rare: requires the API to omit both `data.level` and the 5h percentage).
**Rationale**: `usage-badge` §Badge Rendering (5h percentage uncapped; absent → plan level; deterministic text) and `popup-ui` §Provider List Rendering. Uncapped passthrough lives in the MODEL (137 stays 137); `Math.round` is display formatting only (evidence shows integer percentages). The countdown is NOT modeled — windows carry `resetAt` (= `nextResetTime` verbatim, epoch ms) and the existing pure `formatResetCountdown(resetAt, nowMs)` derives the display countdown, satisfying "countdown = nextResetTime − now" at render time with the controller-supplied now.

### AD-27: ZAI provider rewrite — single-shot monitor GET, platform base from the tick query, parser per `zai-monitor`

**Choice**: `providers/zai.ts` rewritten. `firstRequest(query)` builds `{ method: 'GET', url: \`${zaiMonitorBaseUrl(query.zaiPlatform ?? 'zai')}/api/monitor/usage/quota/limit\` }` — no query, no body; throws before dispatch only on an invalid `zaiPlatform` (not `'zai' | 'zhipu'`). `billingMonths`/`tierLimits`/`now` are no longer required and ignored if present (countdown needs no anchor; `fetchedAt` is engine-stamped). `interPageDelayMs` is dropped — the provider declares none. `parsePage` returns `{ done: true, usage }` on the first page; the engine loop is untouched and simply exits. Envelope discipline kept: success requires numeric `code` 200 (string `"200"` or non-200 → `ProviderApiError`, classifying `server` per AD-21). Parsing: `data.level` (non-empty string, else absent); `data.tokenLimits` entries of type `TOKENS_LIMIT` — `unit === 3 && number === 5` → fiveHour, `unit === 6 && number === 1` → weekly; when no entry carries those discriminators, positional fallback among `TOKENS_LIMIT` entries (`[0]` → 5h, `[1]` → weekly); the `TIME_LIMIT` entry → MCP (`currentValue` → used, `usage` → ceiling, `usageDetails` object → `tools` sorted by name for determinism). Per window: `percentage` passes through uncapped; `null`/absent → percentage AND used absent; when percentage and `total` are both present → `used = Math.round(total × percentage / 100)`; numeric `nextResetTime` → `resetAt` verbatim; absent → gracefully absent without failing other windows. MCP gets NO synthesized percentage or countdown. Result: `kind: 'cost'`, `windows` set, no value/currency/tier.
**Alternatives** (platform plumbing): (a) Per-tick registry construction with a platform-injected `ZaiProvider` — rejected: complicates the composition root and handles mid-session preference changes worse than a per-tick storage read. (b) Provider reads the preference from storage — rejected: providers are I/O-free by contract (provider-framework §Provider Contract). (c) `UsageQuery.zaiPlatform` set by `background.refreshTick` from the platform store — CHOSEN: `UsageQuery` already carries provider-specific optional fields (`startTime/endTime` for OpenAI; `billingMonths` was ZAI's until now), and the modified contract only forbids tier limits and billing months; the read replaces the removed `readTierLimits` call symmetrically.
**Wrong-platform 401 guidance**: derived, not transported. The snapshot error arm stays class-only (AD-13/21 — "the thrown value is dropped"). The popup renders a static guidance constant when `results.zai.status === 'error' && errorClass === 'auth'`. **Alternatives**: enrich the taxonomy with a message — rejected: taxonomy is a pure signal→class map with no provider context; persist guidance in the snapshot — rejected: reopens the AD-13 payload ban.
**Rationale**: `zai-monitor` §Single-Shot Monitor Query, §Level and Window Discrimination, §Percentage Passthrough and Used Derivation, §Reset Countdown, §Monthly MCP Window, §Platform Binding; `provider-framework` §ZAI Parsing (monitor quota/limit) — "MUST NOT model expenseBillList, billingMonth, pagination plans, or Bearer credentials".

### AD-28: Platform preference — pure `core/zai-platforms.ts` + `qd:pref:zai-platform` store + settings selector

**Choice**: New popup-safe pure module `core/zai-platforms.ts`: `type ZaiPlatform = 'zai' | 'zhipu'`, `ZAI_PLATFORMS` list with display labels (`Z.AI`, `ZHIPU`), `zaiMonitorBaseUrl(platform)` → `'https://api.z.ai' | 'https://open.bigmodel.cn'`. New `storage/zai-platform-store.ts` over the injected local `StorageArea` (same wrapper pattern as `KeyStore`): key `qd:pref:zai-platform`, value the platform string; `readZaiPlatform(local)` validates and defaults `'zai'` on absent/invalid; `writeZaiPlatform(local, platform)` validates before writing. Distinct from `qd:key:*` by namespace — the preference is non-secret, returned unmasked, never `chrome.storage.sync` (the wrapper has no sync path, structurally). Popup: the settings view's ZAI section gains a selector rendered from `ZAI_PLATFORMS` (labels unmasked); the controller wires a `change`-delegated handler → `writeZaiPlatform` → re-render, and reads the preference on load. `background.refreshTick` reads the store and passes the platform into `buildTickQuery`.
**Alternatives**: (a) Store under `qd:key:zai-platform` — rejected: `key-storage` §ZAI Platform Preference requires a namespace distinct from the credential namespace (key-store semantics — masking, revocation — are wrong for a preference). (b) A generic `qd:pref:*` settings object — rejected: one preference does not justify an indirection layer; a typed wrapper per key matches the `limit-store` precedent (which this change deletes) without its override-merge complexity. (c) Selector in the main view — rejected: `popup-ui` §ZAI Platform Selector places it in the settings gear.
**Rationale**: `zai-monitor` §Platform Binding (default Z.AI; selection determines the base URL of EVERY monitor request), `key-storage` §ZAI Platform Preference (round-trip unmasked; credential namespace unaffected — covered by a store test writing the preference and re-reading a stored key), `popup-ui` §ZAI Platform Selector (defaults, persist, unmasked render, base-URL switch proven by the request-builder contract test).

### AD-29: Allowlist + manifest + spike triple lock — monitor hosts in, apex out

**Choice**: `PROVIDER_ALLOWLIST.zai` becomes `{ hosts: ['api.z.ai', 'open.bigmodel.cn'], verification: 'community' }`. Apex `bigmodel.cn` is REMOVED — its only caller (`expenseBillList`) is dead, and a permission grant with no caller violates least privilege. The manifest union becomes five hosts (`api.z.ai`, `open.bigmodel.cn`, `api.moonshot.cn`, `api.openai.com`, `business.aliyuncs.com`) — picked up automatically by the AD-16 sync test, whose pinned-list case updates from four to five. `allowlist.source.test.ts` pins are rewritten: the ZAI hosts are exactly the two monitor hosts and the apex is ABSENT (the old "NOT the unverified api.z.ai" pin dies with the REMOVED §Unverified Variant Excluded requirement); suffix-match cases re-pin (`api.z.ai` and subdomains admitted, bare `bigmodel.cn` rejected, cross-provider `open.bigmodel.cn` under kimi rejected). `docs/spike/endpoints.md` ZAI section is rewritten for the monitor surface: endpoint, raw auth + `Accept-Language`, platform binding and key platform-boundedness, response semantics (level, `TOKENS_LIMIT` unit/number discriminators, `TIME_LIMIT`, percentage/total/`nextResetTime`, plain-text error bodies on 401/403), the dead `expenseBillList` noted as removed, and evidence — triple-source: `zai-org/zai-coding-plugins` (the vendor org's own plugin), `ecerutti/glm-usage-monitor`, `guyinwonder168/opencode-glm-quota`. The fenced JSON block updates in the same commit; the sync test enforces doc↔code identity.
**Alternatives**: (a) Keep the apex for a future billing revival — rejected: revive it with the revival (archive retains the spec text); today it is an unearned grant. (b) Mark verification `'official'` — rejected honestly: the endpoint has no official documentation page; one of the three community sources is the vendor org's own code, which is strong but still `community` under the doc's verification taxonomy.
**Rationale**: `network-allowlist` §Per-Provider Domain Allowlist (modified) and the REMOVED §Unverified Variant Excluded; `provider-framework` §Hermetic Tests with Live Transport Contract (recorded request targets the platform-selected monitor host). Host-surface delta stated honestly: 4 → 5 granted hosts; the apex grant is retired in the same change. Unpacked-dev rollout requires an extension reload (Chrome will show the host-permission change).

### AD-30: Status-first error handling — verified structural, pinned by RED tests; taxonomy unchanged

**Choice**: NO structural change to `FetchTransport`. Verified against the code: `fetch()` resolves → `if (!response.ok) throw new HttpStatusError(response.status)` → only then `response.json()`. Error-status bodies are NEVER parsed, so a plain-text 401/403/429/500 body cannot cause a parse failure — `zai-monitor` §Status-First Error Classification is already satisfied by the AD-19 ordering. HitO-4 adds the missing proof: `fetch-transport.test.ts` gains cases where the stub's `json()` REJECTS (simulating a plain-text body) behind `ok: false` responses — asserting `HttpStatusError(status)` with the exact status and that classification (`classifyRefreshError`) yields `auth` (401/403), `rate-limit` (429), `server` (≥500) with no `ResponseParseError`. The taxonomy module is untouched. 2xx bodies that are not JSON still → `ResponseParseError` → `unknown` (unchanged, honest).
**Alternatives**: (a) Parse error bodies defensively and ignore failures — rejected: pointless untrusted-surface handling; error bodies are never read. (b) Move classification into the transport — rejected: AD-21 keeps taxonomy a refresh-layer concern; the transport's job is typed errors with status only (AD-13 spirit). (c) Add a body-sniffing "plain-text" error type — rejected: no consumer needs the distinction.
**Rationale**: `zai-monitor` §Status-First Error Classification ("classified by HTTP status BEFORE any body parse; plain-text bodies on error statuses MUST NOT cause a parse failure") — the design's obligation is proof, not rework; wrong-platform guidance rides the `auth` class per AD-27.

## Data Flow

    alarm tick ─▶ background: readZaiPlatform (qd:pref:zai-platform) + clock.now
                        │ buildTickQuery: { zaiPlatform, startTime/endTime }   (months/tierLimits gone)
                        ▼
                  RefreshEngine (sequential, registry order; no inter-page sleeps remain)
                        │ per keyed provider: KeyStore.readCredential(id, credentialType)
                        ▼
                  AllowlistNetworkClient
                        │  host check (per-provider allowlist: zai = api.z.ai | open.bigmodel.cn)
                        │  credential scan (token arm incl. raw; secret never anywhere; AK query only on Qwen host)
                        │  attach: bearer/admin → Bearer · raw (zai hosts) → verbatim + Accept-Language · ak-sk → signed query
                        ▼
                  FetchTransport ──▶ !ok → HttpStatusError(status) BEFORE body parse ──▶ taxonomy: 401/403 auth · 429 rate-limit · 5xx server
                        │ 2xx JSON
                        ▼
                  parsePage (ZAI: single-shot fold → level, 5h, weekly, MCP)
                        │
                  badge: windows.fiveHour.percentage% uncapped │ level │ value │ ERR
                        └─▶ SnapshotStore qd:snapshot (usage+windows | errorClass only)
    popup open ─▶ controller (view state + platform selector) ─▶ pure views (monitor block | settings) ─▶ #app
                  zai error + auth class ─▶ static wrong-platform guidance

## Sequence Diagram — monitor refresh tick (config rule: complex flows)

```mermaid
sequenceDiagram
    participant AL as chrome.alarms
    participant BG as background.ts
    participant PS as zai-platform-store
    participant EN as RefreshEngine
    participant KS as KeyStore
    participant NC as AllowlistNetworkClient
    participant FT as FetchTransport
    participant SS as SnapshotStore
    participant AC as chrome.action
    participant PU as popup/controller

    AL->>BG: onAlarm("usage-refresh")
    BG->>PS: readZaiPlatform() (qd:pref:zai-platform)
    PS-->>BG: 'zai' | 'zhipu' (absent/invalid → 'zai')
    BG->>BG: buildTickQuery(clock.now, platform) → { zaiPlatform, startTime, endTime }
    BG->>EN: refreshAll(query)
    loop each keyed provider (registry order)
        EN->>KS: readCredential(id, credentialType)
        EN->>NC: send(id, firstRequest(query), credential)
        NC->>NC: host check (zai: api.z.ai | open.bigmodel.cn) + credential-kind scan
        alt bearer / openai-admin-read
            NC->>NC: attach Authorization: Bearer <token>
        else raw (ZAI monitor hosts only)
            NC->>NC: attach Authorization: <key> verbatim + Accept-Language
        else ak-sk (qwen only)
            NC->>NC: signed BSS query, no header
        end
        NC->>FT: fetch(request)
        alt non-2xx — status checked BEFORE body parse
            FT-->>NC: HttpStatusError(status) (body never read)
        else 2xx
            FT-->>NC: TransportResponse (parsed JSON)
        end
        NC-->>EN: TransportResponse | throws
        EN->>EN: parsePage — ZAI single-shot: level, 5h/weekly (TOKENS_LIMIT), MCP (TIME_LIMIT)
    end
    EN-->>BG: onUsage | onError
    BG->>BG: classifyRefreshError → 401/403 auth · 429 rate-limit · ≥500 server · TypeError network
    BG->>AC: setBadgeText (ZAI 5h pct% uncapped | level | monetary | ERR)
    BG->>SS: write({results}) — usage+windows | errorClass only (one write per cycle)
    Note over PU: on open (async to the tick)
    PU->>SS: read()
    PU->>PU: render monitor block ⇄ settings (platform selector); zai auth error → wrong-platform guidance
```

## Interfaces / Contracts

```ts
// core/provider.ts
type CredentialType = 'bearer' | 'ak-sk' | 'openai-admin-read' | 'raw';
type Credential =
  | { readonly type: 'bearer' | 'openai-admin-read' | 'raw'; readonly token: string }
  | { readonly type: 'ak-sk'; readonly accessKeyId: string; readonly accessKeySecret: string };

interface UsageQuery {           // final shape after hito-4
  readonly zaiPlatform?: 'zai' | 'zhipu';   // ZAI; absent → 'zai'
  readonly startTime?: number; readonly endTime?: number;  // OpenAI, epoch s
  readonly now?: number;                     // stays for engine/fetchedAt symmetry; ZAI no longer requires it
}                                            // billingMonths + tierLimits REMOVED

// Provider: interPageDelayMs REMOVED (no declarer remains); credentialType is the attach-mode declaration.

// core/zai-platforms.ts (new, popup-safe pure)
type ZaiPlatform = 'zai' | 'zhipu';
const ZAI_PLATFORMS: readonly { readonly id: ZaiPlatform; readonly label: string }[];
function zaiMonitorBaseUrl(platform: ZaiPlatform): string;  // 'https://api.z.ai' | 'https://open.bigmodel.cn'

// storage/zai-platform-store.ts (new)
const ZAI_PLATFORM_STORAGE_KEY = 'qd:pref:zai-platform';
async function readZaiPlatform(local: StorageArea): Promise<ZaiPlatform>;   // default 'zai'
async function writeZaiPlatform(local: StorageArea, platform: ZaiPlatform): Promise<void>;

// core/usage.ts — see AD-26 for MonitorWindows/UsageWindow/McpWindow/McpToolUsage
interface NormalizedUsage {
  readonly providerId: ProviderId;
  readonly kind: 'balance' | 'cost';
  readonly value?: number;        // monetary providers only now
  readonly currency?: string;
  readonly tier?: string;         // generic; ZAI stops setting it
  readonly breakdown?: readonly LineItem[];
  readonly windows?: MonitorWindows;   // ZAI monitor
  readonly fetchedAt: number;
}
// formatBadgeText: windows → `${Math.round(fiveHour.percentage)}%` uncapped | windows.level | '' ; else monetary path.

// providers/zai.ts (rewritten)
class ZaiProvider implements Provider {
  readonly credentialType = 'raw' as const;   // no interPageDelayMs
  firstRequest(query): { method: 'GET', url: `${base}/api/monitor/usage/quota/limit` };  // no query/body
  parsePage(body, null): { done: true, usage: NormalizedUsage };  // single-shot
}
```

## File Changes

Slices: **S1** foundation (additive) · **S2** monitor swap (atomic) · **S3** popup + removals. See Removal Sequencing.

| File | Action | Slice | Description |
|------|--------|-------|-------------|
| `extension/src/core/zai-platforms.ts` (+ `.test.ts`) | Create | S1 | Platform union, labels, base URLs (AD-28) |
| `extension/src/storage/zai-platform-store.ts` (+ `.test.ts`) | Create | S1 | `qd:pref:zai-platform` wrapper; default `'zai'`; local-only (AD-28) |
| `extension/src/fixtures/zai/monitor--pro-plan.json` | Create | S2 | Happy path: level Pro, both windows + MCP |
| `extension/src/fixtures/zai/monitor--over-100.json` | Create | S2 | 5h pct 137 / total 12000 → used 16440, uncapped |
| `extension/src/fixtures/zai/monitor--null-pct.json` | Create | S2 | pct null, no `nextResetTime` → absent pct/used + graceful countdown absence |
| `extension/src/fixtures/zai/monitor--mcp-only.json` | Create | S2 | Only `TIME_LIMIT` → 5h/weekly absent, no error |
| `extension/src/fixtures/zai/monitor--fallback-position.json` | Create | S2 | `TOKENS_LIMIT` without unit/number → positional mapping |
| `extension/src/fixtures/zai/monitor--code-string-200.json` | Create | S2 | String `"200"` code → `ProviderApiError` discipline |
| `extension/src/fixtures/zai/monitor--plain-text-401.json` | Create | S2 | `{ status: 401, body: "Unauthorized" }` — status-first proof |
| `extension/src/core/provider.ts` | Modify | S1+S2 | S1: `raw` type/credential arm, `zaiPlatform` query field. S2: remove `billingMonths`/`tierLimits`, `interPageDelayMs`, docs |
| `extension/src/core/usage.ts` (+ `.test.ts`) | Modify | S1+S3 | S1: `MonitorWindows`, optional value/currency, badge windows branch. S3: delete `BudgetReport`/`budget` |
| `extension/src/core/provider-metadata.ts` (+ `.test.ts`) | Modify | S2 | ZAI `credentialType: 'raw'` |
| `extension/src/core/credentials.ts` (+ `.test.ts`) | Modify | S1 | Docs + `raw` validation cases (string path already type-agnostic) |
| `extension/src/network/client.ts` (+ `.test.ts`) | Modify | S1+S2 | S1: raw attach + monitor-host scoping. S2: contract tests re-pin `api.z.ai` |
| `extension/src/network/request.ts` | Modify | S1 | Docs: raw joins the token scan arm; no rule change |
| `extension/src/network/allowlist.ts` | Modify | S2 | zai hosts → `['api.z.ai', 'open.bigmodel.cn']` (AD-29) |
| `extension/src/network/allowlist.source.test.ts` | Modify | S2 | New pins: exact monitor hosts, apex absent, suffix cases |
| `extension/src/network/manifest.hosts.test.ts` | Modify | S2 | Pinned list four → five hosts |
| `extension/src/network/fetch-transport.test.ts` | Modify | S1 | Plain-text 401/403/429/500 pins; `json()`-rejects stubs (AD-30) |
| `extension/src/storage/key-store.ts` (+ `.test.ts`) | Modify | S1 | `MaskedCredential` type widened with `'raw'`; raw read/mask cases; zero behavior change |
| `extension/src/storage/snapshot-store.ts` (+ `.test.ts`) | Modify | S1+S3 | S1: `isMonitorWindows` validation (alongside budget). S3: remove `isBudgetReport` |
| `extension/src/providers/zai.ts` (+ `zai.test.ts`) | Modify (rewrite) | S2 | Monitor provider + full test rewrite (AD-27) |
| `extension/src/refresh/engine.ts` (+ `engine.test.ts`) | Modify | S2 | Drop `sleepBetweenPages`/`rng`/`interPageDelayMs`; tests pivot multi-page proof to OpenAI |
| `extension/src/background.ts` (+ `background.test.ts`) | Modify | S2 | `buildTickQuery(clock, platform)`; `readZaiPlatform` in; months/limits/rng out; badge/budget routes → monitor URLs; drop `cstEpoch` import |
| `extension/src/popup/view.ts` (+ `view.test.ts`) | Modify | S3 | Monitor block (level, 5h, weekly, MCP rows), platform selector, zai auth guidance; remove `budgetBlock`; `formatUsageText` guards optional value |
| `extension/src/popup/controller.ts` (+ `controller.test.ts`) | Modify | S3 | Selector change-delegation → `writeZaiPlatform`; pref read on load; guidance state |
| `extension/src/testing/provider-refresh.ts` | Modify | S1 | `TEST_CREDENTIALS` gains the exhaustive `raw` entry |
| `extension/src/fixtures/index.ts` | Modify | S2 | Register 7 monitor fixtures; remove 8 expenseBillList routes |
| `extension/src/fixtures/zai/expense-bill-list--*.json` (8 files) | Delete | S2 | Dead surface (pages 1–3, straddle ×2, unextractable, code-500, code-string-200) |
| `extension/public/manifest.json` | Modify | S2 | host_permissions: −bigmodel.cn, +api.z.ai, +open.bigmodel.cn |
| `extension/public/popup.html` | Modify | S3 | Styles: monitor block, windows/MCP rows, selector |
| `docs/spike/endpoints.md` | Modify | S2 | ZAI section rewritten for the monitor surface + JSON block (AD-29) |
| `README.md` | Modify | S3 | ZAI monitor description; host surface note |
| `extension/src/copy.test.ts` | Modify | S3 | Copy pins extended to the monitor language (existing pins unaffected) |
| `extension/src/core/tier-budget.ts` (+ `.test.ts`) | Delete | S3 | Superseded (tier-budget delta REMOVED) |
| `extension/src/storage/limit-store.ts` (+ `.test.ts`) | Delete | S3 | Superseded |

Unchanged: `providers/index.ts`, `providers/{qwen,openai,kimi}.ts` (+tests), `providers/parse-utils.ts`, `core/{registry,credentials-behavior,clock}.ts`, `network/{transport,rpc-signer}.ts` (+tests), `network/fetch-transport.ts` (verified — AD-30), `storage/key-store` behavior, `platform/browser-api.ts`, `popup/main.ts`, `testing/{fake-clock,fake-browser,recording-transport}.ts`, qwen/openai/kimi fixtures.

## Testing Strategy (strict TDD — RED→GREEN per unit; `npm --prefix extension run test`)

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit — platform | Union validation; base URL per platform; store round-trip unmasked; default on absent/invalid; credential namespace unaffected (write pref, re-read key + mask) | Pure calls + `FakeBrowser.local` |
| Unit — network | Raw attach: verbatim `Authorization` (no Bearer) + `Accept-Language` on monitor host; raw off-host → `NetworkRejectionError`, zero I/O; bearer/admin/ak-sk regressions | `RecordingTransport`; recorded-header sweep |
| Unit — fetch transport | Plain-text 401/403/429/500: `HttpStatusError(status)`, `json()` never called (rejecting stub); 2xx non-JSON → `ResponseParseError` | Stub `fetchImpl`; zero network |
| Unit — parser | Discriminated windows; positional fallback; MCP-only; null-pct absence; >100% uncapped + derived used; `nextResetTime` countdown basis + graceful absence; MCP no synthesized fields; numeric-code discipline; single request per refresh; platform-selected URL; invalid `zaiPlatform` throws pre-dispatch | Monitor fixtures via `driveRefresh` over the real client + `RecordingTransport` |
| Unit — model/badge | `MonitorWindows` on `NormalizedUsage`; badge `137%` uncapped; absent pct → level; absent both → `''`; monetary regressions; snapshot windows validation accepts/rejects | Pure functions; literal cases |
| Unit — engine | Single-shot zai (one dispatch, zero sleeps); OpenAI multi-page still walks `next`; failure propagation; refreshAll order/skip | Existing harness, monitor fixtures |
| Unit — worker | Tick reads platform store → query carries `zaiPlatform`; routes keyed at platform-selected URL; badge `137%`/level/ERR; snapshot windows; auth class on plain-text 401 | `FakeAlarms.fire` harness; `FixtureTransport` routes |
| Unit — popup | Selector defaults/persists unmasked and switches rendered state; monitor block rows; wrong-platform guidance on zai+auth; determinism; settings isolation | happy-dom (controller), node env (view) |
| E2E | Maintainer live: real key → plan level + real 5h percentage in one tick; wrong-platform key → ERR + auth guidance; ZHIPU key + selector → `open.bigmodel.cn` success | Manual unpacked load; hermetic suite stays network-free |

**RED example — parser windows (S2, final form):**

```ts
it('passes the 5h percentage through uncapped and derives used from total', async () => {
  const provider = new ZaiProvider();
  const transport = new RecordingTransport([FIXTURE_RESPONSES['zai/monitor--over-100']]);
  const usage = await driveRefresh(provider, { zaiPlatform: 'zai' },
    new AllowlistNetworkClient(transport), new FakeClock());
  expect(transport.requests).toHaveLength(1);            // single-shot, no query/body
  expect(usage.windows?.level).toBe('Pro');
  expect(usage.windows?.fiveHour?.percentage).toBe(137); // uncapped — NOT 100
  expect(usage.windows?.fiveHour?.used).toBe(16_440);    // round(12000 × 137 / 100)
  expect(usage.windows?.fiveHour?.total).toBe(12_000);
  expect(usage.windows?.weekly).toBeDefined();
  expect(usage.windows?.mcp).toBeDefined();
});
```

RED: `usage.windows` does not exist and the provider still demands `billingMonths` → type + assertion failures. GREEN: AD-26 model + AD-27 parser over the recorded fixture.

**RED example — raw-header contract (S1, final form; S1 pins the same assertions against the then-allowlisted zai host, S2 re-pins to `api.z.ai`):**

```ts
it('attaches raw credentials verbatim (no Bearer) with Accept-Language on the monitor host', async () => {
  const transport = new RecordingTransport([{ status: 200, body: { code: 200, data: {} } }]);
  const client = new AllowlistNetworkClient(transport);
  await client.send('zai',
    { method: 'GET', url: 'https://api.z.ai/api/monitor/usage/quota/limit' },
    { type: 'raw', token: 'zai-monitor-key' });
  expect(transport.requests[0]!.headers['Authorization']).toBe('zai-monitor-key'); // verbatim
  expect(transport.requests[0]!.headers['Accept-Language']).toBeDefined();
});

it('rejects raw attach off the ZAI monitor hosts — zero transport I/O', async () => {
  const transport = new RecordingTransport();
  const client = new AllowlistNetworkClient(transport);
  await expect(client.send('kimi',
    { method: 'GET', url: 'https://api.moonshot.cn/v1/users/me/balance' },
    { type: 'raw', token: 'zai-monitor-key' })).rejects.toThrow(NetworkRejectionError);
  expect(transport.requests).toHaveLength(0);
});
```

Commands: `npm --prefix extension run test` (RED→GREEN loop), `run typecheck`, `run build`.

## Removal Sequencing & Slice Pre-Plan (for sdd-tasks)

Green-at-every-commit rule: tests move in the SAME commit as their subject. Coupling discovered during design: the allowlist change breaks the old provider's tests (its host dies) and the old provider's URL is baked into `background.test` routes and `engine.test` flows — so allowlist+manifest+doc+zai+fixtures+engine+background are ONE atomic review unit (S2), not independently committable steps.

1. **S1 — Foundation (additive, ~350 lines)**: `raw` credential type/attach/scoping (+ client/request/key-store/credentials/metadata-independent tests), `core/zai-platforms` + platform store, `MonitorWindows` model + snapshot validation + badge branch, `fetch-transport` plain-text pins, `provider-refresh` raw credential. Nothing removed; old zai untouched (raw scoping tests pin the interim zai host). Verify: suite + typecheck.
2. **S2 — Monitor swap (atomic, ~900 lines — OVER the 400-line budget)**: allowlist + manifest + spike doc (+ sync tests), zai rewrite + credentialType flip (`zai.ts`, `zai.test.ts`, `provider-metadata`), 7 monitor fixtures in / 8 expenseBillList fixtures out, `fixtures/index`, `provider.ts` strip (months/limits/interPageDelay), engine jitter removal + test pivot to OpenAI, background rewire (+tests; drop `cstEpoch` import), client contract re-pin. After S2, `tier-budget` and `limit-store` have ZERO production references (their standalone tests stay green until S3). Verify: suite + typecheck + build + manifest sync.
3. **S3 — Popup + removals (~450 lines)**: monitor block + selector + guidance (view/controller + popup.html + tests), delete `tier-budget`/`limit-store` (+tests), remove `BudgetReport`/`budget` validation/`budgetBlock`, README + copy pins. Verify: full suite + build + manual unpacked load (maintainer live E2E per proposal).

Forecast guard lines `sdd-tasks` must emit: `Decision needed before apply: Yes`, `Chained PRs recommended: Yes`, `400-line budget risk: High` (S2 alone exceeds the budget even after S1/S3 carve-outs; with `delivery_strategy=ask-on-risk` the maintainer must decide chained PRs S1→S2→S3 with S2 as an accepted swap-sized slice or a further split at the cost of review coupling).

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. (Outbound egress stays bounded by the per-provider allowlist, the credential-placement scan with the two sanctioned exceptions, and the AD-16 manifest sync test; the raw-attach exception is scoped to the two monitor hosts and pinned by zero-I/O rejection tests.)

## Migration / Rollout

No credential migration: stored ZAI keys are plain strings read type-aware as `raw` — bytes unchanged. Platform preference absent → default `'zai'` (no write needed until the user selects). Stale snapshots: a pre-hito-4 snapshot's `usage.budget` field is simply ignored by the new validator (extra keys don't invalidate) — it renders without a monitor block until the next tick (≤1 min) rewrites it; transient by design (hito-3 precedent). Manifest host change requires an extension reload in unpacked dev; Chrome surfaces the new cross-origin hosts. Rollback per proposal: hard-reset to hito-3 head `6c537be` (verified: archive commit); main specs change only at archive.

## Open Questions

- [ ] Monitor payload field pinning beyond the spec: `tokenLimits` discriminator values (unit 3/number 5, unit 6/number 1), `usageDetails` shape (object map vs array), and `data.level` value spelling are community-pinned (`zai-org/zai-coding-plugins`, `ecerutti/glm-usage-monitor`, `guyinwonder168/opencode-glm-quota`); the maintainer live E2E confirms and fixtures re-pin if the live shape differs (fixture-driven parser keeps the drift bounded — hito-3 `customerId` precedent).
- [ ] `Accept-Language` value `'zh-CN'` is cosmetic (presence is the contract); revisit only if the live API misbehaves.
- [ ] Fractional percentages: evidence shows integers; the model carries the exact value and the badge rounds for display — if the live API emits fractions, decide whether the badge keeps rounding.
