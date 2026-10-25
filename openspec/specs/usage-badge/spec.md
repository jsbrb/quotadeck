# Usage Badge Specification

## Purpose

A Manifest V3 background service worker that refreshes provider usage live on a one-minute `chrome.alarms` schedule through the allowlist network client and renders the extension badge from exactly ONE user-chosen provider (`qd:pref:badge-provider`, default zai) resolved once at tick end — for ZAI the 5h window percentage uncapped, with the plan level as fallback; for Qwen the token-plan quota percentage (qwen is quota-only — an ok entry without quota clears the badge); refresh failures are classified into an error taxonomy surfaced to the badge and popup.

## Requirements

### Requirement: One-Minute Alarm Schedule

The service worker SHALL register a `chrome.alarms` alarm with a 1-minute period on installation and on startup when absent, and SHALL refresh usage on every alarm tick. Each refresh SHALL query configured providers live through the allowlist network client, with all time parameters derived from an injectable clock (no wall-clock reads inside provider logic).

#### Scenario: Alarm registered

- GIVEN the extension is loaded unpacked
- WHEN the service worker starts
- THEN an alarm is registered with a 1-minute period

#### Scenario: Live refresh per tick

- GIVEN a registered alarm, an injected fake transport serving canned provider responses, and an injected clock
- WHEN the alarm fires
- THEN each configured provider receives a live-shaped request whose time parameters derive from the clock, and the badge receives its one tick-end update from the chosen provider's latest normalized result

### Requirement: Badge Rendering

The badge SHALL be written exactly ONCE per tick, at tick end, from the resolved entry of the CHOSEN provider (`qd:pref:badge-provider`, default `zai`, read through the preference wrapper; hito-12 WU-D2): an ok result carrying a percentage renders it uncapped as rounded integer display text — the ZAI 5h window and the Qwen token-plan quota flow through the SAME formatter, so the two paths can never drift; a monitor result without a percentage falls back to the plan level; a chosen Qwen entry without a quota renders the CLEARED badge (qwen is a quota-only provider — the balance fallback is dormant while its dispatch stays suspended); the chosen provider's error entry renders the error marker; an absent or unshipped choice (e.g. a stored `kimi`, or the chosen provider not running) renders the CLEARED badge — never the marker. Threshold alerting follows the rendered percentage (zai 5h or qwen quota): background and text colors track its band, and an absent percentage (cleared or error) renders the neutral band. Results of unchosen providers record into the snapshot only — they MUST NOT move the badge. Repeated identical resolutions SHALL produce identical badge text and colors.

#### Scenario: Deterministic text

- GIVEN a chosen ZAI result whose 5h window reports percentage 42.6
- WHEN the badge updates
- THEN the badge text equals the defined compact rendering of that result (43%)
- AND the text and colors are stable across repeated ticks yielding the same result

#### Scenario: ZAI 5h percentage badge

- GIVEN a chosen ZAI result whose 5h window reports percentage 137
- WHEN the badge updates
- THEN the badge text renders 137% uncapped

#### Scenario: Absent percentage falls back to level

- GIVEN a chosen ZAI result whose 5h percentage is absent and whose level is `Pro`
- WHEN the badge updates
- THEN the badge renders the plan level

#### Scenario: Qwen quota badges through the shared formatter

- GIVEN a chosen qwen result whose token-plan quota carries percentage 15
- WHEN the badge updates
- THEN the badge text equals the same integer-display rendering the zai 5h path produces for that figure, with its threshold banding

#### Scenario: Chosen qwen without quota clears the badge

- GIVEN a chosen qwen entry that is ok but carries no quota percentage
- WHEN the badge updates
- THEN the badge is cleared (empty text on the neutral band), not a balance figure and not the marker

#### Scenario: Unchosen failures never move the badge

- GIVEN the chosen provider resolved ok this tick and another provider's entry is an error
- WHEN the badge updates
- THEN the badge renders the chosen provider's text — unchosen results record into the snapshot only

### Requirement: Error State

When a refresh of the CHOSEN provider fails, the badge SHALL display the error marker on the neutral band, and the next successful tick of the chosen provider SHALL replace the marker with fresh usage text. A failure of an unchosen provider MUST NOT display the marker — its class records into the snapshot only.

