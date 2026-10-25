// Qwen quota gateway-origin DNR session rule (hito-12 WU-F) — PURE builder.
//
// Why this exists: the token-plan quota gateway hop (hito-12 WU-C1/C2) fails
// from the MV3 service worker because Chrome always attaches the forbidden
// `Origin: chrome-extension://<id>` header to the request, and Alibaba's WAF
// answers that shape with a 302 to err.taobao.com BEFORE app-level auth is
// ever reached (live header-variant probe, 2026-10-25: chrome-extension
// Origin → 302 err.taobao; `Origin: https://modelstudio.console.alibabacloud.com`
// → 200 BailianGateway.Login.NotLogined; Sec-Fetch-*/UA irrelevant). fetch()
// can neither set nor remove Origin from a worker, so the mitigation is ONE
// declarativeNetRequest SESSION rule that rewrites the gateway request's
// Origin to the public console origin constant, scoped to our own extension
// as initiator, to the gateway host, and to the quota api path.
//
// This is deliberately NOT the DNR header-injection hito-9 rejected
// (openspec/changes/hito-9-qwen-console-session/exploration.md §Lane 1(c)).
// That proposal persisted cookie/session VALUES as rule data — secret
// material in browser-managed storage, bypassing the credential seam. The
// rule built here carries only PUBLIC constants (a well-known console
// origin string, the gateway host already in host_permissions, the api path)
// plus the install's own extension id, which is public per install and used
// solely as the INITIATOR scope. Zero credentials: the Bearer token still
// rides exclusively through the client's session-marker seam
// (network/client.ts), and session rules never persist across browser
// restarts. gateway-origin-rule.test.ts pins every field, including the
// no-cookie/no-authorization/no-secret-substring ban.
import type { DnrSessionRule } from '../platform/browser-api';
import { QWEN_TOKEN_PLAN_GATEWAY_HOST } from '../providers/qwen-token-plan';

/**
 * The PUBLIC console origin the WAF accepts in place of chrome-extension://.
 * A static, user-independent string — NOT session material, NOT a secret.
 */
export const QWEN_GATEWAY_TRUSTED_ORIGIN = 'https://modelstudio.console.alibabacloud.com';

/** The request header the rule rewrites, lower-case as DNR normalizes names. */
export const QWEN_GATEWAY_ORIGIN_HEADER = 'origin';

/** The quota api path the rewrite is scoped to (gateway request shape). */
export const QWEN_GATEWAY_API_PATH = '/cli/api.json';

/** DNR urlFilter pinning the rewrite to the quota usage request, nothing else. */
export const QWEN_GATEWAY_URL_FILTER = `${QWEN_TOKEN_PLAN_GATEWAY_HOST}${QWEN_GATEWAY_API_PATH}`;

/** Stable session-rule id: a re-install with this id REPLACES — never duplicates. */
export const QWEN_TOKEN_PLAN_SESSION_RULE_ID = 1;

/**
 * Builds the one gateway-origin session rule. The caller supplies
 * `extensionId` (background.ts reads it via the worker port's `runtime.id`),
 * so this module never touches the chrome global and stays unit-pure. NO
 * SECRET VALUES may ever enter the payload — every field is a public
 * constant or the caller-provided initiator scope, asserted by tests.
 */
export function buildGatewayOriginSessionRule({
  extensionId,
}: {
  readonly extensionId: string;
}): DnrSessionRule {
  return {
    id: QWEN_TOKEN_PLAN_SESSION_RULE_ID,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: QWEN_GATEWAY_ORIGIN_HEADER, operation: 'set', value: QWEN_GATEWAY_TRUSTED_ORIGIN },
      ],
    },
    condition: {
      requestDomains: [QWEN_TOKEN_PLAN_GATEWAY_HOST],
      resourceTypes: ['xmlhttprequest'],
      // Our own SW's requests only — a global (non-initiator-scoped) rule is
      // out of the question; this rewrite must never affect other extensions'
      // or pages' traffic to the host.
      initiatorDomains: [extensionId],
      urlFilter: QWEN_GATEWAY_URL_FILTER,
    },
  };
}
