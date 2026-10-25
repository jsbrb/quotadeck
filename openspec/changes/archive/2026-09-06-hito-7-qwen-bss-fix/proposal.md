# Proposal: hito-7-qwen-bss-fix — Qwen BSS live 400 (Timestamp format) + error-body capture

> Compressed planning run: proposal, spec delta, and tasks in ONE pass; no design phase — zero architectural forks, both fixes are localized single-file changes.

## Intent

Live worker console (2026-09-05): `[quotadeck] qwen refresh failed: HttpStatusError: HTTP 400` — the signed request reaches `business.aliyuncs.com` and the server rejects it. Root cause (high confidence): `signedRequest` sends `Timestamp` via `toISOString()` WITH milliseconds; Alibaba POP RPC requires ISO-8601 UTC WITHOUT milliseconds (`YYYY-MM-DDTHH:mm:ssZ`). A millisecond-carrying Timestamp yields 400 (Illegal Timestamp), and `Timestamp` feeds the StringToSign (AD-18) — offline vectors were self-consistent; only the live server validates the format.

Secondary defect (diagnostic blind spot): `FetchTransport` throws `HttpStatusError(status)` BEFORE reading the body (AD-30 status-first), so the server's `Code`/`Message` is discarded; taxonomy maps 400 → `unknown` and nobody can see why.

## Scope

### In Scope

- (a) Timestamp fix — `extension/src/network/client.ts` `signedRequest`: millisecond-free ISO-8601 UTC; param and StringToSign agree.
- (b) Error-body capture — `extension/src/network/fetch-transport.ts`: on non-2xx read body as text, embed first ≤200 chars verbatim in the `HttpStatusError` message (server `Code` visible). Never parsed as JSON on error statuses; classification status-first; snapshot class-only (AD-13).
- (c) KEEP the `background.ts` `onError` `console.error` (8516190) as permanent, reframed from "temporary": the only live-observable signal, proved invaluable; worker console is developer-only; AD-13 snapshot untouched.
- (d) Tests — update two existing pins asserting OLD behavior (`client.test.ts:236` millisecond Timestamp; `fetch-transport.test.ts` status-only messages) plus new cases.

### Out of Scope

- Qwen product fork (balance vs plan-usage); other providers; taxonomy changes (400 stays `unknown`).

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `network-allowlist`: + §RPC Timestamp Format, + §Error Body Surfacing (ADDED).

## Approach

Client normalizes the clock instant to `YYYY-MM-DDTHH:mm:ssZ` before signing; transport reads error bodies as text (guarded — body-read failure degrades to status-only) and embeds a capped snippet. Deliberate, narrow relaxation of hito-4 AD-30's "error bodies are never read": the blind spot cost more than the bounded untrusted-text risk.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `extension/src/network/client.ts` (+test) | Modified | Strip milliseconds; pins |
| `extension/src/network/fetch-transport.ts` (+test) | Modified | Snippet capture; `text()` on `FetchResponseLike` |
| `extension/src/background.ts` | Modified | Permanent diagnostic log |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Additional live cause behind the 400 | Medium | (b) makes any residual error self-explanatory |
| Untrusted body text in console | Low | Text-only, 200-char cap, never parsed/persisted |
| AD-30 pin reversal | Low | Delta spec documents the contract; classification unchanged |

## Rollback Plan

Revert the single PR on `feature/hito-7-qwen-bss-fix`. No storage/schema/migration changes; status-only behavior returns immediately.

## Dependencies

- Maintainer live E2E against the real BSS endpoint.

## Success Criteria

- [ ] Hermetic suite green (no-millis + body-capture pins; full `npm --prefix extension run test`).
- [ ] Live E2E: qwen shows ¥ balance, or a self-explanatory server error (`Code` visible in worker console) if account/permission rejects.
- [ ] Snapshot stays class-only (AD-13); existing background pins untouched.
