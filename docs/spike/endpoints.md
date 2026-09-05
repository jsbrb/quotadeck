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

## ZAI (Zhipu AI Open Platform) — `bigmodel.cn` — verified-community

- Endpoint: `GET https://bigmodel.cn/api/finance/expenseBill/expenseBillList?billingMonth=YYYY-MM&pageNum=N&pageSize=N`
- Auth: Bearer token in `Authorization` header.
- Success condition: **numeric** `code` 200 only. A string `"200"` in the `code` field
  is a failure — parsing must reject it.
- Pagination: driven by the `total` record count; collect pages until `total` records
  are gathered. Community-documented politeness window: **500–2000 ms delay between
  consecutive pages** (randomized).
- Dedupe: records are deduplicated by `billingNo` (repeats across pages count once).
- Cost math: per record `cost = costPrice / 1000 * deductUsage`; page cost is the sum.
- Tier: label comes from `tokenResourceName`. **Tier limits are NOT exposed by this
  API** — quota ceilings cannot be derived from this endpoint.
- Domain: domestic platform `bigmodel.cn`. The international variant `api.z.ai` is
  **unverified** and is deliberately excluded from the allowlist in this milestone.
- Source: community project `pxvp2008/areYouOk` (MIT license) — endpoint behavior
  verified against that implementation.

## Qwen (Alibaba Cloud BSS) — `business.aliyuncs.com` — verified-official

- Endpoint: Alibaba Cloud BSS OpenAPI `QueryAccountBalance`, API version `2017-12-14`,
  host `business.aliyuncs.com`.
- Auth: Alibaba Cloud AccessKeyId/AccessKeySecret (AK/SK) with RAM permission
  `bss:DescribeAcccount`. **DashScope `sk-` keys do NOT work** against BSS — rejected
  by the credential validator with AK/SK guidance.
- Balance: `Data.AvailableAmount`; currency: `Data.Currency`.
- Coding Plan quota: **no clean API** — the console path relies on cookie + CSRF
  session auth, which cannot be modeled with stored API credentials. Out of scope for
  this milestone (blocked).
- Source: official Alibaba Cloud BSS OpenAPI documentation.

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
    "hosts": ["bigmodel.cn"],
    "verification": "community"
  },
  "qwen": {
    "hosts": ["business.aliyuncs.com"],
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
