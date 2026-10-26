// Desktop transport — the platform seam that replaces the extension's
// `FetchTransport` default fetch binding (platform/browser-api.ts role).
//
// The webview's ambient fetch cannot reach the provider APIs (browser CORS;
// the extension instead relied on MV3 host permissions). All dispatches go
// through tauri-plugin-http, which performs the request on the Rust side
// (reqwest) under the capability allowlist in capabilities/default.json —
// exactly the seven hosts of the shipped providers, mirroring the extension's
// host_permissions. The AllowlistNetworkClient still suffix-checks every host
// before any I/O, so this layer adds no surface of its own.
//
// Gateway Origin (desktop counterpart of the extension's gateway-origin DNR
// session rule, dnr/gateway-origin-rule.ts): reqwest permits setting Origin,
// so the WAF-accepted PUBLIC console origin is attached directly to the
// token-plan gateway requests. Constant only — never secret material; the
// Bearer still rides exclusively through the client's session-marker seam.

import { fetch as pluginFetch } from "@tauri-apps/plugin-http";
import {
  QWEN_GATEWAY_API_PATH,
  QWEN_GATEWAY_TRUSTED_ORIGIN,
} from "@shared/dnr/gateway-origin-rule";
import { QWEN_TOKEN_PLAN_GATEWAY_HOST } from "@shared/providers/qwen-token-plan";
import { FetchTransport, type FetchResponseLike } from "@shared/network/fetch-transport";
import type { Transport } from "@shared/network/transport";

const GATEWAY_URL_SUFFIX = `${QWEN_TOKEN_PLAN_GATEWAY_HOST}${QWEN_GATEWAY_API_PATH}`;

/**
 * Gateway response probe (autotest measurement): the last gateway hop's
 * STATUS and CONTENT-TYPE only — never bodies, never headers with session
 * material. The Qwen diagnosis needs just one fact: JSON vs the WAF's HTML.
 */
export const gatewayProbe: { last: { status: number; contentType: string } | null } = {
  last: null,
};

function isGatewayUrl(url: string): boolean {
  return url.includes(GATEWAY_URL_SUFFIX);
}

/**
 * FetchImpl over plugin-http with the gateway browser-shape rewrite:
 * public console Origin (desktop twin of the DNR rule), webview UA/Accept
 * headers, and — WU-K — the session cookies read from the embedded Qwen
 * console sign-in window. The gateway host's WAF block page disappears only
 * with the real session cookies; the cookie string never leaves this hop
 * (no persistence, no logging).
 */
export function createDesktopFetchImpl(getGatewayCookies: () => Promise<string | null>) {
  return async (
    url: string,
    init: { method: string; headers: Readonly<Record<string, string>>; body?: string },
  ): Promise<FetchResponseLike> => {
    let headers = init.headers as Record<string, string>;
    if (isGatewayUrl(url)) {
      const cookies = await getGatewayCookies();
      headers = {
        ...headers,
        Origin: QWEN_GATEWAY_TRUSTED_ORIGIN,
        "User-Agent": navigator.userAgent,
        Accept: "*/*",
        "Accept-Language": navigator.language || "en-US,en",
        ...(cookies !== null ? { Cookie: cookies } : {}),
      };
    }
    const response = await pluginFetch(url, {
      method: init.method as "GET" | "POST",
      headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    if (isGatewayUrl(url)) {
      gatewayProbe.last = {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "?",
      };
    }
    return response as unknown as FetchResponseLike;
  };
}

/** The production desktop Transport: FetchTransport over plugin-http. */
export function createDesktopTransport(
  getGatewayCookies: () => Promise<string | null>,
): Transport {
  return new FetchTransport(createDesktopFetchImpl(getGatewayCookies));
}
