```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:989442bde27353a54507e1b6b659c3e516c9f8fd41622e1aad79576bbb52ea9b
verdict: pass
blockers: 0
critical_findings: 0
requirements: 13/13
scenarios: 44/44
test_command: npm --prefix extension run test
test_exit_code: 0
test_output_hash: sha256:898a9333fabc95e39a784367ee61087e2ebf3c8bd7ff028c37b6b911cb663c02
build_command: npm --prefix extension run build
build_exit_code: 0
build_output_hash: sha256:5992d0f7f6509be5bd33e113c77c10731e7769bb23c50a0fdedc9467d5a6db3f
```

## Verification Report

**Change**: hito-8-qwen-hybrid | **Mode**: Strict TDD | **Store**: openspec
**Head**: b2cab15 on `feature/hito-8-qwen-hybrid`, clean tree | **Date**: 2026-09-06 (re-verification)
**Artifacts verified**: proposal.md (incl. Design Notes §1-5), 5 delta specs (incl. the network-allowlist amendment from 24a0e0c), tasks.md. No design.md (compressed run, declared in proposal); Design Notes are the decision record.
**Supersedes**: the FAIL report committed as 90f9d84 (evidence head 622a2b3: 1 critical — task 3.2 open; 1 partial — determinism gap). Both are closed at this head; three remediation commits (676d735, f16e919, 24a0e0c) landed in between and are re-verified below.

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 25 |
| Tasks complete | 25 |
| Tasks incomplete | 0 |

### Build & Tests Execution (this run, head b2cab15)
**Tests**: ✅ 426 passed / 0 failed / 0 skipped — `npm --prefix extension run test`, exit 0, Test Files 29 passed (29), duration 3.78s; output sha256 `898a9333…c02` (captured combined output; hash covers the exact captured bytes incl. runner timing lines). Delta vs the failed verify: +4 tests (cf9a037 +1 plan-carrying determinism; f16e919 +2 probe-console diagnostics; 24a0e0c +1 bodyless-GET Content-Type pin).
**Typecheck**: ✅ exit 0 — `npm --prefix extension run typecheck` (tsc --noEmit), output sha256 `670df1d5…8f`.
**Build**: ✅ exit 0 — `npm --prefix extension run build` → dist/background.js 43.4kb, dist/popup.js 30.8kb, dist/manifest.json, dist/popup.html; output sha256 `5992d0f7…b3f`.
**Coverage**: ➖ Not available — no coverage tooling (config `coverage: null`).
**Evidence revision**: sha256 over the concatenated test+typecheck+build captured outputs → `989442bd…a9b`.

### Prior-Findings Disposition (re-verify)
| Prior finding | Status | Evidence |
|---|---|---|
| C1 — task 3.2 (maintainer live E2E) open → blocked PASS | ✅ CLOSED | Task ticked in b2cab15; maintainer confirmed all three arms live on 2026-09-06 (evidence under "Maintainer Live E2E" below) |
| W1 — PU2 "Deterministic plan rendering" PARTIAL (no plan-carrying repeat render) | ✅ CLOSED | cf9a037 adds `view.test.ts:376` "renders plan-carrying state deterministically — repeated renders stay byte-identical (verify W1 gap, hito-8)": exhausted+resetAt snapshot with plan key state, `strictEqual` on both views, plus containment guards proving the compared output carries `Plan: exhausted` and the plan-key group |
| Remediation 676d735 — BSS Format=JSON | ✅ VERIFIED | `qwen.ts:37` (comment: POP defaults to XML on the intl site) + `qwen.ts:43` query `{Action, Version, Format: 'JSON'}`; pinned by exact query equality on both sites (`qwen.test.ts:82,89`) |
| Remediation f16e919 — probe silent arms surfaced | ✅ VERIFIED | `qwen-plan.ts:68-71` console.error on transport failure; `qwen-plan.ts:83` console.error on unmapped status; behaviorally pinned (`background.test.ts:633,651` — spy asserts the exact diagnostic line and untouched cache). This diagnostic exposed the live 400 that 24a0e0c fixed |
| Remediation 24a0e0c — JSON bodies labeled application/json | ✅ VERIFIED | `client.ts:68-69` `jsonContentType()`: body present → `Content-Type: application/json`, bodyless → no header; applied on all three attach arms (`client.ts:125,132,138`); pinned by exact header equality (`client.test.ts:360-377` labeled probe body) and the bodyless-GET negative pin (`client.test.ts:379-387`). Spec delta network-allowlist amended accordingly (requirement text now carries the Content-Type sentence; no scenario count change) |

