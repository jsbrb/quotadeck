# Design: Hito 3 — Live Usage

## Technical Approach

The hito-1 seam does its job: live usage is a transport swap plus per-type credential attachment. `FetchTransport` (real `fetch`) replaces the fixture table as the production `Transport`; `AllowlistNetworkClient` stays the only credential attacher and learns three attach modes (Bearer, OpenAI-admin Bearer, Alibaba RPC signature). Qwen gains an AK/SK pair end-to-end (settings input → `qd:key:qwen` JSON pair → masked display → HMAC-SHA1 signer). ZAI parsing moves from cost-primary to window semantics: a pure `core/tier-budget.ts` module computes the trailing-5h `apiUsage` sum, tier, capped percentage, and countdown, fed by a two-month fetch driven through the existing pagination state machine. Failures are classified into a five-class taxonomy carried on the cycle snapshot. The popup splits into a per-model consumption main view and a gear-driven settings view. The manifest gains `host_permissions` equal to exactly the allowlist union (AD-16, superseding AD-7).

Maps to proposal §Approach; implements the `tier-budget` delta and the five modified capabilities (`provider-framework`, `usage-badge`, `popup-ui`, `key-storage`, `network-allowlist`).

## Architecture Decisions

Numbering continues the project sequence (hito-1 = AD-1..AD-9, hito-2 = AD-10..AD-15).

### AD-16: `host_permissions` = exact allowlist union, pinned by a sync test (supersedes AD-7)

**Choice**: `public/manifest.json` gains `host_permissions` containing exactly one `https://{host}/*` pattern per host in the union of `PROVIDER_ALLOWLIST` (`bigmodel.cn`, `business.aliyuncs.com`, `api.openai.com`, `api.moonshot.cn`). New `extension/src/network/manifest.hosts.test.ts` (same pattern as `allowlist.source.test.ts`) derives the expected set from `PROVIDER_ALLOWLIST` and deep-strict-equals it against the manifest file — extra or missing hosts fail the build.
**Alternatives**: (a) Broad `<all_urls>` / optional host grants — rejected: grants far more surface than four known hosts. (b) Optional (`optional_host_permissions`) with runtime request — rejected: adds a permission flow this milestone does not need; the badge refreshes unattended.
**Rationale**: `network-allowlist` §Manifest Host Permissions Consistency requires exact equality. Increased surface, stated honestly: cross-origin fetch to these four hosts is now possible from the worker. Mitigations already in place: suffix-scoped per-provider checks (AD-5), credentials only via header or the scoped RPC exception (AD-19), the credential-placement scan, and this sync test — a host added to the manifest without allowlist+spec evidence fails CI.

### AD-17: Qwen AK/SK — two settings fields, JSON pair under `qd:key:qwen`, both parts masked

**Choice**: Input convention = two separate fields (AccessKeyId, AccessKeySecret) in the settings view; `validateCredential` grows an `ak-sk` pair mode rejecting empty/missing parts and DashScope `sk-` values (either part) with the existing `QWEN_AK_SK_GUIDANCE`. Storage shape = one JSON object `{ accessKeyId, accessKeySecret }` under the existing `qd:key:qwen` key. `KeyStore` generalizes to type-aware methods (`saveCredential`/`readCredential`/`readMaskedCredential`/`revokeCredential` over a `Credential` union); token providers keep today's plain-string bytes, so no migration. Display = each part independently masked (`••••` + ≤4 suffix, existing `MASK_SUFFIX_LENGTH`); revoke removes the single key → both parts atomically.
**Alternatives**: (a) One delimited input field (`"AK SK"`) — rejected: error-prone, and a secret containing the delimiter breaks round-trips. (b) Two storage keys (`qd:key:qwen:ak` / `:sk`) — rejected: breaks atomic revocation and per-provider isolation guarantees. (c) Keep string API and store the pair as a delimited string — rejected for the same round-trip reason as (a).
**Rationale**: `key-storage` §Qwen AK/SK Pair Persistence (round-trip, per-part masking, atomic revoke). A legacy plain string stored under `qd:key:qwen` by hito-2 reads as `undefined` (not a pair) — the user re-enters; no unparseable credential ever reaches the signer.

