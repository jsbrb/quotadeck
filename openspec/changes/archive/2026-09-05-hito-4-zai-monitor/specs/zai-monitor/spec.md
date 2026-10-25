# ZAI Monitor Specification

## Purpose

ZAI usage monitoring from the official `GET /api/monitor/usage/quota/limit` endpoint: plan level, 5-hour and weekly token windows, monthly MCP window, API-provided percentage with client-side used derivation, reset countdown, platform binding, raw authorization, and status-first error classification.

> Wire shape pinned from a live capture (maintainer plan `pro`, api.z.ai, 2026-09-05): the entries array is `data.limits`; a `TOKENS_LIMIT` entry MAY carry only `percentage` + `nextResetTime` with no total; `usageDetails` is an array of `{modelCode, usage}` entries.

## Requirements

### Requirement: Single-Shot Monitor Query

The ZAI provider SHALL issue exactly one GET to `/api/monitor/usage/quota/limit` per refresh. It MUST NOT paginate, MUST NOT send a request body, and MUST NOT send pagination or window query parameters.

#### Scenario: One request per refresh

- GIVEN an injected transport and an injected clock
- WHEN a ZAI refresh executes
- THEN exactly one GET to `/api/monitor/usage/quota/limit` is recorded, with no body and no pagination parameters

### Requirement: Level and Window Discrimination

The provider SHALL report `data.level` as the plan level. From the `data.limits` entries it SHALL map the 5h window to the `TOKENS_LIMIT` entry with `unit` 3 and `number` 5, and the weekly window to the `TOKENS_LIMIT` entry with `unit` 6 and `number` 1. When token-limit entries omit these discriminators, the provider SHALL fall back to position: `limits[0]` maps to the 5h window and `limits[1]` to the weekly window.

#### Scenario: Discriminated windows parsed

- GIVEN a fixture with `data.level` `Pro`, a `TOKENS_LIMIT` with unit 3 / number 5, and a `TOKENS_LIMIT` with unit 6 / number 1
- WHEN parsed
- THEN the level is `Pro`, the first entry populates the 5h window, and the second the weekly window

#### Scenario: Positional fallback

- GIVEN a fixture whose two token-limit entries omit unit/number
- WHEN parsed
- THEN entry 0 populates the 5h window and entry 1 the weekly window

#### Scenario: MCP-only fixture

- GIVEN a fixture whose `data` contains only a `TIME_LIMIT` entry
- WHEN parsed
- THEN the MCP window reports and the 5h and weekly windows are absent without error

### Requirement: Percentage Passthrough and Used Derivation

The API-provided `percentage` SHALL pass through uncapped: values above 100 SHALL report as-is. A `null` or absent `percentage` SHALL report that window's percentage as absent. A window WITHOUT `total` is valid: `percentage` and the reset countdown SHALL report, with `used` and `total` absent. When `percentage` and `total` are both present, used SHALL be derived client-side as `round(total × percentage / 100)`. An entry carrying neither `percentage` nor `total` SHALL be skipped.

#### Scenario: Uncapped percentage with derived used

- GIVEN a 5h window reporting percentage 137 and total 12000
- WHEN parsed
- THEN the percentage reports 137 (not capped to 100) and used reports 16440

#### Scenario: Null percentage is absent

- GIVEN a window reporting percentage null
- WHEN parsed
- THEN that window reports no percentage and no derived used

#### Scenario: Total-less window is valid

- GIVEN a 5h `TOKENS_LIMIT` entry reporting percentage 32 and `nextResetTime` but no total
- WHEN parsed
- THEN the 5h window reports percentage 32 with its countdown, and used and total are absent

### Requirement: Reset Countdown

`nextResetTime` SHALL be interpreted as epoch milliseconds; the countdown SHALL equal `nextResetTime − now` with `now` from an injectable clock. A window without `nextResetTime` SHALL report its countdown as gracefully absent and MUST NOT fail the other windows.

#### Scenario: Countdown derived

- GIVEN a 5h window with `nextResetTime` E and an injected now
- WHEN parsed
- THEN the 5h countdown equals E − now

#### Scenario: Graceful absence

- GIVEN a fixture whose windows carry no `nextResetTime`
- WHEN parsed
- THEN the windows still report and every countdown is absent without error

### Requirement: Monthly MCP Window

The provider SHALL report the monthly MCP window from the `TIME_LIMIT` entry: used from `currentValue`, ceiling from `usage`, and per-tool usage from `usageDetails` — an array of `{modelCode, usage}` entries (non-object entries are ignored). The MCP window carries no `nextResetTime`; the provider SHALL NOT synthesize a percentage or countdown for it.

#### Scenario: MCP block parsed

- GIVEN a `TIME_LIMIT` entry with currentValue 0, usage 1000, and `usageDetails` entries for `search-prime`, `web-reader` and `zread`
- WHEN parsed
- THEN MCP reports used 0, ceiling 1000, and all three per-tool entries name-sorted, with no percentage and no countdown

### Requirement: Platform Binding

The ZAI credential SHALL target exactly one platform: Z.AI (`api.z.ai`, the default) or ZHIPU (`open.bigmodel.cn`). The selected platform SHALL determine the base URL of every monitor request. Keys SHALL be treated as platform-bound: an auth failure on the selected platform SHALL surface guidance to check the platform selection rather than only a generic auth error.

#### Scenario: Default platform

- GIVEN no stored platform preference
- WHEN a monitor request is built
- THEN it targets `api.z.ai`

#### Scenario: Selection switches base URL

- GIVEN a stored preference for ZHIPU
- WHEN a monitor request is built
- THEN it targets `open.bigmodel.cn`

#### Scenario: Wrong-platform key guidance

- GIVEN a ZHIPU-issued key while Z.AI is selected and a 401 response
- WHEN the refresh completes
- THEN the auth error includes guidance that the key may belong to the other platform

### Requirement: Raw Authorization

Monitor requests SHALL attach the credential as `Authorization: <raw key>` — the stored key verbatim with no `Bearer` prefix — plus an `Accept-Language` header, on both monitor hosts.

#### Scenario: Raw header on both platforms

- GIVEN a stored ZAI key and each platform selection
- WHEN requests are recorded through an injected transport
- THEN each `Authorization` value equals the raw key with no Bearer prefix, and `Accept-Language` is present

### Requirement: Status-First Error Classification

Error responses SHALL be classified by HTTP status BEFORE any body parse. Plain-text (non-JSON) bodies on error statuses MUST NOT cause a parse failure.

#### Scenario: Plain-text auth errors

- GIVEN transports answering 401 and 403 with plain-text bodies
- WHEN each refresh completes
- THEN each failure is classified auth, with no body-parse error raised
