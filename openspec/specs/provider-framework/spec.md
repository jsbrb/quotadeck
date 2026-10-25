# Provider Framework Specification

## Purpose

Defines the `Provider` contract, provider registration with an explicit engine-dispatch filter, and four providers (ZAI, Qwen/Alibaba BSS, OpenAI, Kimi). The engine dispatches only the shipped providers that are also engine-dispatched — currently ZAI alone; Qwen ships as a QUOTA-ONLY provider whose token-plan quota is fetched by a tick-level two-hop step outside the engine, while its retained BSS balance implementation stays in source unregistered. Each provider declares exactly one credential type (`bearer`, `ak-sk`, `openai-admin-read`, `raw`, or the auxiliary `qwen-plan` probe key); ZAI models the official monitor endpoint, with parsing semantics normative in `zai-monitor`. Provider parsing is proven hermetically against recorded fixtures and injected transports, with live behavior asserted by request-contract tests; the suite itself performs no live network I/O.

## Requirements

### Requirement: Provider Contract

The system SHALL define a `Provider` contract that every provider implements, exposing a stable provider id, display name, required credential type and attach mode, and a parse routine that converts recorded provider responses into a normalized usage result (provider id, timestamp, value and currency when the provider reports a monetary balance, plan level and monitor windows when the provider is ZAI, usage tier when available, plan status — available, exhausted with reset instant, or key-rejected — for Qwen when a plan key exists, and the token-plan quota window — percentage and/or reset instant carried through uncapped/verbatim, never with a synthesized used or total — for Qwen when the quota tick step resolves). The query context SHALL carry an injectable clock and the ZAI platform and Qwen site selections, and MUST NOT carry tier limits or billing months.

#### Scenario: Contract compliance of the four stubs

- GIVEN the four stub providers registered in a test registry
- WHEN each is resolved by provider id
- THEN each satisfies the `Provider` contract with the documented response shape as input

#### Scenario: Plan-only qwen result normalized

- GIVEN a qwen cycle with a stored plan key and no AK/SK pair
- WHEN the cycle result is normalized
- THEN the result is a value-less balance-kind entry carrying plan status and the engine-stamped timestamp

### Requirement: Provider Registration

The system SHALL expose a registry mapping provider ids to provider instances. The default registry SHALL register exactly the providers that are BOTH shipped AND engine-dispatched (`ENGINE_DISPATCHED_PROVIDER_IDS`, AD-6 order) — currently `zai` alone (hito-12 WU-L: qwen is quota-only, its BSS balance dispatch suspended; the `QwenProvider` class stays exported and tested but unregistered for a future pay-as-you-go balance). The registry MUST reject duplicate ids at registration time and unknown ids at lookup time.

#### Scenario: Duplicate id rejected

- GIVEN a provider already registered under id `zai`
- WHEN another provider registers with id `zai`
- THEN registration fails with an explicit error

#### Scenario: Unknown id rejected

- GIVEN the registry containing the four stubs
- WHEN looking up id `unknown-provider`
- THEN lookup fails with an explicit error

#### Scenario: Engine dispatch is zai only

- GIVEN the default registry built from the shipped and engine-dispatched filters
- WHEN its ids are read
- THEN they equal `['zai']` — qwen, openai and kimi never register, while qwen stays shipped for the popup, the badge choice and the manifest host pinning

### Requirement: ZAI Parsing (monitor quota/limit)

The ZAI provider SHALL model GET `/api/monitor/usage/quota/limit` with raw-key Authorization per the `zai-monitor` specification, which is normative for window discrimination, level, percentage, used derivation, countdown, the MCP window, platform binding, and error classification. The provider MUST NOT model `expenseBillList`, `billingMonth`, pagination plans, or Bearer credentials.

#### Scenario: Monitor fixture parsed

- GIVEN a recorded quota/limit fixture with level, token limits, and a `TIME_LIMIT` entry
- WHEN parsed
- THEN the normalized result reports the level and the 5h, weekly, and MCP windows per `zai-monitor`

