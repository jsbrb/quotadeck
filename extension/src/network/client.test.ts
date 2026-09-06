import { describe, expect, it } from 'vitest';
import { AllowlistNetworkClient } from './client';
import { NetworkRejectionError, assertNoCredentialMaterial, type ProviderRequest } from './request';
import type { TransportResponse } from './transport';
import { FakeClock } from '../testing/fake-clock';
import { RecordingTransport } from '../testing/recording-transport';

// Hermetic (network-allowlist spec §Injectable Transport): every scenario runs
// against RecordingTransport — no real network call can occur, and rejections
// must leave ZERO recorded transport I/O.
const ZAI_CREDENTIAL = { type: 'bearer', token: 'zai-secret-token-4f2a' } as const;
const QWEN_PAIR = {
  type: 'ak-sk',
  accessKeyId: 'LTAI5tQwenAccessKeyId00',
  accessKeySecret: 'QwenSecretKey000000000000000000000',
} as const;
const okResponse: TransportResponse = { status: 200, body: { code: 200 } };

/** Decoded query params of a recorded request URL. */
function queryOf(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of url.split('?')[1]!.split('&')) {
    const eq = part.indexOf('=');
    out[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
  }
  return out;
}

function zaiRequest(url = 'https://api.z.ai/api/monitor/usage/quota/limit'): ProviderRequest {
  return { method: 'GET', url };
}

function qwenRequest(): ProviderRequest {
  return {
    method: 'GET',
    url: 'https://business.aliyuncs.com/',
    query: { Action: 'QueryAccountBalance', Version: '2017-12-14' },
  };
}

describe('AllowlistNetworkClient — admission', () => {
  it('admits an allowlisted host and passes a Bearer-authorized request to the transport', async () => {
    const transport = new RecordingTransport([okResponse]);
    const client = new AllowlistNetworkClient(transport);

    const response = await client.send('zai', zaiRequest(), ZAI_CREDENTIAL);

    expect(response).toBe(okResponse);
    expect(transport.requests).toHaveLength(1);
    const sent = transport.requests[0]!;
    expect(sent.method).toBe('GET');
    expect(sent.url).toBe('https://api.z.ai/api/monitor/usage/quota/limit');
    // Key placement: the credential appears ONLY in the Authorization header.
    expect(sent.headers).toEqual({ Authorization: `Bearer ${ZAI_CREDENTIAL.token}` });
    expect(sent.url).not.toContain(ZAI_CREDENTIAL.token);
  });

  it('admits a subdomain of an allowlisted host (AD-5 suffix match)', async () => {
    const transport = new RecordingTransport([okResponse]);
    const client = new AllowlistNetworkClient(transport);

    await client.send('zai', zaiRequest('https://edge.api.z.ai/api/monitor/usage/quota/limit'), ZAI_CREDENTIAL);

    expect(transport.requests).toHaveLength(1);
  });

  it('admits the second monitor host open.bigmodel.cn (AD-29)', async () => {
    const transport = new RecordingTransport([okResponse]);
    const client = new AllowlistNetworkClient(transport);

    await client.send('zai', zaiRequest('https://open.bigmodel.cn/api/monitor/usage/quota/limit'), ZAI_CREDENTIAL);

    expect(transport.requests).toHaveLength(1);
  });
});

