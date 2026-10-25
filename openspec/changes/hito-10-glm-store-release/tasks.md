# Tasks: hito-10-glm-store-release

## 1. Badge alerting (usage-badge delta)

- [x] 1.1 Pure `badgeBackgroundColor(percentage)` in `core/usage.ts` with pinned boundaries (undefined/<50 neutral `#334155`; ≥50 `#F97316`; ≥80 `#EA580C`; ≥90 and uncapped >100 `#DC2626`) — usage.test.ts boundary suite (49/50/79/80/89/90/100/137/undefined) green
- [x] 1.2 `BrowserApi`/`ChromeBrowserApi`/`FakeBrowser` gain `setBadgeBackgroundColor` + `setBadgeTextColor` (call-recording) — FakeAction records badgeBackgrounds/badgeTextColors; @types/chrome promise overloads verified
- [x] 1.3 `refreshTick` sets badge background + white text on success; neutral background with `ERR` on failure; wiring tests pin the recorded calls — background.test.ts Badge Color Wiring suite green (32→neutral, 137→red, ERR→neutral, no text-color on error)

## 2. GLM-only shipping (provider-framework delta)

- [x] 2.1 `SHIPPED_PROVIDER_IDS = ['zai']` exported from `core/provider-metadata.ts` — pinned by provider-metadata.test.ts (ships-exactly-zai + subset tests)
- [x] 2.2 `createDefaultRegistry` registers only shipped ids (pinned order preserved) — index.test.ts pins `['zai']` + unshipped-id rejection; engine.test.ts rewired to explicit provider classes (mechanical, coverage unchanged)
- [x] 2.3 Popup provider list composed from the shipped subset; qwen/openai/kimi code retained unshipped; pins updated — controller zai-only DOM pins green; undrivable qwen/openai/kimi DOM flows removed (view-level coverage retained in view.test.ts); background retained-code integration rebuilt on explicit registries

## 3. Manifest scoping (network-allowlist delta)

- [x] 3.1 `host_permissions` equals filtered allowlist union (zai entry hosts only) — manifest carries `https://api.z.ai/*` + `https://open.bigmodel.cn/*` (verified against PROVIDER_ALLOWLIST.zai)
- [x] 3.2 `manifest.hosts.test.ts` derives from shipped-filtered union and re-pins exact patterns; full allowlist + `docs/spike/endpoints.md` untouched — RED (2 fails vs 7-host manifest) → GREEN observed

## 4. Store packaging

- [x] 4.1 `make-icons.ps1` generates `public/icons/icon{16,32,48,128}.png` (indigo `#4F46E5`, white "Q"); PNGs committed — dimensions verified 16/32/48/128 after generation
- [x] 4.2 Manifest `icons` + `action.default_icon`; description ≤132 chars English; version 0.2.0 (manifest + package.json) — description measured 116 chars; copy.test.ts description pin re-pinned verbatim (authorized)
- [x] 4.3 `build.mjs` copies icons to `dist/`; `zip` script produces `quotadeck-v0.2.0.zip` with `manifest.json` at root; zip artifact gitignored — zip via .NET ZipArchive with forward-slash entries (8 entries verified: manifest at root, icons/iconNN.png), Compress-Archive backslash hazard removed

## 5. Verification & docs

- [x] 5.1 Gates green: `npm --prefix extension run typecheck` / `test` / `build` — observed after every work unit and in the final round (423/423 tests)
- [x] 5.2 README GLM-only posture, shipped hosts, badge thresholds, zip usage — status v0.2.0 GLM-only, "exactly the two shipped hosts" + filtered-allowlist derivation, 50/80/90 + neutral badge colors with white text, zip usage with PowerShell note; copy.test.ts README pins kept green (authorized re-pin of the host-count phrase)
- [ ] 5.3 Unpacked smoke in Chrome (maintainer) — badge color visible on live data
- [ ] 5.4 CWS dashboard: upload zip, Store Listing, Privacy (auth info, zai hosts), Distribution public — maintainer-driven

## Workload forecast

≈ 350–450 authored lines across src/tests/manifest/build/docs, within the single-slice budget; chained-PR fallback not expected.
