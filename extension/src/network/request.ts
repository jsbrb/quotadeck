// Provider-authored request shape + credential-placement guard (AD-3).
//
// STRUCTURAL NO-COOKIE / NO-CALLER-HEADER GUARANTEE (network-allowlist spec
// §Credentials Only in Authorization Header): `ProviderRequest` deliberately has
// NO `headers` field and NO `cookies` field — a provider cannot set arbitrary
// headers or attach cookies even if it wanted to. The only component that
// produces headers is `AllowlistNetworkClient`, which sets exactly one:
// `Authorization`. The downstream `Transport` type carries headers but no cookie
// jar. Credential material therefore has exactly one legal path — the
// Authorization header — and the scan below enforces it dynamically as defense
// in depth (a key smuggled into the URL, query, or body is rejected).

/** A request as built by a provider, BEFORE credentials are attached. */
export interface ProviderRequest {
  readonly method: 'GET' | 'POST';
  /** Absolute URL without credential material; query params travel separately. */
  readonly url: string;
  readonly query?: Readonly<Record<string, string | number>>;
  /** Serialized request body (JSON). Must not contain credential material. */
  readonly body?: string;
}

export type NetworkRejectionReason =
  /** The target host is not on the requesting provider's allowlist. */
  | 'host-not-allowed'
  /** Credential material appeared outside the Authorization header. */
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
 * Credential-placement guard: rejects when the credential (or its URL-encoded
 * form in the fully built URL) appears anywhere in the URL, query values, or
 * body. `AllowlistNetworkClient` runs this BEFORE any transport I/O, so a
 * violating request never leaves the extension (spec §Non-header key suppressed).
 */
export function assertNoCredentialMaterial(
  request: ProviderRequest,
  credential: string,
  fullUrl: string,
): void {
  if (credential.length === 0) {
    throw new NetworkRejectionError('credential-placement', 'Missing credential: nothing to attach.');
  }
  const surfaces: readonly string[] = [
    request.url,
    fullUrl,
    ...Object.entries(request.query ?? {}).map(([key, value]) => `${key}=${value}`),
    ...(request.body !== undefined ? [request.body] : []),
  ];
  for (const surface of surfaces) {
    if (surface.includes(credential)) {
      throw new NetworkRejectionError(
        'credential-placement',
        'Credential material found outside the Authorization header (url/query/body).',
      );
    }
  }
}
