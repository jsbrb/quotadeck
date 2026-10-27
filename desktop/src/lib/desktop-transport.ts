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
import { QWEN_GATEWAY_API_PATH } from "@shared/dnr/gateway-origin-rule";
import { QWEN_TOKEN_PLAN_GATEWAY_HOST } from "@shared/providers/qwen-token-plan";
import { FetchTransport, type FetchResponseLike } from "@shared/network/fetch-transport";
import type { Transport } from "@shared/network/transport";

const GATEWAY_URL_SUFFIX = `${QWEN_TOKEN_PLAN_GATEWAY_HOST}${QWEN_GATEWAY_API_PATH}`;

/**
 * Gateway response probe (autotest measurement): the last gateway hop's
 * STATUS and CONTENT-TYPE and WHICH transport ran it. WU-Q attribution: only
 * browser-hop blocks escalate the backoff — plain-hop failures are expected
 * while the agent webview warms up.
 */
export const gatewayProbe: {
  last: { status: number; contentType: string; via: "browser" | "plain" } | null;
} = {
  last: null,
};

function isGatewayUrl(url: string): boolean {
  return url.includes(GATEWAY_URL_SUFFIX);
}

/** Minimal response shape both hop implementations produce. */
interface HopResponse {
  readonly status: number;
  readonly text: string;
}

/** Network requests never hang forever: 15s hard ceiling per dispatch. */
const FETCH_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${FETCH_TIMEOUT_MS / 1000}s`)), FETCH_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function responseLike(hop: { status: number; text: string }): FetchResponseLike {
  const text = hop.text;
  return {
    status: hop.status,
    ok: hop.status >= 200 && hop.status < 300,
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

/**
 * WU-P browser-hop: the gateway request executes INSIDE the hidden Qwen
 * console webview (real Chromium TLS/h2 + the console page Origin — the exact
 * shape the extension's DNR rule produced and the WAF accepts). The Bearer
 * rides only as a fetch argument. Returns null when the agent is warming or
 * unavailable — the caller falls back to the plain plugin-http hop.
 */
export interface GatewayViaBrowser {
  (request: {
    url: string;
    method: string;
    authorization: string;
    body?: string;
  }): Promise<{ status: number; contentType: string; text: string } | null>;
}

export function createDesktopFetchImpl(
  gatewayViaBrowser: GatewayViaBrowser,
) {
  return async (
    url: string,
    init: { method: string; headers: Readonly<Record<string, string>>; body?: string },
  ): Promise<FetchResponseLike> => {
    if (isGatewayUrl(url)) {
      try {
        const raw = await withTimeout(
          gatewayViaBrowser({
            url,
            method: init.method,
            authorization: init.headers.Authorization ?? "",
            body: init.body,
          }),
          "gateway browser-hop",
        );
        // The Rust command returns Option<(u16, String, String)> — a JSON
        // ARRAY over IPC. Reading it as {s,c,b} silently produced undefined
        // fields and disabled the whole browser-hop (spike WU-U finding).
        const hop = Array.isArray(raw)
          ? { status: raw[0], contentType: raw[1], text: raw[2] }
          : raw;
        if (hop !== null) {
          gatewayProbe.last = {
            status: hop.status,
            contentType: hop.contentType,
            via: "browser",
          };
          return responseLike(hop);
        }
      } catch {
        // fall through to the plain hop
      }
    }
    const raw = await withTimeout(
      pluginFetch(url, {
        method: init.method as "GET" | "POST",
        headers: init.headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
      }),
      "provider request",
    );
    const response = raw as unknown as FetchResponseLike;
    if (isGatewayUrl(url)) {
      const headers = (raw as { headers?: { get?: (name: string) => string | null } }).headers;
      gatewayProbe.last = {
        status: response.status,
        contentType: headers?.get?.("content-type") ?? "?",
        via: "plain",
      };
    }
    return response;
  };
}

/** The production desktop Transport: FetchTransport over plugin-http. */
export function createDesktopTransport(
  gatewayViaBrowser: GatewayViaBrowser,
): Transport {
  return new FetchTransport(createDesktopFetchImpl(gatewayViaBrowser));
}