#### Scenario: Superseded surface absent

- GIVEN the ZAI provider surface
- WHEN inspected
- THEN no expenseBillList request, billingMonth parameter, or pagination plan exists

### Requirement: Qwen Parsing (Alibaba BSS QueryAccountBalance)

The Qwen stub SHALL model balance-only retrieval via Alibaba BSS `QueryAccountBalance` (API 2017-12-14) against the site-selected base URL: `business.ap-southeast-1.aliyuncs.com` for `international` (the DEFAULT) and `business.aliyuncs.com` for `china`, derived from `query.qwenSite` (absent → international; an invalid value MUST throw before any dispatch). Balance from `Data.AvailableAmount`, currency from `Data.Currency`; amounts MUST be accepted as JSON numbers (china) or decimal strings (international) and normalized to numbers. Success validation MUST accept both envelope forms — numeric `Code` 200 (china) or string `"200"` (international) — and an explicitly non-success envelope (`Success` false, or a `Code` other than 200 in either form) MUST fail as an explicit body-level error. The Qwen balance credential type remains Alibaba AK/SK; DashScope `sk-` keys MUST NOT be accepted. The class and its parsing stay in source and hermetically tested, but the default registry does NOT dispatch it (hito-12 WU-L quota-only suspension): a future pay-as-you-go balance re-registers without code change. Coding Plan quota is not obtainable from BSS — it is covered by the token-plan quota tick step requirement.

#### Scenario: International string envelope parsed

- GIVEN a recorded international `QueryAccountBalance` fixture with `Data.AvailableAmount` `"0.00"` (string), `Data.Currency` `"USD"`, `Code` `"200"` (string), and `Success` true
- WHEN parsed
- THEN the normalized result reports balance 0 and currency USD as numbers/strings respectively

#### Scenario: China numeric fixture parsed

- GIVEN a recorded `QueryAccountBalance` fixture with numeric `Data.AvailableAmount` and `Data.Currency`
- WHEN parsed
- THEN the normalized result reports that balance and currency

#### Scenario: Non-success envelope rejected

- GIVEN a 200-status body with `Success` false or `Code` other than 200 in either form
- WHEN parsed
- THEN parsing fails with an explicit body-level error

#### Scenario: Invalid site value rejected before dispatch

- GIVEN a UsageQuery whose `qwenSite` is neither `international` nor `china`
- WHEN the first request is built
- THEN it throws before any dispatch

#### Scenario: DashScope key rejected

- GIVEN a candidate Qwen balance credential of form `sk-...`
- WHEN validated against the Qwen credential type
- THEN it is rejected with guidance that Alibaba AK/SK (RAM `bss:DescribeAcccount`) is required

### Requirement: OpenAI Parsing (organization costs)

The OpenAI stub SHALL model GET `/v1/organization/costs`: costs aggregated from `results[].amount.value` with `results[].amount.currency`, bucketed by line item (`model`, `usage_type`), cursor pagination via `next_page` until absent. Requests model the documented constraints: admin key with read scope, `start_time` required, `bucket_width` fixed at `1d`.

#### Scenario: Costs fixture aggregated

- GIVEN a recorded costs fixture with two result rows in one bucket
- WHEN parsed
- THEN the result sums `amount.value` across `results[]` and exposes per-bucket totals by line item with currency

#### Scenario: Cursor pagination terminated

- GIVEN fixtures for two pages where page 1 has `next_page` and page 2 does not
- WHEN the pagination plan executes
- THEN exactly two pages are consumed and the result covers both pages' rows

#### Scenario: Request validation

- GIVEN a costs request missing `start_time` or specifying `bucket_width` other than `1d`
- WHEN the request is built
- THEN it is rejected before dispatch

### Requirement: Kimi Parsing (moonshot balance)

The Kimi stub SHALL model GET `users/me/balance` with Bearer credential: balance from `data.available_balance`, reported in CNY, whose documented composition is cash plus voucher balance.

#### Scenario: Balance fixture parsed

