# Proposal: Popup Restyle — Neo-Brutalist Developer Instrument

## Intent

The current popup reads as generic AI output. The maintainer generated a ratified design language in Google Stitch ("Neo-Brutalist Developer Instrument", see `docs/design/stitch/`) and wants the popup skin imported — visual system only, honest data only. Two cheap cherry-picks from the design are in scope because the data already exists: a real 2-tab footer nav and a LAST KNOWN (frozen) telemetry presentation. No fake features (no LOGS/STATS views, no ping/burn-rate, no cadence selector, no encryption claims, no raw HTTP traces).

## Scope

### In Scope
- Local woff2 fonts: Space Grotesk (500/600/700) + JetBrains Mono (500/600/700), latin subsets, OFL-licensed, bundled under `extension/public/fonts/`; `build.mjs` copies them; `@font-face` in the popup style. No remote fonts (MV3 CSP).
- Design system from `docs/design/stitch/stitch_quotadeck_developer_quota_monitor/neo_brutalist_developer_instrument/DESIGN.md`: warm paper `#FDFDF7`, ink `#18181B` 2px borders, 0px radius, hard `4px 4px 0` offset shadows (cards) / `2px 2px 0` (insets), pressed state `translate(4px,4px)` + zero shadow, uppercase mono chips, segmented progress bars with 25/50/75/90% ticks, threshold bands green <70 / amber 70-89 / red >=90 (unchanged semantics).
- Monitor view + Settings view restyled in `view.ts`/`popup.html`; Material Symbols replaced by inline SVG icons.
- Footer nav: exactly 2 tabs — QUOTAS (monitor) and KEYS (settings) — wired to the existing `open-settings`/`back` actions.
- LAST KNOWN (frozen): `SnapshotStore` persists a per-provider last-successful entry; when the current cycle entry is an error and a last-known exists, the card renders the stale usage dimmed with a `LAST KNOWN · T-<age>` chip. Real data only.
- Honest footer: real version (0.3.0) + "Built by The North Code".
- Version bump 0.3.0 (manifest + package.json).

### Out of Scope
- LOGS/STATS views, ping/latency, burn rate, poll-cadence selector, alert toggles, storage encryption, raw wire traces, copy-key button, user accounts/avatars, dark mode, i18n.
- Badge behavior (colors/thresholds stay as shipped in 0.2.x).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `popup-ui`: visual system + 2-tab nav + last-known rendering; all element ids and `data-action` hooks stay byte-identical.
- `key-storage`/snapshot surface: `SnapshotStore` gains the per-provider last-known map (`qd:snapshot` shape extended additively).

## Approach

Filter-and-translate, never invent: `view.ts` keeps its pure deterministic string rendering over `PopupState`; the state gains an optional `lastKnown` per provider fed by the extended snapshot. Controller hooks (`#key-input-zai`, `#key-add-zai`, `#key-revoke-zai`, `#zai-platform-select`, `data-action="open-settings"|"back"`, `.hero-percentage`) are load-bearing for `controller.test.ts` and stay unchanged. Fonts fetched once via a committed `scripts/fetch-fonts.ps1` (Google Fonts css2 API, UA-gated woff2 URLs) and committed as binary assets for reproducibility.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `extension/public/fonts/` + `extension/scripts/fetch-fonts.ps1` | New | OFL woff2 subsets + reproducible fetcher |
| `extension/build.mjs` | Modified | copy fonts to dist |
| `extension/src/storage/snapshot-store.ts` (+ test) | Modified | per-provider last-known persistence |
| `extension/src/popup/view.ts` (+ test) | Modified | full restyle, nav, last-known cards |
| `extension/public/popup.html` | Modified | @font-face + neo-brutalist style |
| `extension/src/popup/controller.ts` (+ test) | Minimal | state plumbing only if hooks demand it |
| `extension/public/manifest.json`, `extension/package.json` | Modified | 0.3.0 |
| `README.md` | Modified | restyle note, honest footer |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| view.test re-pin drifts from DESIGN.md | Med | structure pins reference DESIGN.md tokens; maintainer visual check on branch before merge |
| controller hooks break during markup rewrite | Low | ids/data-actions frozen; controller suite must pass with minimal edits |
| Font licensing/bloat | Low | OFL fonts, latin subsets only (~150-250 KB) |
| Exceeds 400-line review budget | High | expected: consolidated review at slice budget per RDD |

## Rollback Plan

All work sits on `feature/hito-11-popup-restyle` (no remote). Revert commits or delete the branch; develop/main untouched until the maintainer approves the visual result and explicitly merges.

## Dependencies

None new — fonts are static assets; no npm packages.

## Success Criteria

- [ ] Popup renders the DESIGN.md system with real data at 360px; zero remote references in popup.html/view output
- [ ] All element ids and data-action hooks byte-identical; controller suite green
- [ ] view suite pins new structure + determinism (byte-identical renders)
- [ ] Error card shows LAST KNOWN dimmed with age chip when a stale success exists
- [ ] Footer shows real 0.3.0 + North Code credit; no invented telemetry anywhere
- [ ] typecheck/test/build green; work-unit commits on the branch; NO merge until maintainer sign-off
