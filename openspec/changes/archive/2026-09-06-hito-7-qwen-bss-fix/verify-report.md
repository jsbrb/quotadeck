```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:cd203a8e81b2ef5f769be7b3a52cb12d68d86bdca94a694432a57c171a1a8079
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 2/2
scenarios: 7/7
test_command: npm --prefix extension run test
test_exit_code: 0
test_output_hash: sha256:1242c7751106d4443a12aa596d8c214ebab87e297504dac6d39d5944d1905ddd
build_command: npm --prefix extension run build
build_exit_code: 0
build_output_hash: sha256:5e6043545484a5e2becbb716fc15c7bdf7af2db626d4408ba59cea8340afa793
```

## Verification Report

**Change**: hito-7-qwen-bss-fix
**Version**: N/A (delta specs, no version field)
**Mode**: Strict TDD
**HEAD**: b3b3a3c (branch `feature/hito-7-qwen-bss-fix`, clean tree)
**evidence_revision digest covers**: sha256 over `proposal.md` + `specs/network-allowlist/spec.md` + `tasks.md` (concatenated bytes).

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 7 |
| Tasks complete | 6 |
| Tasks incomplete | 1 (4.2 — maintainer live E2E checklist, human-owned, in progress in parallel per proposal §Dependencies) |

### Runtime Gates (re-executed this verification)
**Typecheck**: ✅ Passed — `npm --prefix extension run typecheck` (tsc --noEmit), exit 0, no errors.
**Build**: ✅ Passed — `npm --prefix extension run build`, exit 0; both entries emitted: `dist/background.js` (35.3kb), `dist/popup.js` (25.6kb) + manifest + popup.html.
**Tests**: ✅ 330 passed / 0 failed / 0 skipped — `npm --prefix extension run test`, exit 0, 25 files (vitest 5.0.0).
**Coverage**: ➖ Not available — no coverage tooling configured (`coverage: null` in openspec/config.yaml).

