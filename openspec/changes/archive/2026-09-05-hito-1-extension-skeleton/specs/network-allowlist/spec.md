# Network Allowlist Specification

## Purpose

A fetch layer that confines all provider traffic to each provider's officially documented domains and confines credential material to the `Authorization` header. In this milestone the layer is proven by tests (including rejection of non-allowlisted domains); no live calls are shipped.

## Requirements

### Requirement: Per-Provider Domain Allowlist

The network layer SHALL keep a per-provider allowlist of official endpoint domains as documented in `docs/spike/endpoints.md` (ZAI: `bigmodel.cn`; Kimi: `api.moonshot.cn`; OpenAI: `api.openai.com`; Qwen: the Alibaba BSS OpenAPI endpoint). Every outbound request MUST be checked against the target provider's allowlist before any network I/O occurs.

#### Scenario: Allowlisted host admitted

- GIVEN a ZAI request addressed to a host under `bigmodel.cn`
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

### Requirement: Unverified Variant Excluded

The international ZAI variant `api.z.ai` is unverified and MUST NOT appear on the ZAI allowlist in this milestone.

#### Scenario: Unverified domain rejected

- GIVEN a ZAI request addressed to `api.z.ai`
- WHEN submitted through the network layer
- THEN the request is rejected

### Requirement: Credentials Only in Authorization Header

API keys SHALL be attached to requests exclusively as the value of the `Authorization` header. Credential material MUST NOT appear in URLs, query parameters, request bodies, or cookies.

#### Scenario: Key placement

- GIVEN a stored provider key
- WHEN the network layer builds a request
- THEN the key appears only in the `Authorization` header and the URL, query, body, and cookies contain no credential material

#### Scenario: Non-header key suppressed

- GIVEN a component attempting to pass a key as a query parameter
- WHEN the request reaches the network layer
- THEN the request is rejected

### Requirement: Injectable Transport

The network layer SHALL accept an injected transport so tests exercise allowlist and header behavior without live network I/O.

#### Scenario: Hermetic network tests

- GIVEN an injected fake transport that records requests
- WHEN the vitest suite runs
- THEN allowlist and rejection behavior is asserted against recorded requests and no real network call occurs
