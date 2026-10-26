# Changelog

All notable changes to quotadeck are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.5.0] - 2026-10-25

### Added

- DeepSeek provider (pay-as-you-go wallet): the balance endpoint is the
  only account surface, so consumption is derived — wallet total =
  topped-up + granted credits, consumed = total − remaining, percentage
  uncapped and honestly omitted at a zero total.
- DeepSeek twin card: the consumed percentage renders as the card hero
  and inside its threshold bar, with a `Wallet: $X of $Y used` line —
  no reset countdowns exist on a pre-paid wallet.
- DeepSeek badge: the chosen-provider badge renders the wallet
  percentage through the same threshold bands as ZAI/Qwen.
- Live contract publish-gate DeepSeek leg: the real bearer → allowlist
  client → fetch → parse pipeline runs against the live balance
  endpoint under `QUOTADECK_LIVE=1` + `DEEPSEEK_LIVE_KEY`.

### Changed

- Shipped surface grows to three providers and eight hosts
  (`api.deepseek.com` joins the allowlist, manifest and endpoints
  evidence). Badge description and store copy now name all three
  providers.

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
