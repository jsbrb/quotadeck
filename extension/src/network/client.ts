// AllowlistNetworkClient (AD-3) — the only component that attaches credentials.
//
// Pipeline per request, in order, with ZERO transport I/O before every check
// passes (network-allowlist spec):
//   1. Build the full URL (encoded query) and resolve the host.
//   2. Host check: suffix match against THIS provider's allowlist entry.
//   3. Credential-placement scan over url / query / body (defense in depth on
//      top of the structural guarantee — see network/request.ts: ProviderRequest
//      has no header or cookie field, and no cookie jar exists anywhere).
//   4. Attach `Authorization` here — callers never see the header.
//   5. Delegate to the injected Transport.
//
// Note on Qwen: this fixture-only milestone attaches a Bearer-style
// Authorization value for every provider because nothing is actually
// authenticated live; the Alibaba AK/SK HMAC signing scheme lands with the
// live-transport milestone and will be implemented behind this same seam.
import type { ProviderId } from '../core/provider';
import { isHostAllowed } from './allowlist';
import {
  assertNoCredentialMaterial,
  NetworkRejectionError,
  type ProviderRequest,
} from './request';
import type { AuthorizedRequest, Transport, TransportResponse } from './transport';

function buildUrl(request: ProviderRequest): string {
  if (request.query === undefined) {
    return request.url;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query)) {
    params.set(key, String(value));
  }
  const query = params.toString();
  if (query.length === 0) {
    return request.url;
  }
  return `${request.url}${request.url.includes('?') ? '&' : '?'}${query}`;
}

export class AllowlistNetworkClient {
  constructor(private readonly transport: Transport) {}

  async send(
    providerId: ProviderId,
    request: ProviderRequest,
    credential: string,
  ): Promise<TransportResponse> {
    const url = buildUrl(request);
    const host = new URL(url).hostname;

    if (!isHostAllowed(providerId, host)) {
      throw new NetworkRejectionError(
        'host-not-allowed',
        `Host ${host} is not on the allowlist for provider ${providerId}.`,
      );
    }
    assertNoCredentialMaterial(request, credential, url);

    const authorized: AuthorizedRequest = {
      method: request.method,
      url,
      headers: { Authorization: `Bearer ${credential}` },
      ...(request.body !== undefined ? { body: request.body } : {}),
    };
    return this.transport.fetch(authorized);
  }
}
