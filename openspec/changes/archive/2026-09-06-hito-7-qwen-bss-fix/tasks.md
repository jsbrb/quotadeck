# Tasks: hito-7-qwen-bss-fix

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~150–250 (test pin rewrites dominate) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR on `feature/hito-7-qwen-bss-fix` |
| Delivery strategy | auto-chain |
| Chain strategy | pending (single work unit) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Timestamp fix + error-body capture + diagnostics, one hermetic slice | PR 1 | `npm --prefix extension run test` | Maintainer live E2E (4.2): load unpacked, refresh qwen | Revert PR 1 — no storage/schema changes |

## Phase 1: RPC Timestamp Format (§RPC Timestamp Format)

- [x] 1.1 RED — `extension/src/network/client.test.ts`: change the ak-sk pin from `expect(params.Timestamp).toBe(new Date(clock.now()).toISOString())` to exact `2023-11-14T22:13:20Z` + `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/` (no `.`); add a case with a nonzero-millis FakeClock epoch (`1_700_000_000_123`) still emitting no-millis. Run — both fail.
- [x] 1.2 GREEN — `extension/src/network/client.ts` `signedRequest`: normalize the injected clock's ISO string to millisecond-free form BEFORE `signBssQuery`, so the emitted param and StringToSign agree. Existing `rpc-signer.test.ts` pass-through pins stay green.

## Phase 2: Error Body Surfacing (§Error Body Surfacing)

- [x] 2.1 RED — rewrite the old status-only pins in `extension/src/network/fetch-transport.test.ts`: (a) long plain-text 400 → message `HTTP 400` + first ≤200 chars verbatim, `json()` never called; (b) JSON-document 400 → raw `"Code"` snippet visible, no parse; (c) 2xx passthrough unchanged; (d) `text()`-rejecting 400 → status-only message, no secondary failure. Stubs gain `text()`. Run — fails (message is bare `HTTP 400`; `FetchResponseLike` lacks `text()`).
- [x] 2.2 GREEN — `extension/src/network/fetch-transport.ts`: add `text(): Promise<string>` to `FetchResponseLike`; on `!ok` read text (guarded try/catch) and construct `HttpStatusError` with message `HTTP ${status}: ${snippet.slice(0, 200)}`; update the AD-13-spirit module comment to cite §Error Body Surfacing (scoped relaxation: text-only, capped, never parsed, never persisted).

## Phase 3: Diagnostics Decision

- [x] 3.1 `extension/src/background.ts`: keep the single `console.error` in `onError` but drop the "Temporary … Remove once the Qwen defect is fixed" framing — permanent, prints `${name}: ${message}` (now carries the server `Code` via 2.2); snapshot stays class-only (AD-13). Justify in the replaced comment.

## Phase 4: Verification

- [x] 4.1 Full gate from workspace root: `npm --prefix extension run test` (all green incl. new pins), then `npm --prefix extension run typecheck`, then `npm --prefix extension run build`.
- [x] 4.2 Maintainer live E2E checklist: load unpacked extension, store qwen ak-sk key, trigger refresh — PASS: qwen badge shows ¥ balance; ACCEPTABLE: self-explanatory server error (e.g. `InvalidAccessKeyId.NotFound`) in the worker console; FAIL: bare `HTTP 400` with no body snippet.
