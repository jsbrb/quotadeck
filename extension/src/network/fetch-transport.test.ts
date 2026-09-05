// FetchTransport tests (AD-19) — the live Transport over an injectable fetch
// implementation. Every case stubs `fetchImpl`; zero real network exists in
// this suite (hermetic), and the typed-error contract the refresh taxonomy
// classifies on (AD-21) is pinned here at its source.
import { describe, expect, it } from 'vitest';
import { FetchTransport, HttpStatusError, ResponseParseError } from './fetch-transport';
import type { AuthorizedRequest } from './transport';

/** Structural response double — exactly what FetchTransport consumes. */
interface StubResponse {
  readonly status: number;
  readonly ok: boolean;
  json: () => Promise<unknown>;
}

function respond(status: number, body?: unknown): StubResponse {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) };
}

/** Minimal 2xx definition: ok exactly inside [200, 299]. */
function rejectJson(status: number, error: Error): StubResponse {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.reject(error) };
}

const GET_REQUEST: AuthorizedRequest = {
  method: 'GET',
  url: 'https://api.moonshot.cn/v1/users/me/balance',
  headers: { Authorization: 'Bearer kimi-token' },
};

describe('FetchTransport — 2xx passthrough', () => {
  it('returns { status, body } for a 200 JSON response and threads url/method/headers to fetchImpl', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const transport = new FetchTransport(async (url, init) => {
      calls.push({ url, method: init.method, headers: { ...init.headers } });
      return respond(200, { data: { available_balance: '88.88' } });
    });

    await expect(transport.fetch(GET_REQUEST)).resolves.toEqual({
      status: 200,
      body: { data: { available_balance: '88.88' } },
    });
    expect(calls).toEqual([{ url: GET_REQUEST.url, method: 'GET', headers: { Authorization: 'Bearer kimi-token' } }]);
  });

  it('carries a POST body through and passes other 2xx statuses verbatim', async () => {
    const bodies: Array<string | undefined> = [];
    const transport = new FetchTransport(async (_url, init) => {
      bodies.push(init.body);
      return respond(201, { created: true });
    });

    await expect(
      transport.fetch({ method: 'POST', url: 'https://api.example.com/v1/thing', headers: {}, body: '{"q":1}' }),
    ).resolves.toEqual({ status: 201, body: { created: true } });
    expect(bodies).toEqual(['{"q":1}']);
  });
});

describe('FetchTransport — non-2xx throws HttpStatusError (status only, AD-13 spirit)', () => {
  it.each([401, 403, 404, 429, 500, 503])('HTTP %i rejects with HttpStatusError carrying the status', async (status) => {
    const transport = new FetchTransport(async () => respond(status, { ignored: 'body-text-is-untrusted' }));

    const failure = await transport.fetch(GET_REQUEST).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HttpStatusError);
    expect((failure as HttpStatusError).status).toBe(status);
    expect((failure as Error).message).toBe(`HTTP ${status}`); // no body text captured
  });
});

describe('FetchTransport — parse and network failures', () => {
  it('a 2xx body that is not JSON rejects with ResponseParseError', async () => {
    const transport = new FetchTransport(async () => rejectJson(200, new SyntaxError('Unexpected token <')));

    await expect(transport.fetch(GET_REQUEST)).rejects.toBeInstanceOf(ResponseParseError);
  });

  it('a fetch-level TypeError propagates unwrapped (the network failure signal, AD-21)', async () => {
    const failure = new TypeError('Failed to fetch');
    const transport = new FetchTransport(() => Promise.reject(failure));

    await expect(transport.fetch(GET_REQUEST)).rejects.toBe(failure);
  });
});
