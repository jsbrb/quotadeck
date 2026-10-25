# Proposal: Hito 4 — ZAI Monitor Endpoints

## Intent

Hito-3's ZAI `expenseBillList` integration targets the wrong surface — live probes returned `total: 0` during active GLM Coding Plan usage (hito-3 archive). Hito 4 delivers the mandatory requirement (plan level, 5h percentage, reset countdown) via the official `GET /api/monitor/usage/quota/limit`.

## Scope

### In Scope

- ZAI provider rewrite: monitor `quota/limit` as THE ZAI source — `level`→plan; 5h + weekly windows (`TOKENS_LIMIT` discriminators; positional fallback); monthly MCP (`TIME_LIMIT`); API-provided `percentage`/`total`/`nextResetTime`; used derived client-side.
- Raw auth: `Authorization: <raw key>` (Bearer fails) + `Accept-Language`; per-credential strategy (bearer / openai-admin / raw).
- Allowlist: add `api.z.ai`, `open.bigmodel.cn`; drop apex `bigmodel.cn`; manifest union sync.
- ZAI platform selector (Z.AI ↔ ZHIPU; keys platform-bound), stored locally, default Z.AI.
- Popup ZAI block: level; 5h %/used/total + countdown; weekly; MCP.
- Remove expenseBillList provider + fixtures, tier-budget, limit-store, `tierLimits` wiring.

### Out of Scope

- 24h `model-usage`/`tool-usage` — deferred: `quota/limit` serves the mandatory data; extras add params + surface.
- Auth-failure backoff — 1-minute alarm already bounds retries; no documented rate limits.
- `dev.bigmodel.cn` mirror, UX redesign, Qwen info text, Android, chat surfaces, reset cards.

## Capabilities

### New Capabilities

- `zai-monitor`: `quota/limit` parsing — windows, level, used derivation, countdown, platform binding, raw auth, plain-text errors.

### Modified Capabilities

- `provider-framework`: expenseBillList parsing → monitor parsing; credential/attach types extended.
- `network-allowlist`: hosts updated; Unverified Variant Excluded removed (triple-source verified); raw mode sanctioned.
- `usage-badge`: ZAI badge = 5h percentage; >100% uncapped.
- `popup-ui`: ZAI budget block; platform selector in settings gear.
- `key-storage`: non-secret ZAI platform preference, local-only.

### Removed Capabilities

- `tier-budget`: all 7 requirements; API provides percentages directly. (Migration: archive retains text for pay-as-you-go revival.)

## Approach

Single-shot GET via the existing client (raw attach added; `ProviderRequest` stays header-less); monitor windows replace `BudgetReport`; fixtures: pro plan, null pct, >100%, MCP-only, fallback, plain-text 401.

## Affected Areas

| Area | Impact | Change |
|------|--------|--------|
| `providers/zai.ts` + test, `fixtures/zai/` | Rewritten | monitor parsing; billing fixtures out |
| `core/tier-budget.ts`, `storage/limit-store.ts` + tests, `background.ts` wiring | Removed | superseded |
| `core/usage.ts`, `core/provider.ts` | Modified | windows; credential types; tierLimits dropped |
| `network/` + `manifest.json` + `docs/spike/endpoints.md` | Modified | raw mode; hosts; union; spike |
| `popup/` | Modified | ZAI block; selector |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Semantics drift (community-verified) | Med | Positional fallback; fixture-driven parser |
| Plain-text 401/403 bodies | Med | Classify by status before body parse |
| >400 review lines (deletions count) | High | Chained-PR forecast at tasks phase |
| Wrong-platform key | Med | Selector guidance; auth-classified error |

## Rollback Plan

Branch-only: hard-reset to hito-3 head `6c537be` (clean tree, no remote, nothing merged); main specs change only at archive; post-archive: revert sync commit.

## Dependencies

- Maintainer GLM Coding Plan key (Z.AI) for live E2E; evidence: `zai-org/zai-coding-plugins`, `ecerutti/glm-usage-monitor`, `guyinwonder168/opencode-glm-quota`.

## Success Criteria

- [ ] Suite green incl. monitor fixtures; contract test asserts raw `Authorization` (no Bearer) to `api.z.ai`; allowlist + manifest union green; typecheck/build exit 0.
- [ ] Selector persists, switches base URL; superseded code absent.
- [ ] Maintainer live E2E: real plan level; real 5h percentage in one tick.
