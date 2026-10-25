# Key Storage Specification

## Purpose

A storage wrapper that persists provider API keys in `chrome.storage.local`, never touches `chrome.storage.sync`, masks keys for display, and supports revocation. Non-secret preferences — the ZAI platform selection, the Qwen site selection, and the badge provider choice — persist in `chrome.storage.local` under a namespace distinct from the credential namespace and are returned unmasked.

## Requirements

### Requirement: Local-Only Persistence

The storage wrapper SHALL persist provider keys in `chrome.storage.local`. The wrapper MUST NOT read from or write to `chrome.storage.sync`, and no code path in the extension SHALL persist key material outside the storage wrapper (including `localStorage`).

#### Scenario: Save and read round-trip

- GIVEN a provider key submitted for storage
- WHEN saved and read back through the wrapper
- THEN the value returned equals the stored key and it resides in `chrome.storage.local`

#### Scenario: Sync never used

- GIVEN the extension source and a mocked `chrome.storage` API
- WHEN any storage-wrapper operation runs
- THEN `chrome.storage.sync` is never called and no key material appears outside the wrapper's `chrome.storage.local` namespace

### Requirement: Masked Display

Reads intended for display SHALL return a masked form that reveals at most a fixed short suffix of the key; the full key MUST NOT be exposed through the display path.

#### Scenario: Masked read

- GIVEN a stored key `sk-test-1234567890abcdef`
- WHEN a display read is requested
- THEN the returned value reveals no more than the last 4 characters and never the full key

### Requirement: Revocation

The wrapper SHALL support revoking a stored key per provider. After revocation, reads MUST report absence and authenticated provider activity MUST stop.

#### Scenario: Revoke removes key

- GIVEN a stored key for provider `openai`
- WHEN the key is revoked
- THEN subsequent reads report no stored key and the provider cannot authenticate

### Requirement: Per-Provider Isolation

Keys SHALL be stored per provider id; revoking or reading one provider's key MUST NOT affect another provider's stored key.

#### Scenario: Isolated revoke

- GIVEN stored keys for `zai` and `kimi`
- WHEN the `zai` key is revoked
- THEN the `kimi` key remains readable through the wrapper

### Requirement: Qwen AK/SK Pair Persistence

The storage wrapper SHALL persist the Qwen credential as an AK/SK pair (AccessKeyId plus AccessKeySecret) under the `qwen` provider id, subject to the existing local-only and per-provider isolation requirements. Display reads for the pair SHALL return each part independently masked, revealing at most a fixed short suffix per part; the full pair MUST NOT be exposed through any display path outside the input fields during entry. Revoking the `qwen` credential SHALL remove both parts atomically.

#### Scenario: Pair round-trip

- GIVEN a Qwen AK/SK pair submitted for storage
- WHEN saved and read back through the wrapper
- THEN both parts equal the stored values and reside in `chrome.storage.local`

#### Scenario: Masked pair display

- GIVEN a stored Qwen pair
- WHEN a display read is requested
- THEN each part reveals no more than its last 4 characters and the full pair never appears

#### Scenario: Pair revocation removes both parts

- GIVEN a stored Qwen pair
- WHEN the `qwen` credential is revoked
- THEN reads report no stored pair and other providers' keys remain readable

### Requirement: ZAI Platform Preference

The storage wrapper SHALL persist the ZAI platform preference (Z.AI or ZHIPU) in `chrome.storage.local` under a namespace distinct from the credential namespace (`qd:key:*`). The preference is not a credential: it is non-secret, SHALL be returned unmasked, and is subject to the local-only rule (never `chrome.storage.sync`).

#### Scenario: Preference round-trip unmasked

- GIVEN a stored preference `zhipu`
- WHEN read back through the wrapper
- THEN the value equals `zhipu`, is returned unmasked, and resides in `chrome.storage.local` outside the `qd:key:*` namespace

#### Scenario: Credential namespace unaffected

- GIVEN a stored ZAI key and a stored platform preference
- WHEN the preference is written or changed
- THEN the stored key remains readable and masked key display is unchanged

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

### Requirement: Badge Provider Preference

The storage wrapper SHALL persist the toolbar badge provider preference in `chrome.storage.local` under `qd:pref:badge-provider` — a namespace distinct from the credential namespace (`qd:key:*`), sibling of `qd:pref:zai-platform` and `qd:pref:qwen-site` (hito-12 WU-D2). The preference is not a credential: it is non-secret, SHALL be returned unmasked, never masked or revoked through key semantics, and is subject to the local-only rule. The value is a provider id; reads SHALL treat an absent or unknown stored value as the default `zai` (no write-on-read); writes SHALL validate BEFORE persisting. Validation is ProviderId-wide — the whole known provider-id union, NOT the shipped subset — so un-shipping a provider never invalidates a stored preference; the badge resolution treats an unshipped choice as absent at render time (`usage-badge` §Badge Rendering).

#### Scenario: Round-trip unmasked with zai default

- GIVEN no stored badge provider preference
- WHEN read through the wrapper
- THEN `zai` is returned unmasked from `chrome.storage.local`
- AND a stored `qwen` subsequently reads back as `qwen` unmasked

#### Scenario: Invalid value defaults without writing

- GIVEN a stored value that is not a known provider id
- WHEN the preference is read
- THEN the default `zai` is returned and the stored garbage is left untouched (no write-on-read)

#### Scenario: Unshipped but known provider id persists

- GIVEN a valid provider id outside the shipped subset
- WHEN written and read back
- THEN it persists and reads back unmasked, and badge resolution treats it per `usage-badge` — cleared, never invalidated at the store

#### Scenario: Credential namespace unaffected

- GIVEN a stored provider key and a stored badge provider preference
- WHEN the preference is written or changed
- THEN the key remains readable and masked key display is unchanged

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
