# Provider Endpoint Spike (Hito 1)

Per-provider endpoint evidence gathered for the fixture-only Hito 1 milestone. Each
section records the endpoint, credential shape, response parsing rules, quirks, and a
verification status. The fenced `json` block at the bottom is the **machine-readable
domain allowlist — the single source of truth** for the network layer
(AD-4): `extension/src/network/allowlist.ts` holds a typed copy, and
`extension/src/network/allowlist.source.test.ts` fails the build on any drift between
the two.

Verification levels:

- `official` — verified against official vendor API documentation.
- `community` — verified against a community implementation (source cited); no official
  documentation exists for the endpoint.

## ZAI (Z.AI / Zhipu AI Open Platform) — `api.z.ai` + `open.bigmodel.cn` — verified-community

- Endpoint: `GET /api/monitor/usage/quota/limit` — single shot: no pagination, no request
  body, no query parameters.
- Auth: the stored key verbatim in `Authorization` (NO `Bearer` prefix) plus an
  `Accept-Language` header (value pinned `zh-CN`; presence is the contract, the value only
  drives localization).
- Platform binding: a ZAI credential targets exactly one platform — Z.AI (`api.z.ai`, the
  default) or ZHIPU (`open.bigmodel.cn`). The selected platform determines the base URL of
  EVERY monitor request, and keys are platform-bound: a key issued on one platform does not
  authenticate against the other, so an auth failure on the selected platform surfaces
  wrong-platform guidance rather than only a generic auth error.
- Response semantics — success is a **numeric** `code` 200 only; a string `"200"` in the
  `code` field is a failure (parsing must reject it):
  - `data.level` — the plan level (e.g. `Pro`).
  - `data.tokenLimits` entries of type `TOKENS_LIMIT`: the entry with `unit` 3 / `number` 5
    is the 5-hour window; `unit` 6 / `number` 1 is the weekly window. Entries omitting the
    discriminators fall back to position: `tokenLimits[0]` → 5h, `tokenLimits[1]` → weekly.
  - The `TIME_LIMIT` entry is the monthly MCP window: `currentValue` (used), `usage`
    (ceiling), `usageDetails` (per-tool map). MCP carries no `nextResetTime`, and no
    percentage or countdown is synthesized for it.
  - Per window: `percentage` passes through **uncapped** (137 stays 137); `null`/absent
    percentage reports no percentage and no derived used; when percentage and `total` are
    both present, used is derived client-side as `round(total × percentage / 100)`;
    `nextResetTime` is epoch milliseconds carried verbatim as the reset instant (the
    countdown renders from it at display time).
  - Errors: 401/403 bodies are plain text — classification is status-first (HTTP status
    before any body parse), so a plain-text error body can never cause a parse failure.
- Removed surface: the legacy `bigmodel.cn/api/finance/expenseBill/expenseBillList` billing
  pagination is dead. The apex `bigmodel.cn` host grant retired with it — a permission
  grant with no caller violates least privilege.
- Verification status: honestly **community** — no official documentation page exists for
  the endpoint; one of the three sources is the vendor org's own repository, which is
  strong evidence but still community under this doc's taxonomy.
