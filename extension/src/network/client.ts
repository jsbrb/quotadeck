// AllowlistNetworkClient (AD-3) — the only component that attaches credentials.
//
// Pipeline per request, in order, with ZERO transport I/O before every check
// passes (network-allowlist spec):
//   1. Build the full URL (encoded query) and resolve the host. For ak-sk the
//      query is the SIGNED BSS query (AD-18) built first — the scan sees the
//      exact material that would leave the extension.
//   2. Host check: suffix match against THIS provider's allowlist entry.
//   3. Credential-kind-aware placement scan (network/request.ts): tokens are
//      confined to the Authorization header; the AccessKeySecret never
//      appears anywhere; AccessKeyId may appear in the query only on the Qwen
//      BSS host (AD-19 sanctioned exception).
//   4. Attach here — callers never see headers. Bearer/admin → Authorization
//      header; ak-sk → NO header at all, auth travels as the signed query.
//   5. Delegate to the injected Transport.
import { SystemClock, type Clock } from '../core/clock';
import type { Credential, ProviderId } from '../core/provider';
import { isHostAllowed } from './allowlist';
import {
  assertNoCredentialMaterial,
  NetworkRejectionError,
  type ProviderRequest,
} from './request';
import { signBssQuery } from './rpc-signer';
import type { AuthorizedRequest, Transport, TransportResponse } from './transport';

/** Injectable sources for the BSS signature inputs (AD-19: no ambient time). */
export interface NetworkClientDeps {
  /** Timestamp source (epoch ms → ISO-8601 UTC). Defaults to SystemClock. */
  readonly clock?: Clock;
  /** SignatureNonce source. Defaults to crypto.randomUUID(). */
  readonly nonce?: () => string;
}

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
  private readonly clock: Clock;
  private readonly nonce: () => string;

  constructor(
    private readonly transport: Transport,
    deps: NetworkClientDeps = {},
  ) {
    this.clock = deps.clock ?? new SystemClock();
    this.nonce = deps.nonce ?? (() => crypto.randomUUID());
  }

  async send(
    providerId: ProviderId,
    request: ProviderRequest,
    credential: Credential,
  ): Promise<TransportResponse> {
    // ak-sk: the signed query IS the credential attachment — build it first so
    // the scan validates the dispatchable material (AD-19).
    const dispatched: ProviderRequest = credential.type === 'ak-sk'
      ? await this.signedRequest(providerId, request, credential)
      : request;
    const url = buildUrl(dispatched);
    const host = new URL(url).hostname;

    if (!isHostAllowed(providerId, host)) {
      throw new NetworkRejectionError(
        'host-not-allowed',
        `Host ${host} is not on the allowlist for provider ${providerId}.`,
      );
    }
    // Raw credentials are ZAI-monitor-only (AD-25), exactly as ak-sk signing
    // is qwen-only: the target must pass the ZAI allowlist or nothing is
    // attached — rejected before any transport I/O.
    if (credential.type === 'raw' && !isHostAllowed('zai', host)) {
      throw new NetworkRejectionError(
        'credential-placement',
        `Raw credentials are only valid on the ZAI monitor hosts, not ${host}.`,
      );
    }
    assertNoCredentialMaterial(dispatched, credential, url);

    const authorized: AuthorizedRequest =
      credential.type === 'ak-sk'
        ? { method: dispatched.method, url, headers: {}, ...(dispatched.body !== undefined ? { body: dispatched.body } : {}) }
        : credential.type === 'raw'
          ? {
              // Verbatim key, no Bearer prefix, plus the localization header
              // (AD-25: presence is the contract; the value is cosmetic).
              method: dispatched.method,
              url,
              headers: { Authorization: credential.token, 'Accept-Language': 'zh-CN' },
              ...(request.body !== undefined ? { body: request.body } : {}),
            }
          : {
              method: dispatched.method,
              url,
              headers: { Authorization: `Bearer ${credential.token}` },
              ...(request.body !== undefined ? { body: request.body } : {}),
            };
    return this.transport.fetch(authorized);
  }

  /**
   * Builds the signed BSS query (AD-18): provider query params + AccessKeyId +
   * common params, signed with the injected clock timestamp and rng nonce.
   * ak-sk credentials are qwen-only — anything else is a placement violation.
   */
  private async signedRequest(
    providerId: ProviderId,
    request: ProviderRequest,
    credential: Extract<Credential, { type: 'ak-sk' }>,
  ): Promise<ProviderRequest> {
    if (providerId !== 'qwen') {
      throw new NetworkRejectionError(
        'credential-placement',
        `ak-sk credentials are only valid for qwen (Alibaba BSS), not ${providerId}.`,
      );
    }
    const base: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.query ?? {})) {
      base[key] = String(value);
    }
    base.AccessKeyId = credential.accessKeyId;
    const { query, signature } = await signBssQuery(base, credential.accessKeySecret, {
      timestamp: new Date(this.clock.now()).toISOString(),
      nonce: this.nonce(),
    });
    return { method: request.method, url: request.url, query: { ...query, Signature: signature } };
  }
}