### Spec Compliance Matrix (5 deltas: 13 requirements / 44 scenarios)
| Req | Scenario | Covering test (all passed this run) | Result |
|-----|----------|----------------------------|--------|
| KS1 Site Preference | Round-trip unmasked, intl default | qwen-site-store.test.ts (round-trip/default/invalid→default) | ✅ |
| KS1 | Credential namespace unaffected | qwen-site-store.test.ts:48 | ✅ |
| KS2 Plan Key | Round-trip with pair intact | key-store.test.ts:155 | ✅ |
| KS2 | Masked display ≤4 suffix | key-store.test.ts:167 | ✅ |
| KS2 | Isolated revocation both directions | key-store.test.ts:175 | ✅ |
| KS2 | Non-sk-sp rejected w/ guidance | credentials.test.ts:41,51; controller.test.ts:467 | ✅ |
| NA1 Allowlist | Allowlisted host admitted | client.test.ts:42,67 | ✅ |
| NA1 | Intl BSS + probe hosts admitted | client.test.ts:283,360; qwen.test.ts:77 | ✅ |
| NA1 | Non-allowlisted host rejected | client.test.ts:101 | ✅ |
| NA1 | Cross-provider host rejected | allowlist.source.test.ts:66 | ✅ |
| NA1 | Removed apex host rejected | allowlist.source.test.ts:59 | ✅ |
| NA2 Cred Placement | Key placement (header only) | client.test.ts:42,360,401 (incl. amended Content-Type pins at 370-373) | ✅ |
| NA2 | RPC exception BSS-scoped | client.test.ts:216,268,283 | ✅ |
| NA2 | Signed-style rejected off-BSS (incl. probe) | client.test.ts:298,314 | ✅ |
| NA2 | Plan key confined to Authorization | client.test.ts:360 (exact header equality, key absent from URL/query/body) | ✅ |
| NA2 | Non-header key suppressed | client.test.ts:114 | ✅ |
| NA2 | Raw attach scoped to monitor hosts | client.test.ts:148,163,176 | ✅ |
| PF1 Provider Contract | Four stubs contract-compliant | index.test.ts:33,45 | ✅ |
| PF1 | Plan-only qwen result normalized | background.test.ts:574 (incl. plan-only absent-entry case asserted inline at 575-591: exact value-less ok entry, no badge write) | ✅ |
| PF2 Qwen Parsing | International string envelope | qwen.test.ts:99 + fixture query-account-balance--intl-ok.json | ✅ |
| PF2 | China numeric fixture | qwen.test.ts:13,112 | ✅ |
| PF2 | Non-success envelope rejected | qwen.test.ts:124,131 | ✅ |
| PF2 | Invalid site throws pre-dispatch | qwen.test.ts:92 | ✅ |
| PF2 | DashScope key rejected | qwen.test.ts:56; credentials.test.ts:5 | ✅ |
| PF3 Attach Modes | ZAI declares raw attach | client.test.ts:148,163 | ✅ |
| PF3 | Plan key attaches as bearer | client.test.ts:360 (+ signed-query balance: client.test.ts:216) | ✅ |
| PF4 Plan Probe | Available (2xx) | qwen-plan-probe.test.ts:51 | ✅ |
| PF4 | Exhausted w/ reset parsed + rollover | qwen-plan-probe.test.ts:56,64,101 | ✅ |
| PF4 | Key rejected (401/403) | qwen-plan-probe.test.ts:77 | ✅ |
| PF4 | No percentage synthesized | qwen-plan-probe.test.ts:87 (exact key-set assertion) | ✅ |
| PU1 Site Selector | Defaults and persists | view.test.ts:464,474; controller.test.ts:384,393,406; background.test.ts:425,437,449 | ✅ |
| PU2 Plan Line | Plan line per status | view.test.ts:486 (exact 3 texts incl. `2h 0m`) | ✅ |
| PU2 | Plan-only card renders | view.test.ts:524; controller.test.ts:520 | ✅ |
| PU2 | Deterministic plan rendering | view.test.ts:376 (cf9a037: plan-carrying state rendered twice, byte-identical both views, content guards) | ✅ |
| PU3 Plan Key Group | Valid key persisted + masked | controller.test.ts:448 (slot bytes, pair untouched, DOM cleared) | ✅ |
| PU3 | Revoke isolation from pair | controller.test.ts:483,502 | ✅ |
| PU4 Guidance (MOD) | Guidance precedes inputs | view.test.ts:816 | ✅ |
| PU4 | Verbatim provider copy | view.test.ts:781,579 | ✅ |
| PU4 | Guidance distinct from errors | view.test.ts:837 | ✅ |
| UB1 Probe Cadence | Fresh cache suppresses probe | background.test.ts:512 (probeCalls=0, cached status rides) | ✅ |
| UB1 | Expired cache probes exactly once | background.test.ts:527 (probeCalls=1, cache rewritten) | ✅ |
| UB1 | No plan key → no probe | background.test.ts:543 | ✅ |
| UB1 | Badge unchanged by plan status | background.test.ts:557; usage.test.ts:64 (byte-identical) | ✅ |
| UB1 | Transport failure keeps cache | background.test.ts:614 (cache byte-equal, plan omitted, balance ok) + diagnostic pins 633,651 | ✅ |

