# Delta for tier-budget

## REMOVED Requirements

### Requirement: Trailing-Window Usage Computation

(Reason: superseded by `zai-monitor` — the monitor endpoint reports percentage and total directly; client-side 5h sums over expenseBillList records are obsolete.)
(Migration: none at runtime; the archived spec text is retained in the change archive as the reference for a future pay-as-you-go billing milestone.)

### Requirement: Tier Derivation

(Reason: superseded by `zai-monitor` — the plan level arrives as `data.level` from the API; `tokenResourceName` selection is obsolete.)
(Migration: archived text retained as the pay-as-you-go revival reference.)

### Requirement: Configurable Tier Limits

(Reason: superseded by `zai-monitor` — per-window limits arrive from the API; the client-side tier-limit table and `tierLimits` wiring are removed.)
(Migration: archived text retained as the pay-as-you-go revival reference.)

### Requirement: Percentage Computation

(Reason: superseded by `zai-monitor` — percentage is API-provided and passes through uncapped; the client-side `min(round(used/limit×100), 100)` cap is obsolete.)
(Migration: archived text retained as the pay-as-you-go revival reference.)

### Requirement: Reset Countdown

(Reason: superseded by `zai-monitor` — the countdown derives from API-provided `nextResetTime`; `timeWindow` splitting is obsolete.)
(Migration: archived text retained as the pay-as-you-go revival reference.)

### Requirement: Month-Straddle Fetching

(Reason: obsolete — the single-shot monitor query takes no billing month parameters.)
(Migration: none.)

### Requirement: Timezone Discipline

(Reason: obsolete — no client-side window or month-boundary arithmetic remains; the countdown is epoch-ms subtraction.)
(Migration: none.)
