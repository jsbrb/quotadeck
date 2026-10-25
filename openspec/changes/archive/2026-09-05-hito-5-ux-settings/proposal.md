# Proposal: Popup UX Redesign and Settings Guidance

## Intent

The maintainer rejected the current popup design, and provider settings explain nothing about credentials (recurring Qwen AK/SK confusion). Deliver the ratified "Minimal claro" redesign plus real per-provider settings guidance, with zero data-flow, badge, or dependency changes.

## Scope

### In Scope
- Main view: one card per provider; threshold-colored progress bars for ZAI 5h/weekly windows and MCP (fill from used/ceiling); prominent countdown; consistent error cards
- Settings view restyled in the same language
- Static per-provider English guidance in settings: Qwen (two AK/SK fields; RAM `bss:DescribeAcccount`; DashScope `sk-` keys rejected), OpenAI (admin key, read scope), Kimi (CN/international keys not interchangeable), ZAI (coding-plan key; platform-bound selector)
- Branding: footer credit "Built by The North Code" linking https://www.thenorthcode.es/ in the popup, plus the same attribution in README
- View stays pure string rendering; structure and copy test-pinned

### Out of Scope
- Dark mode, i18n beyond English, options page, badge restyling, new dependencies/frameworks, behavior changes

## Capabilities

### New Capabilities
None — guidance renders inside the existing popup-ui surface.

### Modified Capabilities
- `popup-ui`: §Provider List Rendering changes shape (cards, threshold-colored bars, prominent countdown, error cards); ADDED requirement §Settings Guidance covering the copy above (distinct from validation errors)

## Approach

Markup-only: `view.ts` keeps its `PopupState` input and deterministic string output; `popup.html` inline `<style>` rewritten (CSP-legal, system-ui, subtle shadows). Bar fill caps at 100% visually; numeric percentage stays uncapped (137 stays 137). Threshold bands pinned contiguous — green <70%, amber ≥70%, red ≥90% — ratified direction leaves 50–69% unspecified. MCP fill derives from used/ceiling at render time (presentation only). Guidance ships as exported constants; controller and `data-*` hooks unchanged.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `extension/src/popup/view.ts` | Modified | Card markup, bars, threshold classes, guidance constants |
| `extension/src/popup/view.test.ts` | Modified | Structure, copy, determinism assertions |
| `extension/src/popup/controller.test.ts` | Modified | Only if hooks shift |
| `extension/public/popup.html` | Modified | Inline `<style>` redesign |
| `openspec/changes/hito-5-ux-settings/specs/popup-ui/spec.md` | New | Spec-phase delta: MODIFIED rendering + ADDED guidance |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 50–69% threshold band unspecified | Med | Contiguous bands pinned in spec; flagged to maintainer |
| Tests cannot prove visual quality | High | Pin structural classes; maintainer reviews built popup |
| Markup churn breaks controller tests | Low | Stable hooks/input ids |
| Exceeds 400-line review budget | Med | Tasks phase forecasts; chained PR fallback |

## Rollback Plan

All work sits unmerged on `feature/hito-5-ux-settings` (no remote): view/tests/popup.html only. Roll back by reverting or resetting to the hito-4 base. No storage or provider changes — no migration; main specs untouched until archive.

## Dependencies

None — no new packages; `key-storage`/`provider-framework`/`usage-badge` consumed unmodified.

## Success Criteria

- [ ] View tests (node env) assert per-provider card structure, bar markup with band-correct color class, uncapped percentage text
- [ ] Guidance copy asserted verbatim per provider
- [ ] Branding footer asserted (The North Code + https://www.thenorthcode.es/)
- [ ] Determinism: identical `PopupState` rendered twice → byte-identical output
- [ ] happy-dom controller suite green (view switch, save, revoke, platform selector)
- [ ] test/typecheck/build green (`npm --prefix extension run …`); `package.json` dependencies unchanged
