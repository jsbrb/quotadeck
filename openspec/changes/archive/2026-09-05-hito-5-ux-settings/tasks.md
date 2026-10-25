# Tasks: Popup UX Redesign and Settings Guidance

## Review Workload Forecast

Estimated: ~350–420 changed lines (view.ts +75, view.test.ts +190, popup.html ~110 rewritten, README +4). Delivery strategy: ask-on-risk; single PR, split only if apply exceeds 400.

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Bars, cards, guidance, footer, styles | PR 1 | `npm --prefix extension run test -- src/popup/view.test.ts` | `npm --prefix extension run build`, load `extension/dist` unpacked — maintainer visual check | Revert touched files to hito-4 base |

Markup contract: keep pinned lines, ids and `data-*` hooks (`controller.test.ts`); countdown = `<span class="countdown">` inside the 5h line; fills use `style="width:N%"` (manifest sets no CSP).

## Phase 1: Bars and Bands (Threshold bands; Fill capped, text uncapped; MCP bar)

- [x] 1.1 RED `extension/src/popup/view.test.ts`: bands 55→green, 70→amber, 90→red, 137→red (rounded percentage); 137 → fill width 100% + text `137%`
- [x] 1.2 GREEN `extension/src/popup/view.ts`: band helper + bar (`band-green|band-amber|band-red`, fill `min(round(pct),100)`) after percentage-bearing lines only
- [x] 1.3 RED: MCP 0/1000 → width 0%; 54/60 → 90% amber; no `%` text node (strip tags — width is an attribute)
- [x] 1.4 GREEN: MCP bar from `used/ceiling`; `MCP: 3 / 60` line unchanged

## Phase 2: Cards, Countdown, Errors (Usage and tier; Per-provider error state; ZAI budget block; Deterministic rendering)

- [x] 2.1 RED: `section.provider.card` per provider; Qwen-only failure renders its error card in the same wrapper (structurally consistent)
- [x] 2.2 GREEN: card class in `providerMainSection`; error path keeps wrapper + per-class label
- [x] 2.3 RED: ZAI block: level, uncapped `137%` + used/total, `<span class="countdown">` in 5h line, weekly bar, MCP per-tool rows
- [x] 2.4 GREEN: countdown span in `windowLine`; combined textContent byte-preserved
- [x] 2.5 Extend determinism test: bars+guidance+footer state rendered twice → strictEqual both views

## Phase 3: Guidance + Footer (Guidance precedes inputs; Verbatim copy; Guidance distinct from errors; Footer on both views)

- [x] 3.1 RED: import `SETTINGS_GUIDANCE`; each provider's copy asserted verbatim per spec table
- [x] 3.2 GREEN: export static `SETTINGS_GUIDANCE` keyed by ProviderId in `view.ts`
- [x] 3.3 RED: guidance before `form.key-form` with/without stored keys (qwen, openai); kimi invalid-key: guidance and `role="alert"` validation separate
- [x] 3.4 GREEN: `p.settings-guidance` after masked lines, before the form — always rendered, key-independent
- [x] 3.5 RED: both renderers end with footer: `Built by` + anchor `https://www.thenorthcode.es/` (`The North Code`); identical across renders
- [x] 3.6 GREEN: shared footer markup in `renderMain`/`renderSettings`

## Phase 4: popup.html Minimal Claro Rewrite

- [x] 4.1 Rewrite inline `<style>` in `extension/public/popup.html`: cards (radius, subtle shadow, spacing), `band-*` colors, prominent `.countdown`, footer, settings restyle; system-ui; CSP-legal

## Phase 5: Verification + Docs

- [x] 5.1 Suite green with `extension/src/popup/controller.test.ts` untouched (git diff empty); `npm --prefix extension run typecheck`; `npm --prefix extension run build`
- [x] 5.2 `README.md`: "Built by The North Code" attribution linking https://www.thenorthcode.es/
