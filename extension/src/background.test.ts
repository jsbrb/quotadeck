import { describe, expect, it, vi } from 'vitest';
import {
  buildTickQuery,
  createRefreshEngine,
  refreshTick,
  REFRESH_PERIOD_MINUTES,
  startWorker,
  USAGE_REFRESH_ALARM,
} from './background';
import type { Credential, ProviderId } from './core/provider';
import { cstEpoch } from './core/tier-budget';
import { FIXTURE_RESPONSES } from './fixtures';
import { HttpStatusError } from './network/fetch-transport';
import { FixtureTransport, type AuthorizedRequest, type Transport, type TransportResponse } from './network/transport';
import type { BrowserApi } from './platform/browser-api';
import { KeyStore } from './storage/key-store';
import { FakeAction, FakeAlarms, FakeBrowser, FakeStorageArea } from './testing/fake-browser';
import { FakeClock } from './testing/fake-clock';
import { type CycleSnapshot, SNAPSHOT_STORAGE_KEY } from './storage/snapshot-store';

// Hermetic worker tests (usage-badge spec): the composition root is driven
// end-to-end through FakeBrowser-shaped fakes and locally built fixture route
// tables keyed at CLOCK-DERIVED URLs — the live tick derives every time
// parameter from the injected clock, so a route only matches when the
// derivation is exactly right. Zero network: tests that exercise the default
// transport stub the global fetch; everything else injects FixtureTransport
// (no network path). No slice-2 file is modified.
const ALL_KEYS: readonly ProviderId[] = ['zai', 'qwen', 'openai', 'kimi'];

/** 2026-08-30 12:00 +08:00 — the ZAI fixtures' window anchor (2026-08 month). */
const TICK_NOW = Date.UTC(2026, 7, 30, 4, 0, 0);
/** OpenAI trailing window derived from TICK_NOW: [end − 24h, end], epoch s. */
const END_TIME = TICK_NOW / 1000;
const START_TIME = END_TIME - 86_400;

function zaiPageUrl(pageNum: number): string {
  return `https://bigmodel.cn/api/finance/expenseBill/expenseBillList?billingMonth=2026-08&pageNum=${pageNum}&pageSize=2`;
}

/** Route table keyed at the exact URLs the clock-derived tick query produces. */
function liveRoutes(): Record<string, TransportResponse> {
  return {
    [zaiPageUrl(1)]: FIXTURE_RESPONSES['zai/expense-bill-list--page-1'],
    [zaiPageUrl(2)]: FIXTURE_RESPONSES['zai/expense-bill-list--page-2'],
    [zaiPageUrl(3)]: FIXTURE_RESPONSES['zai/expense-bill-list--page-3'],
    [`https://api.openai.com/v1/organization/costs?start_time=${START_TIME}&bucket_width=1d&end_time=${END_TIME}`]:
      FIXTURE_RESPONSES['openai/costs--page-1'],
    [`https://api.openai.com/v1/organization/costs?start_time=${START_TIME}&bucket_width=1d&end_time=${END_TIME}&page=costs_page2_cursor_9f3ab2c1`]:
      FIXTURE_RESPONSES['openai/costs--page-2-final'],
    'https://api.moonshot.cn/v1/users/me/balance': FIXTURE_RESPONSES['kimi/users-me-balance--ok'],
    'https://business.aliyuncs.com/?Action=QueryAccountBalance&Version=2017-12-14':
      FIXTURE_RESPONSES['qwen/query-account-balance--ok'],
  };
}

/** FakeAlarms that records every create() — proves the "only when absent" guard. */
class AlarmRecorder extends FakeAlarms {
  readonly creates: string[] = [];

  create(name: string, info: { periodInMinutes: number }): void {
    this.creates.push(name);
    super.create(name, info);
  }
}

interface Harness {
  readonly api: BrowserApi;
  readonly alarms: AlarmRecorder;
  readonly action: FakeAction;
  readonly local: FakeStorageArea;
  fireInstalled(): void;
  fireStartup(): void;
}

