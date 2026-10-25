# Popup UI Specification

## Purpose

The action popup: renders per-provider usage, tier, and error state from the last badge cycle; manages provider keys with validated entry, masked display, and revocation. Fixture-only in this milestone. Consumes `key-storage`, `provider-framework`, and `usage-badge` unmodified.

## Requirements

### Requirement: Provider List Rendering

The popup SHALL render one entry per registered provider (ZAI, Qwen, OpenAI, Kimi): last-cycle usage value with currency, tier when the normalized result includes one, and a per-provider error indication on refresh failure. Identical cycle data SHALL produce identical rendered output.

#### Scenario: Usage and tier rendered

- GIVEN last-cycle results for all four providers, one including a tier
- WHEN the popup renders
- THEN each provider id appears with value and currency, the tier only for the result including one

#### Scenario: Per-provider error state

- GIVEN a cycle where Qwen failed, others succeeded
- WHEN the popup renders
- THEN Qwen shows an error indication while the others show usage

#### Scenario: Deterministic rendering

- GIVEN the same last-cycle data rendered twice
- WHEN the outputs are compared
- THEN they are identical

### Requirement: Current Cycle Data on Open

The popup SHALL open with the most recent completed badge cycle's data (`usage-badge`), error states included, without waiting for a new cycle; that cycle is fixture-driven in this milestone.

#### Scenario: Open reflects last cycle

- GIVEN a completed fixture-driven badge cycle
- WHEN the popup opens
- THEN the displayed per-provider data equals that cycle's normalized results

### Requirement: Key Addition with Validation

Entered keys SHALL be validated through the existing credential validation (`provider-framework`); valid keys persist only through the storage wrapper (`key-storage`). Empty or invalid input MUST be rejected with the existing guidance and nothing persisted, including Qwen: DashScope `sk-` keys rejected with the Alibaba AK/SK (RAM `bss:DescribeAcccount`) hint.

#### Scenario: Valid key persisted via wrapper

- GIVEN a valid `openai` credential entered in the popup
- WHEN submitted
- THEN it persists through the storage wrapper and the provider shows a stored key

#### Scenario: Empty input rejected

- GIVEN an empty key field
- WHEN submission is attempted
- THEN guidance is shown and nothing is persisted

#### Scenario: Qwen sk- key rejected with hint

- GIVEN a candidate Qwen key `sk-...`
- WHEN submitted
- THEN it is rejected with the Alibaba AK/SK (RAM `bss:DescribeAcccount`) guidance and nothing persists

### Requirement: Masked Key Display

Displayed key state SHALL be masked, revealing at most a 4-character suffix. The full key MUST NOT appear in rendered output anywhere outside the key input field while a value is being entered.

#### Scenario: Stored key rendered masked

- GIVEN a stored key `sk-test-1234567890abcdef`
- WHEN the popup renders key state
- THEN the displayed form reveals at most the last 4 characters

#### Scenario: Full key absent from rendered output

- GIVEN a key entered and submitted
- WHEN output is inspected after submission
- THEN the full key appears nowhere outside the input field during entry

### Requirement: Revocation from the Popup

The popup SHALL support per-provider key revocation, isolated per `key-storage`: revoking one key MUST NOT affect others. Post-revoke, the popup SHALL reflect that provider's key absence.

#### Scenario: Post-revoke absence

- GIVEN a stored `kimi` key
- WHEN revoked from the popup
- THEN the popup shows no stored key for `kimi`

#### Scenario: Revoke isolation

- GIVEN stored keys for `zai` and `kimi`
- WHEN `zai` is revoked from the popup
- THEN `kimi` remains stored and displayed

### Requirement: Fixture-Only Operation

The popup SHALL NOT initiate live network requests in this milestone; all displayed data SHALL come from the fixture-driven badge cycle.

#### Scenario: No live network from popup

- GIVEN the popup under the hermetic suite
- WHEN opened, rendered, and used for key management
- THEN no outbound network request originates from the popup
