// AllowlistNetworkClient (AD-3) — the only component that attaches credentials.
//
// Pipeline per request, in order, with ZERO transport I/O before every check
// passes (network-allowlist spec):
//   1. Build the full URL (encoded query) and resolve the host. For unmarked
//      ak-sk the query is the SIGNED BSS query (AD-18) built first — the scan
//      sees the exact material that would leave the extension. Marked (acs3)
//      ak-sk requests stay query-less; the scan sees the untouched request.
//   2. Host check: suffix match against THIS provider's allowlist entry.
//   3. Credential-kind-aware placement scan (network/request.ts): tokens are
//      confined to the Authorization header; the AccessKeySecret never
//      appears anywhere; AccessKeyId may appear in the query only on the Qwen
//      BSS host (AD-19 sanctioned exception).
//   4. Attach here — callers never see headers. Bearer/admin → Authorization
//      header; unmarked ak-sk → NO header at all, auth travels as the signed
//      query; marked ak-sk (acs3, hito-12) → Authorization plus the fixed
//      host/content-type/x-acs-* signing header set, produced by the seam;
//      session-marked ak-sk (hito-12 C1) → Bearer <transient token> + the
//      form-urlencoded label, gateway host only.
//   5. Delegate to the injected Transport.
import { SystemClock, type Clock } from '../core/clock';
import type { Credential, ProviderId } from '../core/provider';
import { isHostAllowed } from './allowlist';
import { QWEN_PLAN_PROBE_HOST } from '../providers/qwen-plan-probe';
import { QWEN_TOKEN_PLAN_GATEWAY_HOST } from '../providers/qwen-token-plan';
import { signAcs3 } from './acs3-signer';
import {
  assertNoCredentialMaterial,
  NetworkRejectionError,
  type Acs3SigningMarker,
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

/**
 * POP-compliant timestamp (§RPC Timestamp Format): ISO-8601 UTC WITHOUT the
 * millisecond component (`YYYY-MM-DDTHH:mm:ssZ`). Alibaba POP RPC rejects
 * millisecond-carrying timestamps with HTTP 400; `toISOString()` always
 * emits `.sss`, so the fraction is stripped here — BEFORE signing, keeping
 * the emitted param and the StringToSign material identical (AD-18).
 */
function toPopTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/u, 'Z');
}

/**
 * A dispatched JSON body is always labeled `application/json` (live-found
 * 2026-09-06: the token-plan endpoint answers an unlabeled POST body with
 * HTTP 400 before even validating the credential). The label belongs to the
 * BODY — bodyless GETs dispatch without it.
 */