**Compliance summary**: 44/44 scenarios compliant, 13/13 requirements fully complete. The former PU2 determinism PARTIAL is closed by the dedicated plan-carrying determinism test; the amended network-allowlist requirement text (Content-Type labeling) is pinned within the NA2 rows.

### Correctness (Static Evidence)
All 13 delta requirements implemented and source-verified at b2cab15: site table + default intl + invalid→default pre-dispatch throw (qwen-sites.ts, qwen.ts:28-42 incl. Format=JSON at :37,43); tolerant envelope both forms, explicit body-level error (qwen.ts:44-66); dual slot `qd:key:qwen-plan` with per-slot revoke and ≤4-suffix masking (key-store.ts:37-128); sk-sp- validation + guidance (credentials.ts:39-42,72-74); 3-host allowlist = doc JSON block = manifest union (allowlist.ts:24-31, pinned by allowlist.source.test.ts + manifest.hosts.test.ts); BSS-only signing exception + probe-host rejection (request.ts:82-94); body-scoped `Content-Type: application/json` as the single non-credential header (client.ts:68-69,125,132,138 — bodyless requests carry none); probe request shape + status-first map + reset parse w/ range gate and year rollover (qwen-plan-probe.ts); TTL 120/15/15 with cache-survives-failure and no-key-no-probe plus permanent console diagnostics on both silent arms (qwen-plan.ts:60-88); plan merge into ok/absent only, error arm wins, badge untouched (background.ts; usage.ts ignores plan); popup plan line 3 states + plan-key group + selector (view.ts, controller.ts).

### Coherence (Design Notes vs code)
| Decision | Followed? | Evidence |
|----------|-----------|----------|
| §1 Dual credential via slot + token-union rider | ✅ | CredentialSlot/CredentialType unions; Bearer branch covers 'qwen-plan', no new attach mode |
| §2 Probe as tick step outside RefreshEngine | ✅ | refresh/qwen-plan.ts; wired in background.ts after refreshAll, before snapshot write; silent arms now console-visible (f16e919) without widening the transport port |
| §3 Cache bounds 120/15/15 under `qd:qwen-plan-status` | ✅ | qwen-plan.ts:27-33; shape-validated store (SnapshotStore pattern) |
| §4 Reset from error text, not headers | ✅ | parseResetInstant over HttpStatusError.message; transport port unchanged |
| §5 plan optional like windows; badge ignores | ✅ | usage.ts PlanInfo; formatBadgeText has no plan read |

