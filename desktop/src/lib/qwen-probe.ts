// Spike WU-U (qwen cookie-hop) — pure request builders for the session-cookie
// probe against the token-plan usage gateway.
//
// PINNED TWIN of the extension's hop-2 builders (extension/src/providers/
// qwen-token-plan.ts usageRequestBody + tokenPlanUsageRequest) MINUS the
// session marker: desktop cannot import that module (extension/ stays
// untouched by the desktop branch), and the entire spike hypothesis is
// "the SAME request, authenticated only by the console session cookies the
// agent webview carries — exactly how the console web app reads quotas".
// If the shape drifted from the live-verified twin, a failure would be
// ambiguous between "CORS/WAF wall" and "malformed request", so the test
// pins it byte-for-byte.

/** Hop-2 gateway origin — the ONLY host the probe ever talks to. */
export const QWEN_USAGE_GATEWAY_ORIGIN = "https://bailian-singapore-cs.alibabacloud.com";

/** The token-plan personal usage API identifier — static, no account fields. */
const TOKEN_PLAN_USAGE_API = "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage";

/** The live-verified usage URL with the query trio percent-encoded. */
export function qwenUsageProbeUrl(): string {
  const query = new URLSearchParams({
    action: "IntlBroadScopeAspnGateway",
    product: "sfm_bailian",
    api: TOKEN_PLAN_USAGE_API,
  });
  return `${QWEN_USAGE_GATEWAY_ORIGIN}/cli/api.json?${query.toString()}`;
}

/**
 * Static gateway form body — `params=<JSON>&region=ap-southeast-1`.
 * switchAgent is OMITTED ENTIRELY (live probe: omitted = SUCCESS,
 * `switchAgent: 0` = `BailianGateway.Workspace.NotAuthorised`) — no account
 * identifier ever enters this body.
 */
export function qwenUsageProbeBody(): string {
  const params = JSON.stringify({
    Api: TOKEN_PLAN_USAGE_API,
    V: "1.0",
    Data: {
      cornerstoneParam: {
        protocol: "V2",
        console: "ONE_CONSOLE",
        productCode: "p_efm",
        switchUserType: 3,
        consoleSite: "BAILIAN_ALIYUN",
      },
    },
  });
  return `params=${params}&region=ap-southeast-1`;
}
