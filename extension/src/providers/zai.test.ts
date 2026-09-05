import { describe, expect, it } from 'vitest';
import { ProviderApiError, type UsageQuery } from '../core/provider';
import { DEFAULT_TIER_LIMITS, cstEpoch } from '../core/tier-budget';
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
// wall-clock waiting. Window semantics are driven by a literal injected
// `now`; the fixtures were recorded around 2026-08-30 12:00 +08:00.
const HOUR = 3_600_000;
/** Fixture-internal refresh instant the main-flow records were built around. */
const NOW = cstEpoch(2026, 8, 30, 12, 0, 0);
const MAIN_QUERY: UsageQuery = { billingMonths: ['2026-08'], now: NOW };

type MainFlowPage =
  | 'zai/expense-bill-list--page-1'
  | 'zai/expense-bill-list--page-2'
  | 'zai/expense-bill-list--page-3';

/** Typed view over a recorded ZAI page body (fixture-internal shape, O3). */
interface ZaiPageJson {
  data: { customerId?: unknown; list: Array<{ billingNo: string; tokenResourceName: string }> };
}

function zaiPage(key: MainFlowPage): ZaiPageJson {
  return FIXTURE_RESPONSES[key].body as ZaiPageJson;
}

function mainFlowPages(): TransportResponse[] {
  const pages: MainFlowPage[] = [
    'zai/expense-bill-list--page-1',
    'zai/expense-bill-list--page-2',
    'zai/expense-bill-list--page-3',
  ];
  return pages.map((key) => FIXTURE_RESPONSES[key]);
}

describe('ZaiProvider — parse (spec §ZAI Parsing)', () => {
  it('rejects a string "200" code with a ProviderApiError', () => {
    const provider = new ZaiProvider();
    provider.firstRequest(MAIN_QUERY);
    const rejection = () =>
      provider.parsePage(FIXTURE_RESPONSES['zai/expense-bill-list--code-string-200'].body, null);
    expect(rejection).toThrow(/numeric code 200.*got string "200"/i);
    expect(rejection).toThrow(ProviderApiError); // body-level failure classifies as `server` (AD-21)
  });

  it('rejects a non-200 numeric code with a ProviderApiError', () => {
    const provider = new ZaiProvider();
    provider.firstRequest(MAIN_QUERY);
    const rejection = () => provider.parsePage(FIXTURE_RESPONSES['zai/expense-bill-list--code-500'].body, null);
    expect(rejection).toThrow(/numeric code 200.*got number 500/i);
    expect(rejection).toThrow(ProviderApiError);
  });

  it('rejects a missing, empty or malformed billingMonths array before dispatch', () => {
    const provider = new ZaiProvider();
    expect(() => provider.firstRequest({ now: NOW })).toThrow(/billingMonths.*YYYY-MM/i);
    expect(() => provider.firstRequest({ billingMonths: [], now: NOW })).toThrow(/billingMonths.*YYYY-MM/i);
    expect(() => provider.firstRequest({ billingMonths: ['2026/08'], now: NOW })).toThrow(
      /billingMonths.*YYYY-MM/i,
    );
  });

  it('rejects a missing or non-finite now before dispatch', () => {
    const provider = new ZaiProvider();
    expect(() => provider.firstRequest({ billingMonths: ['2026-08'] })).toThrow(/now.*epoch/i);
    expect(() => provider.firstRequest({ billingMonths: ['2026-08'], now: Number.NaN })).toThrow(/now.*epoch/i);
  });
});

describe('ZaiProvider — fixture consistency (O3: community-pinned shape)', () => {
  it('pins data.customerId on every main-flow page and known tiers only', () => {
    for (const key of ['page-1', 'page-2', 'page-3'] as const) {
      const data = zaiPage(`zai/expense-bill-list--${key}`).data;
      expect(data.customerId).toBe('10997756');
      for (const record of data.list) {
        expect(Object.keys(DEFAULT_TIER_LIMITS)).toContain(record.tokenResourceName);
      }
    }
  });

  it('preserves the cross-page duplicate billingNo the dedupe fold must survive', () => {
    const page1 = zaiPage('zai/expense-bill-list--page-1').data.list;
    const page2 = zaiPage('zai/expense-bill-list--page-2').data.list;
    expect(page2[0]?.billingNo).toBe(page1[0]?.billingNo);
  });
});