### AD-18: Alibaba RPC HMAC-SHA1 signer — pure module, injected timestamp/nonce, Web Crypto only

**Choice**: New `extension/src/network/rpc-signer.ts`. `signBssQuery(baseParams, accessKeySecret, { timestamp, nonce })` is async-pure and deterministic: merge `{...baseParams, SignatureMethod:'HMAC-SHA1', SignatureVersion:'1.0', SignatureNonce:nonce, Timestamp:timestamp}`; percent-encode keys and values RFC-3986-style (`encodeURIComponent` + `*`→`%2A`, `%7E`→`~`); sort by key; join `k=v` with `&`; `StringToSign = 'GET&%2F&' + pe(canonical)`; `Signature = Base64(HMAC-SHA1(secret + '&', StringToSign))` via `crypto.subtle` (importKey/sign). Returns the signed query params. BSS 2017-12-14 canonicalization per spike evidence. The secret enters this function and the credential-scan — nowhere else; only the derived `Signature` and `AccessKeyId` are transmitted.
**Alternatives**: (a) Node `crypto` — unavailable in an MV3 service worker. (b) A hand-rolled SHA-1/HMAC — rejected outright for a security boundary. (c) URLSearchParams for encoding — rejected: it encodes space as `+` (form-urlencoded), producing wrong signatures.
**Rationale**: `provider-framework` §Qwen AK/SK Pair Handling ("secret never transmitted; only derived signatures"). SubtleCrypto is the only HMAC in a worker; injecting timestamp/nonce keeps the module unit-testable against a pinned vector (computed offline with Node `crypto` over the identical canonicalization — see Testing).

### AD-19: Live transport + per-type auth attach, with a Qwen-scoped credential-scan exception

**Choice**: New `extension/src/network/fetch-transport.ts`: `FetchTransport implements Transport` over an injectable `fetch` implementation; non-2xx → `HttpStatusError(status)` (no body text — untrusted surface, AD-13 spirit); JSON parse failure → `ResponseParseError`. `FixtureTransport` stays in `transport.ts` as a test double, no longer referenced by `background.ts`. `AllowlistNetworkClient.send(providerId, request, credential: Credential)` attaches by type: `bearer` and `openai-admin-read` → `Authorization: Bearer <token>` (unchanged); `ak-sk` → reject if `providerId !== 'qwen'`; build BSS params from `request.query` + `AccessKeyId`; sign via AD-18 with `Timestamp` from an injected `Clock` and `SignatureNonce` from an injected rng (`crypto.randomUUID()` default); dispatch with the signed query and NO `Authorization` header. The scan (`assertNoCredentialMaterial`) becomes credential-kind aware: token credentials — unchanged full scan; `ak-sk` — the secret is scanned across url/query/body and must never appear; `AccessKeyId` may appear in the query only when the host is allowlisted for `qwen` (`business.aliyuncs.com`), otherwise `'credential-placement'` rejection.
**Alternatives**: (a) Providers sign their own requests — rejected: hands the secret to provider modules and bypasses the single-attacher guarantee (AD-3). (b) An unscoped "signing allowed" scan bypass — rejected: the spec delta scopes the exception to the Qwen BSS host only.
**Rationale**: `network-allowlist` §Credentials Only in Authorization Header (modified): Bearer/admin unchanged; RPC exception exactly for Qwen; secret never transmitted; "signed-style credentials rejected off the Qwen host" becomes a scan unit test. `AuthorizedRequest.headers` may now be `{}` for the Qwen path — headers remain client-exclusive.

### AD-20: `tier-budget` — pure computation, injected clock, code defaults + storage override, one timezone

