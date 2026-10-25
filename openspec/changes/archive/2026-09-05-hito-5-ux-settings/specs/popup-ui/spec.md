# Delta for popup-ui

## MODIFIED Requirements

### Requirement: Provider List Rendering

The popup main view SHALL render one card per registered provider (ZAI, Qwen, OpenAI, Kimi): last-cycle usage with currency for monetary providers; for ZAI a budget block (plan level, 5h and weekly windows, MCP used/ceiling/per-tool); on refresh failure a per-provider error card styled consistently with the others. Every window carrying a percentage SHALL render a threshold-colored progress bar in contiguous bands — green below 70%, amber at or above 70%, red at or above 90%; every percentage maps to exactly one band. Visual bar fill SHALL cap at 100; percentage text SHALL remain uncapped. A percentage-less window with used and ceiling (MCP) SHALL derive bar fill from used/ceiling at render time, presentation only — the view MUST NOT synthesize a percentage for it. The 5h countdown SHALL render as a distinct, prominent element. Identical cycle data SHALL produce byte-identical output.

(Previously: flat provider entries, usage text only; no cards, bars, or bands.)

#### Scenario: Usage and tier rendered

- GIVEN last-cycle results for all four providers, one including a tier
- WHEN the popup renders
- THEN one card per provider id appears, monetary providers with value and currency, the tier only where included, ZAI with its budget block

#### Scenario: Threshold bands

- GIVEN ZAI 5h windows at percentages 55, 70, 90, and 137
- WHEN each bar is inspected
- THEN bands are green, amber, red, red — no percentage unmapped

#### Scenario: Fill capped, text uncapped

- GIVEN a ZAI 5h window at percentage 137
- WHEN rendered
- THEN bar fill caps at 100 while percentage text reads 137

#### Scenario: MCP bar from used/ceiling

- GIVEN a ZAI MCP window: used 0, ceiling 1000, no percentage
- WHEN rendered
- THEN bar fill derives from used/ceiling; no percentage text appears

#### Scenario: Per-provider error state

- GIVEN a cycle where only Qwen failed
- WHEN the popup renders
- THEN Qwen renders an error card structurally consistent with the others

#### Scenario: Deterministic rendering

- GIVEN the same last-cycle data rendered twice
- WHEN the outputs are compared
- THEN they are byte-identical

#### Scenario: ZAI budget block rendered

- GIVEN a ZAI result: level `Pro`, 5h 137% (used 16440, total 12000), countdown, weekly and MCP windows
- WHEN the popup renders
- THEN the ZAI card shows level, uncapped percentage with used and total, a distinct countdown element, weekly bar, and MCP used, ceiling, per-tool rows

## ADDED Requirements

### Requirement: Settings Guidance

Each provider's settings entry SHALL render static English guidance BEFORE its input(s) — whether or not a key is stored — distinct from validation errors. Normative copy:

| Provider | Guidance copy |
|----------|---------------|
| Qwen | Names both fields (Access Key ID, Access Key Secret); created in Alibaba Cloud Console → RAM → AccessKey pair; requires RAM permission `bss:DescribeAcccount`; DashScope `sk-` keys do not work. |
| OpenAI | Admin API key (`sk-admin-`, read scope) from organization settings; regular project keys rejected. |
| Kimi | Key from the Kimi console; CN and international keys not interchangeable. |
| ZAI | The coding-plan API key (the same key your coding tools use); selector chooses Z.AI international or ZHIPU bigmodel.cn; keys are platform-bound. |

#### Scenario: Guidance precedes inputs

- GIVEN `qwen` settings with no stored key and `openai` settings with one
- WHEN each renders
- THEN each shows its guidance before its input(s)

#### Scenario: Verbatim provider copy

- GIVEN settings entries for all four providers
- WHEN the guidance text is inspected
- THEN each entry contains its provider's full copy from the table

#### Scenario: Guidance distinct from errors

- GIVEN an invalid `kimi` key submitted, showing a validation error
- WHEN the entry renders
- THEN guidance and validation error appear as separate content

### Requirement: Branding Footer

The popup SHALL render a footer credit "Built by The North Code" linking to https://www.thenorthcode.es/ (plain anchor suffices) on both main and settings views, deterministically.

#### Scenario: Footer on both views

- GIVEN the popup rendered in both views
- WHEN each output is inspected
- THEN both contain a footer: credit text "Built by The North Code", anchor to https://www.thenorthcode.es/
- AND identical across renders of the same state
