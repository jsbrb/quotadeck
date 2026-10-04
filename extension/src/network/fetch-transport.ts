// Live transport (AD-19) — FetchTransport over an injectable `fetch`
// implementation, plus the typed error pair the refresh taxonomy classifies
// on (AD-21). The injection keeps this unit-testable with stub responses and
// zero network; production binds the ambient worker `fetch`.
//
// AD-13 spirit (snapshot carries the class only) with ONE scoped relaxation,
// hito-7 §Error Body Surfacing: on non-2xx the body is read as TEXT ONLY and
// a bounded (≤200 chars) verbatim snippet is embedded in the HttpStatusError
// message so server error Code/Message stay visible — never parsed as JSON,
// never persisted. Classification remains status-first (AD-30).
import type { AuthorizedRequest, Transport, TransportResponse } from './transport';

/** Non-2xx HTTP response: `status` plus an optional bounded body snippet. */
export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, bodySnippet?: string) {
    super(
      bodySnippet !== undefined && bodySnippet.length > 0
        ? `HTTP ${status}: ${bodySnippet.slice(0, 200)}`
        : `HTTP ${status}`,
    );
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
  text(): Promise<string>;
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
      // §Error Body Surfacing: read the error body as text and embed a
      // bounded verbatim snippet (capped inside HttpStatusError) so the
      // server's Code/Message is observable. A body-read failure MUST NOT
      // mask the status error — degrade to status-only.
      let bodySnippet: string | undefined;
      try {
        bodySnippet = await response.text();
      } catch {
        bodySnippet = undefined;
      }
      throw new HttpStatusError(response.status, bodySnippet);
    }
    try {
      return { status: response.status, body: await response.json() };
    } catch {
      throw new ResponseParseError();
    }
  }
}