#### Scenario: Failed refresh shows marker and retries

- GIVEN a refresh of the chosen provider that fails via an injected error
- WHEN the alarm tick completes
- THEN the badge displays the error marker
- AND the next successful tick of the chosen provider replaces the marker with usage text

### Requirement: Error Taxonomy Mapping

Refresh failures SHALL be classified into a taxonomy: `auth` (HTTP 401/403), `server` (HTTP 5xx), `rate-limit` (HTTP 429 or documented rate-limit signal), `network` (transport failure), and `unknown` for anything else. Each class SHALL map to a distinct error state exposed to the badge and popup; every failed refresh of the chosen provider SHALL display the error marker regardless of class (an unchosen failure records its class into the snapshot only, per §Error State), and the class SHALL accompany the cycle result for popup rendering.

#### Scenario: Auth failure classified

- GIVEN a refresh of the chosen provider answered with HTTP 401 or 403 through the injected transport
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

### Requirement: Qwen Plan Probe Cadence

The refresh tick SHALL run the qwen plan probe only when a plan key (`sk-sp-`) is stored, and at most once per cache window: a cached `available` result MUST be reused without any probe request for 120 minutes, and cached `exhausted` and `key-rejected` results for 15 minutes each (floor: never more than one probe per 15 minutes in any state). The resolved plan status SHALL ride the qwen cycle result into the snapshot with its resolution timestamp, and the badge text MUST NOT change due to plan status — the badge resolves from the chosen provider's percentage/quota per §Badge Rendering, never from the binary plan. A probe failure at the transport layer (anything other than 2xx/429/401/403) SHALL leave the cache untouched and omit plan status for that tick. A qwen error entry takes precedence: plan status merges only into ok or absent qwen entries.

#### Scenario: Fresh cache suppresses the probe

- GIVEN a cached available status probed 30 minutes ago and a stored plan key
- WHEN an alarm tick runs with an injected recording transport
- THEN no plan probe request is dispatched and the qwen cycle result carries the cached plan status

#### Scenario: Expired cache probes exactly once

- GIVEN a cached exhausted status probed 20 minutes ago
- WHEN an alarm tick runs
- THEN exactly one probe request is dispatched, the cache is rewritten, and the cycle result carries the fresh status

#### Scenario: No plan key means no probe

- GIVEN no `sk-sp-` key stored (AK/SK only, or nothing)
- WHEN an alarm tick runs
- THEN no probe request is dispatched and the qwen result carries no plan status

#### Scenario: Badge unchanged by plan status

- GIVEN a chosen qwen ok result with quota percentage 15 and plan status exhausted, and the same result with plan status omitted
- WHEN the badge updates for each
- THEN both render the quota figure exactly the same — plan status changes nothing

#### Scenario: Probe transport failure keeps the cache

- GIVEN a cached available status and a probe whose transport rejects (non-HTTP classification)
- WHEN the tick completes
- THEN the cache still holds the previous entry and the qwen result omits plan status
- AND the other cycle results are unaffected

### Requirement: Qwen Quota Step Merge Discipline

The refresh tick SHALL run the qwen token-plan quota step (provider-framework §Qwen Token-Plan Quota Tick Step — the flow contract is normative there) beside the plan probe, after the engine refreshes and before the snapshot write, with the EXACT plan merge discipline: an error qwen entry keeps its class (the error arm wins — quota never overwrites it), an ok qwen entry gains the quota field keeping everything else, and an absent qwen entry synthesizes a quota-only ok entry. Both merges land BEFORE the tick's single badge write (§Badge Rendering), so a chosen qwen entry badges its quota percentage the same tick the quota first arrives. The minted session token never reaches the snapshot — only the mapped quota window rides it.

#### Scenario: First quota badges the same tick

- GIVEN a stored qwen AK/SK, the badge provider chosen as `qwen`, and a tick whose quota step resolves for the first time
- WHEN the tick completes
- THEN the badge renders the quota percentage in that same tick

#### Scenario: Error arm wins over quota

- GIVEN a qwen entry resolved as an error arm before the quota step
- WHEN the quota step resolves a window in the same tick
- THEN the qwen entry keeps its error class and carries no quota
