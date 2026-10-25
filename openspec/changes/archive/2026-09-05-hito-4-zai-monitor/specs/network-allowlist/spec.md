# Delta for network-allowlist

## MODIFIED Requirements

### Requirement: Per-Provider Domain Allowlist

The network layer SHALL keep a per-provider allowlist of official endpoint domains as documented in `docs/spike/endpoints.md` (ZAI: `api.z.ai` and `open.bigmodel.cn`; Kimi: `api.moonshot.cn`; OpenAI: `api.openai.com`; Qwen: the Alibaba BSS OpenAPI endpoint). Every outbound request MUST be checked against the target provider's allowlist before any network I/O occurs.
(Previously: the ZAI allowlist was the apex `bigmodel.cn`; that apex entry is removed.)

#### Scenario: Allowlisted host admitted

- GIVEN a ZAI request addressed to `api.z.ai` or `open.bigmodel.cn`
- WHEN submitted through the network layer
- THEN the request is passed to the transport layer

#### Scenario: Non-allowlisted host rejected

- GIVEN a request addressed to `evil.example.com`
- WHEN submitted through the network layer
- THEN the request is rejected with an explicit error and no network I/O occurs

#### Scenario: Cross-provider host rejected

- GIVEN a ZAI provider request addressed to Kimi's allowlisted host `api.moonshot.cn`
- WHEN submitted
- THEN the request is rejected because the host is not on the ZAI allowlist

#### Scenario: Removed apex host rejected

- GIVEN a ZAI request addressed to the apex `bigmodel.cn`
- WHEN submitted through the network layer
- THEN the request is rejected with an explicit error and no network I/O occurs

### Requirement: Credentials Only in Authorization Header

Bearer and admin-key credentials SHALL be attached to requests exclusively as the value of the `Authorization` header, and MUST NOT appear in URLs, query parameters, request bodies, or cookies. Raw attach — `Authorization: <key>` verbatim with no prefix — is a sanctioned exception scoped to the ZAI monitor hosts (`api.z.ai`, `open.bigmodel.cn`) only; every other host requires the Bearer or admin form. Alibaba RPC signing is a sanctioned exception, scoped to the Qwen BSS host only: `AccessKeyId` and the derived `Signature` MAY appear as query parameters for requests to that host. The `AccessKeySecret` MUST NOT be transmitted nor placed in URLs, query parameters, headers, bodies, or cookies under any circumstances.
(Previously: only Bearer/admin attachment and the Qwen signing exception were sanctioned.)

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

#### Scenario: Raw attach scoped to monitor hosts

- GIVEN a raw-attached ZAI request to `api.z.ai` and a raw-attached request to any non-ZAI host
- WHEN both are submitted
- THEN the monitor request passes and the other is rejected with an explicit error

## REMOVED Requirements

### Requirement: Unverified Variant Excluded

(Reason: superseded by triple-source verification — `api.z.ai` is confirmed by `zai-org/zai-coding-plugins`, `ecerutti/glm-usage-monitor`, and `guyinwonder168/opencode-glm-quota`, and is the default ZAI monitor host.)
(Migration: requests to `api.z.ai` are admitted per the updated Per-Provider Domain Allowlist; the manifest picks the host up automatically through the existing Manifest Host Permissions Consistency requirement, which is unchanged.)
