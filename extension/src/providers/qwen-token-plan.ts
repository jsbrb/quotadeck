// Qwen token-plan quota parse (hito-12; evidence: docs/spike/endpoints.md
// §Qwen token-plan quota — session-token surface — discovered-live, the
// 2026-10-25 maintainer live capture).
//
// PURE module — no fetch, no storage. The parse stays token-free. The WU-C1
// builders only SHAPE requests: hop 1 carries no credential (the client's
// acs3 seam signs it from the stored pair); hop 2 receives the ALREADY-MINTED
// transient console token and passes it strictly through the session marker —
// the value is never logged, never placed in url/query/body, never persisted.
// Dispatch belongs to the background composition.
//
// Envelope validation is STATUS-FIRST, pinned by the REAL live usage capture
// of 2026-10-25 (docs/spike/endpoints.md §Qwen token-plan quota): the payload
// lives at `data.DataV2.data.data`, and success requires the gateway `code`
// to be 200 or "200" (the per-site tolerance qwen.ts applies to BSS
// envelopes) AND `data.success === true` AND `data.DataV2` present AND the
// inner `data.DataV2.data.success === true`. This surface carries NO inner
// `failed` field — the earlier `failed: false` capture belonged to the
// coding-plan commodity API, a DIFFERENT surface — so a PRESENT `failed`
// must be false (defensive) while an absent one is accepted. A live
// body-level failure answers INSIDE HTTP 200 as data.success:false +
// errorCode with NO DataV2 (the recorded --failed-envelope fixture). Any
// non-success throws ProviderApiError (classifies as `server` per AD-21); a
// successful envelope with a missing or garbage payload answers with honest
// absent fields, never a crash.
//
// Semantics (COMPLETE surface — exactly two fields): `per1MonthPercentage` is
// a 0..1 USED fraction mapped to the 0-100 window convention (× 100) and
// passed through UNCAPPED (a server 1.5 stays 150); non-finite or absent →
// percentage absent. `per1MonthResetTime` finite → carried VERBATIM as
// resetAt (the countdown renders from it at display time). used, total and
// remaining NEVER exist on this surface and are never synthesized — only
// percentage and resetAt are ever set on the returned UsageWindow.
import { ProviderApiError } from '../core/provider';
import type { QwenSite } from '../core/qwen-sites';
import type { UsageWindow } from '../core/usage';
import type { ProviderRequest } from '../network/request';
import { asObject } from './parse-utils';

/** Finite-number gate: anything else (null, absent, NaN, string) is absent. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Renders a missing/typed value for error messages (qwen.ts/zai.ts style). */
function describeValue(value: unknown): string {
  return value === undefined ? 'no value' : `${typeof value} ${JSON.stringify(value)}`;
}

/**
 * Parses the token-plan usage body into a UsageWindow carrying at most
 * `percentage` (0-100 convention, UNCAPPED) and `resetAt` (epoch ms verbatim).
 */
export function parseTokenPlanUsage(body: unknown): UsageWindow {
  const root = asObject(body);
  const code = root?.code;
  if (code !== 200 && code !== '200') {
    throw new ProviderApiError(
      `Qwen token-plan usage failed: gateway code must be 200 or "200", got ${describeValue(code)}.`,
    );
  }
  const data = asObject(root?.data);
  const dataSuccess = data?.success;
  if (dataSuccess !== true) {
    throw new ProviderApiError(
      `Qwen token-plan usage failed: data.success must be true, got ${describeValue(dataSuccess)}.`,
    );
  }
  const dataV2 = asObject(data?.DataV2);
  if (dataV2 === null) {
    throw new ProviderApiError('Qwen token-plan usage failed: data.success is true but data.DataV2 is missing.');
  }
  const inner = asObject(dataV2.data);
  const innerSuccess = inner?.success;
  if (innerSuccess !== true) {
    throw new ProviderApiError(
      `Qwen token-plan usage failed: inner success must be true, got ${describeValue(innerSuccess)}.`,
    );
  }
  // ABSENT failed is the real surface (live 2026-10-25); a present one must
  // be false — defensive acceptance of the coding-plan commodity shape.
  const failed = inner?.failed;
  if (failed !== undefined && failed !== false) {
    throw new ProviderApiError(
      `Qwen token-plan usage failed: inner failed must be false when present, got ${describeValue(failed)}.`,
    );
  }
  // A successful envelope with a missing/garbage payload reports honestly:
  // asObject(null) fallback → both fields absent, no crash.
  const payload = asObject(inner?.data) ?? {};
  const fraction = finiteNumber(payload.per1MonthPercentage);
  const resetAt = finiteNumber(payload.per1MonthResetTime);
  return {
    ...(fraction !== undefined ? { percentage: fraction * 100 } : {}),
    ...(resetAt !== undefined ? { resetAt } : {}),
  };
}

