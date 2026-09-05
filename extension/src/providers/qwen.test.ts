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

  it('builds the documented BSS QueryAccountBalance request (API 2017-12-14)', async () => {
    const transport = new RecordingTransport([FIXTURE_RESPONSES['qwen/query-account-balance--ok']]);
    await driveRefresh(new QwenProvider(), {}, new AllowlistNetworkClient(transport), new FakeClock());

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]!.url).toBe(
      'https://business.aliyuncs.com/?Action=QueryAccountBalance&Version=2017-12-14',
    );
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
