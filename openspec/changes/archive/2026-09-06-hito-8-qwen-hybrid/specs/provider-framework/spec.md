# Delta for provider-framework

## MODIFIED Requirements

### Requirement: Provider Contract

The system SHALL define a `Provider` contract that every provider implements, exposing a stable provider id, display name, required credential type and attach mode, and a parse routine that converts recorded provider responses into a normalized usage result (provider id, timestamp, value and currency when the provider reports a monetary balance, plan level and monitor windows when the provider is ZAI, usage tier when available, and plan status — available, exhausted with reset instant, or key-rejected — for Qwen when a plan key exists). The query context SHALL carry an injectable clock and the ZAI platform and Qwen site selections, and MUST NOT carry tier limits or billing months.

(Previously: the normalized result had no plan status and the query carried only the ZAI platform selection.)

#### Scenario: Contract compliance of the four stubs

- GIVEN the four registered stub providers
- WHEN each is resolved by provider id
- THEN each satisfies the `Provider` contract with the documented response shape as input

#### Scenario: Plan-only qwen result normalized

- GIVEN a qwen cycle with a stored plan key and no AK/SK pair
- WHEN the cycle result is normalized
- THEN the result is a value-less balance-kind entry carrying plan status and the engine-stamped timestamp

### Requirement: Qwen Parsing (Alibaba BSS QueryAccountBalance)

The Qwen stub SHALL model balance-only retrieval via Alibaba BSS `QueryAccountBalance` (API 2017-12-14) against the site-selected base URL: `business.ap-southeast-1.aliyuncs.com` for `international` (the DEFAULT) and `business.aliyuncs.com` for `china`, derived from `query.qwenSite` (absent → international; an invalid value MUST throw before any dispatch). Balance from `Data.AvailableAmount`, currency from `Data.Currency`; amounts MUST be accepted as JSON numbers (china) or decimal strings (international) and normalized to numbers. Success validation MUST accept both envelope forms — numeric `Code` 200 (china) or string `"200"` (international) — and an explicitly non-success envelope (`Success` false, or a `Code` other than 200 in either form) MUST fail as an explicit body-level error. The Qwen balance credential type remains Alibaba AK/SK; DashScope `sk-` keys MUST NOT be accepted. Coding Plan quota is not obtainable from BSS — it is covered by the plan probe requirement.

(Previously: single hardcoded china host, no envelope validation, no site selection.)

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

### Requirement: Credential Attach Modes

The framework SHALL support per-provider credential attach modes: `bearer` (`Authorization: Bearer <key>`), `openai-admin` (admin key), and `raw` (`Authorization: <key>` verbatim, no prefix). Each provider SHALL declare exactly one attach mode for its balance surface; the ZAI provider SHALL declare `raw`. A provider MAY additionally carry an auxiliary probe credential attached as `bearer` on that probe's allowlisted host; the Qwen plan key (`sk-sp-`) is such a credential, attached only on the token-plan probe host while the provider's declared balance mode remains `ak-sk`.

(Previously: exactly one attach mode per provider with no auxiliary credential concept.)

#### Scenario: ZAI declares raw attach

- GIVEN the registered providers with their declared attach modes
- WHEN the ZAI provider builds a monitor request
- THEN the credential attaches verbatim with no prefix, while providers declaring `bearer` or `openai-admin` attach their documented forms

#### Scenario: Qwen plan key attaches as bearer

- GIVEN a stored `sk-sp-` plan key and a probe request
- WHEN dispatched through the network layer
- THEN the key attaches as `Authorization: Bearer <key>` and the balance surface still attaches AK/SK via the signed query

## ADDED Requirements

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