describe('ZaiProvider — pagination + window semantics over the recorded 3-page flow', () => {
  it('folds cost over deduped records and evaluates the 5h budget from the injected now', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      MAIN_QUERY,
      new AllowlistNetworkClient(new RecordingTransport(mainFlowPages())),
      new FakeClock(),
      () => 0,
    );

    // 20 + 5 + 12 + 1 + 1 = 39; the page-2 duplicate of the first record
    // (worth 20) counts once — a double count would yield 59.
    expect(usage.kind).toBe('cost');
    expect(usage.value).toBe(39);
    expect(usage.currency).toBe('CNY');
    expect(usage.tier).toBe('Lite'); // latest in-window record's tokenResourceName (AD-23)

    // In-window apiUsage: 900 (08:00) + 600 (09:30) + 500 (10:15) + 400 (11:45)
    // = 2400; the Aug-28 record (999) is outside now − 5h and excluded.
    expect(usage.budget).toEqual({
      used: 2400,
      limit: 2400, // default Lite limit
      percent: 100, // exactly 100 — not capped from above
      tier: 'Lite',
      resetAt: cstEpoch(2026, 8, 30, 17, 0, 0), // latest record's timeWindow end after the `~` split
    });
  });

  it('applies tierLimits overrides over the defaults', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      { ...MAIN_QUERY, tierLimits: { Lite: 4800 } },
      new AllowlistNetworkClient(new RecordingTransport(mainFlowPages())),
      new FakeClock(),
      () => 0,
    );

    expect(usage.budget).toMatchObject({ used: 2400, limit: 4800, percent: 50 });
  });

  it('requires all 3 pages and carries billingMonth/pageNum/pageSize on each request', async () => {
    const transport = new RecordingTransport(mainFlowPages());

    await driveRefresh(new ZaiProvider(), MAIN_QUERY, new AllowlistNetworkClient(transport), new FakeClock(), () => 0);

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
      MAIN_QUERY,
      new AllowlistNetworkClient(new RecordingTransport(mainFlowPages())),
      minClock,
      () => 0, // rng 0 → always the minimum of the window
    );
    expect(minClock.sleeps).toEqual([500, 500]); // 3 pages → 2 sleeps

    const maxClock = new FakeClock();
    await driveRefresh(
      new ZaiProvider(),
      MAIN_QUERY,
      new AllowlistNetworkClient(new RecordingTransport(mainFlowPages())),
      maxClock,
      () => 1, // rng 1 → always the maximum of the window
    );
    expect(maxClock.sleeps).toEqual([2000, 2000]);
  });
});

describe('ZaiProvider — month-straddle walk (spec §Month-Straddle Fetching)', () => {
  const STRADDLE_NOW = cstEpoch(2026, 8, 1, 2, 0, 0); // window starts 2026-07-31 21:00 +08:00
  const STRADDLE_QUERY: UsageQuery = { billingMonths: ['2026-07', '2026-08'], now: STRADDLE_NOW };

  function straddlePages(): TransportResponse[] {
    return [
      FIXTURE_RESPONSES['zai/expense-bill-list--straddle-prev-month'],
      FIXTURE_RESPONSES['zai/expense-bill-list--straddle-curr-month'],
    ];
  }

  it('walks both months oldest-first through the state machine and folds both into the window', async () => {
    const transport = new RecordingTransport(straddlePages());
    const clock = new FakeClock();

    const usage = await driveRefresh(
      new ZaiProvider(),
      STRADDLE_QUERY,
      new AllowlistNetworkClient(transport),
      clock,
      () => 0,
    );

    expect(transport.requests.map((request) => request.url)).toEqual([
      'https://bigmodel.cn/api/finance/expenseBill/expenseBillList?billingMonth=2026-07&pageNum=1&pageSize=2',
      'https://bigmodel.cn/api/finance/expenseBill/expenseBillList?billingMonth=2026-08&pageNum=1&pageSize=2',
    ]);
    expect(clock.sleeps).toEqual([500]); // 2 pages across 2 months → N−1 = 1 sleep

    // 300 (Jul 31 22:00) + 100 (Aug 1 01:00) — both in-window; the latest
    // record (Aug 1, Max) decides tier, limit and countdown.
    expect(usage.value).toBe(6); // informational cost: 3 + 3
    expect(usage.budget).toEqual({
      used: 400,
      limit: 48_000,
      percent: 1, // round(400/48000 × 100)
      tier: 'Max',
      resetAt: cstEpoch(2026, 8, 1, 6, 0, 0),
    });
  });

  it('keeps the remaining months queue in the opaque pagination state (AD-2/23)', () => {
    const provider = new ZaiProvider();
    provider.firstRequest(STRADDLE_QUERY);

    const parse = provider.parsePage(
      FIXTURE_RESPONSES['zai/expense-bill-list--straddle-prev-month'].body,
      null,
    );

    expect(parse.done).toBe(false);
    if (!parse.done) {
      // The engine never inspects this — but the walk must live HERE, not in
      // provider instance fields: the completed month is gone and the state
      // now points at the queued 2026-08 with a fresh per-month dedupe set.
      expect(parse.state).toMatchObject({ month: '2026-08', monthsQueue: [], seen: [] });
      expect(parse.next.query).toEqual({ billingMonth: '2026-08', pageNum: 1, pageSize: 2 });
    }
  });
});

describe('ZaiProvider — unextractable epochs (spec §Unextractable record excluded)', () => {
  it('excludes the record from the budget while cost still reports', async () => {
    const usage = await driveRefresh(
      new ZaiProvider(),
      MAIN_QUERY,
      new AllowlistNetworkClient(
        new RecordingTransport([FIXTURE_RESPONSES['zai/expense-bill-list--unextractable-epoch']]),
      ),
      new FakeClock(),
      () => 0,
    );

    // The fixture's data carries no customerId, so no billingNo yields an
    // epoch: budget fields are gracefully absent, cost is intact.
    expect(usage.value).toBe(0.5);
    expect(usage.tier).toBeUndefined();
    expect(usage.budget).toEqual({
      used: 0,
      limit: undefined,
      percent: undefined,
      tier: undefined,
      resetAt: undefined,
    });
  });
});
