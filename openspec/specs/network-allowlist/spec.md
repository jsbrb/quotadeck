# Network Allowlist Specification

## Purpose

A fetch layer that ships live provider traffic confined to each provider's officially documented domains, pins the manifest `host_permissions` to exactly the allowlist union filtered to the shipped providers, and confines credential material to the sanctioned placements — the `Authorization` header plus the host-scoped exceptions: Alibaba BSS RPC signing on the Qwen BSS hosts, raw attach on the ZAI monitor hosts, ACS3 header signing at the marked-ak-sk mint seam, and the transient session bearer at the Qwen token-plan quota gateway seam. A companion declarativeNetRequest session rule rewrites only the quota gateway request's `Origin` header to a public constant — the sanctioned WAF-compatibility exception class, distinct from the cookie-value injection hito-9 rejected. The layer remains proven by hermetic tests, including rejection of non-allowlisted domains.

## Requirements

### Requirement: Per-Provider Domain Allowlist

The network layer SHALL keep a per-provider allowlist of official endpoint domains as documented in `docs/spike/endpoints.md` (ZAI: `api.z.ai` and `open.bigmodel.cn`; Kimi: `api.moonshot.cn`; OpenAI: `api.openai.com`; Qwen: the Alibaba BSS OpenAPI endpoints `business.aliyuncs.com` (china site) and `business.ap-southeast-1.aliyuncs.com` (international site), the token-plan probe host `token-plan.ap-southeast-1.maas.aliyuncs.com`, the token-plan quota gateway `bailian-singapore-cs.alibabacloud.com`, and the CLI token mint host `modelstudio.ap-southeast-1.aliyuncs.com` — five qwen hosts). Every outbound request MUST be checked against the target provider's allowlist before any network I/O occurs.

#### Scenario: Allowlisted host admitted

- GIVEN a ZAI request addressed to `api.z.ai` or `open.bigmodel.cn`
- WHEN submitted through the network layer
- THEN the request is passed to the transport layer

#### Scenario: International BSS and probe hosts admitted

- GIVEN qwen requests addressed to `business.ap-southeast-1.aliyuncs.com` and to `token-plan.ap-southeast-1.maas.aliyuncs.com`
- WHEN submitted through the network layer
- THEN both are passed to the transport layer

#### Scenario: Quota gateway and mint hosts admitted

- GIVEN qwen requests addressed to `bailian-singapore-cs.alibabacloud.com` (hop 2 of the quota flow) and to `modelstudio.ap-southeast-1.aliyuncs.com` (hop 1)
- WHEN submitted through the network layer
- THEN both are passed to the transport layer

#### Scenario: Non-allowlisted host rejected

- GIVEN a request addressed to `evil.example.com`
- WHEN submitted through the network layer
- THEN the request is rejected with an explicit error and no network I/O occurs

#### Scenario: Cross-provider host rejected

- GIVEN a ZAI provider request addressed to Kimi's allowlisted host `api.moonshot.cn`
- WHEN submitted
- THEN the request is rejected because the host is not on the ZAI allowlist

#### Scenario: Removed apex host rejected

- GIVEN a ZAI request addressed to the apex `bigmodel.cn`
- WHEN submitted through the network layer
- THEN the request is rejected with an explicit error and no network I/O occurs

### Requirement: Credentials Only in Authorization Header

Bearer and admin-key credentials SHALL be attached to requests exclusively as the value of the `Authorization` header, and MUST NOT appear in URLs, query parameters, request bodies, or cookies. Raw attach — `Authorization: <key>` verbatim with no prefix — is a sanctioned exception scoped to the ZAI monitor hosts (`api.z.ai`, `open.bigmodel.cn`) only; every other host requires the Bearer or admin form. Alibaba RPC signing is a sanctioned exception, scoped to the Qwen BSS hosts only (`business.aliyuncs.com`, `business.ap-southeast-1.aliyuncs.com`) and NEVER the token-plan probe host: `AccessKeyId` and the derived `Signature` MAY appear as query parameters for requests to those hosts. The Qwen token-plan key (`sk-sp-`) attaches exclusively as `Authorization: Bearer <key>` on `token-plan.ap-southeast-1.maas.aliyuncs.com` and MUST NOT appear in the probe URL, query, or request body. Two further placements exist exclusively as per-request MARKERS evaluated by the client at its own sanctioned seams (hito-12): (1) the ACS3 SIGNING marker — an `ak-sk` request declaring scheme `acs3` with action/version is signed ACS3-HMAC-SHA256 and attached as `Authorization` plus a fixed `host`/`x-acs-*` header set; it is valid only on `ak-sk` credentials for the qwen provider, only on query-less requests (the live-proven mint shape), and a marker on any other credential kind is refused before dispatch; (2) the SESSION-BEARER marker — a request carrying a transient minted console token attaches it as `Authorization: Bearer <token>` ONLY for the qwen token-plan usage gateway host (`bailian-singapore-cs.alibabacloud.com`), only on `ak-sk` requests (the stored pair stays the identity gate), never combined with the signing marker, and refused fail-closed on every other host including the mint host; the token MUST NOT appear in the url, query, body, or any log or error surface, and rejection messages name hosts and statuses, never the token. The `AccessKeySecret` MUST NOT be transmitted nor placed in URLs, query parameters, headers, bodies, or cookies under any circumstances. Beyond credentials, the network client is the ONLY header producer (`ProviderRequest` has no headers or cookies fields): any dispatched JSON request body SHALL be labeled `Content-Type: application/json` (servers reject unlabeled bodies - observed as HTTP 400 on the token-plan probe endpoint), a marked session gateway body carries the `application/x-www-form-urlencoded` label, the marked ACS3 seam carries its fixed signing header set, and bodyless requests carry no `Content-Type`.

