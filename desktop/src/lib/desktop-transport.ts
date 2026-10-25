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

/** TEMP diagnostic (T12): captures gateway response metadata for prefs. */
export const capturedResponses: string[] = [];

function isGatewayUrl(url: string): boolean {
  return url.includes(GATEWAY_URL_SUFFIX);
}

export function createDesktopFetchImpl() {
  return async (
    url: string,
    init: { method: string; headers: Readonly<Record<string, string>>; body?: string },
  ): Promise<FetchResponseLike> => {
    const headers = isGatewayUrl(url)
      ? {
          ...init.headers,
          Origin: QWEN_GATEWAY_TRUSTED_ORIGIN,
          // The gateway host's WAF answers header-fingerprinted non-browser
          // clients with a 200 HTML block page (T12 capture: Taobao
          // detail-exception page). Reproduce the browser request shape:
          // webview UA, fetch-like Accept, browser Accept-Language.
          "User-Agent": navigator.userAgent,
          Accept: "*/*",
          "Accept-Language": navigator.language || "en-US,en",
        }
      : init.headers;
    const response = await pluginFetch(url, {
      method: init.method as "GET" | "POST",
      headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    if (isGatewayUrl(url)) {
      try {
        const text = await response.clone().text();
        const headerNames: string[] = [];
        response.headers.forEach((value, key) => {
          headerNames.push(
            `${key}: ${key.includes("access-control") || key === "server" || key === "content-type" ? value.slice(0, 40) : "?"}`,
          );
        });
        capturedResponses.push(
          `status=${response.status} len=${text.length} headers=[${headerNames.join("; ")}] FULLBODY=${text}`,
        );
        if (capturedResponses.length > 3) {
          capturedResponses.shift();
        }
      } catch {
        capturedResponses.push("gateway capture failed");
      }
    }
    return response as unknown as FetchResponseLike;
  };
}

/** The production desktop Transport: FetchTransport over plugin-http. */
export function createDesktopTransport(): Transport {
  return new FetchTransport(createDesktopFetchImpl());
}
