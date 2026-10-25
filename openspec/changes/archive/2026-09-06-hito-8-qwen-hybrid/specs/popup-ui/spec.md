# Delta for popup-ui

## ADDED Requirements

### Requirement: Qwen Site Selector

The settings gear SHALL expose a Qwen site selector (International — the default — or China) that persists locally as the non-secret preference `qd:pref:qwen-site`, renders unmasked, and switches the base URL of every Qwen BSS balance request. An international account queried against the china host fails with `AuthSiteFail`; the selector is the user's remedy and its options MUST communicate that international is the default.

#### Scenario: Selector defaults and persists

- GIVEN the gear surface with no stored qwen site preference
- WHEN China is selected and the popup is reopened
- THEN the selector shows China unmasked, and qwen balance requests target `business.aliyuncs.com`
- AND with no selection the default International targets `business.ap-southeast-1.aliyuncs.com`

### Requirement: Qwen Plan Line

A qwen card whose cycle result carries plan status SHALL render a plan line in normal weight below the balance: `Plan: Available`; `Plan: exhausted · resets in {countdown}` (derived from the reset instant at render time); or `Plan: key rejected`. The balance remains the card's leading figure when present, no percentage is ever synthesized for the plan, and the badge is unaffected. A qwen card SHALL render when EITHER qwen credential is stored; a plan-only card (no AK/SK) renders the plan line without a balance figure.

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

## MODIFIED Requirements

### Requirement: Settings Guidance

Each provider's settings entry SHALL render static English guidance BEFORE its input(s) — whether or not a key is stored — distinct from validation errors. Normative copy:

| Provider | Guidance copy |
|----------|---------------|
| Qwen | Balance: names both fields (Access Key ID, Access Key Secret); created in Alibaba Cloud Console → RAM → AccessKey pair; requires RAM permission `bss:DescribeAcccount`; DashScope `sk-` keys do not work for balance. Plan (optional): a separate inference-only `sk-sp-` key from the Qwen token-plan service; probes the international endpoint and each probe costs one 1-token request; NOT the AccessKey pair. Site: international accounts (the default) use the ap-southeast-1 endpoint; china accounts select China. |
| OpenAI | Admin API key (`sk-admin-`, read scope) from organization settings; regular project keys rejected. |
| Kimi | Key from the Kimi console; CN and international keys not interchangeable. |
| ZAI | The coding-plan API key (the same key your coding tools use); selector chooses Z.AI international or ZHIPU bigmodel.cn; keys are platform-bound. |

(Previously: the qwen row covered only the AK/SK pair and stated DashScope `sk-` keys do not work without the balance/plan distinction.)

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