function jsonContentType(body: string | undefined): Record<string, string> {
  return body === undefined ? {} : { 'Content-Type': 'application/json' };
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
    // the scan validates the dispatchable material (AD-19). The acs3 marker
    // (hito-12) takes the header seam instead: the request stays untouched
    // here and auth attaches after the scan, from signed headers. The session
    // marker (hito-12 C1) likewise leaves the request untouched — the stored
    // pair remains the qwen identity gate while the TRANSIENT token attaches
    // at its own seam below; the BSS signer is never invoked for it.
    const session = request.session;
    const acs3 = credential.type === 'ak-sk' ? request.signing : undefined;
    const dispatched: ProviderRequest =
      credential.type === 'ak-sk' && acs3 === undefined && session === undefined
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
    // The qwen plan key is probe-host-only (hito-8 §Credential Attach Modes):
    // the sk-sp- key attaches as Bearer EXCLUSIVELY on the token-plan probe
    // host — an allowlisted BSS host is still the wrong surface for it.
    if (credential.type === 'qwen-plan' && host !== QWEN_PLAN_PROBE_HOST) {
      throw new NetworkRejectionError(
        'credential-placement',
        `Qwen plan keys are only valid on ${QWEN_PLAN_PROBE_HOST}, not ${host}.`,
      );
    }
    // Marker hygiene: outside ak-sk the discriminator is meaningless — refuse
    // before any attachment (zero transport I/O).
    if (request.signing !== undefined && credential.type !== 'ak-sk') {
      throw new NetworkRejectionError(
        'credential-placement',
        `The acs3 signing marker is only valid on ak-sk credentials, not ${credential.type}.`,
      );
    }
    // Session-bearer hygiene (hito-12 C1): exactly one auth mechanism per
    // request; the transient token rides ONLY the live-verified qwen token-plan
    // usage gateway — the mint host (also allowlisted) and every other host are
    // never session targets. Messages name the host, never the token.
    if (session !== undefined) {
      if (credential.type !== 'ak-sk') {
        throw new NetworkRejectionError(
          'credential-placement',
          `The session-bearer marker is only valid on ak-sk credentials, not ${credential.type}.`,
        );
      }
      if (request.signing !== undefined) {
        throw new NetworkRejectionError(
          'credential-placement',
          'A request cannot carry both the acs3 signing marker and the session-bearer marker.',
        );
      }
      if (providerId !== 'qwen' || host !== QWEN_TOKEN_PLAN_GATEWAY_HOST) {
        throw new NetworkRejectionError(
          'credential-placement',
          `Session tokens are only valid on the qwen token-plan usage gateway, not ${host}.`,
        );
      }
    }
    assertNoCredentialMaterial(dispatched, credential, url);

    if (acs3 !== undefined && credential.type === 'ak-sk') {
      return this.sendAcs3(providerId, dispatched, url, acs3, credential);
    }

    if (session !== undefined) {
      // Single sanctioned session attach: the transient token IS the Bearer
      // value and the only credential header produced — the live gateway
      // contract labels the form body (the label belongs to the body: a
      // bodyless session dispatch carries none). No signed query, no x-acs
      // material, nothing else.
      return this.transport.fetch({
        method: dispatched.method,
        url,
        headers: {
          Authorization: `Bearer ${session.token}`,
          ...(dispatched.body !== undefined
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        ...(dispatched.body !== undefined ? { body: dispatched.body } : {}),
      });
    }

    const authorized: AuthorizedRequest =
      credential.type === 'ak-sk'
        ? { method: dispatched.method, url, headers: { ...jsonContentType(dispatched.body) }, ...(dispatched.body !== undefined ? { body: dispatched.body } : {}) }
        : credential.type === 'raw'
          ? {
              // Verbatim key, no Bearer prefix, plus the localization header
              // (AD-25: presence is the contract; the value is cosmetic).
              method: dispatched.method,
              url,
              headers: { Authorization: credential.token, 'Accept-Language': 'zh-CN', ...jsonContentType(request.body) },
              ...(request.body !== undefined ? { body: request.body } : {}),
            }
          : {
              method: dispatched.method,
              url,
              headers: { Authorization: `Bearer ${credential.token}`, ...jsonContentType(dispatched.body) },
              ...(dispatched.body !== undefined ? { body: dispatched.body } : {}),
            };
    return this.transport.fetch(authorized);
  }

  /**
   * Single sanctioned ACS3 seam (hito-12): signs the query-less mint request
   * with the injected clock/nonce and dispatches it with the produced header
   * set plus Authorization. Only marked ak-sk requests enter here — the legacy
   * BSS query path never does.
   */
  private async sendAcs3(
    providerId: ProviderId,
    request: ProviderRequest,
    url: string,
    marker: Acs3SigningMarker,
    credential: Extract<Credential, { type: 'ak-sk' }>,
  ): Promise<TransportResponse> {
    if (providerId !== 'qwen') {
      throw new NetworkRejectionError(
        'credential-placement',
        `ak-sk credentials are only valid for qwen (Alibaba BSS), not ${providerId}.`,
      );
    }
    // The live-proven mint shape is query-less; anything else would require an
    // unproven canonical query — refuse before signing.
    if (request.query !== undefined && Object.keys(request.query).length > 0) {
      throw new NetworkRejectionError(
        'credential-placement',
        'The ACS3 seam signs query-less requests only — the live-proven mint shape (hito-12).',
      );
    }
    const target = new URL(url);
    const signed = await signAcs3({
      method: request.method,
      host: target.hostname,
      pathname: target.pathname,
      action: marker.action,
      version: marker.version,
      ...(marker.securityToken !== undefined ? { securityToken: marker.securityToken } : {}),
      date: toPopTimestamp(this.clock.now()), // same millis-stripped ISO the POP arm proves
      nonce: this.nonce(),
      body: request.body ?? '',
      accessKeyId: credential.accessKeyId,
      accessKeySecret: credential.accessKeySecret,
    });
    return this.transport.fetch({
      method: request.method,
      url,
      headers: { ...signed.headers, Authorization: signed.authorization },
      ...(request.body !== undefined ? { body: request.body } : {}),
    });
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
      timestamp: toPopTimestamp(this.clock.now()),
      nonce: this.nonce(),
    });
    return { method: request.method, url: request.url, query: { ...query, Signature: signature } };
  }
}