#### Scenario: Key placement

- GIVEN a stored Bearer credential for a provider
- WHEN the network layer builds a request
- THEN the key appears only in the `Authorization` header and the URL, query, body, and cookies contain no credential material

#### Scenario: RPC signature exception scoped to the BSS hosts

- GIVEN a signed Qwen BSS request to either BSS host
- WHEN built
- THEN `AccessKeyId` and `Signature` appear in the query and the `AccessKeySecret` appears nowhere in the request

#### Scenario: Signed-style credentials rejected off the BSS hosts

- GIVEN a request to a non-BSS host (including `token-plan.ap-southeast-1.maas.aliyuncs.com`) carrying an `AccessKeyId` query parameter
- WHEN submitted through the network layer
- THEN it is rejected with an explicit error

#### Scenario: Plan key confined to the Authorization header

- GIVEN a stored `sk-sp-` plan key and a built probe request
- WHEN the request is inspected
- THEN the key appears only as the Bearer `Authorization` header value and never in the URL, query, or JSON body

#### Scenario: Non-header key suppressed

- GIVEN a component attempting to pass a Bearer key as a query parameter
- WHEN the request reaches the network layer
- THEN the request is rejected

#### Scenario: Raw attach scoped to monitor hosts

- GIVEN a raw-attached ZAI request to `api.z.ai` and a raw-attached request to any non-ZAI host
- WHEN both are submitted
- THEN the monitor request passes and the other is rejected with an explicit error

#### Scenario: ACS3 signing marker hygiene

- GIVEN a request declaring the `acs3` signing scheme on a non-ak-sk credential, and a marked ak-sk request carrying query parameters
- WHEN either is submitted through the client
- THEN both are refused before any transport I/O
- AND a valid marked ak-sk qwen mint dispatches with `Authorization` plus the fixed signing header set and the AccessKeySecret nowhere

#### Scenario: Session bearer confined to the gateway

- GIVEN an ak-sk qwen request carrying a session token whose url, query, or body also contains the token
- WHEN submitted
- THEN it is rejected and the rejection names no token
- AND a well-formed session-marked request to the gateway host attaches `Authorization: Bearer <token>` with the token appearing in no other surface

#### Scenario: Session marker refused off the gateway and marker combination rejected

- GIVEN a session-marked request addressed to any host other than `bailian-singapore-cs.alibabacloud.com` (including the mint host), and a request carrying both the signing and the session markers
- WHEN submitted
- THEN each is rejected with an explicit error before any dispatch

### Requirement: Gateway Origin Session Rule (DNR)

The worker SHALL install ONE `declarativeNetRequest` SESSION rule that rewrites the quota gateway request's `Origin` header to the PUBLIC console-origin constant `https://modelstudio.console.alibabacloud.com` — the sanctioned WAF-compatibility exception class, because Chrome always attaches the forbidden `chrome-extension://<id>` Origin the vendor WAF 302-redirects to err.taobao.com before app auth, and `fetch()` can neither set nor remove Origin from a worker. This is explicitly DISTINCT from the cookie/session-value injection hito-9 rejected: the rule data carries ONLY public constants (the console origin, the gateway host, the api path) plus the install's own extension id used solely as the INITIATOR scope — zero credentials, and the Bearer token still rides exclusively through the client's session-marker seam. The rule SHALL be scoped to the gateway host (`requestDomains`), the gateway api path (`urlFilter`), the `xmlhttprequest` resource type, and the own extension id (`initiatorDomains`); it MUST NOT affect other traffic to the host. The rule id SHALL be a frozen public constant (1) and the startup install SHALL be idempotent: remove-by-id plus add in ONE `updateSessionRules` call (session rules survive service-worker restarts for the browser lifetime, so a bare re-add rejects on the surviving id; removing a non-existent id is a documented no-op). A failed install MUST NOT block alarm wiring and logs one prefixed console error naming only the chrome error. The rewrite adds no network destination — the allowlist and `host_permissions` are unchanged.

