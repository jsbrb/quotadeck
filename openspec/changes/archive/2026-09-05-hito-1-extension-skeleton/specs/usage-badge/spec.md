# Usage Badge Specification

## Purpose

A Manifest V3 background service worker that refreshes provider usage on a one-minute `chrome.alarms` schedule and renders the latest normalized usage in the extension badge. In this milestone refresh data comes from stub/fixture results; no live calls.

## Requirements

### Requirement: One-Minute Alarm Schedule

The service worker SHALL register a `chrome.alarms` alarm with a 1-minute period on installation and on startup when absent, and SHALL refresh usage on every alarm tick.

#### Scenario: Alarm registered

- GIVEN the extension is loaded unpacked
- WHEN the service worker starts
- THEN an alarm is registered with a 1-minute period

#### Scenario: Badge refresh per tick

- GIVEN a registered alarm and stub providers returning fixture-based results
- WHEN the alarm fires
- THEN usage is refreshed through the provider framework and the badge text is updated with the latest result

### Requirement: Badge Rendering

The badge SHALL render the normalized usage result in a deterministic compact format (value plus unit/currency abbreviation). Repeated identical results SHALL produce identical badge text.

#### Scenario: Deterministic text

- GIVEN a normalized result of balance 12.34 CNY from a fixture
- WHEN the badge updates
- THEN the badge text equals the defined compact rendering of that result
- AND the text is stable across repeated ticks yielding the same result

### Requirement: Error State

When a refresh fails, the badge SHALL display an error marker, and the next successful alarm tick SHALL replace the marker with fresh usage text.

#### Scenario: Failed refresh shows marker and retries

- GIVEN a provider refresh that fails via an injected error
- WHEN the alarm tick completes
- THEN the badge displays the error marker
- AND the next successful tick replaces the marker with usage text

### Requirement: No Live Calls in Milestone

Badge refresh in this milestone SHALL consume fixture-derived stub results only; live provider calls are deferred to the live milestone.

#### Scenario: Fixture-driven tick

- GIVEN stub providers wired to recorded fixtures
- WHEN an alarm tick fires
- THEN the badge updates from fixture data and no live network call occurs
