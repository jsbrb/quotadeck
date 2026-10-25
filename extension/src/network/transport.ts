// Transport port + fixture-backed implementation (network-allowlist spec
// §Injectable Transport; AD-8).
//
// The Transport is the single I/O seam of the whole extension: the production
// worker binds `FetchTransport` (network/fetch-transport.ts, real `fetch`);
// `FixtureTransport` below is a TEST DOUBLE — the hermetic suites and the
// unpacked-load E2E use it to replay recorded responses with no network path.
//
// Note on headers (AD-19): `AuthorizedRequest.headers` is set exclusively by
// `AllowlistNetworkClient`. Unmarked requests may carry `{}` — the legacy qwen
// ak-sk path still signs auth into the BSS query. Marked routes carry the
// client-produced header sets instead: the ACS3 `x-acs-*`/Authorization set on
// `signing`-marked mint requests, and a Bearer Authorization on `session`-
// marked gateway requests (transient token; never from storage, never in URLs).

/** A request after `AllowlistNetworkClient` attached the Authorization header. */
export interface AuthorizedRequest {
  readonly method: 'GET' | 'POST';
  /** Full URL including encoded query string. */
  readonly url: string;
  /** Set exclusively by AllowlistNetworkClient — exactly `Authorization`, or `{}` for the signed qwen path. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface TransportResponse {
  readonly status: number;
  /** Parsed response payload; providers validate the shape via parsePage. */
  readonly body: unknown;
}

export interface Transport {
  fetch(request: AuthorizedRequest): Promise<TransportResponse>;
}

/**
 * Answers from a route table of recorded fixtures keyed by exact full URL.
 * Phase 4 (`src/fixtures/index.ts`) wires the recorded fixture JSON files into
 * this map so the unpacked worker serves fixtures without loose files (AD-8).
 * An unrouted URL throws — fixture discipline: no silent fallbacks, no network.
 */
export class FixtureTransport implements Transport {
  private readonly routes: Map<string, TransportResponse>;

  constructor(routes: Readonly<Record<string, TransportResponse>> = {}) {
    this.routes = new Map(Object.entries(routes));
  }

  async fetch(request: AuthorizedRequest): Promise<TransportResponse> {
    const fixture = this.routes.get(request.url);
    if (fixture === undefined) {
      throw new Error(`FixtureTransport: no fixture routed for ${request.method} ${request.url}`);
    }
    return fixture;
  }
}