function makeApi(): Harness {
  const base = new FakeBrowser();
  const alarms = new AlarmRecorder();
  const installed: Array<() => void> = [];
  const startup: Array<() => void> = [];
  const api: BrowserApi = {
    storage: base.storage,
    action: base.action,
    alarms,
    runtime: {
      onInstalled: { listen: (listener) => installed.push(listener) },
      onStartup: { listen: (listener) => startup.push(listener) },
    },
  };
  return {
    api,
    alarms,
    action: base.action,
    local: base.local,
    fireInstalled: () => installed.forEach((listener) => listener()),
    fireStartup: () => startup.forEach((listener) => listener()),
  };
}

/** Typed credentials per provider — qwen keys as an AK/SK pair (AD-17). */
const TEST_CREDENTIALS: Readonly<Record<ProviderId, Credential>> = {
  zai: { type: 'bearer', token: 'fixture-milestone-key' },
  qwen: { type: 'ak-sk', accessKeyId: 'LTAI5tFixtureAccessKey', accessKeySecret: 'fixture-milestone-secret' },
  openai: { type: 'openai-admin-read', token: 'fixture-milestone-key' },
  kimi: { type: 'bearer', token: 'fixture-milestone-key' },
};

async function saveKeys(local: FakeStorageArea, ids: readonly ProviderId[]): Promise<void> {
  const keys = new KeyStore(local);
  for (const id of ids) {
    await keys.saveCredential(id, TEST_CREDENTIALS[id]);
  }
}

/**
 * FixtureTransport wrapper for the qwen leg: the live client dispatches a
 * SIGNED query (timestamp/nonce vary per run), so exact-URL routing cannot
 * match. This double normalizes any business.aliyuncs.com dispatch to the
 * recorded route key — proving the signed request still targets the BSS host —
 * and leaves every other route byte-exact.
 */
class SignedQwenRouteTransport implements Transport {
  private readonly routes: FixtureTransport;

  constructor(routes: Readonly<Record<string, TransportResponse>>) {
    this.routes = new FixtureTransport(routes);
  }

  async fetch(request: AuthorizedRequest): Promise<TransportResponse> {
    const url = request.url.startsWith('https://business.aliyuncs.com/')
      ? 'https://business.aliyuncs.com/?Action=QueryAccountBalance&Version=2017-12-14'
      : request.url;
    return this.routes.fetch({ ...request, url });
  }
}

/** Lets fire-and-forget listener promises (alarm ensure/tick) settle. */
const flushTasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Clock double pinned to ONE instant: unlike FakeClock it never advances on
 * inter-page sleeps, so repeated ticks derive byte-identical request URLs and
 * the route table matches on every cycle.
 */
class FixedClock extends FakeClock {
  override now(): number {
    return TICK_NOW;
  }

  override async sleep(): Promise<void> {
    /* pinned: the engine's inter-page sleep resolves without advancing time */
  }
}

/** Counts set() calls that targeted the cycle snapshot key — one per tick. */
const snapshotWrites = (local: FakeStorageArea): number =>
  local.calls.filter((call) => call.op === 'set' && SNAPSHOT_STORAGE_KEY in (call.args[0] as Record<string, unknown>))
    .length;

describe('background — One-Minute Alarm Schedule (usage-badge spec)', () => {
  it('registers the usage-refresh alarm with a 1-minute period on install', async () => {
    const h = makeApi();
    startWorker(h.api, { clock: new FakeClock(TICK_NOW) });

    h.fireInstalled();
    await vi.waitFor(async () => {
      expect(await h.alarms.get(USAGE_REFRESH_ALARM)).toMatchObject({
        name: USAGE_REFRESH_ALARM,
        periodInMinutes: REFRESH_PERIOD_MINUTES,
      });
    });
    expect(h.alarms.creates).toEqual([USAGE_REFRESH_ALARM]);
  });

  it('registers the alarm on startup when absent', async () => {
    const h = makeApi();
    startWorker(h.api, { clock: new FakeClock(TICK_NOW) });

    h.fireStartup();
    await vi.waitFor(async () => {
      expect((await h.alarms.get(USAGE_REFRESH_ALARM))?.periodInMinutes).toBe(1);
    });
    expect(h.alarms.creates).toEqual([USAGE_REFRESH_ALARM]);
  });

  it('does not re-register when the alarm already exists', async () => {
    const h = makeApi();
    // Pre-existing alarm with a DIFFERENT period: if the worker re-created
    // (or overwrote) it, the period would flip to 1 and creates would grow.
    h.alarms.create(USAGE_REFRESH_ALARM, { periodInMinutes: 5 });
    startWorker(h.api, { clock: new FakeClock(TICK_NOW) });

    h.fireStartup();
    await flushTasks();

    expect(h.alarms.creates).toEqual([USAGE_REFRESH_ALARM]); // only the pre-existing one
    expect((await h.alarms.get(USAGE_REFRESH_ALARM))?.periodInMinutes).toBe(5);
  });
});