**Choice**: New `extension/src/core/tier-budget.ts`, zero I/O: `epochFromBillingNo(billingNo, customerId)` (13 chars after the first `customerId` occurrence; anything else → `undefined` → record excluded deterministically); `billingMonthsFor(now)` (window start `now − 5h`; returns `[current]` or `[previous, current]`, oldest first); `evaluateBudget(records, { now, tierLimits })` → `BudgetReport { used, limit?, percent?, tier?, resetAt? }` with `percent = min(round(used/limit × 100), 100)` and `resetAt` = latest in-window record's `timeWindow` end; `timeWindow` absent → `resetAt` undefined, never an error. Limits live in code defaults `DEFAULT_TIER_LIMITS = { Lite: 2400, Pro: 12000, Max: 48000 }`, overridable via an optional `chrome.storage.local` key `qd:tier-limits` (`Record<tier, limit>`) read through a new `storage/limit-store.ts` wrapper (invalid shape → defaults). Timezone discipline: everything internal is epoch ms; the single declared zone is **UTC+8 fixed offset** (Asia/Shanghai — ZAI's platform zone, no DST): `cstEpoch(y,m,d,h,mi,s) = Date.UTC(...) − 8h` and a pure `cstParts(epochMs)` for `YYYY-MM` formatting and month-boundary decisions. No string date comparisons anywhere.
**Alternatives**: (a) Settings UI for limits — out of scope this milestone; storage override is the minimal configurability the spec demands. (b) Browser-local timezone — rejected: membership decisions would change with the user's zone. (c) `Intl` time zones — rejected: a fixed +08:00 offset is pure arithmetic, no formatter dependency.
**Rationale**: `tier-budget` §Timezone Discipline (epoch ordering decides membership) and §Configurable Tier Limits; clock injectability per `usage-badge` (no wall-clock reads inside logic).

### AD-21: Error taxonomy — signal → class, honestly pinned

**Choice**: New `extension/src/refresh/error-taxonomy.ts`: `ErrorClass = 'auth' | 'rate-limit' | 'server' | 'network' | 'unknown'` and pure `classifyRefreshError(error)`. Mapping: `HttpStatusError` 401/403 → `auth`, 429 → `rate-limit`, ≥500 → `server`, other statuses → `unknown`; `TypeError` (fetch network failure) → `network`; `ResponseParseError` (JSON parse) → `unknown`; `ProviderApiError` (body-level non-200 status — ZAI numeric `code !== 200`) → `server`; anything else → `unknown`. `background.refreshTick` classifies in `onError`; the snapshot error entry carries `errorClass`; the badge shows `ERR` regardless of class.
**Alternatives**: (a) Classify inside providers — rejected: providers would need HTTP status they never see; taxonomy is a refresh-layer concern. (b) Message-string matching — rejected: fragile, untestable-in-spirit.
**Rationale**: `usage-badge` §Error Taxonomy Mapping. Honest 429 pin: the spike (`docs/spike/endpoints.md`) documents **no body-level rate-limit signal for any of the four providers** — only the HTTP 429 status is classified as `rate-limit`; "documented rate-limit signal" remains an extension point until a provider documents one. ZAI's in-body `code` covers its non-200 semantics as `server`.

### AD-22: Popup layout — main consumption view + gear settings view + extended snapshot

**Choice**: `PopupState` gains `view: 'main' | 'settings'`. `view.ts` splits into `renderMain` (default) and `renderSettings`; the header of each carries the switch (`data-action="open-settings"` gear / `data-action="back"`), wired by the existing controller click delegation — state flip + re-render, no routing. Main view: per-provider sections — ZAI budget block (percentage + limit + countdown via pure `formatResetCountdown(resetAt, nowMs)`; countdown line simply omitted when absent), OpenAI provider total plus per-model rows from `usage.breakdown` (sorted by model then usageType for determinism), Kimi/Qwen provider-level balances, and error entries rendered with a per-class label (`Auth failed`, `Rate limited`, …). Settings view: all key management moves here (per-provider forms; Qwen = AK + SK password fields per AD-17); the main view renders NO key forms. `NormalizedUsage` gains optional `budget?: BudgetReport` (defined in `core/usage.ts` next to the result shape); `ProviderSnapshotEntry`'s error arm gains required `errorClass`; the snapshot shape-validator extends accordingly (budget validated when present).
**Alternatives**: (a) Two HTML pages — rejected: a second bundle entry + manifest change for a view flip the controller already handles. (b) `<dialog>` overlay — rejected: same DOM, more a11y surface, no spec need. (c) Keep inline forms and add the gear — violates the spec scenario "no inline key entry form appears in the main view".
**Rationale**: `popup-ui` §Settings Gear Surface + §Per-Model Consumption View (deterministic rendering kept by pure string views); snapshot extension per §Current Cycle Data on Open (error states included, now with class).