#### Scenario: Rule shape and zero-credential payload

- GIVEN the rule builder invoked with the install's extension id
- WHEN the produced rule is inspected
- THEN it sets the `origin` request header to the public console constant, scoped to the gateway host, the `/cli/api.json` urlFilter, `xmlhttprequest`, and that extension id as initiator
- AND no cookie, authorization, or secret-bearing value appears anywhere in the rule data

#### Scenario: Idempotent install across worker restarts

- GIVEN a worker start whose previous session rule (same frozen id) still resides in the browser
- WHEN `startWorker` installs the rule
- THEN the install is a single `updateSessionRules` call carrying `removeRuleIds: [1]` beside `addRules`, the re-install succeeds, and the rule is applied on that start

### Requirement: Injectable Transport

The network layer SHALL accept an injected transport so tests exercise allowlist and header behavior without live network I/O.

#### Scenario: Hermetic network tests

- GIVEN an injected fake transport that records requests
- WHEN the vitest suite runs
- THEN allowlist and rejection behavior is asserted against recorded requests and no real network call occurs

### Requirement: Manifest Host Permissions Consistency

The extension manifest `host_permissions` SHALL contain exactly the allowlisted domains of the SHIPPED providers — the union of the per-provider allowlists FILTERED to `SHIPPED_PROVIDER_IDS` (the current build: seven hosts across ZAI and Qwen) — and nothing more; hosts of allowlisted-but-unshipped providers (`api.openai.com`, `api.moonshot.cn`) are not granted.

#### Scenario: Manifest equals shipped allowlist

- GIVEN the shipped `manifest.json` and the network layer's per-provider allowlists
- WHEN compared
- THEN `host_permissions` equals the union of allowlisted domains filtered to the shipped providers exactly

#### Scenario: Extra host fails the check

- GIVEN a manifest granting a host absent from every provider allowlist
- WHEN the consistency check runs
- THEN it fails with an explicit error

### Requirement: RPC Timestamp Format

Every signed Qwen BSS request path (client or signer) MUST emit the `Timestamp` query parameter as POP-compliant ISO-8601 UTC WITHOUT a millisecond component (`YYYY-MM-DDTHH:mm:ssZ`). The signature MUST be computed over exactly the emitted `Timestamp` value. The ACS3 signing seam signs its `date` header through the same millisecond-stripped ISO form. Rationale: Alibaba POP rejects millisecond-carrying timestamps with HTTP 400, and `Timestamp` feeds the StringToSign.

#### Scenario: Emitted timestamp carries no milliseconds

- GIVEN a FakeClock at a fixed epoch with zero milliseconds
- WHEN a qwen ak-sk request is dispatched
- THEN the recorded URL's decoded `Timestamp` equals the exact no-millis form (e.g. `2023-11-14T22:13:20Z`)
- AND the value matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$` (no `.`)

#### Scenario: Millisecond-carrying clock input is normalized

- GIVEN a FakeClock whose epoch has nonzero milliseconds
- WHEN a qwen ak-sk request is dispatched
- THEN the emitted `Timestamp` still matches the no-millis pattern

#### Scenario: Signature computed over the emitted value

- GIVEN the signer invoked with a no-millis timestamp
- WHEN the canonical query is built
- THEN the StringToSign material embeds exactly the `Timestamp` that is dispatched

### Requirement: Error Body Surfacing

On a non-2xx response, the transport MUST surface a bounded snippet of the response body in the `HttpStatusError` message. The body MUST be read as text and MUST NOT be parsed as JSON on error statuses; the snippet MUST be capped (≤200 characters) and embedded verbatim so server error `Code`/`Message` are visible. A body-read failure MUST NOT mask the status error. Classification remains status-first (AD-30); the snapshot remains class-only (AD-13).

#### Scenario: Plain-text error body surfaced

- GIVEN a transport response with status 400 and a long plain-text body
- WHEN fetched
- THEN it rejects with `HttpStatusError` carrying status 400
- AND the message includes `HTTP 400` plus at most the first 200 body characters verbatim
- AND the body is never JSON-parsed

#### Scenario: JSON error document surfaced as text

- GIVEN a 400 whose body is a JSON error document containing `"Code"`
- WHEN fetched
- THEN the raw snippet appears in the message verbatim (server `Code` visible)
- AND no JSON parse occurs on the error path

#### Scenario: 2xx handling unchanged

- GIVEN a 200 JSON response
- WHEN fetched
- THEN it resolves `{ status, body }` exactly as before, parsed as JSON

#### Scenario: Body-read failure degrades to status-only

- GIVEN a 400 whose body read rejects
- WHEN fetched
- THEN it still rejects with `HttpStatusError` (status 400) and a status-only message
