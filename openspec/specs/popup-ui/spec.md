# Popup UI Specification

## Purpose

The action popup: renders per-provider usage, tier, and error state from the last live badge cycle, including per-model consumption, the ZAI monitor budget block (plan level, 5h and weekly windows, MCP window) and the Qwen token-plan quota card (hito-12 twin-card: hero percentage + monitor bar + resets line); manages provider keys behind a settings gear with validated entry, masked display, and revocation, and hosts the ZAI platform selector, the Qwen site selector and the badge provider selector — a preference also changeable by clicking a card hero (hito-12 click-to-badge). Consumes `key-storage`, `provider-framework`, and `usage-badge` unmodified.

## Requirements

### Requirement: Provider List Rendering

The popup main view SHALL render one card per provider with a stored credential; keyless providers SHALL render no card. Monetary providers with a credential SHALL render last-cycle usage with currency, the balance as the card's leading figure where the card carries no primary percentage — the view MUST NOT synthesize a percentage for them; for ZAI a budget block (plan level, 5h and weekly windows, MCP used/ceiling/per-tool). Where a card's primary percentage exists (ZAI: the 5h window; Qwen: the token-plan quota — the Qwen card is a twin of the monitor card per §Qwen Token Plan Quota Line), it SHALL render twice: as the card's largest, boldest element above all other card content, and as the same number inside or over its threshold bar; the displayed figure is the rounded percentage (uncapped). Secondary information (window label, used/total, countdown) SHALL render in normal weight below the primary figure. Every window carrying a percentage SHALL render a threshold-colored progress bar in contiguous bands derived from the rounded displayed percentage — green below 70%, amber at or above 70%, red at or above 90%; every percentage maps to exactly one band. Visual bar fill SHALL cap at 100; percentage text SHALL remain uncapped in both placements. A percentage-less window with used and ceiling (MCP) SHALL derive bar fill from used/ceiling at render time, presentation only — the view MUST NOT synthesize a percentage for it. Every reset countdown (ZAI windows, Qwen quota and plan lines) SHALL render through the shared countdown formatter as a distinct, prominent element: hours form at or below 24h (`Xh Ym`, or `Xm` under an hour), day form `Xd Yh Zm` above it — the boundary splits on the RAW remaining milliseconds, so exactly 24h renders `1d 0h 0m` while 23h59m59s keeps the hours form — and an elapsed or due reset collapses to `0m`. On refresh failure, a credentialed provider SHALL render a per-provider error card styled consistently with the others. Identical cycle data and key states SHALL produce byte-identical output.

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

#### Scenario: Countdown day form above 24h

- GIVEN a reset instant 215h 29m from the render instant
- WHEN the countdown renders
- THEN it reads `8d 23h 29m`
- AND a countdown of exactly 24h reads `1d 0h 0m` while 23h59m59s reads `24h 0m`

### Requirement: Current Cycle Data on Open

The popup SHALL open with the most recent completed badge cycle's data (`usage-badge`), error states included, without waiting for a new cycle.

#### Scenario: Open reflects last cycle

- GIVEN a completed badge cycle
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

### Requirement: Settings Gear Surface

Key management SHALL be reachable only through a settings gear control in the popup; the main view MUST NOT render inline key forms. Within the gear surface, the existing key-validation, masked-display, and revocation requirements apply unchanged, and per-provider isolation SHALL be preserved.

#### Scenario: Gear replaces inline key forms

- GIVEN the popup main view
- WHEN rendered
- THEN a settings gear is present and no inline key entry form appears in the main view

#### Scenario: Key management inside the gear

- GIVEN the gear surface opened for provider `openai`
- WHEN a valid credential is submitted and stored
- THEN the gear shows a masked stored-key indication for `openai` only

#### Scenario: Isolation preserved in the gear

- GIVEN stored keys for `zai` and `kimi`
- WHEN `zai` is revoked from the gear surface
- THEN `kimi` remains stored and displayed masked

### Requirement: Per-Model Consumption View

The main popup content SHALL be a consumption view organized per provider, with a per-model breakdown rendered when the normalized result includes per-model data; providers without per-model data SHALL render their provider-level total only. Rendering SHALL be deterministic for identical cycle data.

#### Scenario: Per-model rows rendered

- GIVEN a cycle result including per-model usage for one provider
- WHEN the popup renders
- THEN that provider shows its per-model rows while others show provider-level totals

#### Scenario: Deterministic per-model rendering

- GIVEN the same last-cycle data rendered twice
- WHEN the outputs are compared
- THEN they are identical

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

### Requirement: Settings Guidance

Each provider's settings entry SHALL render static English guidance BEFORE its input(s) — whether or not a key is stored — distinct from validation errors. Normative copy:

| Provider | Guidance copy |
|----------|---------------|
| Qwen | Balance: names both fields (Access Key ID, Access Key Secret); created in Alibaba Cloud Console → RAM → AccessKey pair; requires RAM permission `bss:DescribeAcccount`; DashScope `sk-` keys do not work for balance. Plan (optional): a separate inference-only `sk-sp-` key from the Qwen token-plan service; probes the international endpoint and each probe costs one 1-token request; NOT the AccessKey pair. Site: international accounts (the default) use the ap-southeast-1 endpoint; china accounts select China. |
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

### Requirement: Qwen Site Selector

The settings gear SHALL expose a Qwen site selector (International — the default — or China) that persists locally as the non-secret preference `qd:pref:qwen-site`, renders unmasked, and switches the base URL of every Qwen BSS balance request built by the retained provider (dispatch of that balance path is currently suspended — provider-framework §Qwen Parsing). The same preference gates the token-plan quota tick step (provider-framework §Qwen Token-Plan Quota Tick Step): international runs the two-hop quota, china — which carries no live-verified quota surface — no-ops. An international account queried against the china host fails with `AuthSiteFail`; the selector is the user's remedy and its options MUST communicate that international is the default.

#### Scenario: Selector defaults and persists

- GIVEN the gear surface with no stored qwen site preference
- WHEN China is selected and the popup is reopened
- THEN the selector shows China unmasked, and qwen balance requests target `business.aliyuncs.com`
- AND with no selection the default International targets `business.ap-southeast-1.aliyuncs.com`

### Requirement: Qwen Plan Line

A qwen card whose cycle result carries plan status SHALL render a plan line in normal weight below the balance and the token-plan quota block: `Plan: Available`; `Plan: exhausted · resets in {countdown}` (derived from the reset instant at render time); or `Plan: key rejected`. Where the card carries a primary percentage it leads the card (twin-card rule, §Qwen Token Plan Quota Line — quota heroes render above the balance); otherwise the balance is the leading figure; no percentage is ever synthesized for the binary plan, and plan status never moves the toolbar badge (the badge follows the chosen provider per `usage-badge`). A qwen card SHALL render when EITHER qwen credential is stored; a plan-only card (no AK/SK) renders the plan line without a balance figure and without a synthesized hero.

#### Scenario: Plan line per status

- GIVEN qwen cycle results carrying plan status available, exhausted (reset in 2h), and key-rejected
- WHEN each card renders
- THEN the plan lines read `Plan: Available`, `Plan: exhausted · resets in 2h 0m`, and `Plan: key rejected` respectively

#### Scenario: Plan-only card renders

- GIVEN a stored plan key and no AK/SK pair
- WHEN the main view renders
- THEN a qwen card appears showing the plan line and no balance figure

#### Scenario: Deterministic plan rendering

- GIVEN the same cycle data and key states rendered twice
- WHEN the outputs are compared
- THEN they are identical

### Requirement: Qwen Token Plan Quota Line

A qwen cycle result carrying the token-plan quota SHALL render the Qwen card as a twin of the ZAI monitor card (hito-12 WU-M, user-ratified): the quota percentage renders TWICE — as the card's `.hero-percentage` (the rounded displayed figure, uncapped text, threshold-colored) above all other card content, and as the same figure inside a threshold monitor bar (`bar-pct`) whose visual fill caps at 100 exactly like ZAI's bar. The bar's accompanying line keeps only the window-label vocabulary: `Token Plan: Resets in <countdown>`, the countdown derived at display time from `quota.resetAt` through the SAME shared formatter as the monitor windows. Absent-percentage and absent-reset mirror the ZAI windowLine discipline: a quota with a percentage but no reset renders the bar alone; a reset-only quota renders the resets line WITHOUT a bar and without a hero; a quota carrying neither field renders no block; nothing is synthesized. The block sits below the balance and above the binary plan line, and plan and quota coexist independently. Where both a ZAI 5h window and a quota exist on one entry, the 5h window takes hero precedence — a card never carries two heroes. Frozen LAST KNOWN renders carry the quota block with the usage it belongs to.

#### Scenario: Quota renders as twin card

- GIVEN a qwen result with quota percentage 11.72 and reset in 1h 30m
- WHEN the popup renders
- THEN the card shows `12%` (Math.round) as its largest, boldest element above all other card content, the same `12%` inside the green-band monitor bar (fill 12%), and the line `Token Plan: Resets in 1h 30m`

#### Scenario: Quota fill capped, text uncapped

- GIVEN a qwen quota at percentage 127.3
- WHEN rendered
- THEN hero and in-bar text both read 127 while the bar fill caps at 100, band red

