# Delta for key-storage

## ADDED Requirements

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
