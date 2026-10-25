# Delta for popup-ui

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Current Cycle Data on Open

The popup SHALL open with the most recent completed badge cycle's data (`usage-badge`), error states included, without waiting for a new cycle.

(Previously: the cycle was described as fixture-driven in this milestone.)

#### Scenario: Open reflects last cycle

- GIVEN a completed badge cycle
- WHEN the popup opens
- THEN the displayed per-provider data equals that cycle's normalized results

## REMOVED Requirements

### Requirement: Fixture-Only Operation

(Reason: popup data now derives from live badge cycles through the allowlist client; the fixture-only constraint no longer holds.)
(Migration: none — the popup still renders last-cycle data and manages keys; live network behavior is governed by `network-allowlist` and `usage-badge`.)
