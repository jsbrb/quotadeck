# Delta for popup-ui

## ADDED Requirements

### Requirement: ZAI Platform Selector

The settings gear SHALL expose a ZAI platform selector (Z.AI or ZHIPU; default Z.AI) that persists locally as a non-secret preference, renders unmasked, and switches the base URL of ZAI monitor requests. When a ZAI refresh fails auth, the popup SHALL surface the wrong-platform guidance from `zai-monitor`.

#### Scenario: Selector defaults and persists

- GIVEN the gear surface with no stored preference
- WHEN ZHIPU is selected and the popup is reopened
- THEN the selector shows ZHIPU unmasked, and ZAI requests target `open.bigmodel.cn`

#### Scenario: Wrong-platform guidance surfaced

- GIVEN a ZAI auth failure carrying wrong-platform guidance
- WHEN the popup renders the error state
- THEN the guidance to check the platform selection is displayed

## MODIFIED Requirements

### Requirement: Provider List Rendering

The popup SHALL render one entry per registered provider (ZAI, Qwen, OpenAI, Kimi): last-cycle usage value with currency for monetary providers, and for ZAI a budget block with plan level, the 5h window (percentage uncapped, used, total, countdown), the weekly window, and the MCP window (used, ceiling, per-tool); plus a per-provider error indication on refresh failure. Identical cycle data SHALL produce identical rendered output.
(Previously: every provider rendered value and currency plus tier when included; no ZAI budget block existed.)

#### Scenario: Usage and tier rendered

- GIVEN last-cycle results for all four providers, one monetary result including a tier
- WHEN the popup renders
- THEN each provider id appears, the monetary providers with value and currency, the tier only for the result including one, and ZAI with its budget block

#### Scenario: Per-provider error state

- GIVEN a cycle where Qwen failed, others succeeded
- WHEN the popup renders
- THEN Qwen shows an error indication while the others show usage

#### Scenario: Deterministic rendering

- GIVEN the same last-cycle data rendered twice
- WHEN the outputs are compared
- THEN they are identical

#### Scenario: ZAI budget block rendered

- GIVEN a ZAI result with level `Pro`, 5h percentage 137 / used 16440 / total 12000 with countdown, weekly window, and MCP window
- WHEN the popup renders
- THEN the ZAI block shows the level, the uncapped 5h percentage with used, total, and countdown, the weekly window, and MCP used, ceiling, and per-tool rows