### Spec Compliance Matrix
| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| §RPC Timestamp Format | Emitted timestamp carries no milliseconds | `client.test.ts > signs the qwen BSS query and dispatches with NO Authorization header` — decoded `Timestamp` equals exact `2023-11-14T22:13:20Z` (FakeClock zero-millis epoch 1_700_000_000_000) AND matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$` (no `.`) | ✅ COMPLIANT |
| §RPC Timestamp Format | Millisecond-carrying clock input is normalized | `client.test.ts > normalizes a millisecond-carrying clock to the no-millis POP Timestamp` — FakeClock(1_700_000_000_123) still emits `2023-11-14T22:13:20Z` + regex | ✅ COMPLIANT |
| §RPC Timestamp Format | Signature computed over the emitted value | Structural identity: `client.ts` passes the single `toPopTimestamp(clock.now())` value into `signBssQuery`; `rpc-signer.ts` sets `query.Timestamp = inputs.timestamp` and builds the canonical/StringToSign from that same query object — signed value IS emitted value by construction. Pinned at runtime by `rpc-signer.test.ts > returns the query as base params plus the four common params` (pass-through: emitted `Timestamp` equals signed input) + the pinned offline vector (deterministic signature over that timestamp); `client.test.ts` asserts dispatched `Timestamp` + `Signature` from one dispatch | ✅ COMPLIANT |
| §Error Body Surfacing | Plain-text error body surfaced | `fetch-transport.test.ts > caps the snippet at the first 200 body characters` (500-char body → message = `HTTP 400: ` + first 200 verbatim, exact length pin, nothing past the cap, `jsonCalls === 0`) + `it.each` 400/401/403/404/429/500/503 carrying status + body verbatim | ✅ COMPLIANT |
| §Error Body Surfacing | JSON error document surfaced as text | `fetch-transport.test.ts > surfaces a JSON error document as raw text` — raw body verbatim in message, contains `"Code":"InvalidAccessKeyId.NotFound"`, `jsonCalls === 0` (no parse on the error path) | ✅ COMPLIANT |
| §Error Body Surfacing | 2xx handling unchanged | `fetch-transport.test.ts > returns { status, body } for a 200 JSON response` (parsed as JSON, `textCalls === 0`) + `carries a POST body through… 201 verbatim` + `a 2xx body that is not JSON rejects with ResponseParseError` | ✅ COMPLIANT |
| §Error Body Surfacing | Body-read failure degrades to status-only | `fetch-transport.test.ts > degrades to a status-only message when the body read rejects` — `text()` rejects → still `HttpStatusError` status 400, message `HTTP 400`, failure ≠ readFailure (no secondary failure) | ✅ COMPLIANT |

**Compliance summary**: 7/7 scenarios compliant (3 RPC Timestamp Format + 4 Error Body Surfacing), each backed by a passing test at runtime.

### Correctness (Static Evidence)
| Item | Status | Notes |
|------|--------|-------|
| Timestamp normalization before signing | ✅ Implemented | `toPopTimestamp()` strips `\.\d{3}Z$` → `Z` at client.ts:57-59, applied at the single injection point (client.ts:146) so param and StringToSign agree (AD-18) |
| Error-body capture, status-first | ✅ Implemented | fetch-transport.ts:69-80 — `!ok` branch reads `text()` inside try/catch, then throws `HttpStatusError(status, snippet)`; classification still precedes any body handling (AD-30 relaxation is read-only, text-only) |
| Cap enforcement | ✅ Implemented | `bodySnippet.slice(0, 200)` inside the `HttpStatusError` constructor itself (fetch-transport.ts:20) — every construction site is capped by construction |
| Degrade path | ✅ Implemented | `catch { bodySnippet = undefined }` → status-only message; read failure never masks the status error |
| Permanent diagnostics | ✅ Implemented | background.ts:107-121 — the `console.error` kept, "Temporary… Remove once fixed" framing replaced with the hito-7 permanence rationale (commit b3b3a3c, +6/−3 comment-only) |
| Snapshot stays class-only (AD-13) | ✅ Intact | background.ts:120 persists `{ status: 'error', errorClass }` only; the thrown value (message included) is dropped; `snapshot-store.ts` not in the change diff |
| Taxonomy untouched | ✅ Intact | `error-taxonomy.ts` not in the change diff; 400 still maps to `unknown`; AD-30 pins block in fetch-transport.test.ts green (json never called on error path, no `ResponseParseError`, classes 401/403→auth, 429→rate-limit, 500→server) |
| Credential surfaces unaffected | ✅ Intact | Snippet source is the RESPONSE body, not the request; the request-side secret sweep (`client.test.ts > the AccessKeySecret appears in NO surface`) green; `AccessKeySecret` still never transmitted |

### Coherence (Design)
No `design.md` exists — the proposal header records the compressed hotfix run ("no design phase — zero architectural forks, both fixes are localized single-file changes"). Design coherence **skipped**; structural architecture-decision checks performed instead:
- **AD-13** intact (snapshot class-only, above).
- **AD-30 relaxation documented** at all three required places: delta spec §Error Body Surfacing (normative), fetch-transport.ts module comment (scoped relaxation: text-only, capped, never parsed, never persisted), proposal §Approach (deliberate, narrow; blind-spot cost > bounded untrusted-text risk).
- **AD-18** intact: signer pure, injected inputs, untouched except by the caller's normalized timestamp.
- **AD-19/AD-21** intact: no Authorization header on ak-sk dispatch (pin green); typed error pair unchanged in shape (`status` + optional snippet).

### Proposal Conformance
All three fixes present as specified: (a) no-millis POP timestamp (2f902ff), (b) bounded verbatim error-body snippet (f229f62), (c) permanent diagnostics reframe (b3b3a3c). Out-of-scope respected — no Qwen product fork, no other providers, no taxonomy change; change diff ⊆ proposal Affected Areas (`client.ts`+test, `fetch-transport.ts`+test, `background.ts`) plus the openspec planning docs. Existing background pins untouched (`background.test.ts` not in diff). Authored changed lines: 185 insertions + 24 deletions = 209 across 5 code files — inside the ~150–250 forecast and under the 400-line review budget.

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | tasks.md embeds explicit RED/GREEN rows per implementation task (openspec-native ledger); no separate apply-progress artifact |
| All tasks have tests | ✅ | 4/4 implementation tasks (1.1/1.2/2.1/2.2) name test files that exist; 3.1 is a comment-only reframe (no test subject beyond existing green pins) |
| RED confirmed (empirically re-proven) | ✅ | Worktree reconstruction at pre-fix base 8516190 + HEAD test files: exactly the documented failures — client.test.ts 2 failed (exact-value pin + nonzero-millis case), fetch-transport.test.ts 9 failed (7 `it.each` statuses + 200-cap + JSON-doc); degrade and AD-30 rows correctly still green at base. 2+9 = 11, matching the documented RED rows; 0 collateral failures |
| GREEN confirmed (tests pass) | ✅ | 330/330 pass at runtime, re-executed this verification |
| Triangulation adequate | ✅ | Timestamp: zero-millis + nonzero-millis + regex; body surfacing: 7 statuses × verbatim + exact-200-boundary + JSON-doc + degrade + 2xx unchanged |
| Safety Net for modified files | ✅ | All pre-existing pins in the two modified test files passed at base (29/40 non-RED rows) and at HEAD inside the 330/330 suite; `rpc-signer.test.ts` pass-through pins untouched and green |

**Test files**: client.test.ts 22 tests, fetch-transport.test.ts 18 tests (runtime counts).

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 40 | 2 (client.test.ts, fetch-transport.test.ts — node env, injected doubles) | vitest |
| Integration | 0 | 0 | happy-dom present in repo, not needed by this slice |
| E2E | 0 | 0 | not installed; live E2E is the human-owned 4.2 checklist |

### Changed File Coverage
Coverage analysis skipped — no coverage tool detected.

### Assertion Quality
**Assertion quality**: ✅ All changed-file assertions verify real behavior — exact-value string pins, regex shape pins, message-length arithmetic, verbatim-containment, call counters (`jsonCalls`/`textCalls`), instance/status/class checks. No tautologies, no ghost loops introduced (the pre-existing empty-headers sweep loop in the untouched hito-3 secret-scan test remains covered by its `JSON.stringify(sent)` whole-request assertion). No `vi.mock` in either file (stubs are local structural doubles).

### Quality Metrics
**Linter**: ➖ Not available. **Type Checker**: ✅ No errors (tsc --noEmit, exit 0).

### Issues Found
**CRITICAL**: None
**WARNING**:
- Task 4.2 (maintainer live E2E checklist) is incomplete — human-owned by design (proposal §Dependencies), in progress in parallel. Hermetic scope is fully verified; settlement/archive of this change should wait for 4.2's PASS/ACCEPTABLE outcome.
**SUGGESTION**:
- fetch-transport.test.ts:190 inline comment `// the error body is never even read` is stale — since this change the body IS read as text; the assertion (`jsonCalls === 0`, no JSON parse) and the surrounding describe comment are correct. Comment-only nit.
- RED/GREEN evidence lives as rows inside `tasks.md` rather than a dedicated apply-progress artifact (carry-over from hito-6 convention); content is complete and was empirically re-proven this verification.

### Verdict
**PASS WITH WARNINGS**
All 7 scenarios across 2 ADDED requirements are COMPLIANT with passing runtime evidence; all gates green at HEAD b3b3a3c (typecheck exit 0, build exit 0, 330/330 tests); proposal conformance, AD-13/AD-30/AD-18 invariants, and out-of-scope respected; 0 critical findings. The single warning is the pending human-owned live E2E (task 4.2), which cannot be agent-executed and gates archive, not the hermetic verdict.