- Sources (triple, community-verified incl. the official org repo):
  `zai-org/zai-coding-plugins` (the vendor org's own plugin), `ecerutti/glm-usage-monitor`,
  `guyinwonder168/opencode-glm-quota`.

## Qwen (Alibaba Cloud BSS) — `business.aliyuncs.com` + `business.ap-southeast-1.aliyuncs.com` — verified-official

- Endpoint: Alibaba Cloud BSS OpenAPI `QueryAccountBalance`, API version `2017-12-14`,
  on the SITE-SELECTED host: `business.ap-southeast-1.aliyuncs.com` for the
  international site (the DEFAULT) and `business.aliyuncs.com` for the china site.
  Live evidence (maintainer, international account): the china host answers
  HTTP 400 `AuthSiteFail` for international credentials; the ap-southeast-1 host
  answers 200.
- Auth: Alibaba Cloud AccessKeyId/AccessKeySecret (AK/SK) with RAM permission
  `bss:DescribeAccount`. **DashScope `sk-` keys do NOT work** against BSS — rejected
  by the credential validator with AK/SK guidance.
- Balance: `Data.AvailableAmount`; currency: `Data.Currency`. The envelope differs
  per site: china serializes NUMERIC `Code` 200 and numeric amounts; international
  serializes STRING `Code` `"200"`, bool `Success`, and decimal STRING amounts —
  parsing tolerates both forms and normalizes amounts to numbers.
- Coding Plan quota: no percentage/total on any key surface — only the binary
  probe below. RPC-signing credentials are sanctioned on the TWO BSS hosts ONLY
  (never the probe host).
- Source: official Alibaba Cloud BSS OpenAPI documentation plus maintainer live
  captures on both sites (2026-09).

### Qwen token-plan probe — `token-plan.ap-southeast-1.maas.aliyuncs.com` — verified-community

- Endpoint: `POST /compatible-mode/v1/chat/completions` with body
  `{ "model": "qwen3.6-flash", "messages": [{ "role": "user", "content": "hi" }], "max_tokens": 1, "stream": false }`.
- Auth: the token-plan inference key (`sk-sp-`) EXCLUSIVELY as
  `Authorization: Bearer <key>` — never in the URL, query, or body. Each probe
  costs one 1-token request; the extension caches outcomes (120 min available,
  15 min exhausted/key-rejected).
- Outcome mapping (status-first): 200 → plan available; 429 → exhausted with the
  reset instant parsed from the surfaced error text (`reset at MM-DD HH:MM:SS UTC`,
  year derived from the clock; past-derived instants roll to the next year);
  401/403 → key rejected. No percentage or total exists on any surface — none is
  synthesized.
- Verification status: honestly **community** — the endpoint shape follows the
  officially documented DashScope-compatible API, but the token-plan host itself
  is community/maintainer-evidenced only; the allowlist entry-level
  `verification: official` describes the BSS hosts, this subsection carries the
  probe's weaker evidence class.
- Source: community evidence on the Qwen token-plan (coding-plan) service,
  maintainer-ratified 2026-09.

## OpenAI — `api.openai.com` — verified-official

- Endpoint: `GET https://api.openai.com/v1/organization/costs`.
- Auth: Admin key (`sk-admin-...`) with **read** scope.
- Request constraints: `start_time` is **required**; `bucket_width` fixed at `1d` for
  this use case; cursor pagination via `next_page` until absent.
- Response: cost rows in `results[]` with `amount.value` / `amount.currency`; line
  items bucket by `model` and `usage_type`; total is the sum of `amount.value`.
- Source: official OpenAI API documentation.

## Kimi (Moonshot AI) — `api.moonshot.cn` — verified-official

- Endpoint: `GET https://api.moonshot.cn/v1/users/me/balance`.
- Auth: Bearer token in `Authorization` header.
- Balance: `data.available_balance`, denominated **CNY**; documented composition is
  cash balance + voucher balance.
- Quirk: China (`api.moonshot.cn`) and international platform keys are **NOT
  interchangeable** — a key issued on one platform does not authenticate against the
  other.
- Source: official Moonshot AI platform documentation.

## Machine-readable allowlist (single source of truth — AD-4)

Shape: `{ providerId: { hosts: string[], verification: "official" | "community" } }`.
Host matching is suffix-based (`host === pattern || host.endsWith("." + pattern)`,
AD-5), scoped per provider. This block must stay structurally identical to
`PROVIDER_ALLOWLIST` in `extension/src/network/allowlist.ts`.

```json
{
  "zai": {
    "hosts": ["api.z.ai", "open.bigmodel.cn"],
    "verification": "community"
  },
  "qwen": {
    "hosts": [
      "business.aliyuncs.com",
      "business.ap-southeast-1.aliyuncs.com",
      "token-plan.ap-southeast-1.maas.aliyuncs.com"
    ],
    "verification": "official"
  },
  "openai": {
    "hosts": ["api.openai.com"],
    "verification": "official"
  },
  "kimi": {
    "hosts": ["api.moonshot.cn"],
    "verification": "official"
  }
}
```