// ── WU-C1 request builders + mint response parse ────────────────────────────
// Contracts live-verified 2026-10-25 against the maintainer's international
// account (docs/spike/endpoints.md §Qwen token-plan quota — session-token
// surface). International is the ONLY site with live evidence: the china
// builders answer NULL rather than guessing cn hosts into dispatch.

/** Mint host — hop 1; the client signs requests here with the acs3 marker. */
export const QWEN_TOKEN_MINT_HOST = 'modelstudio.ap-southeast-1.aliyuncs.com';

/** Usage gateway host — hop 2; the ONLY host a session-bearer may attach to. */
export const QWEN_TOKEN_PLAN_GATEWAY_HOST = 'bailian-singapore-cs.alibabacloud.com';

/** The token-plan personal usage API identifier — static, no account fields. */
const TOKEN_PLAN_USAGE_API = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage';

/**
 * Static gateway form body — `params=<JSON>&region=ap-southeast-1`.
 * switchAgent is OMITTED ENTIRELY (live probe: omitted = SUCCESS,
 * `switchAgent: 0` = `BailianGateway.Workspace.NotAuthorised`) — no account
 * identifier ever enters this body.
 */
function usageRequestBody(): string {
  const params = JSON.stringify({
    Api: TOKEN_PLAN_USAGE_API,
    V: '1.0',
    Data: {
      cornerstoneParam: {
        protocol: 'V2',
        console: 'ONE_CONSOLE',
        productCode: 'p_efm',
        switchUserType: 3,
        consoleSite: 'BAILIAN_ALIYUN',
      },
    },
  });
  return `params=${params}&region=ap-southeast-1`;
}

/**
 * Hop 1 — the session-token mint request. The stored AK/SK never ride this
 * descriptor: the client's acs3 seam (hito-12 B2) signs it from the
 * credential. Returns null for sites without live evidence.
 */
export function mintQuotaTokenRequest(site: QwenSite): ProviderRequest | null {
  if (site !== 'international') {
    return null;
  }
  return {
    method: 'POST',
    url: `https://${QWEN_TOKEN_MINT_HOST}/modelstudio/cli/generateAccessToken`,
    body: '{}',
    signing: { scheme: 'acs3', action: 'GenerateCLIAccessToken', version: '2026-02-10' },
  };
}

/**
 * Mint failure. Only the vendor's string Code/Message surface in the text —
 * the raw body is NEVER echoed (a success-shaped body literally contains the
 * token) and no credential material ever appears here.
 */
export class QwenMintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QwenMintError';
  }
}

/**
 * Extracts the minted `cliAccessToken`. The live response carries it TOP LEVEL
 * and ONLY on success — a nonempty string; RequestId and any other fields are
 * tolerated. Missing, empty, or non-string is a classified mint failure.
 */
export function parseMintResponse(body: unknown): string {
  const record = asObject(body);
  const token = record?.cliAccessToken;
  if (typeof token === 'string' && token.length > 0) {
    return token;
  }
  const detail = [record?.Code, record?.Message]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(': ');
  throw new QwenMintError(
    `Qwen session token mint failed${detail.length > 0 ? ` (${detail})` : ''} — no cliAccessToken in the response.`,
  );
}

/**
 * Hop 2 — the gateway usage request. The transient session token rides ONLY on
 * the session marker: never the url, the query, or the body (the client
 * attaches it as Bearer at its sanctioned gateway seam, and the placement scan
 * rejects any smuggling). Returns null for sites without live evidence — the
 * token is not even placed on a request then.
 */
export function tokenPlanUsageRequest(sessionToken: string, site: QwenSite): ProviderRequest | null {
  if (site !== 'international') {
    return null;
  }
  return {
    method: 'POST',
    url: `https://${QWEN_TOKEN_PLAN_GATEWAY_HOST}/cli/api.json`,
    // The client's buildUrl encodes this trio into the exact live URL
    // (api=...%2Ftokenplan%2F...); the values themselves carry no secrets.
    query: {
      action: 'IntlBroadScopeAspnGateway',
      product: 'sfm_bailian',
      api: TOKEN_PLAN_USAGE_API,
    },
    body: usageRequestBody(),
    session: { token: sessionToken },
  };
}

