// FetchTransport tests (AD-19) — the live Transport over an injectable fetch
// implementation. Every case stubs `fetchImpl`; zero real network exists in
// this suite (hermetic), and the typed-error contract the refresh taxonomy
// classifies on (AD-21) is pinned here at its source. Since hito-7, error
// statuses also surface a bounded TEXT snippet of the body (§Error Body
// Surfacing): text-only, capped at 200 chars, never parsed, never persisted.
import { describe, expect, it } from 'vitest';
import { FetchTransport, HttpStatusError, ResponseParseError } from './fetch-transport';
import type { AuthorizedRequest } from './transport';
import { classifyRefreshError } from '../refresh/error-taxonomy';

/** Structural response double — exactly what FetchTransport consumes. */
interface StubResponse {
  readonly status: number;
  readonly ok: boolean;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function respond(status: number, body?: unknown): StubResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body ?? null)),
  };
}

/** Non-2xx double whose body reads as the given text. */
function errorText(status: number, body: string): StubResponse {
  return {
    status,
    ok: false,
    json: () => Promise.reject(new Error('json() must not be called on the error path')),
    text: () => Promise.resolve(body),
  };
}

/** Minimal 2xx definition: ok exactly inside [200, 299]. */
function rejectJson(status: number, error: Error): StubResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.reject(error),
    text: () => Promise.resolve(''),
  };
}

const GET_REQUEST: AuthorizedRequest = {
  method: 'GET',
  url: 'https://api.moonshot.cn/v1/users/me/balance',
  headers: { Authorization: 'Bearer kimi-token' },
};

describe('FetchTransport — 2xx passthrough', () => {
  it('returns { status, body } for a 200 JSON response and threads url/method/headers to fetchImpl', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    let textCalls = 0;
    const stub = respond(200, { data: { available_balance: '88.88' } });
    const transport = new FetchTransport(async (url, init) => {
      calls.push({ url, method: init.method, headers: { ...init.headers } });
      return { ...stub, text: () => { textCalls += 1; return Promise.resolve(''); } };
    });

    await expect(transport.fetch(GET_REQUEST)).resolves.toEqual({
      status: 200,
      body: { data: { available_balance: '88.88' } },
    });
    expect(calls).toEqual([{ url: GET_REQUEST.url, method: 'GET', headers: { Authorization: 'Bearer kimi-token' } }]);
    expect(textCalls).toBe(0); // 2xx is handled exactly as before: parsed as JSON
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

describe('FetchTransport — non-2xx throws HttpStatusError with a bounded body snippet (§Error Body Surfacing)', () => {
  it.each([400, 401, 403, 404, 429, 500, 503])('HTTP %i carries the status plus the body verbatim', async (status) => {
    const transport = new FetchTransport(async () => errorText(status, `boom-${status}`));

    const failure = await transport.fetch(GET_REQUEST).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HttpStatusError);
    expect((failure as HttpStatusError).status).toBe(status);
    expect((failure as Error).message).toBe(`HTTP ${status}: boom-${status}`);
  });

  it('caps the snippet at the first 200 body characters (long plain-text body, json never called)', async () => {
    let jsonCalls = 0;
    const longBody = `${'A'.repeat(150)}${'B'.repeat(350)}`; // 500 chars, boundary at char 200
    const transport = new FetchTransport(async () => ({
      status: 400,
      ok: false,
      json: () => {
        jsonCalls += 1;
        return Promise.reject(new Error('must not be called'));
      },
      text: () => Promise.resolve(longBody),
    }));

    const failure = await transport.fetch(GET_REQUEST).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HttpStatusError);
    expect((failure as HttpStatusError).status).toBe(400);
    expect((failure as Error).message).toBe(`HTTP 400: ${'A'.repeat(150)}${'B'.repeat(50)}`); // first 200, verbatim
    expect((failure as Error).message.length).toBe('HTTP 400: '.length + 200);
    expect((failure as Error).message).not.toContain('B'.repeat(51)); // nothing past the cap
    expect(jsonCalls).toBe(0); // read as text, never parsed as JSON
  });

  it('surfaces a JSON error document as raw text — server Code visible, never parsed', async () => {
    let jsonCalls = 0;
    const body = '{"RequestId":"4C4-UUID","Code":"InvalidAccessKeyId.NotFound","Message":"The specified AccessKeyID does not exist."}';
    const transport = new FetchTransport(async () => ({
      status: 400,
      ok: false,
      json: () => {
        jsonCalls += 1;
        return Promise.reject(new Error('must not be called'));
      },
      text: () => Promise.resolve(body),
    }));

    const failure = await transport.fetch(GET_REQUEST).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HttpStatusError);
    expect((failure as HttpStatusError).status).toBe(400);
    expect((failure as Error).message).toBe(`HTTP 400: ${body}`); // raw snippet, verbatim
    expect((failure as Error).message).toContain('"Code":"InvalidAccessKeyId.NotFound"');
    expect(jsonCalls).toBe(0); // no JSON parse on the error path
  });

  it('degrades to a status-only message when the body read rejects (no secondary failure)', async () => {
    const readFailure = new TypeError('body stream already locked');
    const transport = new FetchTransport(async () => ({
      status: 400,
      ok: false,
      json: () => Promise.reject(new Error('must not be called')),
      text: () => Promise.reject(readFailure),
    }));

    const failure = await transport.fetch(GET_REQUEST).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HttpStatusError); // the read failure never masks the status error
    expect(failure).not.toBe(readFailure);
    expect((failure as HttpStatusError).status).toBe(400);
    expect((failure as Error).message).toBe('HTTP 400');
  });
});

describe('FetchTransport — status-first error classification (AD-30 pins)', () => {
  // zai-monitor §Status-First Error Classification: error responses are
  // classified by HTTP status BEFORE any body parse — a plain-text body on an
  // error status can never cause a parse failure. Since hito-7 the error body
  // IS read, but only as text (§Error Body Surfacing); each stub's json()
  // still REJECTS and records the call, so jsonCalls > 0 or a ResponseParseError
  // would fail these pins twice over.
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limit'],
    [500, 'server'],
  ] as const)('plain-text body on HTTP %i classifies %s with no body parse', async (status, errorClass) => {
    let jsonCalls = 0;
    const transport = new FetchTransport(async () => ({
      status,
      ok: false,
      json: () => {
        jsonCalls += 1;
        return Promise.reject(new SyntaxError('Unexpected token <')); // plain-text body
      },
      text: () => Promise.resolve('plain-text error body'),
    }));

    const failure = await transport.fetch(GET_REQUEST).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HttpStatusError);
    expect(failure).not.toBeInstanceOf(ResponseParseError);
    expect((failure as HttpStatusError).status).toBe(status);
    expect(jsonCalls).toBe(0); // the error body is never even read
    expect(classifyRefreshError(failure)).toBe(errorClass);
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
