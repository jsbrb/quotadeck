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

### Qwen token-plan quota — session-token surface — discovered-live

- Plan identity: the maintainer's international subscription is a **Token Plan (personal,
  Standard tier)** — NOT the Coding Plan commodity API:
  `codingPlan.queryCodingPlanInstanceInfoV2` answers 200 with `codingPlanInstanceInfos: []`
  for every commodity code tried. The quota lives on this token-plan surface, not on the
  BSS balance or the probe.
- Endpoint: `POST https://bailian-singapore-cs.alibabacloud.com/cli/api.json?action=IntlBroadScopeAspnGateway&product=sfm_bailian&api=zeldaHttp.apikeyMgr.%2Ftokenplan%2Fpersonal%2Fapi%2Fv2%2Fusage`
- Auth: `Authorization: Bearer <cliAccessToken>` — a console access token, NOT AK/SK
  signing on the gateway itself. Mint path 1 (live-captured): the vendor CLI's browser
  device-flow. Mint path 2 (headless, live-verified end-to-end 2026-10-25): the AK/SK-signed
  `GenerateCLIAccessToken` on host `modelstudio.ap-southeast-1.aliyuncs.com` — `POST
  /modelstudio/cli/generateAccessToken` with body `{}`, headers `x-acs-action:
  GenerateCLIAccessToken` + `x-acs-version: 2026-02-10`, ACS3-HMAC-SHA256 signing. The
  response carries `cliAccessToken` TOP LEVEL AND ONLY ON SUCCESS (failure answers
  top-level `Code`/`Message`; the raw failure body is never echoed) — the token value
  is never stored or logged. The
  cn-beijing twin `modelstudio.cn-beijing.aliyuncs.com` is NOT live-verified and is NOT
  allowlisted.
- Required authorizations (user-facing setup, both mandatory): (1) a RAM custom policy
  allowing action `modelstudio:GenerateCLIAccessToken` — the system policy
  `AliyunModelStudioReadOnlyAccess` does NOT include it (Generate is classified write);
  (2) Model Studio WORKSPACE membership for the RAM user (console
  Settings→Permissions→Add User, Administrator role) — without it the quota gateway
  answers `BailianGateway.Team.NotAuthorised` even with a valid token.
- Mint gotcha (ACS3 canonicalization): the canonical sections are joined with `\n` while
  the canonical-headers block itself ends with a trailing newline — producing a BLANK LINE
  before the `SignedHeaders` section; a missing or extra newline there yields
  `SignatureDoesNotMatch`.
- End-to-end PASS (headless chain): mint → gateway usage call → live
  `{ "per1MonthPercentage": 0.1250, "per1MonthResetTime": 1793721600000 }` — the
  minted token authenticated the call directly with the static, account-neutral body.
- Request body (form-urlencoded): `params=<JSON>&region=ap-southeast-1`, where the JSON is
  `{"Api":"zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage","V":"1.0","Data":{"cornerstoneParam":{"protocol":"V2","console":"ONE_CONSOLE","productCode":"p_efm","switchUserType":3,"consoleSite":"BAILIAN_ALIYUN"}}}`.
  `switchAgent` is omitted entirely (live probe: omitted = SUCCESS,
  `switchAgent: 0` = `BailianGateway.Workspace.NotAuthorised`) — the body is static,
  no account identifiers.
- Response semantics (COMPLETE surface — exactly two fields):
  `{ "per1MonthPercentage": 0.1172, "per1MonthResetTime": 1793721600000 }`.
  - `per1MonthPercentage` is a **0..1 USED fraction** — NOT remaining (live cross-check:
    console showed "Remaining 88.4%" at ≈11.7% used). The 0..1 fraction must map to the
    0-100 window convention at the parse level; the passthrough philosophy stays uncapped —
    no percentage, used, or total is ever synthesized beyond what the fields carry.
  - `per1MonthResetTime` is epoch milliseconds carried **verbatim** as the reset instant
    (the countdown renders from it at display time).
  - There is NO used/total token count on this surface — the console's "Plan quota 45,000"
    comes from a different subscription API, and no total is inferred from it. Values moved
    between two live calls: near-real-time freshness.
- Gateway matrix (reference only, from vendor CLI source): regions `cn-beijing` and
  `ap-southeast-1`; international gateways `bailian-cs.console.alibabacloud.com`
  (cn-beijing) and `bailian-singapore-cs.alibabacloud.com` (ap-southeast-1, action
  `IntlBroadScopeAspnGateway`). Only the live-captured ap-southeast-1 gateway is
  allowlisted; the china site carries NO live-verified quota surface, so the request
  builders answer null for it (hito-12 C1) — never a guessed cn host in dispatch.
- Verification status: honestly **community** — no official documentation exists for the
  endpoint; the evidence is the vendor's own CLI source (`bailian-cli` 2.5.1 on npm) plus
  maintainer live captures (2026-10-25, international account). The allowlist entry-level
  `verification: official` describes the BSS hosts; this subsection carries the quota
  surface's weaker evidence class.
- Sources: `bailian-cli` 2.5.1 (npm) for the request shape and gateway matrix; maintainer
  live captures cross-checked against the console quota page for the response values;
  `scripts/spike-token-mint.ps1` for the headless AK/SK token-mint probe (2026-10-25).

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
      "token-plan.ap-southeast-1.maas.aliyuncs.com",
      "bailian-singapore-cs.alibabacloud.com",
      "modelstudio.ap-southeast-1.aliyuncs.com"
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
