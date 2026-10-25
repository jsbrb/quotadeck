// Provider-authored request shape + credential-placement guard (AD-3, AD-19).
//
// STRUCTURAL NO-COOKIE / NO-CALLER-HEADER GUARANTEE (network-allowlist spec
// §Credentials Only in Authorization Header): `ProviderRequest` deliberately has
// NO `headers` field and NO `cookies` field — a provider cannot set arbitrary
// headers or attach cookies even if it wanted to. The only component that
// produces headers is `AllowlistNetworkClient`, which sets at most:
// `Authorization` (token credentials) and `Content-Type: application/json`
// whenever a JSON body dispatches (the label belongs to the body) — the
// sanctioned ACS3 seam (hito-12) additionally emits the fixed
// `host`/`x-acs-*` signing header set, still produced EXCLUSIVELY by the
// client, never provider-authored. The
// downstream `Transport` type carries headers but no cookie jar.
//
// Credential material therefore has exactly one legal path per kind — the
// Authorization header for tokens (bearer, openai-admin-read, and raw, which
// the client attaches verbatim on the ZAI monitor hosts; AD-25), the derived
// BSS query signature for ak-sk — and the scan below enforces it dynamically
// as defense in depth:
// - token credentials (incl. raw): the token must not appear in url/query/body;
// - ak-sk (AD-19 sanctioned exception, scoped): the AccessKeySecret must not
//   appear ANYWHERE; the AccessKeyId may appear ONLY as a query parameter and
//   ONLY on the two Qwen BSS hosts (business.aliyuncs.com,
//   business.ap-southeast-1.aliyuncs.com — never the token-plan probe host) —
//   anything else is rejected before any transport I/O.
import type { Credential } from '../core/provider';
import { isQwenBssHost } from '../core/qwen-sites';

/**
 * Optional per-request signing discriminator (hito-12). ABSENT keeps the
 * legacy ak-sk BSS RPC query path (AD-18) — byte-identical default. The
 * `acs3` scheme routes an ak-sk request through the client's ACS3-HMAC-SHA256
 * header seam (live-proven token mint, docs/spike/endpoints.md §Qwen
 * token-plan quota): action/version ride the signed `x-acs-*` headers and an
 * optional STS token is signed too. Meaningless on any other credential kind —
 * the client refuses it before dispatch.
 */
export interface Acs3SigningMarker {
  readonly scheme: 'acs3';
  readonly action: string;
  readonly version: string;
  readonly securityToken?: string;
}

/** A request as built by a provider, BEFORE credentials are attached. */
export interface ProviderRequest {
  readonly method: 'GET' | 'POST';
  /** Absolute URL without credential material; query params travel separately. */
  readonly url: string;
  readonly query?: Readonly<Record<string, string | number>>;
  /** Serialized request body (JSON). Must not contain credential material. */
  readonly body?: string;
  /** Signing discriminator; undefined = the legacy BSS RPC query path (AD-18). */
  readonly signing?: Acs3SigningMarker;
}

export type NetworkRejectionReason =
  /** The target host is not on the requesting provider's allowlist. */
  | 'host-not-allowed'
  /** Credential material appeared outside its sanctioned placement. */
  | 'credential-placement';

/** Explicit error thrown when the network layer refuses to dispatch a request. */
export class NetworkRejectionError extends Error {
  readonly reason: NetworkRejectionReason;

  constructor(reason: NetworkRejectionReason, message: string) {
    super(message);
    this.name = 'NetworkRejectionError';
    this.reason = reason;
  }
}

/**
 * Credential-kind-aware placement guard (AD-19). `AllowlistNetworkClient` runs
 * this BEFORE any transport I/O over the fully built request, so a violating
 * request never leaves the extension (spec §Non-header key suppressed and
 * §Signed-style credentials rejected off the Qwen host).
 */
export function assertNoCredentialMaterial(
  request: ProviderRequest,
  credential: Credential,
  fullUrl: string,
): void {
  const querySurfaces: readonly string[] = Object.entries(request.query ?? {}).map(
    ([key, value]) => `${key}=${value}`,
  );
  const bodySurfaces: readonly string[] = request.body !== undefined ? [request.body] : [];

  if (credential.type === 'ak-sk') {
    if (credential.accessKeyId.length === 0 || credential.accessKeySecret.length === 0) {
      throw new NetworkRejectionError('credential-placement', 'Missing credential: nothing to attach.');
    }
    // The secret is never transmitted — no surface, no exception, no host.
    for (const surface of [request.url, fullUrl, ...querySurfaces, ...bodySurfaces]) {
      if (surface.includes(credential.accessKeySecret)) {
        throw new NetworkRejectionError(
          'credential-placement',
          'AccessKeySecret must never appear in the url, query, body, headers, or cookies.',
        );
      }
    }
    // AccessKeyId: query-only, and only on the TWO Qwen BSS hosts (china +
    // international). The allowlist also admits the token-plan probe host —
    // signed-style credentials are NOT sanctioned there (hito-8 scoping).
    if (!isQwenBssHost(new URL(fullUrl).hostname)) {
      for (const surface of [...querySurfaces, fullUrl]) {
        if (surface.includes(credential.accessKeyId)) {
          throw new NetworkRejectionError(
            'credential-placement',
            'AccessKeyId in the query is allowed only on the Qwen BSS hosts (business.aliyuncs.com, business.ap-southeast-1.aliyuncs.com).',
          );
        }
      }
    }
    for (const surface of [request.url, ...bodySurfaces]) {
      if (surface.includes(credential.accessKeyId)) {
        throw new NetworkRejectionError(
          'credential-placement',
          'AccessKeyId must not appear in the url path or body.',
        );
      }
    }
    return;
  }

  if (credential.token.length === 0) {
    throw new NetworkRejectionError('credential-placement', 'Missing credential: nothing to attach.');
  }
  for (const surface of [request.url, fullUrl, ...querySurfaces, ...bodySurfaces]) {
    if (surface.includes(credential.token)) {
      throw new NetworkRejectionError(
        'credential-placement',
        'Credential material found outside the Authorization header (url/query/body).',
      );
    }
  }
}