- GIVEN a recorded Kimi balance fixture with `data.available_balance`
- WHEN parsed
- THEN the normalized result reports the balance in CNY

### Requirement: Hermetic Tests with Live Transport Contract

Provider logic SHALL be tested hermetically: the vitest suite MUST pass on recorded fixtures and injected fake transports with no live network I/O. Live behavior SHALL be proven by contract: each provider issues live requests through the allowlist client, and the suite MUST assert the recorded request shape (method, host, path, credential placement, query) against the documented endpoint.

#### Scenario: Suites are hermetic

- GIVEN the full vitest suite with injected fake transports
- WHEN executed
- THEN all provider tests pass using fixture data only and no outbound network call occurs

#### Scenario: Live request contract asserted

- GIVEN the ZAI provider with a stored credential and an injected fake transport
- WHEN a live fetch is triggered
- THEN the recorded request targets the platform-selected monitor host (`api.z.ai` by default, `open.bigmodel.cn` for ZHIPU), carries the raw credential in `Authorization` with no Bearer prefix, and the response parses per the ZAI requirement

### Requirement: Qwen AK/SK Pair Handling

The Qwen credential SHALL be an Alibaba AccessKeyId plus AccessKeySecret pair. Validation MUST reject pairs with either part empty or missing and MUST reject DashScope `sk-` values with the Alibaba AK/SK (RAM `bss:DescribeAcccount`) guidance. The AccessKeySecret SHALL NOT leave the signing boundary; only derived signatures are transmitted.

#### Scenario: Pair completeness validated

- GIVEN a candidate Qwen pair with an empty AccessKeySecret
- WHEN validated
- THEN it is rejected with explicit guidance

#### Scenario: Secret confined to the signer

- GIVEN a signed Qwen request built through an injected transport
- WHEN the recorded request is inspected
- THEN the AccessKeySecret appears nowhere (URL, query, headers, body, cookies) and only the derived Signature is present

### Requirement: Credential Attach Modes

The framework SHALL support per-provider credential attach modes: `bearer` (`Authorization: Bearer <key>`), `openai-admin` (admin key), and `raw` (`Authorization: <key>` verbatim, no prefix). Each provider SHALL declare exactly one attach mode for its balance surface; the ZAI provider SHALL declare `raw`. A provider MAY additionally carry an auxiliary probe credential attached as `bearer` on that probe's allowlisted host; the Qwen plan key (`sk-sp-`) is such a credential, attached only on the token-plan probe host while the provider's declared balance mode remains `ak-sk`. Beyond the declared modes the client admits exactly two request-marked placements — ACS3 header signing on query-less `ak-sk` requests (signing marker) and a transient console-session bearer on the token-plan usage gateway (session marker) — both produced exclusively by the network client at its sanctioned seams (`network-allowlist` §Credentials Only in Authorization Header); a provider-authored request carries no headers field.

#### Scenario: ZAI declares raw attach

- GIVEN the registered providers with their declared attach modes
- WHEN the ZAI provider builds a monitor request
- THEN the credential attaches verbatim with no prefix, while providers declaring `bearer` or `openai-admin` attach their documented forms

#### Scenario: Qwen plan key attaches as bearer

- GIVEN a stored `sk-sp-` plan key and a probe request
- WHEN dispatched through the network layer
- THEN the key attaches as `Authorization: Bearer <key>` and the balance surface still attaches AK/SK via the signed query

### Requirement: Qwen Plan Probe

The framework SHALL model a binary token-plan probe for Qwen: `POST /compatible-mode/v1/chat/completions` on `token-plan.ap-southeast-1.maas.aliyuncs.com` with the `sk-sp-` key as Bearer credential and body `{ "model": "qwen3.6-flash", "messages": [{ "role": "user", "content": "hi" }], "max_tokens": 1, "stream": false }`. Outcome mapping MUST be status-first: 2xx → available; 429 → exhausted with the reset instant parsed from the surfaced error text (`reset at MM-DD HH:MM:SS UTC`; year derived from the injected clock, a past-derived instant rolls to the next year); 401/403 → key-rejected. An exhausted response whose reset text is absent or unparseable SHALL still report exhausted without a reset instant. The probe MUST NOT synthesize a percentage or total — no such figure exists on any key surface.

