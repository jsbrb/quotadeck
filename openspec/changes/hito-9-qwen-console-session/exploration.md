# Exploration: hito-9-qwen-console-session — Qwen Coding Plan usage via console session

> Explore phase artifact. READ-ONLY research; no code changed. Branch `feature/hito-9-qwen-console-session` cut from `develop` @ 6316a4f.
> Ratified direction (reverses hito-8's no-cookie stance): recover percentage-remaining / total-quota / reset-date from the Alibaba Cloud console, with security GUARANTEED BY DESIGN where possible. This exploration maps HOW, not WHETHER.

## Current State

- Hitos 1–8 (426 tests, strict TDD) built the MV3 extension with a structural security core: `ProviderRequest` has **no `headers`/`cookies` fields** (`extension/src/network/request.ts`); the only component that produces headers is `AllowlistNetworkClient` (`extension/src/network/client.ts`), which attaches credentials at exactly one sanctioned placement per kind (Bearer/raw → `Authorization`; ak-sk → signed BSS query). `FetchTransport` (`extension/src/network/fetch-transport.ts`) passes **no `credentials` option** to `fetch` → default `credentials: 'same-origin'` → the extension origin (`chrome-extension://`) never sends cookies today. The no-cookie guarantee is currently enforced by *absence of the capability*, not by a guard.
- Qwen plan data today is binary: `QwenPlanStep` (`extension/src/refresh/qwen-plan.ts`) probes `token-plan.ap-southeast-1.maas.aliyuncs.com` with the `sk-sp-` key, caching `{status, resetAt?, probedAt}` (`PlanInfo` in `extension/src/core/usage.ts`, `QwenPlanStore` under `qd:qwen-plan-status`). No percentage/total exists on any key surface (hito-8, `docs/spike/endpoints.md`).
- The plan status merges into the qwen snapshot entry only on the ok/absent arm (`refreshTick` in `extension/src/background.ts`); the popup renders `Plan: <status> · resets in …` below the balance (`extension/src/popup/view.ts`, §Qwen Plan Line).
- Allowlist single source of truth: fenced JSON in `docs/spike/endpoints.md` ↔ `PROVIDER_ALLOWLIST` (`extension/src/network/allowlist.ts`), pinned equal by `allowlist.source.test.ts`; manifest host_permissions pinned by `manifest.hosts.test.ts`.

## Lane 1 — MV3 session-attachment capability surface (facts, sourced)

### (a) `host_permissions` + SW `fetch` with `credentials: 'include'` — cookies DO auto-attach

- Cross-origin `fetch` from the extension service worker requires **no CORS** once the target host is in `host_permissions` (Chrome docs: *Cross-origin network requests*, https://developer.chrome.com/docs/extensions/develop/concepts/network-requests — "Extension origins aren't so limited… as long as the extension requests host permissions").
- Cookies are **not sent by default**: the Fetch standard defaults `credentials` to `same-origin`, and the extension origin differs from any `https://` target. The call must pass `credentials: 'include'` explicitly (fetch spec default, applies in SW).
- With `credentials: 'include'` + host permission, cookies attach **including `SameSite=Strict`**: "Requests from an extension to a third-party are treated as same-site if the extension has host permissions for the third-party. This means SameSite=Strict cookies can be sent. … this only applies to network requests, not access through `document.cookie` … and does not apply if third-party cookies are blocked." (Chrome docs: *Storage and cookies*, https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).
- **Failure modes**: (1) user blocks third-party cookies → same-site treatment lapses (doc-cited; exact behavior in current Chrome **needs live verification**); (2) cookies live in the default profile's cookie store only (no incognito unless enabled); (3) session simply absent → 302/401, detectable status-first.
- **Permission strings**: `host_permissions: ["https://modelstudio.console.alibabacloud.com/*"]` (+ `https://bailian.console.alibabacloud.com/*` if CN in scope). NO `cookies` permission needed — the browser jar attaches cookies; **the extension never sees cookie values**. Install prompt gains the host warning "Read and change your data on modelstudio.console.alibabacloud.com" (host-permission warning; https://developer.chrome.com/docs/extensions/reference/permissions-list).
- Chrome version: MV3 GA behavior; no special minimum.

### (b) `chrome.cookies` — scoped read of named cookies

- Permission strings: `"cookies"` + `host_permissions` for the target hosts; `getAll` "only retrieves cookies for domains that the extension has host permissions to" (API reference: https://developer.chrome.com/docs/extensions/reference/api/cookies). `get({url, name})` reads a single named cookie — a natural exact-name scoping point.
- The `cookies` permission has **no standalone install warning** (permissions-list, ibid.); the host warning from (a) is what the user sees either way.
- The API operates on the browser cookie store (not `document.cookie`), and the `Cookie` type exposes `httpOnly`/`sameSite`/`partitionKey` flags; reading HttpOnly cookies through this API is the long-standing, widely relied-upon behavior (implied by the API surface; **pin with a 5-minute live check** during discovery rather than trusting this page alone).
- Partitioning: by default methods operate on **unpartitioned** cookies; `partitionKey` overrides (Chrome 119+; same reference). Relevant only if the console ever ships CHIPS cookies.
- Use here would be: read the CSRF cookie (if the endpoint needs one) and/or synthesize a `Cookie` header manually — which also **bypasses SameSite/third-party-blocking entirely** (we construct the header; the browser never applies cookie policy to it). That is (b)'s one real technical advantage over (a).
- Cost: session values enter SW memory — the pure "extension never touches session material" property is lost (see Lane 2).

### (c) `declarativeNetRequest` header injection — REJECT, here is why

- Capability exists: `modifyHeaders` rules can `set`/`remove` any request header and `append` is allowlisted for `cookie` among others (API reference: https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest, §Header modification); DNR "will affect calls to `fetch()` made in a service worker" (§Interactions with service workers). `declarativeNetRequestWithHostAccess` adds no standalone warning.
- Why it is forbidden *for this feature* by our own architecture rules:
  1. **Session material would be persisted as rule data.** The cookie value must be embedded in the rule; dynamic rules persist across browser sessions and upgrades, session rules live in browser-managed storage while running — both outside `KeyStore`/our storage contracts, violating "key material has exactly one home".
  2. **Rules are URL-scoped, not seam-scoped.** A `modifyHeaders` rule matches by URL condition; without careful `initiatorDomains` scoping it can inject the session into requests to the same host from *any* context, including the user's own tabs. This converts "credentials attach at exactly one audited seam" into "credentials attach wherever a rule matches".
  3. It bypasses `AllowlistNetworkClient`/any single choke point — the exact anti-pattern the network-allowlist spec exists to prevent.
- Verdict: document, reject, never implement. (Removal use — stripping cookies — is fine; injection is not.)

### (d) Offscreen documents / tab-based flows

- An offscreen document must be a **static bundled extension page**; it cannot *be* the console page (API reference: https://developer.chrome.com/docs/extensions/reference/api/offscreen). It can iframe a remote site (`IFRAMES_SCRIPTING`/`DOM_SCRAPING` reasons), **but** a cross-site iframe gets a partitioned storage/cookie context keyed to the extension origin — "the site won't be able to access the same cookies as if it were navigated to directly" (Storage and cookies, citing crbug 1463991) — and consoles typically send `X-Frame-Options`/CSP `frame-ancestors`. **Offscreen-iframe is a structural dead end for authenticated console pages**; no further research needed.
- A **real (hidden/minimized) tab** navigated top-level to the console URL gets the genuine first-party session. Usage: (i) *bootstrap-only* — open the console when the session is expired so the user re-logs-in (cheap, no scraping); (ii) *scrape* — `chrome.scripting` into the tab to read the quota from page context (needs `scripting` + host permissions; MV3 SW lifetime must be managed around the tab). Scrape variant is brittle (DOM/console SPA churn) and puts our code inside an authenticated page — weaker guarantees, kept only as documented fallback if the console API is WAF-guarded against bare SW fetches.

### (e) Official API surface for coding-plan usage — NONE exists (verified 2026-09-06)

- Official Model Studio docs (updated 2026-09-04): "**Coding Plan usage**: If you are subscribed to Coding Plan, view quota consumption on the Coding Plan page" — a console URL, `https://modelstudio.console.alibabacloud.com/ap-southeast-1/?tab=plan#/efm/subscription/coding-plan` (CN family: `bailian.console.alibabacloud.com`). No OpenAPI, no key-authenticated usage endpoint is documented anywhere on the page. Sources: https://www.alibabacloud.com/help/en/model-studio and https://www.alibabacloud.com/help/en/model-studio/coding-plan.
- **Bonus facts captured from the official Coding Plan page** (for the live-discovery brief and product copy):
  - Quota semantics: Pro = 6,000 req/5h (rolling, restored per-minute), 45,000/week (**resets Monday 00:00 UTC+8**), 90,000/month (resets on renewal date). The maintainer's observed "~10,000 total / 7-day reset" does not match current Pro numbers (may be an older/Lite plan or a different regional display) — the live capture, not the docs, is the source of truth for rendering.
  - ToS signal (quote): "Do not use the plan's API key for automated scripts… Using the API key outside the permitted scope is a violation that may result in subscription suspension or API key revocation." — this clause touches **hito-8's existing binary probe** (an automated 1-token call with the `sk-sp-` key). A read-only console-session fetch consumes no quota and uses no plan API key — arguably *safer* under this policy than the probe we already ship. Risk to record, not to hide.

## Lane 2 — Security-guarantee architecture: enforceable vs conventional

Structural = "a violating code path cannot be written without changing a pinned type/test", matching the existing keys-only-in-Authorization guarantee.

| Guarantee | Option A (SW fetch, browser-attached) | Option B (chrome.cookies scoped read) | Option C (tab-based) |
|---|---|---|---|
| No session material ever in `chrome.storage`/snapshots | **Structural** — nothing to store; the browser holds the jar | Structural if the session client has *no store dependency* and the type carries no persistable field (test-pinnable) | Structural for storage; page scrape adds DOM exposure |
| No session material in extension *memory* | **Structural** — cookie values never exposed to JS without `cookies` permission | Conventional only — values transit SW memory | Mixed (bootstrap-only variant: yes) |
| Blast radius of XSS/compromised dependency in the SW | Can issue credentialed requests **only to granted hosts** and read their responses (quota data — low sensitivity); **cannot read/copy cookie values**; cannot attach session to any other host | Same host scoping, **plus** can read session cookie values and exfiltrate them (values are in JS) | Same as A/B for SW; scrape variant additionally executes near the live session |
| Single audited attach seam | **Structural** — one `SessionFetchTransport` is the only `credentials:'include'` call site (RED test: no other transport sets it) | One seam possible (session client), but header construction is code, not platform | N/A |
| Snapshot discipline (derived numbers only) | **Structural** — `PlanInfo`/validators extended to numerics; no raw response field exists on the snapshot type (AD-13/15 pattern extended) | Same | Same |
| Host scope minimalization | Exact origins (`modelstudio.console.alibabacloud.com`, NOT `*.aliyun.com`) — pinned by manifest↔allowlist↔doc triple tests | Same + exact cookie names pinned in spec | Same + `scripting` only if scrape |
| Revocation UX | Conventional (detect 302/401 → "session expired, open console" plan state) but deterministic | Same | Bootstrap tab makes re-login natural |
| CSRF token never stored | Structural **iff** the endpoint is cookies-only (no header) — else in-memory per-request acquisition (conventional, but discard-after-use is test-pinnable) | Same; token readable from cookie forces this option | N/A |

**Impossible to guarantee (stated plainly):**
- We cannot structurally stop a fully compromised SW from *using* the granted session against the granted host. Scope minimization bounds it; nothing eliminates it.
- We cannot bind Alibaba-side behavior: the console endpoint is undocumented, unversioned, and may change or be guarded (WAF/slider) at any time.
- Third-party-cookie-blocking may break Option A attachment (doc-cited caveat) — must be probed live and surfaced as guidance, not assumed away.

## Lane 3 — Integration mapping (in-repo seams, verified)

| Seam | Today | Hit-9 impact |
|---|---|---|
| `extension/src/refresh/qwen-plan.ts` (`QwenPlanStep`) | Binary probe + TTL cache (120/15 min) | Gains a session-source resolution path; merge discipline (error arm wins) stays; cadence decision — session reads are **free** (no inference cost), so a shorter TTL than the probe is defensible |
| `extension/src/providers/qwen-plan-probe.ts` | Pure probe build/map | Unchanged (stays as key-based fallback); new sibling pure module for the console response parse (fixtures + parse discipline) |
| `extension/src/core/usage.ts` (`PlanInfo {status, resetAt?}`) | Binary shape | Extend with numeric fields (percentage/total/resetAt). `UsageWindow` (`percentage?/total?/resetAt?`, AD-26 passthrough) already models exactly this triple — reuse-vs-extend is a design decision, not new invention. `formatBadgeText` keeps ignoring `plan` (badge = balance) |
| `extension/src/storage/qwen-plan-store.ts` + `snapshot-store.ts` | `{status, resetAt?, probedAt}` shape-validated | Validator + shape extended for numerics; snapshot still carries derived numbers only |
| `extension/src/popup/view.ts` | `Plan: exhausted · resets in 1h 30m` | Plan line renders percentage/total/countdown; §Settings Guidance qwen row gains console-session copy; new "session expired → open console" state |
| `extension/src/background.ts` | Composes engine + `QwenPlanStep` after `refreshAll`, pre-snapshot | Composes the new session step the same tick-level way (hito-8 design-note-2 pattern) |
| `extension/src/network/*` | `AllowlistNetworkClient` — the only header producer; `FetchTransport` has no `credentials` | **Dedicated seam**: a separate session client/transport pair that alone sets `credentials:'include'`, scoped to exactly the console host. Keeping it OUT of `AllowlistNetworkClient` preserves the keys-only structural guarantee verbatim (mirrors keeping `QwenPlanStep` out of `RefreshEngine`) |
| `extension/public/manifest.json`, `network/allowlist.ts`, `docs/spike/endpoints.md` | 7 hosts, triple-pinned | + console host(s); new evidence class for a session surface (doc taxonomy needs a `session` verification tier or an explicit note) |
| `platform/browser-api.ts` | `chrome` adapter | Only touched if Option B/C chosen (`cookies`, `tabs`, `scripting`) |

Spec deltas (requirement names, from `openspec/specs/`):
- `network-allowlist`: MODIFIED §Per-Provider Domain Allowlist, §Manifest Host Permissions Consistency; ADDED §Session Requests (credentials-attach scoping + no-persistence rule).
- `provider-framework`: MODIFIED §Provider Contract (session source is tick-level, like the probe, not a Provider); ADDED §Qwen Console Usage (parse contract).
- `usage-badge`: MODIFIED §Qwen Plan Probe Cadence (merged cadence/caching).
- `popup-ui`: MODIFIED §Qwen Plan Line, §Settings Guidance; ADDED §Console Session State (expired/healthy + open-console action).
- `key-storage`: likely untouched structurally — a session is deliberately NOT a stored credential; only guidance copy references it.

## Lane 4 — Live-discovery plan (maintainer-assisted, hito-1-spike style)

The target page is now KNOWN from official docs (Lane 1e) — no guessing needed. Recipe for the maintainer:

1. Open Chrome → log into the console → navigate to `https://modelstudio.console.alibabacloud.com/ap-southeast-1/?tab=plan#/efm/subscription/coding-plan`.
2. DevTools → Network → filter **Fetch/XHR** → hard-reload, then click into the Coding Plan tab so the quota widget loads.
3. Find the JSON response whose payload contains the observed figures (~86.9 / ~10,000 / the reset date). For THAT request record:
   - full **request URL + method**;
   - **cookie NAMES only** (Request Headers → `Cookie` — list names left of `=`; never copy values);
   - any **CSRF-ish request headers** (`x-csrf-token`, `x-aliyun-…`, etc.) and where the value appears: a cookie? a `<meta>` tag? `localStorage`? (Application tab);
   - **response JSON shape** (sanitized skeleton — keys and value types, not account data);
   - whether the URL is region-prefixed and whether a `workspace`/instance id rides the path or query.
4. Copy → "Copy as fetch", strip the cookie header, run it from a DevTools console on ANY origin (e.g. a blank tab) with `credentials:'include'` added — if it answers 200 from a foreign origin, Option A works as-is; if it 403s without the CSRF header, note which header; if it 403s even with it (Referer/Origin pinning or WAF), Option A is dead → Option B/C gate.
5. Repeat once in a logged-out profile to capture the failure shape (302 login redirect vs 401 JSON) — this pins the revocation-detection contract.
Deliverable: an endpoints.md subsection (`### Qwen console plan usage — session surface — discovered-live`) with the evidence block, same discipline as hito-8's live captures. This is a proposal/apply-phase dependency, executed by the maintainer, not simulated.

## Approaches

1. **Option A — Browser-attached session (SW fetch + `credentials:'include'`, narrow host_permissions, NO cookies permission)** — the browser is the only thing that ever touches session material.
   - Pros: strongest enforceable set (no session material in storage OR memory; values unreadable even to a compromised SW; single seam; zero new permissions beyond hosts); no per-cookie-name maintenance; free reads (no inference cost); smallest CWS-optics footprint.
   - Cons: dies if the endpoint demands a CSRF header sourced from a cookie; third-party-cookie-blocking caveat; undocumented endpoint may rotate.
   - Effort: Medium (new seam + spec deltas + parse module; no storage/credential work at all).
2. **Option B — Scoped `chrome.cookies` read (exact names, in-memory only)** — fallback when CSRF-from-cookie is required or attachment is blocked.
   - Pros: bypasses SameSite/3P-blocking entirely (manual `Cookie` header); exact cookie names are spec-pinnable; still no persisted material.
   - Cons: session values transit SW memory (exfiltratable by a compromised dependency) — guarantee degrades from structural to conventional; HttpOnly cookies readable (powerful = dangerous); more moving parts.
   - Effort: Medium-High.
3. **Option C — Bootstrap tab (Option A/B steady-state + real console tab only on session expiry for re-login)** — UX completion, not a data path.
   - Pros: clean revocation story ("your session expired" → one click → login → done); no scraping.
   - Cons: `tabs`-adjacent permissions/warnings if expanded; not needed for reads.
   - Effort: Low (additive later).
   - *(Full tab-scrape variant: documented as last resort only — WAF blocks direct fetches — because code-in-authenticated-page has the weakest guarantees.)*

**Ruled out (documented, not approaches):** DNR header injection (Lane 1c — persists session as rule data, URL-scoped leakage, bypasses the seam); offscreen-iframe (Lane 1d — partitioned cookie context + XFO make it structurally broken for authenticated pages).

## Recommendation

**Option A as the primary architecture, with Option B pre-designed as the documented fallback, and Option C as a later UX add-on.** Rationale: A is the only option whose core guarantee — session material never exists in extension code, storage, or memory — is *structural* (the platform enforces it by not exposing cookie values without a permission we don't declare), which is the exact same species of guarantee as the existing keys-only-in-Authorization rule. B surrenders precisely the property the maintainer demanded ("guaranteed by design") in the only case that matters (compromised dependency). The Lane-4 discovery run decides A vs B with a 15-minute maintainer task before spec freeze; the proposal should carry both with the decision gate explicit.

## Risks

- The console endpoint is undocumented and may require CSRF-from-cookie (kills A), pin Origin/Referer, or sit behind a WAF (kills A and B → C-scrape). Mitigation: Lane-4 gate before spec freeze; honest fallback chain.
- Third-party-cookie-blocking users may silently lose cookie attachment (doc-cited caveat, needs live check). Mitigation: detection + guidance copy, not silence.
- ToS exposure: automated console access is uncharted; and hito-8's probe already brushes the "no automated scripts with the plan key" clause. Mitigation: read-only GET, low cadence, maintainer acceptance recorded in the proposal; consider whether the probe should eventually retire in favor of the session source.
- Host-permission widening is user-visible (install prompt changes) and permanent-ish (revoking sites disables the feature). Mitigation: exact origins only, never `*.aliyun.com`; explain in settings copy.
- Endpoint shape drift (undocumented API). Mitigation: status-first parse, shape-validated reads, honest `undefined` (the hito-8 discipline, reused).
- The maintainer's observed quota (~10k / 7-day) does not match current official Pro numbers (45k/week) — render what the API returns, not doc-derived constants.

## Ready for Proposal

**Yes — with one pre-proposal task recommended:** run the Lane-4 maintainer discovery (15 min) BEFORE or DURING proposal so Option A vs B is decided on evidence rather than assumption. The orchestrator should tell the maintainer the open product decisions:

1. **Guarantee tier**: A (browser-attached only) vs B (allow scoped cookie reads) — decided by the Lane-4 CSRF finding; B is only acceptable if the maintainer explicitly accepts in-memory session transit.
2. **Cadence**: session reads are free — keep 15/120-min TTLs or shorten (e.g., 5–15 min) for the session source? (Probe TTLs unchanged either way.)
3. **Data shape**: reuse `UsageWindow` passthrough vs extend `PlanInfo` with numerics; badge stays balance-only (recommended yes).
4. **Scope**: international console only first, or CN (`bailian.console.alibabacloud.com`) too?
5. **ToS acceptance**: record explicit maintainer sign-off on automated read-only console access (and acknowledge the existing probe's policy tension).
6. **Fate of the hito-8 probe**: keep as key-based fallback, or plan its retirement once the session source is live?