describe('background — buildTickQuery (usage-badge spec §Live refresh per tick)', () => {
  it('derives billingMonths, now and the trailing-24h OpenAI window from the injected clock', () => {
    expect(buildTickQuery(new FakeClock(TICK_NOW), { Lite: 4800 })).toEqual({
      billingMonths: ['2026-08'], // 2026-08-30 12:00 +08:00; window start 07:00 same month
      now: TICK_NOW,
      startTime: START_TIME,
      endTime: END_TIME,
      tierLimits: { Lite: 4800 }, // limit-store feed passes through verbatim
    });
  });

  it('queues both billing months when the 5h window straddles a month boundary', () => {
    const straddleNow = cstEpoch(2026, 9, 1, 2, 0, 0); // window starts 2026-08-31 21:00 +08:00
    expect(buildTickQuery(new FakeClock(straddleNow), {}).billingMonths).toEqual(['2026-08', '2026-09']);
  });
});

describe('background — Badge Rendering + refresh per tick (usage-badge spec)', () => {
  it('updates the badge on every tick: one deterministic text per keyed provider, last result wins, stable across repeated ticks', async () => {
    const h = makeApi();
    await saveKeys(h.local, ALL_KEYS);
    startWorker(h.api, {
      clock: new FixedClock(),
      rng: () => 0,
      transport: new SignedQwenRouteTransport(liveRoutes()),
    });
    h.fireInstalled();
    await flushTasks();

    const perTick = ['¥39', '¥100', '$20', '¥89'];
    h.alarms.fire(USAGE_REFRESH_ALARM);
    await vi.waitFor(() => expect(h.action.badgeTexts).toEqual(perTick));

    h.alarms.fire(USAGE_REFRESH_ALARM); // repeated tick, identical fixture results
    await vi.waitFor(() => expect(h.action.badgeTexts).toEqual([...perTick, ...perTick]));
  });

  it('refreshes only keyed providers — unkeyed providers leave the badge untouched', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['kimi']);
    startWorker(h.api, { clock: new FixedClock(), transport: new FixtureTransport(liveRoutes()) });

    h.alarms.fire(USAGE_REFRESH_ALARM);
    await vi.waitFor(() => expect(h.action.badgeTexts).toEqual(['¥89']));
  });

  it('dispatches live-shaped requests whose time parameters derive from the clock', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai', 'openai']);
    // Routes are keyed ONLY at clock-derived URLs: the ZAI pages match only
    // when billingMonth comes from the clock, the OpenAI pages only when the
    // start/end window does — any wall-clock or fixture-table query misses.
    const engine = createRefreshEngine(h.api, {
      clock: new FakeClock(TICK_NOW),
      rng: () => 0,
      transport: new FixtureTransport(liveRoutes()),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['¥39', '$20']);
  });
});

