// Transport port + fixture-backed implementation (network-allowlist spec
// §Injectable Transport; AD-8).
//
// The Transport is the single I/O seam of the whole extension: tests and the
// shipped worker both use fixture-backed transports in this milestone, and the
// future live milestone is a transport swap — no other layer changes.

/** A request after `AllowlistNetworkClient` attached the Authorization header. */
export interface AuthorizedRequest {
  readonly method: 'GET' | 'POST';
  /** Full URL including encoded query string. */
  readonly url: string;
  /** Set exclusively by AllowlistNetworkClient — exactly `Authorization`. */
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