describe('AllowlistNetworkClient — rejection with zero transport I/O', () => {
  it.each([
    {
      case: 'non-allowlisted host',
      request: zaiRequest('https://evil.example.com/api/monitor/usage/quota/limit'),
    },
    {
      case: 'cross-provider host (Kimi host used by ZAI)',
      request: zaiRequest('https://api.moonshot.cn/v1/users/me/balance'),
    },
    {
      case: 'retired apex bigmodel.cn (AD-29 — expenseBillList is dead)',
      request: zaiRequest('https://bigmodel.cn/api/finance/expenseBill/expenseBillList'),
    },
  ])('rejects $case before any I/O', async ({ request }) => {
    const transport = new RecordingTransport(); // empty queue: any fetch would throw
    const client = new AllowlistNetworkClient(transport);

    await expect(client.send('zai', request, ZAI_CREDENTIAL)).rejects.toBeInstanceOf(
      NetworkRejectionError,
    );
    expect(transport.requests).toHaveLength(0);
  });

  it('rejects host-not-allowed with the explicit rejection reason', async () => {
    const client = new AllowlistNetworkClient(new RecordingTransport());
    const attempt = client.send(
      'zai',
      zaiRequest('https://evil.example.com/api/monitor/usage/quota/limit'),
      ZAI_CREDENTIAL,
    );
    await expect(attempt).rejects.toMatchObject({
      name: 'NetworkRejectionError',
      reason: 'host-not-allowed',
    });
  });

  it('rejects a credential smuggled as a query parameter', async () => {
    const transport = new RecordingTransport();
    const client = new AllowlistNetworkClient(transport);
    const smuggled: ProviderRequest = {
      method: 'GET',
      url: 'https://api.z.ai/api/monitor/usage/quota/limit',
      query: { apikey: ZAI_CREDENTIAL.token },
    };

    await expect(client.send('zai', smuggled, ZAI_CREDENTIAL)).rejects.toMatchObject({
      reason: 'credential-placement',
    });
    expect(transport.requests).toHaveLength(0);
  });

  it('rejects a credential smuggled in the request body', async () => {
    const transport = new RecordingTransport();
    const client = new AllowlistNetworkClient(transport);
    const smuggled: ProviderRequest = {
      method: 'POST',
      url: 'https://api.z.ai/api/monitor/usage/quota/limit',
      body: JSON.stringify({ token: ZAI_CREDENTIAL.token }),
    };

    await expect(client.send('zai', smuggled, ZAI_CREDENTIAL)).rejects.toMatchObject({
      reason: 'credential-placement',
    });
    expect(transport.requests).toHaveLength(0);
  });
});

describe('AllowlistNetworkClient — raw attach (AD-25, ZAI monitor hosts only; re-pinned to api.z.ai by AD-29)', () => {
  const RAW_CREDENTIAL = { type: 'raw', token: 'zai-monitor-key-7f3d' } as const;

  it('attaches raw credentials verbatim (no Bearer) with Accept-Language on the monitor host', async () => {
    const transport = new RecordingTransport([okResponse]);
    const client = new AllowlistNetworkClient(transport);

    const response = await client.send('zai', zaiRequest('https://api.z.ai/api/monitor/usage/quota/limit'), RAW_CREDENTIAL);

    expect(response).toBe(okResponse);
    expect(transport.requests).toHaveLength(1);
    const sent = transport.requests[0]!;
    // Verbatim: the raw key IS the Authorization value — no Bearer prefix.
    expect(sent.headers.Authorization).toBe('zai-monitor-key-7f3d');
    expect(sent.headers.Authorization).not.toContain('Bearer');
    expect(sent.headers['Accept-Language']).toBe('zh-CN');
  });

  it('attaches raw credentials on both monitor hosts (§Raw Authorization)', async () => {
    const transport = new RecordingTransport([okResponse, okResponse]);
    const client = new AllowlistNetworkClient(transport);

    await client.send('zai', zaiRequest('https://api.z.ai/api/monitor/usage/quota/limit'), RAW_CREDENTIAL);
    await client.send('zai', zaiRequest('https://open.bigmodel.cn/api/monitor/usage/quota/limit'), RAW_CREDENTIAL);

    for (const sent of transport.requests) {
      expect(sent.headers.Authorization).toBe('zai-monitor-key-7f3d'); // raw key, no Bearer
      expect(sent.headers['Accept-Language']).toBeDefined();
    }
  });

  it('rejects raw attach off the ZAI monitor hosts — zero transport I/O', async () => {
    const transport = new RecordingTransport(); // empty queue: any fetch would throw
    const client = new AllowlistNetworkClient(transport);

    await expect(
      client.send('kimi', zaiRequest('https://api.moonshot.cn/v1/users/me/balance'), RAW_CREDENTIAL),
    ).rejects.toMatchObject({
      name: 'NetworkRejectionError',
      reason: 'credential-placement',
    });
    expect(transport.requests).toHaveLength(0);
  });

  it('rejects raw attach to a host outside every allowlist before any I/O', async () => {
    const transport = new RecordingTransport();
    const client = new AllowlistNetworkClient(transport);

    await expect(
      client.send('zai', zaiRequest('https://evil.example.com/api/monitor/usage/quota/limit'), RAW_CREDENTIAL),
    ).rejects.toMatchObject({ name: 'NetworkRejectionError', reason: 'host-not-allowed' });
    expect(transport.requests).toHaveLength(0);
  });

  it('a raw key smuggled outside the Authorization header is rejected (raw joins the token scan arm)', async () => {
    const transport = new RecordingTransport();
    const client = new AllowlistNetworkClient(transport);
    const smuggled: ProviderRequest = {
      method: 'GET',
      url: 'https://api.z.ai/api/monitor/usage/quota/limit',
      query: { apikey: RAW_CREDENTIAL.token },
    };

    await expect(client.send('zai', smuggled, RAW_CREDENTIAL)).rejects.toMatchObject({
      reason: 'credential-placement',
    });
    expect(transport.requests).toHaveLength(0);
  });
});

