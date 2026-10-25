# Changelog

All notable changes to quotadeck are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.0] - 2026-10-25

### Added

- Qwen Token Plan quota monitoring: a two-hop AK/SK → session-token flow
  against the live gateway, surfacing the quota percentage and the monthly
  reset window.
- Badge provider preference: a **Badge provider** dropdown in Settings and
  click-to-choose on either card's hero percentage, with a chip marker
  identifying the provider the toolbar badge currently renders.
- Live contract publish-gate (`scripts/live-contract.ps1`): runs the real
  builder → signer → allowlist client → transport → parser pipeline against
  the live Qwen endpoints; its opt-in test skips silently in the hermetic
  suite.
- DeclarativeNetRequest session-origin rule for gateway WAF compatibility.

### Changed

- The Qwen card became a twin of the Z.ai monitor card: hero percentage plus
  threshold progress bar.
- Qwen dispatch is quota-only: the BSS account-balance dispatch is suspended.
- The reset countdown renders days for windows longer than 24 hours.
- The Qwen settings form is stacked for readability.

### Notes

- Qwen quota users need a RAM custom policy allowing the
  `modelstudio:GenerateCLIAccessToken` action and Model Studio workspace
  membership (documented in `README.md` and `docs/spike/endpoints.md`).

## [0.3.0] - 2026-10-25

### Added

- Neo-brutalist popup redesign on the ratified design system (Space Grotesk
  and JetBrains Mono), with local OFL woff2 font subsets bundled in the
  extension.
- Last-known usage is persisted per provider: a failed refresh shows the
  provider's most recent successful snapshot dimmed under a `T-<age>` chip.

### Notes

- Chrome Web Store listing screenshots were regenerated for the restyled
  popup.

## [0.2.0] - 2026-10-04

### Added

- First public Chrome Web Store release: GLM-only build (Z.ai provider).
- Threshold-colored badge alerting.
- Extension icons and the dist zip packaging tooling.