#### Scenario: Available

- GIVEN a probe answered with HTTP 200
- WHEN the outcome is mapped
- THEN the plan status is available with no reset instant

#### Scenario: Exhausted with reset parsed

- GIVEN a probe answered with HTTP 429 whose surfaced error message contains `reset at 09-06 10:00:00 UTC`
- WHEN the outcome is mapped with an injected clock in 2026
- THEN the plan status is exhausted with that reset instant in 2026
- AND a reset text deriving a past instant rolls to the following year

#### Scenario: Key rejected

- GIVEN a probe answered with HTTP 401 or 403
- WHEN the outcome is mapped
- THEN the plan status is key-rejected

#### Scenario: No percentage synthesized

- GIVEN any probe outcome
- WHEN the plan status is produced
- THEN it carries only the status and optional reset instant — never a percentage, total, or used figure

### Requirement: Qwen Token-Plan Quota Tick Step

The framework SHALL compose the qwen token-plan quota as a TICK-LEVEL two-hop step beside the plan probe, deliberately outside the engine's per-provider refresh: hop 1 signs `GenerateCLIAccessToken` (version `2026-02-10`, body `{}`) on the mint host `modelstudio.ap-southeast-1.aliyuncs.com` with the stored AK/SK pair through the client's ACS3 signing seam; hop 2 POSTs the static, account-neutral usage body to the gateway `bailian-singapore-cs.alibabacloud.com` with the minted console token riding exclusively the session-bearer marker (both seams normative in `network-allowlist`). The step runs every tick only when BOTH gates hold — a stored qwen AK/SK pair AND the `international` site selection; the china site has no live-verified quota surface, so the request builders answer null and the step no-ops without dispatch; a missing pair no-ops likewise. There is no TTL cache: the minted token is TRANSIENT — tick-local in-memory only, never persisted, never an instance field across ticks, never logged, never placed in a url, query, body, or error surface. Every failure class (mint rejection, mint failure, gateway auth, gateway body failure, gateway request failure, no-data answer) logs exactly ONE `[quotadeck] qwen quota`-prefixed console.error line and omits the quota — the tick NEVER throws; the gateway auth line names the HTTP status only. The resolved window carries `percentage` (the gateway's 0..1 used fraction mapped to the 0-100 convention, passed through UNCAPPED) and/or `resetAt` (epoch ms carried VERBATIM), plus the step's clock-stamped refresh instant; used and total never exist on this surface and are never synthesized, and a response carrying neither field is no-data — logged and omitted, an empty quota never rides the snapshot. The merge into the cycle results follows `usage-badge` §Qwen Quota Step Merge Discipline: error arm wins, ok arm gains, absent arm synthesizes a quota-only ok entry.

#### Scenario: Gates hold, quota resolves

- GIVEN a stored qwen AK/SK pair, the international site, and transports serving a successful mint and usage gateway response
- WHEN the tick runs the step
- THEN exactly two requests are dispatched (mint signed via the ACS3 seam, gateway via the session seam) and the quota window carries the mapped percentage and verbatim reset instant

#### Scenario: China site or missing pair no-ops

- GIVEN the china site selection, or no stored AK/SK pair
- WHEN the tick runs the step
- THEN no request is dispatched and the qwen entry carries no quota

#### Scenario: Session token is tick-local

- GIVEN a tick that successfully minted a session token
- WHEN the tick completes
- THEN the token appears in no storage write, snapshot payload, log line, or cross-tick state

#### Scenario: Failure classes never throw

- GIVEN each quota failure in turn — mint rejection, plain mint failure, gateway 401/403, gateway body failure, gateway transport failure, and a success envelope carrying neither quota field
- WHEN the tick runs the step
- THEN each answers with exactly one `[quotadeck] qwen quota`-prefixed console.error line, omits the quota, and the tick completes without throwing
