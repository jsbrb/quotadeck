// Live transport (AD-19) — FetchTransport over an injectable `fetch`
// implementation, plus the typed error pair the refresh taxonomy classifies
// on (AD-21). The injection keeps this unit-testable with stub responses and
// zero network; production binds the ambient worker `fetch`.
//
// AD-13 spirit: these errors carry the STATUS only — response body text is
// untrusted surface and is never captured into messages.
import type { AuthorizedRequest, Transport, TransportResponse } from './transport';

/** Non-2xx HTTP response. `status` is the only payload carried. */
export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

/** A 2xx response whose body could not be parsed as JSON. */
export class ResponseParseError extends Error {
  constructor() {
    super('Failed to parse the response body as JSON.');
    this.name = 'ResponseParseError';
  }
}

/** Structural slice of a fetch `Response` the transport consumes. */
export interface FetchResponseLike {
  readonly status: number;
  readonly ok: boolean;
  json(): Promise<unknown>;
}

/** Injectable fetch implementation (structural subset of the global fetch). */
export type FetchImpl = (
  url: string,
  init: { method: string; headers: Readonly<Record<string, string>>; body?: string },
) => Promise<FetchResponseLike>;

/**
 * The production `Transport` (AD-19): dispatches through the injected fetch
 * implementation, maps non-2xx to `HttpStatusError(status)` and JSON parse
 * failures to `ResponseParseError`. A fetch-level rejection (network failure
 * surfaces as `TypeError`) propagates unwrapped — the taxonomy classifies it.
 */
export class FetchTransport implements Transport {
  private readonly fetchImpl: FetchImpl;

  constructor(fetchImpl?: FetchImpl) {
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  async fetch(request: AuthorizedRequest): Promise<TransportResponse> {
    const response = await this.fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
    });
    if (!response.ok) {
      throw new HttpStatusError(response.status);
    }
    try {
      return { status: response.status, body: await response.json() };
    } catch {
      throw new ResponseParseError();
    }
  }
}
