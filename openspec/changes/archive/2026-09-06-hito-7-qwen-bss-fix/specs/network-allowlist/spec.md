# Delta for network-allowlist

## ADDED Requirements

### Requirement: RPC Timestamp Format

Every signed Qwen BSS request path (client or signer) MUST emit the `Timestamp` query parameter as POP-compliant ISO-8601 UTC WITHOUT a millisecond component (`YYYY-MM-DDTHH:mm:ssZ`). The signature MUST be computed over exactly the emitted `Timestamp` value. Rationale: Alibaba POP RPC rejects millisecond-carrying timestamps with HTTP 400, and `Timestamp` feeds the StringToSign.

#### Scenario: Emitted timestamp carries no milliseconds

- GIVEN a FakeClock at a fixed epoch with zero milliseconds
- WHEN a qwen ak-sk request is dispatched
- THEN the recorded URL's decoded `Timestamp` equals the exact no-millis form (e.g. `2023-11-14T22:13:20Z`)
- AND the value matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$` (no `.`)

#### Scenario: Millisecond-carrying clock input is normalized

- GIVEN a FakeClock whose epoch has nonzero milliseconds
- WHEN a qwen ak-sk request is dispatched
- THEN the emitted `Timestamp` still matches the no-millis pattern

#### Scenario: Signature computed over the emitted value

- GIVEN the signer invoked with a no-millis timestamp
- WHEN the canonical query is built
- THEN the StringToSign material embeds exactly the `Timestamp` that is dispatched

### Requirement: Error Body Surfacing

On a non-2xx response, the transport MUST surface a bounded snippet of the response body in the `HttpStatusError` message. The body MUST be read as text and MUST NOT be parsed as JSON on error statuses; the snippet MUST be capped (≤200 characters) and embedded verbatim so server error `Code`/`Message` are visible. A body-read failure MUST NOT mask the status error. Classification remains status-first (AD-30); the snapshot remains class-only (AD-13).

#### Scenario: Plain-text error body surfaced

- GIVEN a transport response with status 400 and a long plain-text body
- WHEN fetched
- THEN it rejects with `HttpStatusError` carrying status 400
- AND the message includes `HTTP 400` plus at most the first 200 body characters verbatim
- AND the body is never JSON-parsed

#### Scenario: JSON error document surfaced as text

- GIVEN a 400 whose body is a JSON error document containing `"Code"`
- WHEN fetched
- THEN the raw snippet appears in the message verbatim (server `Code` visible)
- AND no JSON parse occurs on the error path

#### Scenario: 2xx handling unchanged

- GIVEN a 200 JSON response
- WHEN fetched
- THEN it resolves `{ status, body }` exactly as before, parsed as JSON

#### Scenario: Body-read failure degrades to status-only

- GIVEN a 400 whose body read rejects
- WHEN fetched
- THEN it still rejects with `HttpStatusError` (status 400) and a status-only message
