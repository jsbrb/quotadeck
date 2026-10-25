# Provider Framework Specification

## Purpose

Defines the `Provider` contract, provider registration, and four stub providers (ZAI, Qwen/Alibaba BSS, OpenAI, Kimi) whose parsing logic is proven exclusively against recorded fixtures in this milestone. No live API calls.

## Requirements

### Requirement: Provider Contract

The system SHALL define a `Provider` contract that every provider implements, exposing a stable provider id, display name, required credential type, and a parse routine that converts recorded provider responses into a normalized usage result (provider id, value, currency, usage tier when available, timestamp).

#### Scenario: Contract compliance of the four stubs

- GIVEN the four registered stub providers
- WHEN each is resolved by provider id
- THEN each satisfies the `Provider` contract with the documented response shape as input

### Requirement: Provider Registration

The system SHALL expose a registry mapping provider ids to provider instances. The registry MUST reject duplicate ids at registration time and unknown ids at lookup time.

#### Scenario: Duplicate id rejected

- GIVEN a provider already registered under id `zai`
- WHEN another provider registers with id `zai`
- THEN registration fails with an explicit error

#### Scenario: Unknown id rejected

- GIVEN the registry containing the four stubs
- WHEN looking up id `unknown-provider`
- THEN lookup fails with an explicit error

### Requirement: ZAI Parsing (bigmodel.cn expenseBillList)

The ZAI stub SHALL model the documented endpoint: GET `expenseBillList` with `billingMonth` (YYYY-MM) plus `pageNum`/`pageSize`, Bearer credential, success only on numeric `code` 200. Cost per record SHALL compute as `costPrice / 1000 * deductUsage`; tier SHALL derive from `tokenResourceName`; pagination SHALL be driven by `total` with a 500–2000 ms delay between pages; records SHALL be deduplicated by `billingNo`.

#### Scenario: Fixture page parsed

- GIVEN a recorded `expenseBillList` fixture page with numeric `code` 200
- WHEN parsed
- THEN cost equals the sum of `costPrice / 1000 * deductUsage` per record and the tier label comes from `tokenResourceName`

#### Scenario: Non-numeric or non-200 code rejected

- GIVEN fixtures where `code` is `"200"` (string) or any non-200 value
- WHEN parsed
- THEN parsing fails with an explicit error

#### Scenario: Pagination plan with jitter and dedupe

- GIVEN fixtures spanning 3 pages with a `total` requiring all pages and one repeated `billingNo`
- WHEN the pagination plan executes with an injected clock
- THEN consecutive page requests are separated by 500–2000 ms, each page carries `billingMonth` (YYYY-MM) with `pageNum`/`pageSize`, fetching stops once `total` records are collected, and the repeated `billingNo` is counted once

### Requirement: Qwen Parsing (Alibaba BSS QueryAccountBalance)

The Qwen stub SHALL model balance-only retrieval via Alibaba BSS `QueryAccountBalance` (API 2017-12-14): balance from `Data.AvailableAmount`, currency from `Data.Currency`. The Qwen stub SHALL declare Alibaba AK/SK as its credential type; DashScope `sk-` keys MUST NOT be accepted. Coding Plan quota is out of scope.

#### Scenario: Balance fixture parsed

- GIVEN a recorded `QueryAccountBalance` fixture with `Data.AvailableAmount` and `Data.Currency`
- WHEN parsed
- THEN the normalized result reports that balance and currency

#### Scenario: DashScope key rejected

- GIVEN a candidate Qwen credential of form `sk-...`
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

### Requirement: Fixture-Only Data

Every provider test in this milestone SHALL run against recorded fixture files; no test SHALL perform live network I/O.

#### Scenario: Suites are hermetic

- GIVEN the full vitest suite
- WHEN executed
- THEN all provider tests pass using fixture data only and no outbound network call occurs
