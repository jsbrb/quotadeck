# hito-11-popup-restyle — Neo-brutalist popup (branch-only until sign-off)

## Objective
Import the ratified Stitch design system (Neo-Brutalist Developer Instrument) into the quotadeck popup: local fonts, 2-tab nav, LAST KNOWN frozen telemetry, honest copy. Version 0.3.0.

## Constraints (maintainer-ratified 2026-10-04)
- ALL work stays on `feature/hito-11-popup-restyle` (cut from develop ff-synced to main @ 3851e83). NO merge to develop/main until the maintainer visually reviews and explicitly approves. Iterate corrections on-branch.
- No fake features: no LOGS/STATS, ping, burn-rate, cadence selector, encryption claims, raw traces, copy-key, avatars.
- Element ids + data-action hooks byte-identical (controller suite is the guard).
- Fonts: bundle OFL woff2 latin subsets locally; zero remote references (MV3 CSP).

## Tasks
- [x] T0 setup: develop ff-synced to main, branch created — parent, inline
- [x] T1 design refs + openspec docs + this ledger committed (7eda3f0) — parent, inline
- [x] T2 (WU1) fonts: 0fff629 — css2 returned 1 variable woff2/family (sanctioned contingency): space-grotesk 22,288 B + jetbrains-mono 31,432 B, wOF2-verified; build copies dist/fonts
- [x] T3 (WU2) snapshot-store lastKnown: 62e89a0 — store owns merge, background untouched (deviation, justified); 7 named RED→GREEN tests
- [x] T4 (WU3) restyle: 7d94e0b — popup.html DESIGN.md style (0 remote refs verified), view.ts chips/nav/last-known/SVG icons/honest footer; hooks byte-identical (double-proven); 826 insertions (over heuristic, as forecast)
- [x] T5 (WU4) 0.3.0: da53b4f — manifest+package+zip name; POPUP_VERSION↔manifest pin makes desync impossible
- [x] T6 parent spot check DONE (460/460, dist/fonts); RDD: full candidate lens_context_budget_exceeded (no authority created) → split: docs refs 7eda3f0 = passive structural readback (10 files, zero shipped code); code slice base 7eda3f0 = medium/1348 lines/review_due=false (under_budget) → no adversarial review required; consent lineage f7103229 closed at preflight untouched
- [x] T7 maintainer visual review: "me gusta!!!" (2026-10-25) — signed off on branch
- [x] T8 merge: develop ff→4edb000; main --no-ff→3e1de39 'chore(release): v0.3.0' + tag v0.3.0; zip rebuilt from main (10 entries, manifest at root, fonts+icons verified); pushed main+tags to jsbrb/quotadeck; ls-remote = exactly main + v0.2.0 + v0.3.0 (no develop, no pending branches)

## Verification evidence
- typecheck clean; test 460/460 (29 files) — writer + parent spot check identical; build includes dist/icons + dist/fonts
- popup.html: 0 http references (public + dist); rendered-output URL count pinned to exactly 1 (branding link) by test
- pre-existing note: dist/popup.js carries qwen-sites data strings (endpoint names, never fetched — popup has no network path); flagged, out of scope
- release zip quotadeck-v0.3.0.zip: 10 forward-slash entries, manifest.json at root
- store listing screenshot regenerated to the neo-brutalist popup (a099823): docs/store/screenshot-1280x800.png, 1280x800, PS 5.1 ANSI mojibake fixed via runtime [char]0xB7 middle dot; pushed to main

## Review/RDD log
- assess (base 82c6e43, full branch): high (hot_path 'auth' = design-reference filename false positive), 2430 lines → review_due high_risk
- consent granted by maintainer; START failed preflight lens_context_budget_exceeded (immutable evidence never truncated) → retry-safe, no authority
- reduced scope per provider instruction: docs-only commit passive-readbacked; code slice assess medium/1348/under_budget → no cycle required; boundary stays pending in slice