### AD-23: ZAI window semantics through the existing pagination state machine

**Choice**: `UsageQuery` changes: `billingMonth` → `billingMonths: readonly string[]` (oldest first), plus `now` (epoch ms) and `tierLimits`. `zai.ts` keeps its AD-2 opaque fold: state now carries the months queue, the current month's cursor/dedupe set, and collected per-record extracts `{ apiUsage, epochMs, tokenResourceName, timeWindowEnd, cost }`. A month is done when `total` is reached; if months remain, `parsePage` returns `next` with the next `billingMonth` — the engine and its inter-page jitter are untouched. On final fold the provider runs `evaluateBudget` with `query.now`/`query.tierLimits` → `usage.budget`, and `usage.tier` = in-window latest `tokenResourceName` (replacing last-write-wins). Cost stays informational. `timeWindow` parses on the `~` separator; the end timestamp parses in the AD-20 fixed +08:00 zone. Fixtures are ours, so the five ZAI fixture files are re-recorded to the community shape: `~`-separated `timeWindow`, per-record `apiUsage`, and `billingNo`s embedding `customerId` + 13-digit epoch; new fixtures cover the straddle (two months) and unextractable-epoch cases.
**Alternatives**: (a) Engine learns "months" — rejected: breaks state opacity (AD-2) for a provider concern. (b) Two separate refresh cycles for straddle months — rejected: two folds, two badges, double jitter; the state machine already generalizes. (c) Window computed in background from raw records — rejected: background would need ZAI payload knowledge.
**Rationale**: `provider-framework` §ZAI Parsing (modified) + `tier-budget` §Month-Straddle Fetching. `customerId` sourcing: taken from the page payload when present (fixtures pin it at `data.customerId`); absent → all epochs unextractable → budget fields gracefully absent while cost still reports (§Unextractable record excluded). See Open Questions for the live-field caveat.

### AD-24: Carry-overs — provider metadata module, testable Enter handling, copy updates

**Choice**: (1) New `extension/src/core/provider-metadata.ts`: `PROVIDER_METADATA: readonly { id, displayName, credentialType }[]` in AD-6 order; `providers/index.ts` builds the registry from it; the popup imports metadata only — provider classes (and their dead endpoint-URL constants) leave the popup bundle. The import-boundary assertion in `controller.test.ts` extends its regex to `../(network|fixtures|providers)`. (2) The `submit`-event Enter backstop (real-browser-only, untestable in happy-dom) is REPLACED by a `keydown` Enter handler on credential inputs — dispatchable in happy-dom, so the Enter path gets a real RED→GREEN test; the `defaultPrevented` dance is deleted. (3) Copy: `README.md` loses all "fixture-only milestone" language (status section, security posture, popup notes rewritten for live fetch, `host_permissions`, gear/settings, per-model view); `public/manifest.json` description becomes "Provider usage and balance badge".
**Alternatives**: (a) Keep the submit backstop with a "real-browser-only" test note — rejected under strict TDD: an untestable path is exactly what the backstop removal avoids. (b) Popup keeps importing `createDefaultRegistry` — rejected: ships provider URL constants and parse code to a page forbidden to use them.
**Rationale**: Proposal §Approach ("Design-deferred … carry-overs: dead URLs; Enter backstop"); `popup-ui` REMOVED Fixture-Only Operation makes the copy honest again.

## Data Flow

    alarm tick ─▶ background: buildTickQuery(clock.now, limits) ─▶ RefreshEngine
                                                        │ per keyed provider (registry order)
        KeyStore.readCredential(id, type) ──▶ Credential ─┤
                                                        ▼
                              AllowlistNetworkClient ── attach ──▶ FetchTransport (real fetch)
                                  │  bearer/admin → Authorization      │
                                  │  ak-sk → sign (AD-18) → query      ▼
                                  ▼                              response | typed error
                              Provider.parsePage (fold, opaque state; ZAI walks billingMonths)
                                                        │
                              tier-budget.evaluateBudget (pure, epoch ms, +08:00)
                                                        │
                          badge (formatBadgeText | ERR) ─┴─▶ SnapshotStore qd:snapshot
                                                        │            (usage+budget | errorClass)
    popup open ─▶ controller (view state) ─▶ pure views (main | settings) ─▶ #app

