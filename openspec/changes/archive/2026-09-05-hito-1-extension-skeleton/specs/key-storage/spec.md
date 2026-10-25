# Key Storage Specification

## Purpose

A storage wrapper that persists provider API keys in `chrome.storage.local`, never touches `chrome.storage.sync`, masks keys for display, and supports revocation.

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
