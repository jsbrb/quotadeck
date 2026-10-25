# Delta for usage-badge

## ADDED Requirements

### Requirement: One-Shot Refresh Alarm

The service worker SHALL handle a one-shot alarm named `refresh-now` by running the same refresh tick as the periodic alarm (`usage-refresh`): live provider queries through the allowlist network client with clock-derived time parameters, and the snapshot write. The periodic `usage-refresh` registration and its 1-minute period SHALL remain unchanged: handling `refresh-now` MUST NOT create, duplicate, or reschedule the periodic alarm. Alarm names other than `usage-refresh` and `refresh-now` SHALL be ignored.

#### Scenario: One-shot alarm runs the shared tick

- GIVEN the registered periodic alarm, an injected fake transport serving canned provider responses, and an injected clock
- WHEN the `refresh-now` alarm fires
- THEN one refresh tick runs exactly as a periodic tick, writing the normalized snapshot

#### Scenario: Periodic schedule unchanged

- GIVEN a registered `usage-refresh` alarm with a 1-minute period
- WHEN a `refresh-now` alarm is created and fires
- THEN `usage-refresh` remains registered with its 1-minute period and no duplicate periodic alarm exists

#### Scenario: Unknown alarm ignored

- GIVEN the service worker's alarm handler
- WHEN an alarm with an unknown name fires
- THEN no refresh tick or snapshot write occurs
