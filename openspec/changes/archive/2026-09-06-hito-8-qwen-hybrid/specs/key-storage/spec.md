# Delta for key-storage

## ADDED Requirements

### Requirement: Qwen Site Preference

The storage wrapper SHALL persist the Qwen BSS site preference (`international` or `china`) in `chrome.storage.local` under `qd:pref:qwen-site` — a namespace distinct from the credential namespace (`qd:key:*`). The preference is not a credential: it is non-secret, SHALL be returned unmasked, and defaults to `international`. Reads SHALL treat an absent or invalid stored value as the default (no write-on-read); writes SHALL validate before persisting.

#### Scenario: Round-trip unmasked with international default

- GIVEN no stored site preference
- WHEN read through the wrapper
- THEN `international` is returned unmasked from `chrome.storage.local`
- AND a stored `china` subsequently reads back as `china` unmasked

#### Scenario: Credential namespace unaffected

- GIVEN a stored Qwen AK/SK pair and a stored site preference
- WHEN the preference is written or changed
- THEN the pair remains readable and its masked display is unchanged

### Requirement: Qwen Plan Key (Dual Credential)

The wrapper SHALL store a SECOND, independent, optional Qwen credential — the token-plan inference key — under `qd:key:qwen-plan`, distinct from the AK/SK pair under `qd:key:qwen`. Validation MUST reject values that are empty or do not start with `sk-sp-`. Display reads SHALL mask the plan key revealing at most a fixed short suffix. Revocation SHALL be per credential: revoking the plan key MUST NOT remove the AK/SK pair, and revoking the pair MUST NOT remove the plan key.

#### Scenario: Plan key round-trip with pair intact

- GIVEN a stored Qwen AK/SK pair
- WHEN a valid `sk-sp-` plan key is saved under the plan slot
- THEN both credentials read back their stored values and reside in `chrome.storage.local`

#### Scenario: Masked plan key display

- GIVEN a stored plan key `sk-sp-1234567890abcdef`
- WHEN a display read is requested
- THEN the returned value reveals at most the last 4 characters and never the full key

#### Scenario: Isolated revocation in both directions

- GIVEN both qwen credentials stored
- WHEN the plan key is revoked
- THEN the AK/SK pair remains readable and the plan key reads as absent
- AND revoking the pair leaves the plan key readable

#### Scenario: Non-sk-sp value rejected

- GIVEN a candidate plan key `sk-ordinary` or an empty string
- WHEN submitted for storage
- THEN it is rejected with explicit guidance and nothing persists
