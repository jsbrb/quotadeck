# Delta for usage-badge

## ADDED Requirements

### Requirement: Qwen Plan Probe Cadence

The refresh tick SHALL run the qwen plan probe only when a plan key (`sk-sp-`) is stored, and at most once per cache window: a cached `available` result MUST be reused without any probe request for 120 minutes, and cached `exhausted` and `key-rejected` results for 15 minutes each (floor: never more than one probe per 15 minutes in any state). The resolved plan status SHALL ride the qwen cycle result into the snapshot with its resolution timestamp, and the badge text MUST NOT change due to plan status — the badge renders the balance as before. A probe failure at the transport layer (anything other than 2xx/429/401/403) SHALL leave the cache untouched and omit plan status for that tick. A qwen balance error entry takes precedence: plan status merges only into ok or absent qwen entries.

#### Scenario: Fresh cache suppresses the probe

- GIVEN a cached available status probed 30 minutes ago and a stored plan key
- WHEN an alarm tick runs with an injected recording transport
- THEN only the balance request is dispatched and the cycle result carries the cached plan status

#### Scenario: Expired cache probes exactly once

- GIVEN a cached exhausted status probed 20 minutes ago
- WHEN an alarm tick runs
- THEN exactly one probe request is dispatched, the cache is rewritten, and the cycle result carries the fresh status

#### Scenario: No plan key means no probe

- GIVEN no `sk-sp-` key stored (AK/SK only, or nothing)
- WHEN an alarm tick runs
- THEN no probe request is dispatched and the qwen result carries no plan status

#### Scenario: Badge unchanged by plan status

- GIVEN a qwen ok result with balance 12.34 USD and plan status exhausted
- WHEN the badge updates
- THEN the badge text equals the balance rendering exactly as without plan status

#### Scenario: Probe transport failure keeps the cache

- GIVEN a cached available status and a probe whose transport rejects (non-HTTP classification)
- WHEN the tick completes
- THEN the cache still holds the previous entry and the qwen result omits plan status
- AND the balance outcome is unaffected
