# Delta for usage-badge

## MODIFIED Requirements

### Requirement: Badge Rendering

The badge SHALL render the normalized usage result in a deterministic compact format (value plus unit/currency abbreviation). For the ZAI provider the badge SHALL render the 5h window percentage, uncapped above 100; when the 5h percentage is absent, the badge SHALL render the plan level. Repeated identical results SHALL produce identical badge text.
(Previously: one format for all providers; no ZAI-specific rule, no uncapped percentage, no fallback.)

#### Scenario: Deterministic text

- GIVEN a normalized result of balance 12.34 CNY from a fixture
- WHEN the badge updates
- THEN the badge text equals the defined compact rendering of that result
- AND the text is stable across repeated ticks yielding the same result

#### Scenario: ZAI 5h percentage badge

- GIVEN a ZAI result whose 5h window reports percentage 137
- WHEN the badge updates
- THEN the badge text renders 137% uncapped

#### Scenario: Absent percentage falls back to level

- GIVEN a ZAI result whose 5h percentage is absent and whose level is `Pro`
- WHEN the badge updates
- THEN the badge renders the plan level
