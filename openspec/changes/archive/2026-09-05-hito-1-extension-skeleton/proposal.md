# Proposal: Hito 1 — Extension Skeleton

## Intent

quotadeck monitors AI plan usage/quota. Hito 1 turns the endpoint spike into a verified Chrome extension foundation: manifest v3 + strict TypeScript + esbuild + vitest skeleton, four fixture-proven stub providers, security posture enforced in code. No live API calls.

## Scope

### In Scope
- `docs/spike/endpoints.md` — per-provider evidence: auth, shapes, gotchas, verification status (ZAI, Qwen, OpenAI, Kimi).
- `extension/` skeleton — manifest v3, strict TypeScript, esbuild, vitest.
- `Provider` interface + four stubs with fixture-based parser tests.
- Allowlist network layer — official domains only; `Authorization` header only.
- `chrome.storage.local` wrapper (never `.sync`); masked keys + revoke.
- Badge + `chrome.alarms` (1 min) background worker.
- `LICENSE` (MIT) + minimal `README.md`.

### Out of Scope
- Live API calls with real keys (stubs + fixtures only).
- Qwen Coding Plan quota (no official API — see Approach).
- Android/iOS, store publishing, cert pinning, telemetry.

## Capabilities

### New Capabilities
- `provider-framework`: Provider contract, registration, four stubs; parsing proven against fixtures.
- `network-allowlist`: per-provider domain allowlist; keys only in the `Authorization` header.
- `key-storage`: `chrome.storage.local` wrapper; masked display; revoke; no `.sync` path.
- `usage-badge`: badge updated on a 1-min `chrome.alarms` schedule.

### Modified Capabilities
None — greenfield; `openspec/specs/` is empty.

## Approach

Layered: `Provider` interface → stub providers → allowlist fetch layer → storage wrapper → badge/alarms service worker. Fixture tests pin parsing contracts; the live-calls milestone swaps stub fetches for real requests.

**Qwen v1: keep Qwen as the fourth stub, BSS balance only.**
- `QueryAccountBalance` (Alibaba BSS OpenAPI) is the only official, verified Qwen-side endpoint. Coding Plan quota needs browser cookie + rotating CSRF — automating it violates the security posture; blocked pending an official API.
- Hito-1 cost is a stub + fixture (zero risk). Live go/no-go — AK/SK + `bss:DescribeAcccount` RAM setup; DashScope `sk-` keys don't work — re-decided at the live milestone.
- Balance remains a real signal for pay-as-you-go users.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `extension/` | New | MV3 skeleton: manifest, service worker, providers, network, storage, tests |
| `docs/spike/endpoints.md`, `LICENSE`, `README.md` | New | Spike evidence; MIT license; readme |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| ZAI endpoint community-verified; shape may change or ban | Medium | Fixtures pin shape; jitter/pagination/dedupe documented |
| Qwen needs Alibaba AK/SK (DashScope key won't work) | Medium | Docs state AK/SK + RAM requirement; live launch deferred |
| `api.z.ai` international variant unverified | Low | Stub targets `bigmodel.cn`; intl marked unverified |

## Rollback Plan

Greenfield on a feature branch: delete `extension/`, `docs/spike/`, `LICENSE`, `README.md`, and this change folder — nothing else depends on them.

## Dependencies

Chrome MV3 runtime (unpacked dev load); esbuild; vitest.

## Success Criteria

- [ ] esbuild build passes; all vitest suites green with fixture-only data.
- [ ] Network layer rejects non-allowlisted requests (test-proven).
- [ ] Storage wrapper has no `.sync` path; keys masked with revoke.
- [ ] Badge updates on each 1-min alarm tick (unpacked load).
- [ ] Endpoints doc covers all providers with verification status + links.