## Sequence Diagram — live alarm tick (config rule: complex flows)

```mermaid
sequenceDiagram
    participant AL as chrome.alarms
    participant BG as background.ts
    participant LS as LimitStore
    participant EN as RefreshEngine
    participant KS as KeyStore
    participant NC as AllowlistNetworkClient
    participant SG as rpc-signer
    participant FT as FetchTransport
    participant TB as tier-budget
    participant SS as SnapshotStore
    participant AC as chrome.action
    participant PU as popup/controller

    AL->>BG: onAlarm("usage-refresh")
    BG->>LS: read() (qd:tier-limits)
    BG->>BG: buildTickQuery(clock.now): billingMonths (+08:00), now, startTime/endTime, tierLimits
    BG->>EN: refreshAll(query)
    loop each keyed provider (registry order)
        EN->>KS: readCredential(id, credentialType)
        EN->>NC: send(id, firstRequest(query), credential)
        NC->>NC: host check + credential-kind scan (secret never anywhere; AK query only on Qwen host)
        alt bearer / openai-admin-read
            NC->>NC: attach Authorization: Bearer
        else ak-sk (qwen only)
            NC->>SG: signBssQuery(query+common, secret, {clock timestamp, rng nonce})
            SG-->>NC: signed query + Signature (secret stays here)
        end
        NC->>FT: fetch(request)
        FT-->>NC: 2xx JSON | HttpStatusError | ResponseParseError | TypeError
        NC-->>EN: TransportResponse
        EN->>EN: parsePage fold (ZAI: dedupe, months queue; jitter 500–2000 ms between pages)
    end
    opt provider = zai (final fold)
        EN->>TB: evaluateBudget(records, {now, tierLimits})
        TB-->>EN: BudgetReport (used, limit, %, tier, resetAt?)
    end
    EN-->>BG: onUsage | onError
    BG->>TB: classifyRefreshError(error)
    BG->>AC: setBadgeText(value text | "ERR")
    BG->>SS: write({results}) — usage+budget | error+errorClass (one write per cycle)
    Note over PU: on open (async to the tick)
    PU->>SS: read()
    PU->>PU: render main view (per-model/budget) ⇄ settings view (gear)
```

## Interfaces / Contracts

