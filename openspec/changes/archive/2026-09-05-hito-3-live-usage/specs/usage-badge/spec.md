# Delta for usage-badge

## ADDED Requirements

### Requirement: Error Taxonomy Mapping

Refresh failures SHALL be classified into a taxonomy: `auth` (HTTP 401/403), `server` (HTTP 5xx), `rate-limit` (HTTP 429 or documented rate-limit signal), `network` (transport failure), and `unknown` for anything else. Each class SHALL map to a distinct error state exposed to the badge and popup; every failed refresh SHALL display the error marker regardless of class, and the class SHALL accompany the cycle result for popup rendering.

#### Scenario: Auth failure classified

- GIVEN a provider refresh answered with HTTP 401 or 403 through the injected transport
- WHEN the tick completes
- THEN the failure is classified `auth`, the badge shows the error marker, and the popup error state indicates auth

#### Scenario: Server and rate-limit classified

- GIVEN refreshes answered with HTTP 500 and HTTP 429
- WHEN each tick completes
- THEN the failures are classified `server` and `rate-limit` respectively

#### Scenario: Network failure and unmapped errors

- GIVEN a refresh failing at the transport layer and one failing with an unmapped cause
- WHEN the ticks complete
- THEN they are classified `network` and `unknown` respectively

## MODIFIED Requirements

### Requirement: One-Minute Alarm Schedule

The service worker SHALL register a `chrome.alarms` alarm with a 1-minute period on installation and on startup when absent, and SHALL refresh usage on every alarm tick. Each refresh SHALL query configured providers live through the allowlist network client, with all time parameters derived from an injectable clock (no wall-clock reads inside provider logic).

(Previously: refresh consumed stub/fixture results; no live calls.)

#### Scenario: Alarm registered

- GIVEN the extension is loaded unpacked
- WHEN the service worker starts
- THEN an alarm is registered with a 1-minute period

#### Scenario: Live refresh per tick

- GIVEN a registered alarm, an injected fake transport serving canned provider responses, and an injected clock
- WHEN the alarm fires
- THEN each configured provider receives a live-shaped request whose time parameters derive from the clock, and the badge text updates with the latest normalized result

## REMOVED Requirements

### Requirement: No Live Calls in Milestone

(Reason: superseded by clock-derived live refresh through the allowlist network client.)
(Migration: the live refresh scenarios replace the fixture-driven tick scenario; hermetic testing continues via injected fake transports per `provider-framework`.)
