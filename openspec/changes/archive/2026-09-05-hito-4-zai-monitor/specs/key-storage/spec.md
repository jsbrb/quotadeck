# Delta for key-storage

## ADDED Requirements

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