### Proposal Conformance & Security Sweep
Hybrid delivered (BSS balance + binary probe). Out-of-scope respected: no cookie/session surface (ProviderRequest has no headers/cookies fields), no synthesized percentage/total (PlanInfo = {status, resetAt?}), no CN probe host (2 sites / 3 qwen hosts only), no other-provider source changes (diff 1af2c42..b2cab15 touches only the declared areas + this change's openspec dir). Security posture unchanged from the prior verify and re-pinned green: signing exception derives from the site table (`isQwenBssHost` ← BSS_HOSTS from QWEN_SITES, request.ts:82-94), NOT the allowlist — signed-style credentials rejected on the probe host; plan key attaches ONLY as `Authorization: Bearer` on the probe host and is rejected even on allowlisted BSS hosts (client.test.ts:360,389); AccessKeySecret appears on NO surface (request.ts:73-81, pinned client.test.ts:401); probe request body is credential-free; the new Content-Type header is non-credential and strictly body-scoped (client.ts:68-69) — the allowlist amendment introduces no credential surface.

### Maintainer Live E2E (task 3.2 — confirmed 2026-09-06)
- (a) International balance rendered **$0.00** from the `business.ap-southeast-1.aliyuncs.com` host — no `AuthSiteFail` (the live-found 400 that motivated 676d735's `Format=JSON` is gone; the intl envelope's string `Code` `"200"` parses as specified).
- (b) Real `sk-sp-` key → popup shows **"Plan: Available"**; `chrome.storage` `qd:qwen-plan-status` = `{"status":"available"}` after a 2xx probe — the end-to-end probe path (labeled JSON body per 24a0e0c, Bearer-only attach, TTL cache write) works against the real endpoint.
- (c) Badge remains balance-only with plan status present — pinned hermetically (`background.test.ts:557` "badge text is unchanged by plan status"; `usage.test.ts:64` byte-identical badge text).

### TDD Compliance (Strict)
| Check | Result | Details |
|-------|--------|---------|
| TDD evidence reported | ⚠️ | No apply-progress artifact in openspec store; RED/GREEN structure embedded in tasks.md (1.1 RED/1.2 GREEN … 2.13/2.14), all ticked — unchanged store topology, carried note from the prior verify |
| All tasks have tests | ✅ | 14/14 RED tasks' test files exist on disk |
| GREEN confirmed by execution | ✅ | 426/426 pass this run |
| Triangulation adequate | ✅ | Multi-scenario behaviors carry multiple distinct-value cases |
| Safety net | ✅ | Full pre-existing suite green alongside new tests |
| Assertion quality | ✅ | 0 trivial assertions in audited files (incl. the 4 new tests) |

### Test Layer Distribution
Unit: 426 tests / 29 files (vitest, node env; controller/view tests simulate DOM in-process via happy-dom). Integration: 0 (none declared in capabilities). E2E: 0 hermetic — live E2E is the human-owned task 3.2, now confirmed (above).

### Changed File Coverage
Coverage analysis skipped — no coverage tool detected (config `coverage: null`). Changed-file quality gate covered by tsc --noEmit (whole project, exit 0).

### Assertion Quality
✅ All assertions verify real behavior — audited: the 4 tests added since the failed verify (view.test.ts:376 strictEqual repeated renders + content guards; background.test.ts:633,651 console.error spy with exact diagnostic args + cache-absence assertion; client.test.ts:379 exact header equality proving NO Content-Type on bodyless GET) plus the re-audited hito-8 files (qwen-plan-probe.test.ts, background.test.ts plan sections, client.test.ts scoping pins, view.test.ts plan sections, controller.test.ts plan group, usage.test.ts). Exact-value assertions (UTC instants, byte-equal caches, exact snapshot objects, header equality); no tautologies, ghost loops, type-only, or smoke-only assertions.

### Quality Metrics
**Linter**: ➖ Not configured. **Type Checker**: ✅ 0 errors (exit 0).

### Issues Found
**CRITICAL**: None.

**WARNING**:
1. (Informational, non-blocking, carried from the prior verify — not a defect of this change) Strict-TDD module expects an apply-progress "TDD Cycle Evidence" table; the openspec store keeps that structure in tasks.md RED/GREEN task pairs instead. Compensated by direct verification (files exist; suite passes by execution).

**SUGGESTION**:
1. proposal.md success-criteria checkboxes 1 (hermetic suite green incl. pins) and 3 (no credential outside its sanctioned placement) remain unticked in prose; both are now evidenced by this verification — tick at archive settlement (docs-only, orchestrator-owned).

### Verdict
**PASS** — all gates exit 0 (426/426 tests across 29 files, tsc clean, build clean), 25/25 tasks complete, 44/44 spec scenarios compliant across 13/13 requirements, design coherent, security posture re-pinned, both prior blockers to PASS closed (task 3.2 live E2E confirmed by the maintainer; determinism gap pinned), and all three remediation commits verified in source with covering pins. The single remaining warning is informational store topology carried from the prior verify. Archive-ready.