describe('AllowlistNetworkClient — ak-sk attach (AD-19, qwen only)', () => {
  it('signs the qwen BSS query and dispatches with NO Authorization header', async () => {
    const transport = new RecordingTransport([okResponse]);
    // FakeClock default epoch 1_700_000_000_000 → 2023-11-14T22:13:20Z.
    const client = new AllowlistNetworkClient(transport, { clock: new FakeClock(), nonce: () => 'fixed-nonce-0001' });

    const response = await client.send('qwen', qwenRequest(), QWEN_PAIR);

    expect(response).toBe(okResponse);
    const sent = transport.requests[0]!;
    expect(sent.url.startsWith('https://business.aliyuncs.com/?')).toBe(true);
    // NO Authorization header — the RPC exception carries auth in the query.
    expect(sent.headers).toEqual({});
    expect(sent.headers.Authorization).toBeUndefined();
    const params = queryOf(sent.url);
    expect(params.AccessKeyId).toBe(QWEN_PAIR.accessKeyId);
    expect(params.Action).toBe('QueryAccountBalance');
    expect(params.Version).toBe('2017-12-14');
    expect(params.SignatureMethod).toBe('HMAC-SHA1');
    expect(params.SignatureVersion).toBe('1.0');
    expect(params.SignatureNonce).toBe('fixed-nonce-0001'); // injected rng
    expect(params.Timestamp).toBe('2023-11-14T22:13:20Z'); // injected clock, no milliseconds
    expect(params.Timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); // §RPC Timestamp Format: no '.'
    expect(params.Signature).toMatch(/^[A-Za-z0-9+/]+={0,2}$/); // derived signature present
  });

  it('normalizes a millisecond-carrying clock to the no-millis POP Timestamp (§RPC Timestamp Format)', async () => {
    const transport = new RecordingTransport([okResponse]);
    const client = new AllowlistNetworkClient(transport, {
      clock: new FakeClock(1_700_000_000_123), // nonzero milliseconds
      nonce: () => 'fixed-nonce-0001',
    });

    await client.send('qwen', qwenRequest(), QWEN_PAIR);

    const params = queryOf(transport.requests[0]!.url);
    expect(params.Timestamp).toBe('2023-11-14T22:13:20Z'); // millis stripped before signing
    expect(params.Timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('rejects an ak-sk credential for any provider other than qwen, with zero I/O', async () => {
    const transport = new RecordingTransport();
    const client = new AllowlistNetworkClient(transport);

    await expect(client.send('openai', zaiRequest('https://api.openai.com/v1/organization/costs'), QWEN_PAIR)).rejects.toMatchObject({
      name: 'NetworkRejectionError',
      reason: 'credential-placement',
    });
    expect(transport.requests).toHaveLength(0);
  });
});

describe('credential-kind scan (AD-19) — AccessKeyId scoped to the Qwen host', () => {
  it('admits AccessKeyId as a query parameter on the Qwen BSS host', () => {
    const request: ProviderRequest = {
      method: 'GET',
      url: 'https://business.aliyuncs.com/',
      query: { AccessKeyId: QWEN_PAIR.accessKeyId, Action: 'QueryAccountBalance' },
    };
    expect(() =>
      assertNoCredentialMaterial(
        request,
        QWEN_PAIR,
        'https://business.aliyuncs.com/?AccessKeyId=LTAI5tQwenAccessKeyId00&Action=QueryAccountBalance',
      ),
    ).not.toThrow();
  });

  it('admits AccessKeyId as a query parameter on the international BSS host too (hito-8 two-host scope)', () => {
    const request: ProviderRequest = {
      method: 'GET',
      url: 'https://business.ap-southeast-1.aliyuncs.com/',
      query: { AccessKeyId: QWEN_PAIR.accessKeyId, Action: 'QueryAccountBalance' },
    };
    expect(() =>
      assertNoCredentialMaterial(
        request,
        QWEN_PAIR,
        'https://business.ap-southeast-1.aliyuncs.com/?AccessKeyId=LTAI5tQwenAccessKeyId00&Action=QueryAccountBalance',
      ),
    ).not.toThrow();
  });

  it('rejects signed-style credentials off the Qwen host (spec scenario)', () => {
    const request: ProviderRequest = {
      method: 'GET',
      url: 'https://api.openai.com/v1/organization/costs',
      query: { AccessKeyId: QWEN_PAIR.accessKeyId },
    };
    expect(() =>
      assertNoCredentialMaterial(request, QWEN_PAIR, 'https://api.openai.com/v1/organization/costs?AccessKeyId=LTAI5tQwenAccessKeyId00'),
    ).toThrowError(NetworkRejectionError);
    try {
      assertNoCredentialMaterial(request, QWEN_PAIR, 'https://api.openai.com/v1/organization/costs?AccessKeyId=LTAI5tQwenAccessKeyId00');
    } catch (error) {
      expect((error as NetworkRejectionError).reason).toBe('credential-placement');
    }
  });

  it('2.9 RED: rejects AccessKeyId in the query on the token-plan probe host — BSS-only scoping (spec scenario)', () => {
    const request: ProviderRequest = {
      method: 'POST',
      url: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      query: { AccessKeyId: QWEN_PAIR.accessKeyId },
    };
    expect(() =>
      assertNoCredentialMaterial(
        request,
        QWEN_PAIR,
        'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions?AccessKeyId=LTAI5tQwenAccessKeyId00',
      ),
    ).toThrowError(NetworkRejectionError);
  });

  it('rejects the AccessKeySecret in the query even on the Qwen host', () => {
    const request: ProviderRequest = {
      method: 'GET',
      url: 'https://business.aliyuncs.com/',
      query: { AccessKeySecret: QWEN_PAIR.accessKeySecret },
    };
    expect(() =>
      assertNoCredentialMaterial(request, QWEN_PAIR, `https://business.aliyuncs.com/?AccessKeySecret=${QWEN_PAIR.accessKeySecret}`),
    ).toThrowError(/AccessKeySecret/u);
  });

  it('rejects AccessKeyId in the URL path or body even on the Qwen host', () => {
    const inPath: ProviderRequest = { method: 'GET', url: `https://business.aliyuncs.com/${QWEN_PAIR.accessKeyId}`, query: {} };
    expect(() => assertNoCredentialMaterial(inPath, QWEN_PAIR, inPath.url)).toThrowError(/AccessKeyId/u);

    const inBody: ProviderRequest = { method: 'POST', url: 'https://business.aliyuncs.com/', body: JSON.stringify({ ak: QWEN_PAIR.accessKeyId }) };
    expect(() => assertNoCredentialMaterial(inBody, QWEN_PAIR, inBody.url)).toThrowError(/AccessKeyId/u);
  });
});

describe('AllowlistNetworkClient — qwen plan key (hito-8 §Credential Attach Modes)', () => {
  const PLAN_CREDENTIAL = { type: 'qwen-plan', token: 'sk-sp-plan-probe-key-9999' } as const;

  function probeRequest(): ProviderRequest {
    return {
      method: 'POST',
      url: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      body: JSON.stringify({ model: 'qwen3.6-flash', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false }),
    };
  }

  it('admits the probe host and attaches the sk-sp- key ONLY as the Bearer Authorization header', async () => {
    const transport = new RecordingTransport([okResponse]);
    const client = new AllowlistNetworkClient(transport);

    const response = await client.send('qwen', probeRequest(), PLAN_CREDENTIAL);

    expect(response).toBe(okResponse);
    const sent = transport.requests[0]!;
    // A dispatched JSON body is always labeled: the token-plan endpoint
    // rejects unlabeled POST bodies with HTTP 400 (live-found 2026-09-06).
    expect(sent.headers).toEqual({
      Authorization: 'Bearer sk-sp-plan-probe-key-9999',
      'Content-Type': 'application/json',
    });
    expect(sent.url).not.toContain('sk-sp-');
    expect(sent.body ?? '').not.toContain('sk-sp-'); // key confined to the header, never the body
    expect(sent.body ?? '').not.toContain('AccessKeyId'); // probe body is the documented 1-token shape
  });

  it('a bodyless GET attaches NO Content-Type — the label belongs to the body, not the credential', async () => {
    const transport = new RecordingTransport([okResponse]);
    const client = new AllowlistNetworkClient(transport);

    await client.send('zai', zaiRequest(), ZAI_CREDENTIAL);

    const sent = transport.requests[0]!;
    expect(sent.headers).toEqual({ Authorization: 'Bearer zai-secret-token-4f2a' });
  });

  it('rejects a qwen plan key off the probe host — even on the qwen-allowlisted BSS hosts — with zero I/O', async () => {
    const transport = new RecordingTransport(); // empty queue: any fetch would throw
    const client = new AllowlistNetworkClient(transport);

    await expect(
      client.send('qwen', qwenRequest(), PLAN_CREDENTIAL), // business.aliyuncs.com is allowlisted, but not for plan keys
    ).rejects.toMatchObject({ name: 'NetworkRejectionError', reason: 'credential-placement' });
    expect(transport.requests).toHaveLength(0);
  });
});

describe('signed qwen dispatch — secret never transmitted (O2: every surface asserted)', () => {
  it('the AccessKeySecret appears in NO surface: url, query, body, headers, cookies', async () => {
    const transport = new RecordingTransport([okResponse]);
    const client = new AllowlistNetworkClient(transport, { clock: new FakeClock(), nonce: () => 'fixed-nonce-0001' });
    await client.send('qwen', qwenRequest(), QWEN_PAIR);
    const sent = transport.requests[0]!;

    // url — whole URL including its query component
    expect(sent.url.includes(QWEN_PAIR.accessKeySecret)).toBe(false);
    // query — every parameter, raw AND decoded
    for (const [key, value] of Object.entries(queryOf(sent.url))) {
      expect(key.includes(QWEN_PAIR.accessKeySecret)).toBe(false);
      expect(value.includes(QWEN_PAIR.accessKeySecret)).toBe(false);
      expect(decodeURIComponent(value).includes(QWEN_PAIR.accessKeySecret)).toBe(false);
    }
    // body — absent or clean
    expect((sent.body ?? '').includes(QWEN_PAIR.accessKeySecret)).toBe(false);
    // headers — no value carries the secret
    for (const value of Object.values(sent.headers)) {
      expect(value.includes(QWEN_PAIR.accessKeySecret)).toBe(false);
    }
    // cookies — structurally impossible: no Cookie header, no cookie field
    expect(sent.headers.Cookie).toBeUndefined();
    expect('cookies' in sent).toBe(false);
    // whole-request sweep
    expect(JSON.stringify(sent).includes(QWEN_PAIR.accessKeySecret)).toBe(false);
  });
});
