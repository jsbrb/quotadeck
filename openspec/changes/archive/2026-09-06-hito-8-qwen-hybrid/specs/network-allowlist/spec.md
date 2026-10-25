# Delta for network-allowlist

## MODIFIED Requirements

### Requirement: Per-Provider Domain Allowlist

The network layer SHALL keep a per-provider allowlist of official endpoint domains as documented in `docs/spike/endpoints.md` (ZAI: `api.z.ai` and `open.bigmodel.cn`; Kimi: `api.moonshot.cn`; OpenAI: `api.openai.com`; Qwen: the Alibaba BSS OpenAPI endpoints `business.aliyuncs.com` (china site) and `business.ap-southeast-1.aliyuncs.com` (international site), plus the token-plan probe host `token-plan.ap-southeast-1.maas.aliyuncs.com`). Every outbound request MUST be checked against the target provider's allowlist before any network I/O occurs.

(Previously: the qwen entry carried the single china BSS host `business.aliyuncs.com`.)

#### Scenario: Allowlisted host admitted

- GIVEN a ZAI request addressed to `api.z.ai` or `open.bigmodel.cn`
- WHEN submitted through the network layer
- THEN the request is passed to the transport layer

#### Scenario: International BSS and probe hosts admitted

- GIVEN qwen requests addressed to `business.ap-southeast-1.aliyuncs.com` and to `token-plan.ap-southeast-1.maas.aliyuncs.com`
- WHEN submitted through the network layer
- THEN both are passed to the transport layer

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

Bearer and admin-key credentials SHALL be attached to requests exclusively as the value of the `Authorization` header, and MUST NOT appear in URLs, query parameters, request bodies, or cookies. Raw attach â€” `Authorization: <key>` verbatim with no prefix â€” is a sanctioned exception scoped to the ZAI monitor hosts (`api.z.ai`, `open.bigmodel.cn`) only; every other host requires the Bearer or admin form. Alibaba RPC signing is a sanctioned exception, scoped to the Qwen BSS hosts only (`business.aliyuncs.com`, `business.ap-southeast-1.aliyuncs.com`) and NEVER the token-plan probe host: `AccessKeyId` and the derived `Signature` MAY appear as query parameters for requests to those hosts. The Qwen token-plan key (`sk-sp-`) attaches exclusively as `Authorization: Bearer <key>` on `token-plan.ap-southeast-1.maas.aliyuncs.com` and MUST NOT appear in the probe URL, query, or request body. The `AccessKeySecret` MUST NOT be transmitted nor placed in URLs, query parameters, headers, bodies, or cookies under any circumstances. Beyond credentials, the network client produces exactly one non-credential header: any dispatched JSON request body SHALL be labeled `Content-Type: application/json` (servers reject unlabeled bodies - observed as HTTP 400 on the token-plan probe endpoint); bodyless requests carry no `Content-Type`.

(Previously: the RPC signing exception was scoped to the single Qwen BSS host; no probe host or plan-key form existed.)

#### Scenario: Key placement

- GIVEN a stored Bearer credential for a provider
- WHEN the network layer builds a request
- THEN the key appears only in the `Authorization` header and the URL, query, body, and cookies contain no credential material

#### Scenario: RPC signature exception scoped to the BSS hosts

- GIVEN a signed Qwen BSS request to either BSS host
- WHEN built
- THEN `AccessKeyId` and `Signature` appear in the query and the `AccessKeySecret` appears nowhere in the request

#### Scenario: Signed-style credentials rejected off the BSS hosts

- GIVEN a request to a non-BSS host (including `token-plan.ap-southeast-1.maas.aliyuncs.com`) carrying an `AccessKeyId` query parameter
- WHEN submitted through the network layer
- THEN it is rejected with an explicit error

#### Scenario: Plan key confined to the Authorization header

- GIVEN a stored `sk-sp-` plan key and a built probe request
- WHEN the request is inspected
- THEN the key appears only as the Bearer `Authorization` header value and never in the URL, query, or JSON body

#### Scenario: Non-header key suppressed

- GIVEN a component attempting to pass a Bearer key as a query parameter
- WHEN the request reaches the network layer
- THEN the request is rejected

#### Scenario: Raw attach scoped to monitor hosts

- GIVEN a raw-attached ZAI request to `api.z.ai` and a raw-attached request to any non-ZAI host
- WHEN both are submitted
- THEN the monitor request passes and the other is rejected with an explicit error
