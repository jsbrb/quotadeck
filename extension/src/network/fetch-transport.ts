// Typed transport errors (AD-19/AD-21) — design home of the live transport
// error pair. `FetchTransport` itself (3.1) lands here later; slice 1 ships
// the error types the refresh taxonomy classifies on.
//
// AD-13 spirit: these errors carry the STATUS only — response body text is
// untrusted surface and is never captured into messages.

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
