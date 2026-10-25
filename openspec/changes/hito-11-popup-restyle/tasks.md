# Tasks: hito-11-popup-restyle

## 1. Fonts (local, OFL)

- [x] 1.1 `extension/scripts/fetch-fonts.ps1`: css2 API fetch (modern UA) for Space Grotesk 500/600/700 + JetBrains Mono 500/600/700 latin woff2 → `extension/public/fonts/`; script + woff2 committed
  - Evidence (2026-10-25): script run with Chrome/126 UA; css2 served ONE variable file per family (same URL across weights 500/600/700) — deduped per the task contingency to `space-grotesk-latin.woff2` (22,288 B) + `jetbrains-mono-latin.woff2` (31,432 B), both wOF2-magic-verified. @font-face will declare `font-weight: 500 700`.
- [x] 1.2 `build.mjs` copies `public/fonts` → `dist/fonts`; dist verified
  - Evidence: `npm --prefix extension run build` → `dist/fonts/` lists exactly the two woff2 files; typecheck + 427 tests green.

## 2. Last-known persistence (snapshot surface)

- [x] 2.1 `SnapshotStore`: per-provider last-known successful entry persisted additively in `qd:snapshot`; RED→GREEN unit tests (stale entry survives a later error tick; untouched on provider absence)
  - Evidence (2026-10-25): RED — 7 named lastKnown tests failed pre-implementation (survival/update/ownership/validation). GREEN — `CycleSnapshot.lastKnown?` (ok-arm only) merged inside `write` (previous map carried, ok entries overwrite, error arms never touch, empty map omitted → all-error cycles store exactly `{ results }`); strict read validation; `background.ts` needed no change (single `qd:snapshot` set per cycle preserved); controller seed helper switched to raw area write so re-read-count pins stay popup-attributed. 436/436 green.

## 3. Restyle (popup-ui)

- [x] 3.1 `popup.html`: @font-face + neo-brutalist style per DESIGN.md (paper/ink palette, 2px borders, 0 radius, hard offset shadows, pressed translate, segmented bars with ticks); CSP-legal (no remote URLs, no inline script)
  - Evidence (2026-10-25): full <style> rewrite — `#fdfdf7`/`#18181b`/`#fde047` tokens, `2px solid`, `border-radius: 0`, `4px 4px 0` cards / `2px 2px 0` insets, `translate(4px, 4px)` pressed, 360px canvas, local `url('fonts/*.woff2')` @font-face with `font-weight: 500 700` variable ranges + system fallbacks, `.bar-ticks` notch gradient at calc(25/50/75/90% - 2px). Pinned by the `popup.html — neo-brutalist design system` suite (incl. zero `https?://` in the file).
- [x] 3.2 `view.ts`: monitor + settings markup restyled; inline SVG icons (no Material Symbols); footer nav QUOTAS/KEYS wired to existing open-settings/back hooks; LAST KNOWN dimmed card with `T-<age>` chip; honest footer (v0.3.0 + Built by The North Code); all ids/data-actions byte-identical
  - Evidence (2026-10-25): real `PLAN · <level>` header chip (live ZAI ok entry only — fake LIVE badge never ships); `card-error` AUTH-FAILED treatment keeps the real class labels + guidance; `lastKnown` renders dimmed frozen usage under `LAST KNOWN · T-<age>` via `formatKnownAge(nowMs, fetchedAt)` — never Date.now(); segmented `.bar-ticks` in every bar; hero carries its threshold band class; 2-tab `.tabbar` (QUOTAS/KEYS) on the existing data-actions; 10 inline SVG icons; footer version constant pinned to the manifest by test (v0.2.0 until the 4.1 bump, then v0.3.0 — honest at every commit).
- [x] 3.3 `view.test.ts` re-pinned to new structure/copy/determinism; `controller.test.ts` green with minimal edits (hooks unchanged)
  - Evidence (2026-10-25): bar/hero/footer/error-card exact pins updated to new markup; new suites: PLAN chip, 2-tab nav, bar ticks, formatKnownAge, LAST KNOWN card, honesty pins (no LIVE/PING/burn/AES/encrypt/cadence/latency/LOGS/STATS), zero-remote-rendered-output, popup.html design tokens. `controller.test.ts` UNCHANGED in WU3 — every hook (`#key-input-zai`, `#key-add-zai`, `#key-revoke-zai`, `#zai-platform-select`, `data-action` open-settings/back/refresh, `section.provider`, `.hero-percentage`, `form.key-form`) still byte-identical; 459/459 + typecheck + build green.

## 4. Release metadata + docs

- [x] 4.1 manifest + package.json → 0.3.0; README restyle note + honest version; copy.test pins kept green
  - Evidence (2026-10-25): RED — bumping `manifest.json` alone failed the `POPUP_VERSION stays pinned to the manifest version` view test as designed; GREEN — `view.ts POPUP_VERSION='v0.3.0'` + `package.json` (incl. zip name) + README status/restyle paragraph (design system, local OFL woff2 fonts, LAST KNOWN card, no-invented-surfaces note) + new copy.test restyle pin. All pre-existing copy.test pins (two shipped hosts, ZHIPU, api.z.ai, open.bigmodel.cn, raw-auth, description) green.
- [x] 4.2 Gates: typecheck / test / build green on the branch
  - Evidence (2026-10-25): `tsc --noEmit` clean; `vitest run` 460/460 (29 files); `node build.mjs` emits background.js + popup.js + manifest.json + popup.html + icons/ + fonts/ (2 woff2). Remote-ref audit on shipped dist: popup.html 0 `http` hits; popup.js rendered-output URLs = branding footer only (bundle data strings from core/qwen-sites are pre-existing 0.2.0 content, never fetched — popup has no network path).

## 5. Maintainer review (blocking for merge)

- [x] 5.1 Maintainer loads unpacked from the branch dist, reviews the new popup with live data, requests corrections (iterate on-branch)
- [x] 5.2 Only after explicit sign-off: merge to develop (then main/tag/zip as a separate decision)

## Workload forecast

~500-700 authored lines (view.ts + tests dominate) — expect the consolidated RDD review at slice budget.
