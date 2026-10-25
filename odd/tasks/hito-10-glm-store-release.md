# hito-10-glm-store-release — GLM-only Chrome Web Store release

## Objective
Prepare and package the first public Chrome Web Store release of quotadeck as a GLM-only build (ZAI provider only), with threshold-colored badge alerting and CWS publication assets.

## Problem / Why
The extension supports four providers but the maintainer wants the store launch scoped to GLM (ZAI) only. The Chrome action badge already shows the 5h-window percentage but gives no visual alert; the CWS listing needs icons, store metadata, and packaging that do not exist yet.

## Decisions (user-ratified 2026-10-04)
- Park hito-9 (qwen console session percentages) on its own branch; release from the develop line (hitos 1–8 complete).
- Ship **zai only**; other provider code is retained but not shipped (filter, don't delete).
- Badge thresholds: ≥50 orange `#F97316`, ≥80 deep orange `#EA580C`, ≥90 red `#DC2626`, otherwise neutral `#334155`; white text. Uncapped percentages (137 → red).
- Version `0.2.0`. Public distribution, free, after maintainer-driven dashboard steps.
- Icons generated once (indigo rounded square + white "Q") and committed.

## Scope
- extension/src: badge color fn + adapter + wiring; SHIPPED_PROVIDER_IDS filter (registry + popup); manifest host scoping + sync test.
- extension/public/manifest.json: icons, default_icon, description, version 0.2.0, zai-only hosts.
- extension/build.mjs + package.json: icon copy + zip script. scripts/make-icons.ps1 + public/icons/.
- README posture update. openspec docs (this change folder).

## Tasks
- [x] T0 git: park hito-9 (6b9bede), branch feature/hito-10-glm-store-release from develop — parent, inline
- [x] T1 (WU1) badge threshold colors — commit 7407602 (RED 8 fails → GREEN; boundaries 49/50/79/80/89/90/137/undefined pinned)
- [x] T2 (WU2) SHIPPED_PROVIDER_IDS zai-only registry + popup — commit 63262e3 (authorized engine.test.ts mechanical rewire, 3 call sites)
- [x] T3 (WU3) manifest hosts scoped + sync test re-pin — commit 99ae761 (api.z.ai + open.bigmodel.cn; allowlist/endpoints.md untouched)
- [x] T4 (WU4) icons + metadata 0.2.0 + zip — commit cf13668 (authorized copy.test.ts two-pin re-pin; zip via .NET ZipArchive forward-slash, 8 entries, manifest at root)
- [x] T5 (WU5) README GLM-only posture — commit b46cf8e
- [x] T6 gates + spot check — typecheck clean; parent re-ran test: Test Files 29 passed (29), Tests 423 passed (423) — matches writer report
- [x] T6b docs set — commit f3f8447 (openspec proposal + tasks + this ledger)
- [ ] T7 openspec delta specs for touched capabilities (usage-badge, popup-ui, network-allowlist, provider-framework) — pending, at archive time
- [ ] T8 dashboard guidance (upload, listing, privacy, distribution) — user-driven, guided 2026-10-04

## Acceptance criteria
- Badge background reflects thresholds on every tick; ERR badge neutral.
- Unpacked dist shows only ZAI in popup/settings; manifest hosts = zai allowlist entry exactly; hosts sync test green.
- dist/icons present; zip `extension/quotadeck-v0.2.0.zip` has manifest.json at root.
- `typecheck`/`test`/`build` green; work-unit commits on feature branch; no push.

## Verification evidence
- typecheck: clean (tsc --noEmit) — writer per WU + final, parent final
- test: 423 passed (423), 29 files — writer final + parent spot check (byte-identical)
- build: dist/background.js + popup.js + manifest.json + popup.html + dist/icons/ (16/32/48/128)
- zip: extension/quotadeck-v0.2.0.zip — 8 entries, all forward-slash, manifest.json at root; gitignored

## Review/RDD log
- assess #1 (pre-docs): high/unassessable (untracked) → committed docs f3f8447
- assess #2: medium (executable_change .gitignore), 1116 lines, review_due=slice_budget_reached
- consent: granted by maintainer via provider-issued start command (native channel degraded)
- review: lineage review-56da961153e05544, lens review-reliability — **approved**, no blocking findings
- acknowledged: authority burned (consumed revision sha256:e48e637e…)
- assess #3 (post-review fix cb164cf): medium (configuration_change manifest), 42 lines, review_due=false / under_budget — pending in slice, no new cycle
- assess #4 (badge rework 0a0e320): medium (executable_change background.test.ts), 86 lines, review_due=false / under_budget — no new cycle; slice pending total 128 lines

## Post-review tweak (2026-10-04, maintainer feedback)
- Maintainer rejected white-on-dark neutral band legibility → ratified: neutral (<50 + ERR) renders dark `#0F172A` on light `#E2E8F0`; bands ≥50 unchanged (white on saturated colors)
- develop: 0a0e320 `fix(usage): render neutral badge band as dark text on light background` (new pure `badgeTextColor` mirroring band logic; ERR arm now writes text color — old "no write" pin inverted; 427/427)
- main: 5657b63 merge + tag v0.2.0 re-pointed (tag never left the machine; 2d6c2f2 → 5657b63)
- Zip rebuilt from main, re-verified (8 entries, manifest at root)
- Store listing screenshot: b595f39 `docs(store): add 1280x800 listing screenshot generator` — System.Drawing promo (docs/store/screenshot-1280x800.png, 1280x800 exact); assess #5: medium/251 lines/under_budget, no cycle

## Pre-publication audit (2026-10-04, before first GitHub push)
- Secret scan: full main history (133 commits) + tree — 34 distinct token values, ALL self-identifying test fixtures (LTAI5t*/sk-* fakes); zero real secrets
- Gates: 427/427 tests, typecheck clean; npm audit: 0 vulnerabilities; zero runtime deps (dev-only toolchain)
- dist budget: background.js 45.6 KB + popup.js 31.8 KB (unminified by design), icons < 4 KB
- Privacy policy: 770c133 `docs(store): add privacy policy` (PRIVACY.md)
- License: 30e9585 — MIT holder now "The North Code & contributors" (maintainer decision)
- assess #6: medium, 288 lines, review_due=false / under_budget — no cycle
- Pending: push main + tag v0.2.0 ONLY (single refspec; develop/hito-9 stay local) once maintainer provides the GitHub URL; then ls-remote verification (expect exactly refs/heads/main + refs/tags/v0.2.0)
- Push DONE: origin = https://github.com/jsbrb/quotadeck.git — pushed refs/heads/main (ca5f28f) + refs/tags/v0.2.0 (→ 5657b63); ls-remote shows EXACTLY those two refs — develop/hito-9 never left the machine. Privacy policy URL for CWS dashboard: https://github.com/jsbrb/quotadeck/blob/main/PRIVACY.md

## Release landing (2026-10-04)
- R3-1 fix: cb164cf `fix(manifest): require Chrome 110 for badge text color` (manifest + copy.test pin; 424/424 tests)
- develop ← ff-only feature/hito-10 (6316a4f → cb164cf)
- main ← --no-ff develop → merge commit 41f190f `chore(release): v0.2.0 GLM-only Chrome Web Store release` + annotated tag **v0.2.0**
- Deployment artifact built FROM main: extension/quotadeck-v0.2.0.zip verified (8 entries, forward-slash, manifest.json at root)
- Branches deleted (safe -d, all absorbed): hito-1..8 + hito-10. Final: main + develop + feature/hito-9-qwen-console-session (pending, parked at 6b9bede; rebase onto main when qwen work resumes)

## Follow-ups (advisory, post-review — separate later work, never reopens the review)
- R3-1 (WARNING): `setBadgeTextColor` needs Chrome 110+ and the manifest declares no `minimum_chrome_version` — consider adding `"minimum_chrome_version": "110"`
- R3-2 (WARNING): retained qwen plan-probe step + stripped probe host → a stale stored qwen plan credential could dispatch to an unpermitted host every cadence window; inertness unproved
- R3-3 (SUGGESTION): orphaned unshipped credentials (qwen/openai/kimi) persist in chrome.storage.local with no in-product revoke path — consider one-time upgrade cleanup
- R3-4 (SUGGESTION): zip script hardcodes v0.2.0 filename instead of deriving from package version
