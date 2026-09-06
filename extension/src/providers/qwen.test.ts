import { describe, expect, it } from 'vitest';
import { validateCredential } from '../core/credentials';
import type { QwenSite } from '../core/qwen-sites';
import { ProviderApiError, type UsageQuery } from '../core/provider';
import { FIXTURE_RESPONSES } from '../fixtures';
import { AllowlistNetworkClient } from '../network/client';
import { FakeClock } from '../testing/fake-clock';
import { driveRefresh } from '../testing/provider-refresh';
import { RecordingTransport } from '../testing/recording-transport';
import { QwenProvider } from './qwen';

describe('QwenProvider (spec §Qwen Parsing)', () => {
  it('parses Data.AvailableAmount / Data.Currency into a normalized balance', async () => {
    const transport = new RecordingTransport([FIXTURE_RESPONSES['qwen/query-account-balance--ok']]);
    const usage = await driveRefresh(
      new QwenProvider(),
      // The recorded fixture is the CN-site shape; the default site is now
      // international (allowlisted in the network unit), so this CN dispatch
      // pins the china base explicitly. The intl dispatch is pinned at the
      // tick level in background.test.ts.
      { qwenSite: 'china' },
      new AllowlistNetworkClient(transport),
      new FakeClock(),
    );

    expect(usage.providerId).toBe('qwen');
    expect(usage.kind).toBe('balance');
    expect(usage.value).toBe(100.28);
    expect(usage.currency).toBe('CNY');
  });

  it('builds the documented BSS QueryAccountBalance request, signed per AD-19 (no Authorization header)', async () => {
    const transport = new RecordingTransport([FIXTURE_RESPONSES['qwen/query-account-balance--ok']]);
    const client = new AllowlistNetworkClient(transport, {
      clock: new FakeClock(),
      nonce: () => 'test-nonce-0001',
    });
    await driveRefresh(new QwenProvider(), { qwenSite: 'china' }, client, new FakeClock());

    expect(transport.requests).toHaveLength(1);
    const sent = transport.requests[0]!;
    expect(sent.headers).toEqual({}); // ak-sk: auth travels as the signed query
    const params: Record<string, string> = {};
    for (const part of sent.url.split('?')[1]!.split('&')) {
      const eq = part.indexOf('=');
      params[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
    }
    expect(params.Action).toBe('QueryAccountBalance');
    expect(params.Version).toBe('2017-12-14');
    expect(params.AccessKeyId).toBe('LTAI5tTestDriverAK000');
    expect(params.SignatureMethod).toBe('HMAC-SHA1');
    expect(params.SignatureNonce).toBe('test-nonce-0001');
    expect(params.Signature.length).toBeGreaterThan(0);
  });

  it('declares ak-sk, so DashScope sk- keys are rejected with AK/SK + RAM guidance', () => {
    const qwen = new QwenProvider();
    expect(qwen.credentialType).toBe('ak-sk');

    const result = validateCredential(qwen.credentialType, 'sk-dashscope-not-alibaba');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/AK\/SK/);
      expect(result.message).toMatch(/bss:DescribeAcccount/);
    }
  });

  it('throws an explicit error when Data.AvailableAmount is missing', () => {
    const provider = new QwenProvider();
    expect(() => provider.parsePage({ Code: '200', Success: true, Data: {} }, null)).toThrow(
      /Data\.AvailableAmount/,
    );
  });
});

describe('QwenProvider site selection (spec §Qwen Parsing — site-selected base)', () => {
  it('defaults to the international BSS base when no site is selected', () => {
    const request = new QwenProvider().firstRequest({});

    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://business.ap-southeast-1.aliyuncs.com/');
    expect(request.query).toEqual({ Action: 'QueryAccountBalance', Version: '2017-12-14' });
  });

  it('targets the china BSS base when qwenSite is china', () => {
    const request = new QwenProvider().firstRequest({ qwenSite: 'china' });

    expect(request.url).toBe('https://business.aliyuncs.com/');
    expect(request.query).toEqual({ Action: 'QueryAccountBalance', Version: '2017-12-14' });
  });

  it('throws before any dispatch when qwenSite is neither international nor china', () => {
    const query: UsageQuery = { qwenSite: 'mars' as unknown as QwenSite };
    expect(() => new QwenProvider().firstRequest(query)).toThrow(/qwenSite/i);
  });
});

describe('QwenProvider envelope tolerance (spec §Qwen Parsing — tolerant envelope)', () => {
  it('parses the international string envelope: string amount, string Code "200", Success true', () => {
    const page = new QwenProvider().parsePage(
      FIXTURE_RESPONSES['qwen/query-account-balance--intl-ok'].body,
      null,
    );

    expect(page.done).toBe(true);
    if (page.done) {
      expect(page.usage.value).toBe(0);
      expect(page.usage.currency).toBe('USD');
    }
  });

  it('parses the china numeric envelope: numeric amount and numeric Code 200', () => {
    const body = { Code: 200, Success: true, Data: { AvailableAmount: 123.45, Currency: 'CNY' } };

    const page = new QwenProvider().parsePage(body, null);

    expect(page.done).toBe(true);
    if (page.done) {
      expect(page.usage.value).toBe(123.45);
      expect(page.usage.currency).toBe('CNY');
    }
  });

  it('rejects an explicitly non-success envelope: Success false fails as a body-level error', () => {
    const body = { Code: '200', Success: false, Data: { AvailableAmount: '1.00', Currency: 'USD' } };

    expect(() => new QwenProvider().parsePage(body, null)).toThrow(ProviderApiError);
    expect(() => new QwenProvider().parsePage(body, null)).toThrow(/Success/i);
  });

  it('rejects a Code other than 200 in either form as a body-level error', () => {
    const data = { AvailableAmount: '1.00', Currency: 'USD' };

    expect(() => new QwenProvider().parsePage({ Code: '400', Success: true, Data: data }, null)).toThrow(
      ProviderApiError,
    );
    expect(() => new QwenProvider().parsePage({ Code: 400, Success: true, Data: data }, null)).toThrow(
      ProviderApiError,
    );
  });
});
