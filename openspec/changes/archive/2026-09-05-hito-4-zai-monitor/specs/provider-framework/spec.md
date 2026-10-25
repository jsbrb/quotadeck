# Delta for provider-framework

## ADDED Requirements

### Requirement: Credential Attach Modes

The framework SHALL support per-provider credential attach modes: `bearer` (`Authorization: Bearer <key>`), `openai-admin` (admin key), and `raw` (`Authorization: <key>` verbatim, no prefix). Each provider SHALL declare exactly one attach mode; the ZAI provider SHALL declare `raw`.

#### Scenario: ZAI declares raw attach

- GIVEN the registered providers with their declared attach modes
- WHEN the ZAI provider builds a monitor request
- THEN the credential attaches verbatim with no prefix, while providers declaring `bearer` or `openai-admin` attach their documented forms

## RENAMED Requirements

### Requirement: ZAI Parsing (bigmodel.cn expenseBillList) → ZAI Parsing (monitor quota/limit)

(Reason: the expenseBillList surface returned zero-value totals during active live usage; the provider is rewritten to the official monitor endpoint.)
(Migration: parsing semantics are normative in `zai-monitor`; this requirement retains only the framework-level contract, updated below.)

## MODIFIED Requirements

### Requirement: Provider Contract

The system SHALL define a `Provider` contract that every provider implements, exposing a stable provider id, display name, required credential type and attach mode, and a parse routine that converts recorded provider responses into a normalized usage result (provider id, timestamp, value and currency when the provider reports a monetary balance, plan level and monitor windows when the provider is ZAI, usage tier when available). The query context SHALL carry an injectable clock and MUST NOT carry tier limits or billing months.
(Previously: normalized result described as value/currency/tier only, and the query context was unconstrained.)

#### Scenario: Contract compliance of the four stubs

- GIVEN the four registered stub providers
- WHEN each is resolved by provider id
- THEN each satisfies the `Provider` contract with the documented response shape as input

### Requirement: ZAI Parsing (monitor quota/limit)

The ZAI provider SHALL model GET `/api/monitor/usage/quota/limit` with raw-key Authorization per the `zai-monitor` specification, which is normative for window discrimination, level, percentage, used derivation, countdown, the MCP window, platform binding, and error classification. The provider MUST NOT model `expenseBillList`, `billingMonth`, pagination plans, or Bearer credentials.
(Previously: modeled bigmodel.cn `expenseBillList` with `billingMonth` paging, Bearer auth, `apiUsage` sums, `billingNo` epoch extraction, and `tokenResourceName` tier; its scenarios "Fixture page parsed", "Non-numeric or non-200 code rejected", "Pagination plan with jitter and dedupe", and "Latest record selects the tier" are removed with it.)

#### Scenario: Monitor fixture parsed

- GIVEN a recorded quota/limit fixture with level, token limits, and a `TIME_LIMIT` entry
- WHEN parsed
- THEN the normalized result reports the level and the 5h, weekly, and MCP windows per `zai-monitor`

#### Scenario: Superseded surface absent

- GIVEN the ZAI provider surface
- WHEN inspected
- THEN no expenseBillList request, billingMonth parameter, or pagination plan exists

### Requirement: Hermetic Tests with Live Transport Contract

Provider logic SHALL be tested hermetically: the vitest suite MUST pass on recorded fixtures and injected fake transports with no live network I/O. Live behavior SHALL be proven by contract: each provider issues live requests through the allowlist client, and the suite MUST assert the recorded request shape (method, host, path, credential placement, query) against the documented endpoint.
(Previously: same hermetic rule, but the ZAI contract scenario asserted the `bigmodel.cn` host, a Bearer credential, and `billingMonth` derived from the clock.)

#### Scenario: Suites are hermetic

- GIVEN the full vitest suite with injected fake transports
- WHEN executed
- THEN all provider tests pass using fixture data only and no outbound network call occurs

#### Scenario: Live request contract asserted

- GIVEN the ZAI provider with a stored credential and an injected fake transport
- WHEN a live fetch is triggered
- THEN the recorded request targets the platform-selected monitor host (`api.z.ai` by default, `open.bigmodel.cn` for ZHIPU), carries the raw credential in `Authorization` with no Bearer prefix, and the response parses per the ZAI requirement