#### Scenario: Quota honest absence mirrors ZAI

- GIVEN qwen quota results: percentage-only, reset-only, and neither field
- WHEN each card renders
- THEN percentage-only shows hero and bar with no resets line, reset-only shows the resets line without bar or hero, and neither-field renders no quota block at all

### Requirement: Qwen Plan Key Settings Group

The qwen settings section SHALL render a second field group — `Plan key (sk-sp-)` — with its own password input, save, and revoke controls, validated to a non-empty `sk-sp-` prefix, persisted only through the storage wrapper's plan slot, displayed masked (≤4-character suffix), and revocable independently of the AK/SK pair above it.

#### Scenario: Valid plan key persisted and masked

- GIVEN a valid `sk-sp-` key entered in the plan group
- WHEN submitted
- THEN it persists through the wrapper's plan slot and displays masked
- AND the AK/SK pair's stored state is unchanged

#### Scenario: Revoke isolation from the pair

- GIVEN both qwen credentials stored
- WHEN the plan key is revoked from its group
- THEN the AK/SK pair remains stored and displayed masked

### Requirement: Qwen Credential Form Stacking

The qwen settings section SHALL stack its credential form vertically (hito-12 WU-K): one labeled full-width field per line — the Access Key ID on its own labeled row, then the Access Key Secret on its own labeled row — the plan key group a separate stacked row (`Plan key (sk-sp-)` label above its own full-width input), and each group's save and revoke controls on their own row below the fields. No two fields share a line. Single-field providers keep their inline form unchanged.

#### Scenario: Qwen fields stack one per line

- GIVEN the qwen settings section rendered
- WHEN its form is inspected
- THEN the Access Key ID row, the Access Key Secret row, the plan key row, and the save/revoke action rows each occupy their own line, every label sitting above its own full-width field

#### Scenario: Single-field providers unchanged

- GIVEN the zai settings section rendered
- WHEN its form is inspected
- THEN the single credential input keeps its existing inline form

### Requirement: Badge Provider Selector

The settings view SHALL open with a badge provider selector as the FIRST block under the header, before the provider sections (hito-12 WU-D2). Its options SHALL be the shipped providers, composed data-driven from the provider list the controller supplies (display names unmasked, no hardcoded option list in the view), and the currently stored preference (`qd:pref:badge-provider`, default zai) SHALL carry the `selected` attribute. Changing the selection SHALL persist through the non-secret preference wrapper (`key-storage`) and re-render the view; the dropdown remains the discoverable path alongside click-to-badge — both write the same store.

#### Scenario: Selector reflects the stored preference

- GIVEN a stored badge-provider preference of `qwen`
- WHEN the settings view renders
- THEN the selector's options are the shipped providers and `qwen` carries `selected`

#### Scenario: Selection persists

- GIVEN the settings view with the default selection
- WHEN `qwen` is chosen in the selector
- THEN the preference persists through the wrapper and the re-rendered selector shows `qwen` selected

### Requirement: Click-to-Choose Badge

Every card hero percentage SHALL sit inside a clickable hero wrapper carrying a tooltip (`title` "Show this provider in the toolbar badge"; hito-12 WU-M2). Activating the wrapper SHALL write the enclosing card's provider as the badge-provider preference through the same preference wrapper the dropdown uses, then re-render the popup optimistically; the click path MUST NOT touch the alarms port or the snapshot, and the toolbar badge itself refreshes on the next background tick. The badge-owning card SHALL render a `.chip-badge` marker EXACTLY ONCE — beside the hero when the live card renders one, beside the provider name otherwise (plan-only, quota-less, failed or frozen-only shapes, and chosen-without-data). Cards without a hero render no click target, nothing is synthesized for them, and no other card carries the marker. A click whose provider is forged, unshipped, or fails the store guard MUST be ignored with nothing written.

#### Scenario: Clicking a hero moves the badge

- GIVEN the badge currently belongs to `zai`
- WHEN the qwen card's hero is clicked
- THEN the preference is written to `qwen`, the popup re-renders optimistically, and the `.chip-badge` marker appears exactly once on the qwen card and is removed from `zai`

#### Scenario: No-hero card marks the name row

- GIVEN a card is the chosen provider but renders no hero (plan-only or quota-less qwen)
- WHEN the popup renders
- THEN the `.chip-badge` marker appears once beside the provider name and no click affordance is synthesized

#### Scenario: Forged and unshipped payloads ignored

- GIVEN a click whose enclosing card carries a forged or unshipped `data-provider`
- WHEN the controller handles it
- THEN the preference is not written and the render is unchanged
