import { describe, expect, it, vi } from 'vitest';
import {
  createRefreshEngine,
  FIXTURE_ROUTES,
  refreshTick,
  REFRESH_PERIOD_MINUTES,
  startWorker,
  USAGE_REFRESH_ALARM,
} from './background';
import type { ProviderId } from './core/provider';
import { FIXTURE_RESPONSES } from './fixtures';
import { FixtureTransport } from './network/transport';
import type { BrowserApi } from './platform/browser-api';
import { KeyStore } from './storage/key-store';
import { FakeAction, FakeAlarms, FakeBrowser, FakeStorageArea } from './testing/fake-browser';
import { FakeClock } from './testing/fake-clock';

// Hermetic worker tests (usage-badge spec): the composition root is driven
// end-to-end through FakeBrowser-shaped fakes and the bundled fixture routes —
// no Chrome runtime and zero network (the transport is FixtureTransport,
// which has no network path). FakeBrowser (slice 2) predates the `runtime`
// lifecycle port added in Phase 5, so the harness composes a BrowserApi-shaped
// object around its parts plus a recording alarms double — no slice-2 file is
// modified.
const ZAI_PAGE_1_URL =
  'https://bigmodel.cn/api/finance/expenseBill/expenseBillList?billingMonth=2026-08&pageNum=1&pageSize=2';
const ALL_KEYS: readonly ProviderId[] = ['zai', 'qwen', 'openai', 'kimi'];

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

async function saveKeys(local: FakeStorageArea, ids: readonly ProviderId[]): Promise<void> {
  const keys = new KeyStore(local);
  for (const id of ids) {
    await keys.saveKey(id, 'fixture-milestone-key');
  }
}

/** Lets fire-and-forget listener promises (alarm ensure/tick) settle. */
const flushTasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('background — One-Minute Alarm Schedule (usage-badge spec)', () => {
  it('registers the usage-refresh alarm with a 1-minute period on install', async () => {
    const h = makeApi();
    startWorker(h.api, { clock: new FakeClock() });

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
    startWorker(h.api, { clock: new FakeClock() });

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
    startWorker(h.api, { clock: new FakeClock() });

    h.fireStartup();
    await flushTasks();

    expect(h.alarms.creates).toEqual([USAGE_REFRESH_ALARM]); // only the pre-existing one
    expect((await h.alarms.get(USAGE_REFRESH_ALARM))?.periodInMinutes).toBe(5);
  });
});

describe('background — Badge Rendering + refresh per tick (usage-badge spec)', () => {
  it('updates the badge on every tick: one deterministic text per keyed provider, last result wins, stable across repeated ticks', async () => {
    const h = makeApi();
    await saveKeys(h.local, ALL_KEYS);
    startWorker(h.api, { clock: new FakeClock(), rng: () => 0 });
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
    startWorker(h.api, { clock: new FakeClock() });

    h.alarms.fire(USAGE_REFRESH_ALARM);
    await vi.waitFor(() => expect(h.action.badgeTexts).toEqual(['¥89']));
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
      clock: new FakeClock(),
    });
    await refreshTick(h.api, failing);

    // Tick 2 — recovery via the default bundled fixture routes.
    const recovering = createRefreshEngine(h.api, { clock: new FakeClock() });
    await refreshTick(h.api, recovering);

    expect(h.action.badgeTexts).toEqual(['ERR', '¥89']);
  });

  it('replaces the marker within the same tick when a later provider succeeds', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai', 'kimi']);
    // Recorded ZAI failure fixture routed at page 1 — the recorded-flow way to
    // inject a provider error.
    const routes = {
      ...FIXTURE_ROUTES,
      [ZAI_PAGE_1_URL]: FIXTURE_RESPONSES['zai/expense-bill-list--code-500'],
    };
    const engine = createRefreshEngine(h.api, {
      transport: new FixtureTransport(routes),
      clock: new FakeClock(),
      rng: () => 0,
    });

    await refreshTick(h.api, engine);

    expect(h.action.badgeTexts).toEqual(['ERR', '¥89']);
  });
});

describe('background — No Live Calls in Milestone (usage-badge spec)', () => {
  it('completes a full four-provider tick with global fetch disabled — fixture data only', async () => {
    const h = makeApi();
    await saveKeys(h.local, ALL_KEYS);
    vi.stubGlobal('fetch', () => {
      throw new Error('live network is forbidden in the fixture-only milestone');
    });

    try {
      const engine = createRefreshEngine(h.api, { clock: new FakeClock(), rng: () => 0 });
      await refreshTick(h.api, engine);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(h.action.badgeTexts).toEqual(['¥39', '¥100', '$20', '¥89']);
  });
});
