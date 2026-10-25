# Delta for popup-ui

## ADDED Requirements

### Requirement: Manual Refresh Control

The main view SHALL expose a refresh affordance in its header. When activated, the popup SHALL register a storage-change listener for the usage snapshot key and then create a one-shot alarm named `refresh-now` with an immediate `when` through the injected browser alarms port. When the listener observes a storage change to the snapshot key, the popup SHALL re-read the snapshot and re-render the main view from it; no other data path SHALL be introduced.

#### Scenario: Refresh affordance present

- GIVEN the popup main view
- WHEN rendered
- THEN the header contains a refresh affordance

#### Scenario: Activation creates the one-shot alarm

- GIVEN the main view rendered with the injected browser alarms port and storage port
- WHEN the refresh affordance is activated
- THEN a storage-change listener for the snapshot key is registered
- AND a one-shot alarm named `refresh-now` with an immediate `when` is created through the alarms port

#### Scenario: Snapshot re-read on storage change

- GIVEN an activated refresh whose alarm-triggered tick has written a new snapshot
- WHEN the storage change to the snapshot key is observed
- THEN the popup re-reads the snapshot and re-renders the main view from it

## MODIFIED Requirements

### Requirement: Provider List Rendering

The popup main view SHALL render one card per provider with a stored credential; keyless providers SHALL render no card. Monetary providers with a credential SHALL render last-cycle usage with currency, the balance as the card's leading figure — the view MUST NOT synthesize a percentage for them; for ZAI a budget block (plan level, 5h and weekly windows, MCP used/ceiling/per-tool). Where a card's primary percentage exists (ZAI: the 5h window), it SHALL render twice: as the card's largest, boldest element above all other card content, and as the same number inside or over its threshold bar. Secondary information (window label, used/total, countdown) SHALL render in normal weight below the primary figure. Every window carrying a percentage SHALL render a threshold-colored progress bar in contiguous bands — green below 70%, amber at or above 70%, red at or above 90%; every percentage maps to exactly one band. Visual bar fill SHALL cap at 100; percentage text SHALL remain uncapped in both placements. A percentage-less window with used and ceiling (MCP) SHALL derive bar fill from used/ceiling at render time, presentation only — the view MUST NOT synthesize a percentage for it. The 5h countdown SHALL render as a distinct, prominent element. On refresh failure, a credentialed provider SHALL render a per-provider error card styled consistently with the others. Identical cycle data and key states SHALL produce byte-identical output.

(Previously: one card per registered provider regardless of stored credential; the 5h percentage rendered once, mid-card, in normal weight.)

#### Scenario: Usage and tier rendered

- GIVEN last-cycle results for all four providers, each with a stored credential, one including a tier
- WHEN the popup renders
- THEN one card per provider id appears, monetary providers with value and currency led by the balance, the tier only where included, ZAI with its budget block

#### Scenario: Keyless provider renders no card

- GIVEN last-cycle results for all four providers, with `kimi` lacking a stored credential
- WHEN the main view renders
- THEN no `kimi` card appears
- AND the settings view still lists `kimi` with its guidance and input(s)

#### Scenario: Threshold bands

- GIVEN ZAI 5h windows at percentages 55, 70, 90, and 137
- WHEN each bar is inspected
- THEN bands are green, amber, red, red — no percentage unmapped

#### Scenario: Fill capped, text uncapped

- GIVEN a ZAI 5h window at percentage 137
- WHEN rendered
- THEN bar fill caps at 100 while the hero figure and the in-bar number both read 137

#### Scenario: MCP bar from used/ceiling

- GIVEN a ZAI MCP window: used 0, ceiling 1000, no percentage
- WHEN rendered
- THEN bar fill derives from used/ceiling; no percentage text appears

#### Scenario: Per-provider error state

- GIVEN a cycle where only `qwen` failed and `qwen` has a stored credential
- WHEN the popup renders
- THEN Qwen renders an error card structurally consistent with the others

#### Scenario: Deterministic rendering

- GIVEN the same last-cycle data and key states rendered twice
- WHEN the outputs are compared
- THEN they are byte-identical

#### Scenario: ZAI budget block rendered

- GIVEN a ZAI result: level `Pro`, 5h 137% (used 16440, total 12000), countdown, weekly and MCP windows
- WHEN the popup renders
- THEN the ZAI card shows 137% as its largest, boldest element above all other card content, the same 137 inside or over the 5h threshold bar, level, used and total in normal weight below the primary figure, a distinct countdown element, weekly bar, and MCP used, ceiling, per-tool rows