```ts
// core/provider.ts — Credential union (CredentialType unchanged)
type Credential =
  | { readonly type: 'bearer' | 'openai-admin-read'; readonly token: string }
  | { readonly type: 'ak-sk'; readonly accessKeyId: string; readonly accessKeySecret: string };

// UsageQuery (modified): billingMonth -> billingMonths; clock-derived now; optional limits
interface UsageQuery {
  readonly billingMonths?: readonly string[];      // ZAI, YYYY-MM, oldest first
  readonly startTime?: number; readonly endTime?: number;  // OpenAI, epoch s
  readonly now?: number;                            // epoch ms, from the injected Clock
  readonly tierLimits?: Readonly<Record<string, number>>;
}

// network/rpc-signer.ts
function signBssQuery(base: Record<string, string>, secret: string,
  inputs: { timestamp: string; nonce: string }): Promise<{ query: Record<string, string>; signature: string }>;

// network/fetch-transport.ts
class FetchTransport implements Transport { constructor(fetchImpl?: typeof fetch) }  // throws HttpStatusError | ResponseParseError

// core/tier-budget.ts
interface BudgetRecord { apiUsage: number; epochMs: number | undefined;
  tokenResourceName?: string; timeWindowEnd?: number }
interface BudgetReport { used: number; limit: number | undefined; percent: number | undefined;
  tier: string | undefined; resetAt: number | undefined }
function epochFromBillingNo(billingNo: string, customerId: string | undefined): number | undefined;
function billingMonthsFor(now: number): readonly string[];
function evaluateBudget(records: readonly BudgetRecord[], opts: { now: number;
  tierLimits: Readonly<Record<string, number>> }): BudgetReport;
const DEFAULT_TIER_LIMITS: Readonly<Record<string, number>>; // Lite 2400 / Pro 12000 / Max 48000

// refresh/error-taxonomy.ts
type ErrorClass = 'auth' | 'rate-limit' | 'server' | 'network' | 'unknown';
function classifyRefreshError(error: unknown): ErrorClass;

// storage/snapshot-store.ts (extended entries)
type ProviderSnapshotEntry =
  | { readonly status: 'ok'; readonly usage: NormalizedUsage }          // usage.budget?
  | { readonly status: 'error'; readonly errorClass: ErrorClass };      // no other payload (AD-13)

// storage/key-store.ts — type-aware surface (token bytes unchanged; qwen = JSON pair)
readCredential(id, type): Promise<Credential | undefined>;
readMaskedCredential(id, type): Promise<MaskedCredential | undefined>;  // both parts masked for ak-sk
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `extension/src/network/fetch-transport.ts` (+ `.test.ts`) | Create | Live `Transport` over injectable `fetch`; typed errors carry status only |
| `extension/src/network/rpc-signer.ts` (+ `.test.ts`) | Create | Pure BSS HMAC-SHA1 signer + RFC-3986 encoder (AD-18) |
| `extension/src/network/manifest.hosts.test.ts` | Create | manifest `host_permissions` == `PROVIDER_ALLOWLIST` union sync test (AD-16) |
| `extension/src/core/tier-budget.ts` (+ `.test.ts`) | Create | Window sum, tier, %, countdown, straddle months, +08:00 helpers (AD-20) |
| `extension/src/core/provider-metadata.ts` (+ `.test.ts`) | Create | Popup-safe metadata module; registry derives from it (AD-24) |
| `extension/src/refresh/error-taxonomy.ts` (+ `.test.ts`) | Create | Signal → class mapping (AD-21) |
| `extension/src/storage/limit-store.ts` (+ `.test.ts`) | Create | Optional `qd:tier-limits` override wrapper (AD-20) |
| `extension/src/network/client.ts` | Modify | `Credential`-typed attach: Bearer/admin header, ak-sk signing; clock+rng deps (AD-19) |
| `extension/src/network/request.ts` | Modify | Credential-kind-aware scan with the Qwen-host-scoped AK exception (AD-19) |
| `extension/src/network/transport.ts` | Modify | Docs only: `FixtureTransport` is test-only; headers may be `{}` |
| `extension/src/network/client.test.ts` | Modify | ak-sk attach paths, secret-never-transmitted, off-Qwen-host rejection |
| `extension/src/core/provider.ts` | Modify | `Credential` union; `UsageQuery` fields (AD-23) |
| `extension/src/core/credentials.ts` (+ `.test.ts`) | Modify | Pair validation: empty parts + `sk-` rejection (AD-17) |
| `extension/src/core/usage.ts` (+ `.test.ts`) | Modify | `BudgetReport` on `NormalizedUsage` |
| `extension/src/storage/key-store.ts` (+ `.test.ts`) | Modify | Type-aware API; qwen pair round-trip, dual masking, atomic revoke (AD-17) |
| `extension/src/storage/snapshot-store.ts` (+ `.test.ts`) | Modify | `errorClass` + `budget` shape validation (AD-21/22) |
| `extension/src/providers/zai.ts` (+ `zai.test.ts`) | Modify | Window semantics, months queue, apiUsage/epoch/timeWindow, budget fold (AD-23) |
| `extension/src/providers/index.ts` (+ `index.test.ts`) | Modify | Registry built from `PROVIDER_METADATA` (AD-24) |
| `extension/src/refresh/engine.ts` (+ `engine.test.ts`) | Modify | `refresh(provider, query, credential: Credential)`; `readCredential` per type |
| `extension/src/background.ts` (+ `background.test.ts`) | Modify | `FetchTransport` default; clock-derived `buildTickQuery`; classification; snapshot carries class+budget; `FIXTURE_QUERY`/`FIXTURE_ROUTES` removed |
| `extension/src/popup/view.ts` (+ `view.test.ts`) | Modify | `renderMain`/`renderSettings`, gear, per-model rows, countdown, class labels (AD-22) |
| `extension/src/popup/controller.ts` (+ `controller.test.ts`) | Modify | View switching, settings forms (qwen pair), keydown-Enter, boundary regex + `providers` (AD-22/24) |
| `extension/public/popup.html` | Modify | Styles: gear/back header, budget line, model rows, settings view |
| `extension/public/manifest.json` | Modify | `host_permissions` (4 hosts); description copy (AD-16/24) |
| `extension/src/fixtures/zai/*.json` | Modify | Re-recorded: `apiUsage`, `~` timeWindow, epoch-bearing `billingNo`; + straddle & unextractable fixtures (new files under same dir, registered in `fixtures/index.ts`) |
| `extension/src/fixtures/index.ts` | Modify | Register new ZAI fixtures |
| `README.md` | Modify | Kill fixture-only language; live security posture incl. `host_permissions` (AD-24) |

No deletions; `qwen.ts`, `openai.ts`, `kimi.ts`, `platform/browser-api.ts`, `build.mjs`, `testing/*` are unchanged.

## Testing Strategy (strict TDD — RED→GREEN per unit; `npm --prefix extension run test`)

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit — signer | Pinned BSS vector (below); encoding edge cases (`*`, `~`, `:`); secret absent from output params | Pure calls; vector computed offline with Node `crypto` over the identical canonicalization |
| Unit — budget | Window sum, epoch extraction (present/absent customerId), latest-tier, default vs overridden limits, unknown tier → percent absent, rounding, cap at 100, countdown derived/absent, straddle/no-straddle months, epoch-vs-string ordering | Pure functions + `FakeClock`-style literal epochs |
| Unit — network | Per-type attach; qwen-only ak-sk; secret never in any surface (recorded request sweep); AK-in-query allowed only on `business.aliyuncs.com`; off-host → `NetworkRejectionError`; manifest sync (AD-16) | `RecordingTransport` (`src/testing/`); manifest test reads `public/manifest.json` |
| Unit — fetch transport | 2xx body passthrough; 401/429/500 → `HttpStatusError(status)`; malformed JSON → `ResponseParseError`; network `TypeError` | Stub `fetchImpl`; zero real network |
| Unit — taxonomy | Table-driven: every signal class → expected class; unknown fallback | Direct construction of typed errors |
| Unit — key store | Pair round-trip; both parts masked ≤4; revoke removes both; legacy qwen plain string → `undefined`; token providers byte-identical to hito-2 | `FakeBrowser.local` |
| Unit — ZAI | apiUsage sum in-window only; straddle walks both `billingMonth`s through the state machine (jitter sleeps = pages−1); dedupe; latest-record tier; cost informational; non-numeric/non-200 code rejection; unextractable epoch excluded | Recorded pages via existing provider-test harness |
| Unit — worker | Tick derives query from injected clock (months/window); error entries carry class; badge `ERR` for every class; one snapshot write incl. budget; recovery replaces ERR | `FakeAlarms.fire` harness in `background.test.ts` |
| Unit — popup | Gear present, no inline forms in main; view switching; per-model rows only when breakdown present; determinism (render twice); settings isolation (revoke zai ≠ kimi); Enter submits via keydown; full keys/pair absent from DOM; import boundary incl. `providers` | happy-dom pragma (controller), node env (view) |
| E2E | Maintainer live checks per proposal: stored ZAI key → live 5h percentage in one tick; bad key → `ERR` + auth class; other creds → values; revoke → skipped | Manual unpacked load; hermetic suite stays network-free |

**RED example — signer (vector pre-computed offline, design-verified):**

```ts
it('produces the pinned signature for a fixed BSS vector', async () => {
  const { signature } = await signBssQuery(
    { AccessKeyId: 'LTAI5tTestAccessKeyId', Action: 'QueryAccountBalance',
      Format: 'JSON', Version: '2017-12-14' },
    'TestSecretKey0000000000000000000000',
    { timestamp: '2026-09-05T08:00:00Z', nonce: '9e7f80c0-test-nonce-0001' },
  );
  expect(signature).toBe('xmAUc1KiUFczd0HBbplKPgXLEDU=');
});
```

RED: `./rpc-signer` does not exist → import fails. GREEN: encoder + canonicalization + SubtleCrypto HMAC. StringToSign for this vector is `GET&%2F&AccessKeyId%3DLTAI5tTestAccessKeyId%26Action%3DQueryAccountBalance%26Format%3DJSON%26SignatureMethod%3DHMAC-SHA1%26SignatureNonce%3D9e7f80c0-test-nonce-0001%26SignatureVersion%3D1.0%26Timestamp%3D2026-09-05T08%253A00%253A00Z%26Version%3D2017-12-14` (keys `SignatureMethod/SignatureNonce/SignatureVersion/Timestamp` are merged as common params before canonicalization).

**RED example — budget math:**

```ts
const HOUR = 3_600_000;
it('caps percentage at 100 and derives countdown from the latest in-window timeWindow', () => {
  const now = cstEpoch(2026, 9, 5, 12, 0, 0);           // fixed +08:00 instant
  const resetAt = now + 2 * HOUR;
  const report = evaluateBudget(
    [
      { apiUsage: 10_000, epochMs: now - 4 * HOUR, tokenResourceName: 'Pro',  timeWindowEnd: now + HOUR },
      { apiUsage: 20_000, epochMs: now - 1 * HOUR, tokenResourceName: 'Lite', timeWindowEnd: resetAt },
      { apiUsage: 99_999, epochMs: now - 6 * HOUR, tokenResourceName: 'Max',  timeWindowEnd: now - 5 * HOUR }, // out of window
    ],
    { now, tierLimits: {} },                              // defaults: Lite 2400 / Pro 12000 / Max 48000
  );
  expect(report.used).toBe(30_000);                       // out-of-window record excluded
  expect(report.tier).toBe('Lite');                       // latest in-window record wins
  expect(report.limit).toBe(2400);
  expect(report.percent).toBe(100);                       // capped, not 1250
  expect(report.resetAt).toBe(resetAt);                   // latest in-window window end
});
```

Commands: `npm --prefix extension run test` (RED→GREEN loop), `run typecheck`, `run build`.

## Slice Pre-Plan (for sdd-tasks)

Forecast: ~1,300–1,700 authored lines incl. tests — far above the 400-line budget. Guard lines `sdd-tasks` must emit: `Decision needed before apply: Yes`, `Chained PRs recommended: Yes`, `400-line budget risk: High`. Natural slices (each with start/finish/verification/rollback):

1. **Network + auth + signer** — fetch-transport, rpc-signer, `Credential` union + client/request per-type attach & scoped scan, manifest hosts + sync test, key-store pair, credentials pair, error-taxonomy. Verify: suite + typecheck; manifest test green.
2. **Providers + budget** — tier-budget, limit-store, `BudgetReport`, ZAI window semantics + straddle + fixture re-record, provider-metadata, engine credential typing, snapshot extension. Verify: hermetic provider/budget suites.
3. **Popup + worker wiring** — background live composition (`buildTickQuery`, classification, snapshot writes), popup main/settings views + keydown + copy (README, manifest description), import boundary. Verify: full suite + build + manual unpacked load (live E2E per proposal).

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. (Outbound network egress is bounded by the allowlist checks, the credential-placement scan, and the AD-16 manifest sync test; the signer boundary is covered by the secret-never-transmitted sweep tests.)

## Migration / Rollout

No data migration for token providers (bytes unchanged). Qwen: a legacy hito-2 plain string under `qd:key:qwen` reads as "no credential" — the user re-enters the pair. Snapshots: pre-hitó-3 error entries lack `errorClass`, so a stale snapshot reads as "no cycle yet" until the next tick (≤1 min) rewrites it — transient by design. `host_permissions` addition requires an extension reload (unpacked dev: reload in `chrome://extensions`; Chrome will show the new cross-origin permission). Rollback per proposal: close PR / delete branch; shipped state stays hito-2.

## Open Questions

- [ ] ZAI `customerId` page field: pinned as `data.customerId` from community evidence; the live endpoint's actual field name is unverified. Graceful degradation covers a mismatch (budget absent, cost intact); the maintainer live E2E confirms and the fixture is re-pinned if needed.
- [ ] OpenAI live window default (trailing 24h, `bucket_width=1d`) is a product choice, not spec-pinned — revisable without architectural change.
