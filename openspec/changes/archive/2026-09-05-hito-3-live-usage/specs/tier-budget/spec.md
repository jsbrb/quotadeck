# Tier-Budget Specification

## Purpose

ZAI-parity budgeting: trailing 5-hour window usage, tier, capped percentage, reset countdown, configurable limits. Pure, clock-injectable computation.

## Requirements

### Requirement: Trailing-Window Usage Computation

ZAI usage SHALL equal the sum of `apiUsage` over records whose `transaction_time` is at or after `now − 5h` (`now` from an injectable clock). `transaction_time` SHALL be epoch ms extracted from `billingNo`: the 13 characters after the first customerId occurrence. Records with unextractable epochs SHALL be excluded deterministically, not raise.

#### Scenario: Window sum

- GIVEN records inside and outside the window per an injected clock
- WHEN usage is computed
- THEN the result sums `apiUsage` for in-window records only

#### Scenario: Epoch extraction from billingNo

- GIVEN a `billingNo` embedding the customerId followed by 13 epoch-ms digits
- WHEN `transaction_time` is extracted
- THEN it equals those digits as epoch milliseconds

#### Scenario: Unextractable record excluded

- GIVEN a record whose `billingNo` lacks the customerId
- WHEN the window is computed
- THEN the record is excluded without error

### Requirement: Tier Derivation

The active tier SHALL be the `tokenResourceName` of the in-window record with maximum `transaction_time`.

#### Scenario: Latest record wins

- GIVEN in-window records where an older carries `Pro` and the newest carries `Lite`
- WHEN the tier is derived
- THEN the tier is `Lite`

### Requirement: Configurable Tier Limits

Tier limits SHALL be configurable. Unconfigured tiers MUST use the defaults Lite 2400, Pro 12000, Max 48000 per 5-hour window, compared against the window `apiUsage` sum. A tier without a limit SHALL report percentage absent, not fail.

#### Scenario: Default limits

- GIVEN no configured limits, derived tier `Pro`, usage 1200
- WHEN the budget is evaluated
- THEN the default limit 12000 applies

#### Scenario: Overridden limit

- GIVEN tier `Lite` configured limit 100, usage 50
- WHEN the budget is evaluated
- THEN limit 100 is used, not 2400

#### Scenario: Unknown tier

- GIVEN a derived tier without a limit
- WHEN the budget is evaluated
- THEN usage computes and percentage is absent

### Requirement: Percentage Computation

The percentage SHALL equal `min(round(used / limit × 100), 100)`.

#### Scenario: Rounding

- GIVEN usage 100 and limit 300
- WHEN the percentage is computed
- THEN it equals 33

#### Scenario: Cap at 100

- GIVEN usage 30000 and limit 12000
- WHEN the percentage is computed
- THEN it equals 100

### Requirement: Reset Countdown

The reset time SHALL be the latest in-window record's `timeWindow` end (after the `~` split). Without a parseable `timeWindow`, the countdown SHALL be gracefully absent, never failing usage, tier, or percentage.

#### Scenario: Countdown derived

- GIVEN the latest in-window record with `timeWindow` ending at epoch E
- WHEN requested at injected now
- THEN it reports the interval from now to E

#### Scenario: Graceful absence

- GIVEN the latest in-window record lacking a parseable `timeWindow`
- WHEN the budget is evaluated
- THEN usage, tier, and percentage report and the countdown is absent

### Requirement: Month-Straddle Fetching

When `now − 5h` falls in the previous calendar month, records SHALL be fetched for both the current and previous `billingMonth`; otherwise the current month only.

#### Scenario: Straddle

- GIVEN a clock whose window start falls in the previous month
- WHEN ZAI records are fetched
- THEN both billingMonths are requested and feed the window sum

#### Scenario: No straddle

- GIVEN a clock whose window start is in the current month
- WHEN ZAI records are fetched
- THEN only the current billingMonth is requested

### Requirement: Timezone Discipline

All window, month-boundary, and countdown arithmetic SHALL use one declared timezone. Membership and boundary decisions SHALL NOT use mixed-format string date comparison.

#### Scenario: Epoch ordering decides membership

- GIVEN records whose date strings sort differently from their epoch order
- WHEN window membership is computed
- THEN the decision follows epoch-ms comparison in the declared timezone