describe('background — default live transport (FetchTransport, AD-19)', () => {
  it('dispatches through the real fetch when no transport is injected', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['kimi']);
    vi.stubGlobal('fetch', async () => ({
      status: 200,
      ok: true,
      json: async () => ({ data: { available_balance: '88.88' } }),
    }));
    try {
      const engine = createRefreshEngine(h.api, { clock: new FakeClock(TICK_NOW) }); // no transport
      await refreshTick(h.api, engine, new FakeClock(TICK_NOW));
    } finally {
      vi.unstubAllGlobals();
    }

    expect(h.action.badgeTexts).toEqual(['¥89']); // the live fetch answered
  });

  it('a fetch-level network failure classifies as network and badges ERR', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['kimi']);
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    try {
      const engine = createRefreshEngine(h.api, { clock: new FakeClock(TICK_NOW) });
      await refreshTick(h.api, engine, new FakeClock(TICK_NOW));
    } finally {
      vi.unstubAllGlobals();
    }

    expect(h.action.badgeTexts).toEqual(['ERR']);
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.kimi).toEqual({ status: 'error', errorClass: 'network' });
  });

  it('hermetic proof: an injected transport serves the full four-provider tick with the global fetch forbidden', async () => {
    const h = makeApi();
    await saveKeys(h.local, ALL_KEYS);
    vi.stubGlobal('fetch', () => {
      throw new Error('live network is forbidden in the hermetic suite');
    });
    try {
      const engine = createRefreshEngine(h.api, {
        clock: new FakeClock(TICK_NOW),
        rng: () => 0,
        transport: new SignedQwenRouteTransport(liveRoutes()),
      });
      await refreshTick(h.api, engine, new FakeClock(TICK_NOW));
    } finally {
      vi.unstubAllGlobals();
    }

    expect(h.action.badgeTexts).toEqual(['¥39', '¥100', '$20', '¥89']);
  });
});

describe('background — Error State (usage-badge spec)', () => {
  it('shows ERR after an injected failure and the next successful tick replaces it', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['kimi']);

    // Tick 1 — injected failure: a FixtureTransport with NO routes throws on
    // every fetch; there is no fallback, so the refresh fails.
    const failing = createRefreshEngine(h.api, {
      transport: new FixtureTransport({}),
      clock: new FakeClock(TICK_NOW),
    });
    await refreshTick(h.api, failing, new FakeClock(TICK_NOW));

    // Tick 2 — recovery through the stubbed default transport.
    vi.stubGlobal('fetch', async () => ({
      status: 200,
      ok: true,
      json: async () => ({ data: { available_balance: '88.88' } }),
    }));
    try {
      const recovering = createRefreshEngine(h.api, { clock: new FakeClock(TICK_NOW) });
      await refreshTick(h.api, recovering, new FakeClock(TICK_NOW));
    } finally {
      vi.unstubAllGlobals();
    }

    expect(h.action.badgeTexts).toEqual(['ERR', '¥89']);
  });

  it('replaces the marker within the same tick when a later provider succeeds', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai', 'kimi']);
    // Recorded ZAI failure fixture routed at page 1 — the recorded-flow way to
    // inject a provider error.
    const routes = {
      ...liveRoutes(),
      [zaiPageUrl(1)]: FIXTURE_RESPONSES['zai/expense-bill-list--code-500'],
    };
    const engine = createRefreshEngine(h.api, {
      transport: new FixtureTransport(routes),
      clock: new FakeClock(TICK_NOW),
      rng: () => 0,
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['ERR', '¥89']);
  });
});

describe('background — Error Taxonomy Mapping (usage-badge spec)', () => {
  /** Transport double failing every dispatch with a configured error. */
  class FailingTransport implements Transport {
    constructor(private readonly error: Error) {}

    async fetch(_request: AuthorizedRequest): Promise<TransportResponse> {
      throw this.error;
    }
  }

  it.each([
    ['auth', () => new HttpStatusError(401)],
    ['rate-limit', () => new HttpStatusError(429)],
    ['server', () => new HttpStatusError(500)],
    ['network', () => new TypeError('Failed to fetch')],
    ['unknown', () => new Error('unmapped failure')],
  ] as const)('classifies %s: badge ERR and the snapshot entry carries the class', async (expected, makeError) => {
    const h = makeApi();
    await saveKeys(h.local, ['kimi']);
    const engine = createRefreshEngine(h.api, {
      transport: new FailingTransport(makeError()),
      clock: new FakeClock(TICK_NOW),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['ERR']); // every class renders the marker
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.kimi).toEqual({ status: 'error', errorClass: expected });
  });

  it('a body-level provider failure (ZAI numeric code 500) classifies as server', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai']);
    const engine = createRefreshEngine(h.api, {
      transport: new FixtureTransport({ [zaiPageUrl(1)]: FIXTURE_RESPONSES['zai/expense-bill-list--code-500'] }),
      clock: new FakeClock(TICK_NOW),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['ERR']);
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.zai).toEqual({ status: 'error', errorClass: 'server' });
  });
});

