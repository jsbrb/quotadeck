# Delta for network-allowlist

## ADDED Requirements

### Requirement: Manifest Host Permissions Consistency

The extension manifest `host_permissions` SHALL contain exactly the allowlisted domains — the union of the per-provider allowlists — and nothing more.

#### Scenario: Manifest equals allowlist

- GIVEN the shipped `manifest.json` and the network layer's per-provider allowlists
- WHEN compared
- THEN `host_permissions` equals the union of allowlisted domains exactly

#### Scenario: Extra host fails the check

- GIVEN a manifest granting a host absent from every provider allowlist
- WHEN the consistency check runs
- THEN it fails with an explicit error

## MODIFIED Requirements

### Requirement: Credentials Only in Authorization Header

Bearer and admin-key credentials SHALL be attached to requests exclusively as the value of the `Authorization` header, and MUST NOT appear in URLs, query parameters, request bodies, or cookies. Alibaba RPC signing is a sanctioned exception, scoped to the Qwen BSS host only: `AccessKeyId` and the derived `Signature` MAY appear as query parameters for requests to that host. The `AccessKeySecret` MUST NOT be transmitted nor placed in URLs, query parameters, headers, bodies, or cookies under any circumstances.

(Previously: all credential material was confined to the `Authorization` header with no signing exception.)

#### Scenario: Key placement

- GIVEN a stored Bearer credential for a provider
- WHEN the network layer builds a request
- THEN the key appears only in the `Authorization` header and the URL, query, body, and cookies contain no credential material

#### Scenario: RPC signature exception scoped to Qwen

- GIVEN a signed Qwen BSS request
- WHEN built
- THEN `AccessKeyId` and `Signature` appear in the query and the `AccessKeySecret` appears nowhere in the request

#### Scenario: Signed-style credentials rejected off the Qwen host

- GIVEN a request to a non-Qwen host carrying an `AccessKeyId` query parameter
- WHEN submitted through the network layer
- THEN it is rejected with an explicit error

#### Scenario: Non-header key suppressed

- GIVEN a component attempting to pass a Bearer key as a query parameter
- WHEN the request reaches the network layer
- THEN the request is rejected
