import { describe, expect, it } from 'vitest';
import { validateCredential } from '../core/credentials';
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
      {},
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
    await driveRefresh(new QwenProvider(), {}, client, new FakeClock());

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
