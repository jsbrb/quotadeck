# Delta for provider-framework

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: ZAI Parsing (bigmodel.cn expenseBillList)

The ZAI provider SHALL model GET `expenseBillList` with `billingMonth` (YYYY-MM) plus `pageNum`/`pageSize`, Bearer credential, success only on numeric `code` 200. Per record it SHALL surface usage from `apiUsage`; `transaction_time` as epoch ms extracted from `billingNo` (13 chars after the first customerId occurrence); `tokenResourceName`; and the raw `timeWindow`. The tier SHALL derive from the `tokenResourceName` of the record with maximum `transaction_time`. Cost (`costPrice / 1000 * deductUsage`) SHALL remain an informational metric; budget usage comes from `apiUsage` sums per `tier-budget`. Pagination SHALL be driven by `total` with 500–2000 ms between pages; records SHALL be deduplicated by `billingNo`.

(Previously: cost was the primary usage metric; tier had no recency rule; no per-record window fields.)

#### Scenario: Fixture page parsed

- GIVEN a recorded `expenseBillList` fixture page with numeric `code` 200
- WHEN parsed
- THEN usage equals `apiUsage` per record, `transaction_time` equals the 13 epoch-ms digits after the customerId in `billingNo`, the tier comes from the latest record's `tokenResourceName`, and cost reports as an informational sum

#### Scenario: Non-numeric or non-200 code rejected

- GIVEN fixtures where `code` is `"200"` (string) or any non-200 value
- WHEN parsed
- THEN parsing fails with an explicit error

#### Scenario: Pagination plan with jitter and dedupe

- GIVEN fixtures spanning 3 pages with a `total` requiring all pages and one repeated `billingNo`
- WHEN the pagination plan executes with an injected clock
- THEN consecutive page requests are separated by 500–2000 ms, each page carries `billingMonth` (YYYY-MM) with `pageNum`/`pageSize`, fetching stops once `total` records are collected, and the repeated `billingNo` is counted once

#### Scenario: Latest record selects the tier

- GIVEN a fixture where an older record carries `tokenResourceName` `Pro` and the newest carries `Lite`
- WHEN parsed
- THEN the reported tier is `Lite`

### Requirement: Hermetic Tests with Live Transport Contract

Provider logic SHALL be tested hermetically: the vitest suite MUST pass on recorded fixtures and injected fake transports with no live network I/O. Live behavior SHALL be proven by contract: each provider issues live requests through the allowlist client, and the suite MUST assert the recorded request shape (method, host, path, credential placement, query) against the documented endpoint.

(Previously: Fixture-Only Data — provider tests ran on fixtures only, no live transport contract.)

#### Scenario: Suites are hermetic

- GIVEN the full vitest suite with injected fake transports
- WHEN executed
- THEN all provider tests pass using fixture data only and no outbound network call occurs

#### Scenario: Live request contract asserted

- GIVEN the ZAI provider with a stored credential and an injected fake transport
- WHEN a live fetch is triggered with an injected clock
- THEN the recorded request targets the allowlisted `bigmodel.cn` host, carries the Bearer credential in the `Authorization` header, includes `billingMonth` derived from the clock, and the response parses per the ZAI requirement

## RENAMED Requirements

### Requirement: Fixture-Only Data → Hermetic Tests with Live Transport Contract

(Reason: live transport now ships behind the allowlist client; fixture-only no longer describes the contract.)
(Migration: reference the new name; fixture suites remain valid under the hermetic clause.)
