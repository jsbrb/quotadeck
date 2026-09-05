import { describe, expect, it } from 'vitest';
import { FIXTURE_RESPONSES } from '../fixtures';
import { AllowlistNetworkClient } from '../network/client';
import type { TransportResponse } from '../network/transport';
import { FakeClock } from '../testing/fake-clock';
import { driveRefresh } from '../testing/provider-refresh';
import { RecordingTransport } from '../testing/recording-transport';
import { ZaiProvider } from './zai';

// Hermetic (spec §Fixture-Only Data): every scenario parses recorded fixture
// files through the real AllowlistNetworkClient against a RecordingTransport
// — no network I/O can occur, and the jitter assertions use FakeClock, never
// wall-clock waiting.
const page = (key: 'zai/expense-bill-list--page-1' | 'zai/expense-bill-list--page-2' | 'zai/expense-bill-list--page-3'): TransportResponse =>
  FIXTURE_RESPONSES[key];

function zaiTransport(): RecordingTransport {
  return new RecordingTransport([
    page('zai/expense-bill-list--page-1'),
    page('zai/expense-bill-list--page-2'),
    page('zai/expense-bill-list--page-3'),
  ]);
}

describe('ZaiProvider — parse (spec §ZAI Parsing)', () => {
  it('rejects a string "200" code with an explicit error', () => {
    const provider = new ZaiProvider();
    provider.firstRequest({ billingMonth: '2026-08' });
    expect(() =>
      provider.parsePage(FIXTURE_RESPONSES['zai/expense-bill-list--code-string-200'].body, null),
    ).toThrow(/numeric code 200.*got string "200"/i);
  });

  it('rejects a non-200 numeric code with an explicit error', () => {
    const provider = new ZaiProvider();
    provider.firstRequest({ billingMonth: '2026-08' });
    expect(() =>
      provider.parsePage(FIXTURE_RESPONSES['zai/expense-bill-list--code-500'].body, null),
    ).toThrow(/numeric code 200.*got number 500/i);
  });

  it('parses fixture page 1 into a continuation carrying billingMonth/pageNum/pageSize', () => {
    const provider = new ZaiProvider();
    provider.firstRequest({ billingMonth: '2026-08' });
    const parse = provider.parsePage(page('zai/expense-bill-list--page-1').body, null);
    expect(parse.done).toBe(false);
    if (!parse.done) {
      expect(parse.next.query).toEqual({ billingMonth: '2026-08', pageNum: 2, pageSize: 2 });
      expect(parse.state).toBeDefined(); // opaque fold state for the engine (AD-2)
    }
  });

  it('rejects a missing or malformed billingMonth before dispatch', () => {
    const provider = new ZaiProvider();
    expect(() => provider.firstRequest({})).toThrow(/billingMonth.*YYYY-MM/i);
    expect(() => provider.firstRequest({ billingMonth: '2026/08' })).toThrow(/billingMonth.*YYYY-MM/i);
  });
});

describe('ZaiProvider — pagination across the recorded 3-page flow', () => {
  it('collects every page until total unique records: cost = Σ costPrice/1000×deductUsage, tier from tokenResourceName', async () => {
    const clock = new FakeClock();
    const client = new AllowlistNetworkClient(zaiTransport());

    const usage = await driveRefresh(new ZaiProvider(), { billingMonth: '2026-08' }, client, clock, () => 0);

    // 20 + 5 + 12 + 1 + 1 = 39; the page-2 duplicate of BL202608010001 (worth
    // 20) is counted once — a double count would yield 59.
    expect(usage.value).toBe(39);
    expect(usage.kind).toBe('cost');
    expect(usage.currency).toBe('CNY');
    expect(usage.tier).toBe('GLM-4.5-Air'); // tokenResourceName of the final record
    expect(usage.providerId).toBe('zai');
  });

  it('requires all 3 pages and carries billingMonth/pageNum/pageSize on each request', async () => {
    const transport = zaiTransport();
    const client = new AllowlistNetworkClient(transport);

    await driveRefresh(new ZaiProvider(), { billingMonth: '2026-08' }, client, new FakeClock(), () => 0);

    expect(transport.requests).toHaveLength(3);
    expect(transport.requests.map((request) => request.url)).toEqual([
      'https://bigmodel.cn/api/finance/expenseBill/expenseBillList?billingMonth=2026-08&pageNum=1&pageSize=2',
      'https://bigmodel.cn/api/finance/expenseBill/expenseBillList?billingMonth=2026-08&pageNum=2&pageSize=2',
      'https://bigmodel.cn/api/finance/expenseBill/expenseBillList?billingMonth=2026-08&pageNum=3&pageSize=2',
    ]);
  });

  it('sleeps exactly N−1 times on the injected Clock, each draw inside [500, 2000] ms', async () => {
    const minClock = new FakeClock();
    await driveRefresh(
      new ZaiProvider(),
      { billingMonth: '2026-08' },
      new AllowlistNetworkClient(zaiTransport()),
      minClock,
      () => 0, // rng 0 → always the minimum of the window
    );
    expect(minClock.sleeps).toEqual([500, 500]); // 3 pages → 2 sleeps

    const maxClock = new FakeClock();
    await driveRefresh(
      new ZaiProvider(),
      { billingMonth: '2026-08' },
      new AllowlistNetworkClient(zaiTransport()),
      maxClock,
      () => 1, // rng 1 → always the maximum of the window
    );
    expect(maxClock.sleeps).toEqual([2000, 2000]);
  });
});