describe('background — Cycle Snapshot (popup-ui spec §Current Cycle Data on Open)', () => {
  it('tick writes exactly one snapshot per completed cycle: ok entries carry the cycle usage incl. budget', async () => {
    const h = makeApi();
    await saveKeys(h.local, ALL_KEYS);
    startWorker(h.api, {
      clock: new FixedClock(),
      rng: () => 0,
      transport: new SignedQwenRouteTransport(liveRoutes()),
    });
    h.fireInstalled();
    await flushTasks();

    const perTick = ['¥39', '¥100', '$20', '¥89'];
    h.alarms.fire(USAGE_REFRESH_ALARM);
    // The snapshot write is the tick's LAST operation — once it lands, the
    // badge sequence is final, so both can be asserted deterministically.
    await vi.waitFor(() => expect(snapshotWrites(h.local)).toBe(1));
    expect(h.action.badgeTexts).toEqual(perTick);

    h.alarms.fire(USAGE_REFRESH_ALARM); // repeated tick — still one write per cycle
    await vi.waitFor(() => expect(snapshotWrites(h.local)).toBe(2));
    expect(h.action.badgeTexts).toEqual([...perTick, ...perTick]);

    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(Object.keys(stored.results)).toEqual([...ALL_KEYS]);
    expect(stored.results.zai).toEqual({
      status: 'ok',
      usage: expect.objectContaining({
        providerId: 'zai',
        kind: 'cost',
        value: 39,
        currency: 'CNY',
        tier: 'Lite',
        // The single cycle write carries the ZAI budget report verbatim (AD-22).
        budget: {
          used: 2400,
          limit: 2400,
          percent: 100,
          tier: 'Lite',
          resetAt: cstEpoch(2026, 8, 30, 17, 0, 0),
        },
      }),
    });
    expect(stored.results.qwen).toMatchObject({ status: 'ok', usage: expect.objectContaining({ value: 100.28, currency: 'CNY' }) });
    expect(stored.results.openai).toMatchObject({ status: 'ok', usage: expect.objectContaining({ value: 20, currency: 'usd' }) });
    expect(stored.results.kimi).toMatchObject({ status: 'ok', usage: expect.objectContaining({ value: 88.88, currency: 'CNY' }) });
  });

  it('unkeyed providers have no snapshot entry and no credential material reaches the snapshot', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai', 'kimi']);
    startWorker(h.api, { clock: new FakeClock(TICK_NOW), rng: () => 0, transport: new FixtureTransport(liveRoutes()) });

    h.alarms.fire(USAGE_REFRESH_ALARM);
    await vi.waitFor(() => expect(snapshotWrites(h.local)).toBe(1));

    expect(h.action.badgeTexts).toEqual(['¥39', '¥89']);
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(Object.keys(stored.results)).toEqual(['zai', 'kimi']); // qwen + openai absent
    expect(JSON.stringify(stored)).not.toContain('fixture-milestone-key');
  });

  it('a failed provider records its class entry while its badge path stays unchanged', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai', 'kimi']);
    const routes = {
      ...liveRoutes(),
      [zaiPageUrl(1)]: FIXTURE_RESPONSES['zai/expense-bill-list--code-500'],
    };
    const engine = createRefreshEngine(h.api, {
      transport: new FixtureTransport(routes),
      clock: new FakeClock(TICK_NOW),
      rng: () => 0,
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['ERR', '¥89']); // usage-badge behavior, byte-identical
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.zai).toEqual({ status: 'error', errorClass: 'server' }); // class only (AD-13/21)
    expect(stored.results.kimi).toMatchObject({ status: 'ok' });
  });
});
