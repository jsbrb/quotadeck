import { describe, expect, it } from 'vitest';
import { AllowlistNetworkClient } from './client';
import { NetworkRejectionError, type ProviderRequest } from './request';
import type { TransportResponse } from './transport';
import { RecordingTransport } from '../testing/recording-transport';

// Hermetic (network-allowlist spec §Injectable Transport): every scenario runs
// against RecordingTransport — no real network call can occur, and rejections
// must leave ZERO recorded transport I/O.
const ZAI_CREDENTIAL = 'zai-secret-token-4f2a';
const okResponse: TransportResponse = { status: 200, body: { code: 200 } };

function zaiRequest(url = 'https://bigmodel.cn/api/finance/expenseBill/expenseBillList'): ProviderRequest {
  return {
    method: 'GET',
    url,
    query: { billingMonth: '2026-08', pageNum: 1, pageSize: 20 },
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
    expect(sent.url).toBe(
      'https://bigmodel.cn/api/finance/expenseBill/expenseBillList?billingMonth=2026-08&pageNum=1&pageSize=20',
    );
    // Key placement: the credential appears ONLY in the Authorization header.
    expect(sent.headers).toEqual({ Authorization: `Bearer ${ZAI_CREDENTIAL}` });
    expect(sent.url).not.toContain(ZAI_CREDENTIAL);
  });

  it('admits a subdomain of an allowlisted host (AD-5 suffix match)', async () => {
    const transport = new RecordingTransport([okResponse]);
    const client = new AllowlistNetworkClient(transport);

    await client.send('zai', zaiRequest('https://open.bigmodel.cn/api/finance/expenseBill/expenseBillList'), ZAI_CREDENTIAL);

    expect(transport.requests).toHaveLength(1);
  });
});

describe('AllowlistNetworkClient — rejection with zero transport I/O', () => {
  it.each([
    {
      case: 'non-allowlisted host',
      request: zaiRequest('https://evil.example.com/api/finance/expenseBill/expenseBillList'),
    },
    {
      case: 'cross-provider host (Kimi host used by ZAI)',
      request: zaiRequest('https://api.moonshot.cn/v1/users/me/balance'),
    },
    {
      case: 'unverified international variant api.z.ai',
      request: zaiRequest('https://api.z.ai/api/finance/expenseBill/expenseBillList'),
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
      zaiRequest('https://evil.example.com/api/finance/expenseBill/expenseBillList'),
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
      url: 'https://bigmodel.cn/api/finance/expenseBill/expenseBillList',
      query: { apikey: ZAI_CREDENTIAL },
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
      url: 'https://bigmodel.cn/api/finance/expenseBill/expenseBillList',
      body: JSON.stringify({ token: ZAI_CREDENTIAL }),
    };

    await expect(client.send('zai', smuggled, ZAI_CREDENTIAL)).rejects.toMatchObject({
      reason: 'credential-placement',
    });
    expect(transport.requests).toHaveLength(0);
  });
});
