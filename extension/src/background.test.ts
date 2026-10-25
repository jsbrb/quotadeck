import { describe, expect, it, vi } from 'vitest';
import {
  buildTickQuery,
  createQwenPlanStep,
  createQwenQuotaStep,
  createRefreshEngine,
  refreshTick,
  REFRESH_NOW_ALARM,
  REFRESH_PERIOD_MINUTES,
  resolveChosenBadge,
  startWorker,
  USAGE_REFRESH_ALARM,
  type WorkerOptions,
} from './background';
import { SystemClock } from './core/clock';
import type { Credential, Provider, ProviderId } from './core/provider';
import { ProviderRegistry } from './core/registry';
import type { NormalizedUsage } from './core/usage';
import { FIXTURE_RESPONSES } from './fixtures';
import { AllowlistNetworkClient } from './network/client';
import { HttpStatusError, FetchTransport } from './network/fetch-transport';
import { FixtureTransport, type AuthorizedRequest, type Transport, type TransportResponse } from './network/transport';
import { KimiProvider, OpenAiProvider, QwenProvider, ZaiProvider } from './providers';
import { QWEN_PLAN_PROBE_HOST } from './providers/qwen-plan-probe';
import { QWEN_TOKEN_MINT_HOST, QWEN_TOKEN_PLAN_GATEWAY_HOST } from './providers/qwen-token-plan';
import type { AlarmCreateInfo, BrowserApi, WorkerBrowserApi } from './platform/browser-api';
import { RefreshEngine } from './refresh/engine';
import { writeBadgeProvider } from './storage/badge-provider-store';
import { KeyStore } from './storage/key-store';
import { QWEN_PLAN_STATUS_STORAGE_KEY } from './storage/qwen-plan-store';
import { writeQwenSite } from './storage/qwen-site-store';
import { writeZaiPlatform } from './storage/zai-platform-store';
import {
  FakeAction,
  FakeAlarms,
  FakeBrowser,
  FakeDeclarativeNetRequest,
  FakeStorageArea,
} from './testing/fake-browser';
import { FakeClock } from './testing/fake-clock';
import { type CycleSnapshot, type ProviderSnapshotEntry, SNAPSHOT_STORAGE_KEY } from './storage/snapshot-store';

// Hermetic worker tests (usage-badge spec): the composition root is driven
// end-to-end through FakeBrowser-shaped fakes and locally built fixture route
// tables keyed at CLOCK-DERIVED URLs — the live tick derives every time
// parameter from the injected clock, so a route only matches when the
// derivation is exactly right. ZAI routes key at the PLATFORM-SELECTED
// monitor URL (default api.z.ai; zhipu preference → open.bigmodel.cn), which
// only matches when the platform store read feeds buildTickQuery. Zero
// network: tests that exercise the default transport stub the global fetch;
// everything else injects FixtureTransport (no network path).
const ALL_KEYS: readonly ProviderId[] = ['zai', 'qwen', 'openai', 'kimi'];

/** 2026-08-30 12:00 +08:00 — a fixed anchor instant for the trailing-24h window. */
const TICK_NOW = Date.UTC(2026, 7, 30, 4, 0, 0);
/** OpenAI trailing window derived from TICK_NOW: [end − 24h, end], epoch s. */
const END_TIME = TICK_NOW / 1000;
const START_TIME = END_TIME - 86_400;

/** Monitor URL the tick targets for a platform (AD-28/29). */
function zaiMonitorUrl(platform: 'zai' | 'zhipu' = 'zai'): string {
  return `https://${platform === 'zhipu' ? 'open.bigmodel.cn' : 'api.z.ai'}/api/monitor/usage/quota/limit`;
}

/** Route table keyed at the exact URLs the clock-derived tick query produces. */
function liveRoutes(): Record<string, TransportResponse> {
  return {
    [zaiMonitorUrl()]: FIXTURE_RESPONSES['zai/monitor--pro-plan'],
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

  create(name: string, info: AlarmCreateInfo): void {
    this.creates.push(name);
    super.create(name, info);
  }
}

/**
 * chrome.runtime.id stand-in wired through the worker port's runtime slice —
 * the DNR initiator scope the worker must read via the seam, never chrome (WU-F).
 */
const FAKE_RUNTIME_ID = 'abcdefghijklmnopabcdefghijklmnop';

interface Harness {
  readonly api: WorkerBrowserApi;
  readonly alarms: AlarmRecorder;
  readonly action: FakeAction;
  readonly local: FakeStorageArea;
  /** The recording DNR double — the install-once assertions read this (WU-F). */
  readonly dnr: FakeDeclarativeNetRequest;
  fireInstalled(): void;
  fireStartup(): void;
}

function makeApi(): Harness {
  const base = new FakeBrowser();
  const alarms = new AlarmRecorder();
  const installed: Array<() => void> = [];
  const startup: Array<() => void> = [];
  const api: WorkerBrowserApi = {
    storage: base.storage,
    action: base.action,
    alarms,
    declarativeNetRequest: base.declarativeNetRequest,
    runtime: {
      id: FAKE_RUNTIME_ID,
      onInstalled: { listen: (listener) => installed.push(listener) },
      onStartup: { listen: (listener) => startup.push(listener) },
    },
  };
  return {
    api,
    alarms,
    action: base.action,
    local: base.local,
    dnr: base.declarativeNetRequest,
    fireInstalled: () => installed.forEach((listener) => listener()),
    fireStartup: () => startup.forEach((listener) => listener()),
  };
}

/** Typed credentials per provider — ZAI keys attach raw, qwen as an AK/SK pair (AD-17/25). */
const TEST_CREDENTIALS: Readonly<Record<ProviderId, Credential>> = {
  zai: { type: 'raw', token: 'fixture-milestone-key' },
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

/** Concrete class per id — mirrors providers/index.ts wiring for explicit test registries. */
const PROVIDER_CLASSES: Readonly<Record<ProviderId, () => Provider>> = {
  zai: () => new ZaiProvider(),
  qwen: () => new QwenProvider(),
  openai: () => new OpenAiProvider(),
  kimi: () => new KimiProvider(),
};

/**
 * Engine graph over an EXPLICIT provider set (hito-10): the default registry
 * ships zai only, so retained non-zai integration coverage composes its own
 * registry from the provider classes — same engine graph as production, no
 * production seam involved.
 */
function engineForProviders(
  browser: BrowserApi,
  ids: readonly ProviderId[],
  options: WorkerOptions = {},
): RefreshEngine {
  const registry = new ProviderRegistry();
  for (const id of ids) {
    registry.register(PROVIDER_CLASSES[id]());
  }
  return new RefreshEngine({
    registry,
    client: new AllowlistNetworkClient(options.transport ?? new FetchTransport()),
    keys: new KeyStore(browser.storage.local),
    clock: options.clock ?? new SystemClock(),
  });
}

/**
 * FixtureTransport wrapper for the qwen leg: the live client dispatches a
 * SIGNED query (timestamp/nonce vary per run), so exact-URL routing cannot
 * match. This double normalizes any BSS-host dispatch (china or the
 * international default — hito-8 flipped the default to ap-southeast-1) to
 * the recorded route key — proving the signed request still targets a BSS
 * host — and leaves every other route byte-exact. The recorded CN-shaped
 * body serves both: the tolerant qwen parse accepts numeric and string
 * envelopes alike. Which BSS host a tick targets is pinned by the dedicated
 * site-selection tests below, not by this normalization.
 */
class SignedQwenRouteTransport implements Transport {
  private readonly routes: FixtureTransport;

  constructor(routes: Readonly<Record<string, TransportResponse>>) {
    this.routes = new FixtureTransport(routes);
  }

  async fetch(request: AuthorizedRequest): Promise<TransportResponse> {
    const url =
      request.url.startsWith('https://business.aliyuncs.com/') ||
      request.url.startsWith('https://business.ap-southeast-1.aliyuncs.com/')
        ? 'https://business.aliyuncs.com/?Action=QueryAccountBalance&Version=2017-12-14'
        : request.url;
    return this.routes.fetch({ ...request, url });
  }
}

/**
 * Transport double for the qwen site-selection tests: captures the URL of
 * every BSS dispatch (the signed query varies per run, so exact-URL routing
 * cannot prove WHICH host was targeted — the hostname itself is the evidence)
 * and serves the recorded CN fixture for either BSS host; the tolerant qwen
 * parse accepts its shape from both sites.
 */
class QwenUrlCaptureTransport implements Transport {
  readonly qwenHosts: string[] = [];

  async fetch(request: AuthorizedRequest): Promise<TransportResponse> {
    const host = new URL(request.url).hostname;
    if (host === 'business.aliyuncs.com' || host === 'business.ap-southeast-1.aliyuncs.com') {
      this.qwenHosts.push(host);
      return FIXTURE_RESPONSES['qwen/query-account-balance--ok'];
    }
    throw new Error(`unexpected non-qwen dispatch: ${request.url}`);
  }
}

/**
 * Transport double mirroring FetchTransport's status-first ordering (AD-30):
 * an error status throws HttpStatusError BEFORE the body is ever read — a
 * plain-text error body (e.g. the recorded 401) can never cause a parse
 * failure.
 */
class StatusFirstTransport implements Transport {
  private readonly routes: FixtureTransport;

  constructor(routes: Readonly<Record<string, TransportResponse>>) {
    this.routes = new FixtureTransport(routes);
  }

  async fetch(request: AuthorizedRequest): Promise<TransportResponse> {
    const fixture = await this.routes.fetch(request);
    if (fixture.status < 200 || fixture.status >= 300) {
      throw new HttpStatusError(fixture.status); // body never touched
    }
    return fixture;
  }
}

/** Lets fire-and-forget listener promises (alarm ensure/tick) settle. */
const flushTasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Clock double pinned to ONE instant: repeated ticks derive byte-identical
 * request URLs and the route table matches on every cycle.
 */
class FixedClock extends FakeClock {
  override now(): number {
    return TICK_NOW;
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

describe('background — One-Shot Refresh Alarm (usage-badge spec)', () => {
  it('firing refresh-now runs the shared refresh tick: the chosen default (zai) badge renders once and exactly one snapshot write lands', async () => {
    const h = makeApi();
    await saveKeys(h.local, ALL_KEYS); // unshipped keys sit inert — only shipped providers register (hito-10)
    startWorker(h.api, {
      clock: new FixedClock(),
      transport: new SignedQwenRouteTransport(liveRoutes()),
    });
    h.fireInstalled();
    await flushTasks();

    h.alarms.fire(REFRESH_NOW_ALARM);
    await vi.waitFor(() => expect(snapshotWrites(h.local)).toBe(1));

    // WU-D2 single-write badge: one text per tick from the chosen default
    // (zai) — qwen records its snapshot entry but never moves the badge.
    expect(h.action.badgeTexts).toEqual(['32%']);
    expect(h.alarms.creates).toEqual([USAGE_REFRESH_ALARM]); // the worker registers ONLY the periodic alarm
    await expect(h.alarms.get(REFRESH_NOW_ALARM)).resolves.toBeUndefined();
  });

  it('leaves the periodic schedule unchanged after a refresh-now fire: still registered, period 1, no duplicate create', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai']);
    startWorker(h.api, { clock: new FixedClock(), transport: new FixtureTransport(liveRoutes()) });
    h.fireInstalled();
    await flushTasks();

    h.alarms.fire(REFRESH_NOW_ALARM);
    await vi.waitFor(() => expect(snapshotWrites(h.local)).toBe(1));

    expect(await h.alarms.get(USAGE_REFRESH_ALARM)).toMatchObject({
      name: USAGE_REFRESH_ALARM,
      periodInMinutes: REFRESH_PERIOD_MINUTES,
    });
    expect(h.alarms.creates).toEqual([USAGE_REFRESH_ALARM]); // no re-create, no duplicate
  });

  it('ignores unknown alarm names: no badge writes, no snapshot write', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai']);
    startWorker(h.api, { clock: new FixedClock(), transport: new FixtureTransport(liveRoutes()) });
    h.fireInstalled();
    await flushTasks();

    h.alarms.fire('not-a-quotadeck-alarm');
    await flushTasks();

    expect(h.action.badgeTexts).toEqual([]);
    expect(snapshotWrites(h.local)).toBe(0);
  });
});

describe('background — Gateway Origin Rule Install (hito-12 WU-F)', () => {
  it('installs the scoped gateway-origin session rule exactly once at worker boot', () => {
    const h = makeApi();

    startWorker(h.api, { clock: new FakeClock(TICK_NOW) });

    expect(h.dnr.calls.map((call) => call.op)).toEqual(['updateSessionRules']); // one install per SW start
    // The payload pinned AT THE BACKGROUND LEVEL too: the runtime id must ride
    // in through the platform seam's runtime slice as the initiator scope, and
    // the rewrite target is the PUBLIC console origin — no credential (WU-F).
    expect(h.dnr.calls[0]?.args[0]).toEqual({
      addRules: [
        {
          id: 1, // QWEN_TOKEN_PLAN_SESSION_RULE_ID (dnr/gateway-origin-rule.ts)
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'origin', operation: 'set', value: 'https://modelstudio.console.alibabacloud.com' },
            ],
          },
          condition: {
            requestDomains: [QWEN_TOKEN_PLAN_GATEWAY_HOST],
            resourceTypes: ['xmlhttprequest'],
            initiatorDomains: [FAKE_RUNTIME_ID],
            urlFilter: `${QWEN_TOKEN_PLAN_GATEWAY_HOST}/cli/api.json`,
          },
        },
      ],
    });
  });

  it('a second worker start replaces by id: two recorded updates, ONE live rule, no secret-shaped payload', () => {
    const h = makeApi();
    startWorker(h.api, { clock: new FakeClock(TICK_NOW) });
    startWorker(h.api, { clock: new FakeClock(TICK_NOW) });

    expect(h.dnr.calls).toHaveLength(2); // idempotent replace-by-id, not skip — each SW start re-installs
    expect(h.dnr.sessionRules.size).toBe(1); // no duplicate rule accumulates under the same id
    expect(JSON.stringify(h.dnr.sessionRules.get(1))).not.toMatch(/cookie|authorization|bearer/i); // public constants only (hito-9 §Lane 1(c) ban)
  });
});

describe('background — buildTickQuery (usage-badge spec §Live refresh per tick)', () => {
  it('derives { zaiPlatform, qwenSite, now, trailing-24h OpenAI window } from the injected clock — no months, no tier limits', () => {
    expect(buildTickQuery(new FakeClock(TICK_NOW), 'zai', 'international')).toEqual({
      zaiPlatform: 'zai',
      qwenSite: 'international',
      now: TICK_NOW,
      startTime: START_TIME,
      endTime: END_TIME,
    });
  });

  it('carries the stored platform selection through to the query', () => {
    expect(buildTickQuery(new FakeClock(TICK_NOW), 'zhipu', 'china')).toEqual({
      zaiPlatform: 'zhipu',
      qwenSite: 'china',
      now: TICK_NOW,
      startTime: START_TIME,
      endTime: END_TIME,
    });
  });
});

describe('background — Badge Rendering + refresh per tick (usage-badge spec)', () => {
  it('the shipped worker badges the chosen provider only: one badge write per tick, stable across repeated ticks', async () => {
    const h = makeApi();
    await saveKeys(h.local, ALL_KEYS); // unshipped keys sit inert — only shipped providers register (hito-12: zai + qwen)
    startWorker(h.api, {
      clock: new FixedClock(),
      transport: new SignedQwenRouteTransport(liveRoutes()),
    });
    h.fireInstalled();
    await flushTasks();

    const perTick = ['32%']; // WU-D2: one badge write per tick, from the chosen default (zai)
    h.alarms.fire(USAGE_REFRESH_ALARM);
    await vi.waitFor(() => expect(h.action.badgeTexts).toEqual(perTick));

    h.alarms.fire(USAGE_REFRESH_ALARM); // repeated tick, identical fixture result
    await vi.waitFor(() => expect(h.action.badgeTexts).toEqual([...perTick, ...perTick]));
  });

  it('refreshes keyed providers and badges the chosen provider once per tick (retained multi-provider graph)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai', 'kimi']);
    const engine = engineForProviders(h.api, ['zai', 'kimi'], {
      clock: new FixedClock(),
      transport: new FixtureTransport(liveRoutes()),
    });

    const perTick = ['32%']; // WU-D2: the chosen default (zai) renders; kimi records but never moves the badge
    await refreshTick(h.api, engine, new FixedClock());
    expect(h.action.badgeTexts).toEqual(perTick);

    await refreshTick(h.api, engine, new FixedClock()); // repeated tick, identical fixture results
    expect(h.action.badgeTexts).toEqual([...perTick, ...perTick]);
  });

  it('renders the 5h percentage uncapped — 137 stays 137%', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai']);
    const engine = createRefreshEngine(h.api, {
      clock: new FakeClock(TICK_NOW),
      transport: new FixtureTransport({ ...liveRoutes(), [zaiMonitorUrl()]: FIXTURE_RESPONSES['zai/monitor--over-100'] }),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['137%']); // uncapped (AD-26)
  });

  it('falls back to the plan level when the 5h percentage is null', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai']);
    const engine = createRefreshEngine(h.api, {
      clock: new FakeClock(TICK_NOW),
      transport: new FixtureTransport({ ...liveRoutes(), [zaiMonitorUrl()]: FIXTURE_RESPONSES['zai/monitor--null-pct'] }),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['Lite']); // absent pct → level (AD-26)
  });

  it('refreshes only keyed providers — a chosen provider that never ran clears the badge (retained kimi graph)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['kimi']);
    const engine = engineForProviders(h.api, ['kimi'], {
      clock: new FixedClock(),
      transport: new FixtureTransport(liveRoutes()),
    });

    await refreshTick(h.api, engine, new FixedClock());

    expect(h.action.badgeTexts).toEqual(['']); // WU-D2: choice (default zai) absent → cleared; unchosen kimi never badges
  });

  it('dispatches live-shaped requests whose time parameters derive from the clock (retained openai graph)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai', 'openai']);
    // Routes are keyed ONLY at clock-derived URLs: the ZAI monitor route has
    // no time parameter (single-shot), the OpenAI pages match only when the
    // start/end window comes from the clock — any wall-clock or fixture-table
    // query misses.
    const engine = engineForProviders(h.api, ['zai', 'openai'], {
      clock: new FakeClock(TICK_NOW),
      transport: new FixtureTransport(liveRoutes()),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['32%']); // WU-D2: chosen zai badges once; the openai result records without moving it
  });

  it('targets open.bigmodel.cn when the zhipu platform preference is stored (§Platform Binding)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai']);
    await writeZaiPlatform(h.local, 'zhipu');
    const engine = createRefreshEngine(h.api, {
      clock: new FakeClock(TICK_NOW),
      // Keyed ONLY at the zhipu base: the tick must read qd:pref:zai-platform
      // and route through it — a default api.z.ai dispatch misses the route.
      transport: new FixtureTransport({ [zaiMonitorUrl('zhipu')]: FIXTURE_RESPONSES['zai/monitor--pro-plan'] }),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['32%']);
  });

  it('defaults to api.z.ai when no platform preference is stored (§Platform Binding)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai']);
    // Keyed ONLY at the default base: an absent preference must read 'zai'.
    const engine = createRefreshEngine(h.api, {
      clock: new FakeClock(TICK_NOW),
      transport: new FixtureTransport({ [zaiMonitorUrl()]: FIXTURE_RESPONSES['zai/monitor--pro-plan'] }),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['32%']);
  });
});

describe('background — Badge Color Wiring (hito-10 threshold colors)', () => {
  it('success tick sets background + text color from the 5h percentage band beside the badge text', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai']);
    const engine = createRefreshEngine(h.api, {
      clock: new FakeClock(TICK_NOW),
      transport: new FixtureTransport({ [zaiMonitorUrl()]: FIXTURE_RESPONSES['zai/monitor--pro-plan'] }),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['32%']);
    expect(h.action.badgeBackgrounds).toEqual(['#E2E8F0']); // 32 < 50 → light neutral band with dark text
    expect(h.action.badgeTextColors).toEqual(['#0F172A']);
  });

  it('an uncapped 137% tick colors the badge red', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai']);
    const engine = createRefreshEngine(h.api, {
      clock: new FakeClock(TICK_NOW),
      transport: new FixtureTransport({ ...liveRoutes(), [zaiMonitorUrl()]: FIXTURE_RESPONSES['zai/monitor--over-100'] }),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['137%']); // uncapped (AD-26)
    expect(h.action.badgeBackgrounds).toEqual(['#DC2626']); // ≥90 red band
    expect(h.action.badgeTextColors).toEqual(['#FFFFFF']);
  });

  it('a tick whose choice never ran sets the neutral light background and dark text beside the cleared badge, never a threshold color (retained kimi graph)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['kimi']);
    const engine = engineForProviders(h.api, ['kimi'], {
      transport: new FixtureTransport({}), // no routes → every dispatch fails
      clock: new FakeClock(TICK_NOW),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['']); // WU-D2: the chosen default (zai) is absent → cleared, not ERR
    expect(h.action.badgeBackgrounds).toEqual(['#E2E8F0']); // neutral light band, not a threshold band
    expect(h.action.badgeTextColors).toEqual(['#0F172A']); // dark text — the cleared badge must not end up white-on-light
  });
});

describe('background — Qwen Site Selection (usage-badge spec §Live refresh per tick; retained qwen graph)', () => {
  it('targets the international BSS host by default when no site preference is stored', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await writeBadgeProvider(h.local, 'qwen'); // WU-D2: the qwen leg owns the badge this tick
    const transport = new QwenUrlCaptureTransport();
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(transport.qwenHosts).toEqual(['business.ap-southeast-1.aliyuncs.com']);
    expect(h.action.badgeTexts).toEqual(['¥100']); // the chosen qwen balance — cycle completed over the intl host
  });

  it('targets business.aliyuncs.com when the china site preference is stored', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await writeQwenSite(h.local, 'china');
    const transport = new QwenUrlCaptureTransport();
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(transport.qwenHosts).toEqual(['business.aliyuncs.com']);
  });

  it('re-reads the site preference per tick — a change between ticks switches the host', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    const transport = new QwenUrlCaptureTransport();
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW)); // no preference → intl default
    await writeQwenSite(h.local, 'china');
    await refreshTick(h.api, engine, new FakeClock(TICK_NOW)); // china now stored

    expect(transport.qwenHosts).toEqual([
      'business.ap-southeast-1.aliyuncs.com',
      'business.aliyuncs.com',
    ]);
  });
});

describe('background — Qwen Plan Probe Cadence (usage-badge spec §Qwen Plan Probe Cadence; retained qwen graph)', () => {
  /**
   * Transport double for the hybrid qwen legs: serves the recorded balance
   * fixture on either BSS host and a configurable probe outcome on the
   * token-plan host (FetchTransport-shaped: non-2xx probes THROW
   * HttpStatusError after the body-as-text, so the 429 reset text reaches
   * the mapper exactly as in production). Counts every probe dispatch.
   */
  class QwenHybridTransport implements Transport {
    private probeDispatches = 0;
    readonly probeCalls = (): number => this.probeDispatches;

    constructor(
      private readonly probeOutcome: () => TransportResponse,
      private readonly balanceOutcome: () => TransportResponse = () =>
        FIXTURE_RESPONSES['qwen/query-account-balance--ok'],
    ) {}

    async fetch(request: AuthorizedRequest): Promise<TransportResponse> {
      const host = new URL(request.url).hostname;
      if (host === QWEN_PLAN_PROBE_HOST) {
        this.probeDispatches++;
        return this.probeOutcome();
      }
      if (host === 'business.aliyuncs.com' || host === 'business.ap-southeast-1.aliyuncs.com') {
        return this.balanceOutcome();
      }
      throw new Error(`unexpected non-qwen dispatch: ${request.url}`);
    }
  }

  /** A probe leg answering `status` with an optional text body (429 reset text lives there). */
  const probeAnswer = (status: number, bodyText = ''): (() => TransportResponse) => () => {
    if (status < 200 || status >= 300) {
      throw new HttpStatusError(status, bodyText);
    }
    return FIXTURE_RESPONSES['qwen/plan-probe--ok'];
  };

  async function savePlanKey(local: FakeStorageArea): Promise<void> {
    await new KeyStore(local).saveCredential('qwen-plan', { type: 'qwen-plan', token: 'sk-sp-plan-probe-key-0001' });
  }

  /** The 429 text the mapper parses: resets 2026-09-06T10:00:00Z, TICK_NOW is 08-30. */
  const RESET_TEXT = 'HTTP 429: {"Code":"Throttling","Message":"quota reset at 09-06 10:00:00 UTC"}';

  it('a fresh available cache suppresses the probe: only the balance request dispatches', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await savePlanKey(h.local);
    await h.local.set({ [QWEN_PLAN_STATUS_STORAGE_KEY]: { status: 'available', probedAt: TICK_NOW - 30 * 60_000 } });
    const transport = new QwenHybridTransport(probeAnswer(200));
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW), createQwenPlanStep(h.api, { clock: new FakeClock(TICK_NOW), transport }));

    expect(transport.probeCalls()).toBe(0); // 30 min < 120 min TTL → no probe
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.qwen).toMatchObject({ status: 'ok', usage: { plan: { status: 'available' } } });
  });

  it('an expired cache probes exactly once, rewrites the cache, and carries the fresh status', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await savePlanKey(h.local);
    await h.local.set({ [QWEN_PLAN_STATUS_STORAGE_KEY]: { status: 'exhausted', probedAt: TICK_NOW - 20 * 60_000 } }); // > 15 min
    const transport = new QwenHybridTransport(probeAnswer(200));
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW), createQwenPlanStep(h.api, { clock: new FakeClock(TICK_NOW), transport }));

    expect(transport.probeCalls()).toBe(1); // expired → exactly one probe
    expect(h.local.snapshot()[QWEN_PLAN_STATUS_STORAGE_KEY]).toEqual({ status: 'available', probedAt: TICK_NOW });
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.qwen).toMatchObject({ status: 'ok', usage: { plan: { status: 'available' } } });
  });

  it('no plan key means no probe — the qwen result carries no plan status', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']); // AK/SK only
    const transport = new QwenHybridTransport(probeAnswer(200));
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW), createQwenPlanStep(h.api, { clock: new FakeClock(TICK_NOW), transport }));

    expect(transport.probeCalls()).toBe(0);
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect('plan' in (stored.results.qwen as { usage: { plan?: unknown } }).usage).toBe(false);
    expect(QWEN_PLAN_STATUS_STORAGE_KEY in h.local.snapshot()).toBe(false); // no cache written either
  });

  it('badge text is unchanged by plan status — the badge renders the balance', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await savePlanKey(h.local);
    await writeBadgeProvider(h.local, 'qwen'); // WU-D2: chosen qwen — the balance outcome must survive the plan merge
    const transport = new QwenHybridTransport(probeAnswer(429, RESET_TEXT));
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW), createQwenPlanStep(h.api, { clock: new FakeClock(TICK_NOW), transport }));

    expect(h.action.badgeTexts).toEqual(['¥100']); // identical to a plan-less tick
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.qwen).toMatchObject({
      status: 'ok',
      usage: { value: 100.28, plan: { status: 'exhausted', resetAt: Date.UTC(2026, 8, 6, 10, 0, 0) } },
    });
  });

  it('plan merges into ok and absent entries; the error arm wins', async () => {
    // (a) absent: plan key only, no AK/SK — a plan-only value-less ok entry appears.
    const planOnly = makeApi();
    await savePlanKey(planOnly.local);
    const planOnlyTransport = new QwenHybridTransport(probeAnswer(200));
    await refreshTick(
      planOnly.api,
      engineForProviders(planOnly.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport: planOnlyTransport }),
      new FakeClock(TICK_NOW),
      createQwenPlanStep(planOnly.api, { clock: new FakeClock(TICK_NOW), transport: planOnlyTransport }),
    );

    const planOnlySnapshot = planOnly.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(planOnlySnapshot.results.qwen).toEqual({
      status: 'ok',
      usage: { providerId: 'qwen', kind: 'balance', plan: { status: 'available' }, fetchedAt: TICK_NOW },
    });
    expect(planOnly.action.badgeTexts).toEqual(['']); // WU-D2: the choice (default zai) never ran → cleared

    // (b) error arm: the balance leg fails — the class entry stays, no plan merge.
    const failing = makeApi();
    await saveKeys(failing.local, ['qwen']);
    await savePlanKey(failing.local);
    const failingTransport = new QwenHybridTransport(
      probeAnswer(200),
      () => {
        throw new HttpStatusError(401);
      },
    );
    await refreshTick(
      failing.api,
      engineForProviders(failing.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport: failingTransport }),
      new FakeClock(TICK_NOW),
      createQwenPlanStep(failing.api, { clock: new FakeClock(TICK_NOW), transport: failingTransport }),
    );

    const failingSnapshot = failing.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(failingSnapshot.results.qwen).toEqual({ status: 'error', errorClass: 'auth' }); // error wins
  });

  it('a probe transport failure keeps the cache and omits plan status; the balance is unaffected', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await savePlanKey(h.local);
    await writeBadgeProvider(h.local, 'qwen'); // WU-D2: chosen qwen proves the balance badge survives the probe failure
    const cached = { status: 'available', probedAt: TICK_NOW - 130 * 60_000 }; // expired
    await h.local.set({ [QWEN_PLAN_STATUS_STORAGE_KEY]: cached });
    const transport = new QwenHybridTransport(() => {
      throw new TypeError('Failed to fetch'); // non-HTTP classification
    });
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW), createQwenPlanStep(h.api, { clock: new FakeClock(TICK_NOW), transport }));

    expect(h.action.badgeTexts).toEqual(['¥100']); // balance outcome unaffected
    expect(h.local.snapshot()[QWEN_PLAN_STATUS_STORAGE_KEY]).toEqual(cached); // cache untouched
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect('plan' in (stored.results.qwen as { usage: { plan?: unknown } }).usage).toBe(false);
  });

  it('a probe transport failure surfaces on the worker console (permanent diagnostics, hito-7 parity)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await savePlanKey(h.local);
    const transport = new QwenHybridTransport(() => {
      throw new TypeError('Failed to fetch');
    });
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await refreshTick(h.api, engine, new FakeClock(TICK_NOW), createQwenPlanStep(h.api, { clock: new FakeClock(TICK_NOW), transport }));
      expect(errorSpy).toHaveBeenCalledWith('[quotadeck] qwen plan probe failed:', 'TypeError: Failed to fetch');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('an unmapped probe status surfaces on the worker console and leaves the cache untouched', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await savePlanKey(h.local);
    const transport = new QwenHybridTransport(probeAnswer(500, 'boom'));
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await refreshTick(h.api, engine, new FakeClock(TICK_NOW), createQwenPlanStep(h.api, { clock: new FakeClock(TICK_NOW), transport }));
      expect(errorSpy).toHaveBeenCalledWith('[quotadeck] qwen plan probe unmapped status: 500 — cache untouched, plan omitted.');
      expect(QWEN_PLAN_STATUS_STORAGE_KEY in h.local.snapshot()).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('a probe answering 429 without parseable reset text still reports exhausted without resetAt', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await savePlanKey(h.local);
    const transport = new QwenHybridTransport(probeAnswer(429, 'HTTP 429: {"Code":"Throttling"}'));
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW), createQwenPlanStep(h.api, { clock: new FakeClock(TICK_NOW), transport }));

    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.qwen).toMatchObject({ status: 'ok', usage: { plan: { status: 'exhausted' } } });
    expect('resetAt' in ((stored.results.qwen as { usage: { plan?: { resetAt?: unknown } } }).usage.plan ?? {})).toBe(false);
    expect(h.local.snapshot()[QWEN_PLAN_STATUS_STORAGE_KEY]).toEqual({ status: 'exhausted', probedAt: TICK_NOW });
  });
});

describe('background — Qwen Quota Two-Hop Step (hito-12 WU-C2; retained qwen graph)', () => {
  /**
   * Four-host routing double: the plan/probe legs keep the hybrid behavior and
   * the two-hop quota legs join — the mint host answers a synthetic sentinel
   * token, the gateway host serves the recorded live-shaped usage fixture.
   * Counts quota dispatches so gating (china, missing keys) stays provable.
   */
  class QwenQuotaHybridTransport implements Transport {
    private mintDispatches = 0;
    private gatewayDispatches = 0;

    constructor(
      private readonly balance: () => TransportResponse = () => FIXTURE_RESPONSES['qwen/query-account-balance--ok'],
      private readonly probe: () => TransportResponse = () => FIXTURE_RESPONSES['qwen/plan-probe--ok'],
      private readonly usage: () => TransportResponse = () => FIXTURE_RESPONSES['qwen/token-plan-usage--ok'],
    ) {}

    quotaCalls(): { mint: number; gateway: number } {
      return { mint: this.mintDispatches, gateway: this.gatewayDispatches };
    }

    async fetch(request: AuthorizedRequest): Promise<TransportResponse> {
      const host = new URL(request.url).hostname;
      if (host === QWEN_PLAN_PROBE_HOST) return this.probe();
      if (host === 'business.aliyuncs.com' || host === 'business.ap-southeast-1.aliyuncs.com') return this.balance();
      if (host === QWEN_TOKEN_MINT_HOST) {
        this.mintDispatches++;
        return { status: 200, body: { cliAccessToken: 'sess-bg-quota-token-cc13' } };
      }
      if (host === QWEN_TOKEN_PLAN_GATEWAY_HOST) {
        this.gatewayDispatches++;
        return this.usage();
      }
      throw new Error(`unexpected qwen-quota hybrid dispatch: ${request.url}`);
    }
  }

  async function savePlanKeyLocal(local: FakeStorageArea): Promise<void> {
    await new KeyStore(local).saveCredential('qwen-plan', { type: 'qwen-plan', token: 'sk-sp-plan-probe-key-0001' });
  }

  it('both steps compose in one tick: the ok entry carries plan AND quota; the chosen qwen badge renders the quota percentage', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await savePlanKeyLocal(h.local);
    await writeBadgeProvider(h.local, 'qwen'); // WU-D2: the chosen provider with quota present badges its percentage
    const transport = new QwenQuotaHybridTransport();
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(
      h.api,
      engine,
      new FakeClock(TICK_NOW),
      createQwenPlanStep(h.api, { clock: new FakeClock(TICK_NOW), transport }),
      createQwenQuotaStep(h.api, { clock: new FakeClock(TICK_NOW), transport }),
    );

    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.qwen).toMatchObject({
      status: 'ok',
      usage: {
        value: 100.28,
        plan: { status: 'available' },
        quota: { percentage: 14.557322303961778, resetAt: 1_793_721_600_000, fetchedAt: TICK_NOW },
      },
    });
    expect(h.action.badgeTexts).toEqual(['15%']); // quota percentage 14.56 through the zai-path formatter — chosen qwen (WU-D2)
    expect(transport.quotaCalls()).toEqual({ mint: 1, gateway: 1 });
  });

  it('the minted session token never reaches the persisted snapshot bytes', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    const transport = new QwenQuotaHybridTransport();
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW), undefined, createQwenQuotaStep(h.api, { clock: new FakeClock(TICK_NOW), transport }));

    expect(JSON.stringify(h.local.snapshot())).not.toContain('sess-bg-quota-token-cc13');
  });

  it('the error arm wins: a failing balance leg keeps its class entry — no quota merge', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    const transport = new QwenQuotaHybridTransport(() => {
      throw new HttpStatusError(401);
    });
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(
      h.api,
      engine,
      new FakeClock(TICK_NOW),
      undefined,
      createQwenQuotaStep(h.api, { clock: new FakeClock(TICK_NOW), transport }),
    );

    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.qwen).toEqual({ status: 'error', errorClass: 'auth' }); // class wins over a successful quota
    expect(transport.quotaCalls()).toEqual({ mint: 1, gateway: 1 }); // the step still ran its per-tick cadence
  });

  it('china site: the quota step no-ops — zero mint/gateway dispatches and no quota field on the entry', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await savePlanKeyLocal(h.local);
    await writeQwenSite(h.local, 'china');
    const transport = new QwenQuotaHybridTransport();
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(
      h.api,
      engine,
      new FakeClock(TICK_NOW),
      createQwenPlanStep(h.api, { clock: new FakeClock(TICK_NOW), transport }),
      createQwenQuotaStep(h.api, { clock: new FakeClock(TICK_NOW), transport }),
    );

    expect(transport.quotaCalls()).toEqual({ mint: 0, gateway: 0 });
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    const usage = (stored.results.qwen as { usage: { quota?: unknown; plan?: unknown } }).usage;
    expect('quota' in usage).toBe(false);
    expect(usage.plan).toEqual({ status: 'available' }); // plan cadence unaffected by the gate
  });

  it('an absent qwen entry synthesizes quota-only, mirroring the plan-only discipline (badge cleared while the choice never ran)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    const transport = new QwenQuotaHybridTransport();
    // Registry WITHOUT qwen: the engine produces no qwen result — the quota
    // step must synthesize the entry exactly like the plan step does today.
    const engine = engineForProviders(h.api, [], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(
      h.api,
      engine,
      new FakeClock(TICK_NOW),
      undefined,
      createQwenQuotaStep(h.api, { clock: new FakeClock(TICK_NOW), transport }),
    );

    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.qwen).toEqual({
      status: 'ok',
      usage: {
        providerId: 'qwen',
        kind: 'balance',
        quota: { percentage: 14.557322303961778, resetAt: 1_793_721_600_000, fetchedAt: TICK_NOW },
        fetchedAt: TICK_NOW, // the plan-only synthesis discipline, field-for-field
      },
    });
    expect(h.action.badgeTexts).toEqual(['']); // WU-D2: the default choice (zai) never ran → cleared; a chosen+shipped synthesized entry WOULD badge
  });
});

describe('background — default live transport (FetchTransport, AD-19)', () => {
  it('dispatches through the real fetch when no transport is injected (retained kimi graph)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['kimi']);
    vi.stubGlobal('fetch', async () => ({
      status: 200,
      ok: true,
      json: async () => ({ data: { available_balance: '88.88' } }),
    }));
    try {
      const engine = engineForProviders(h.api, ['kimi'], { clock: new FakeClock(TICK_NOW) }); // no transport
      await refreshTick(h.api, engine, new FakeClock(TICK_NOW));
    } finally {
      vi.unstubAllGlobals();
    }

    expect(h.action.badgeTexts).toEqual(['']); // WU-D2: the live fetch answered; unchosen kimi records, the absent choice clears
  });

  it('a fetch-level network failure classifies as network with a cleared badge for the absent choice (retained kimi graph)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['kimi']);
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    try {
      const engine = engineForProviders(h.api, ['kimi'], { clock: new FakeClock(TICK_NOW) });
      await refreshTick(h.api, engine, new FakeClock(TICK_NOW));
    } finally {
      vi.unstubAllGlobals();
    }

    expect(h.action.badgeTexts).toEqual(['']); // WU-D2: ERR belongs to the chosen provider — unchosen kimi cannot raise it
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.kimi).toEqual({ status: 'error', errorClass: 'network' });
  });

  it('hermetic proof: an injected transport serves the shipped tick with the global fetch forbidden', async () => {
    const h = makeApi();
    await saveKeys(h.local, ALL_KEYS); // unshipped keys sit inert (hito-10)
    vi.stubGlobal('fetch', () => {
      throw new Error('live network is forbidden in the hermetic suite');
    });
    try {
      const engine = createRefreshEngine(h.api, {
        clock: new FakeClock(TICK_NOW),
        transport: new SignedQwenRouteTransport(liveRoutes()),
      });
      await refreshTick(h.api, engine, new FakeClock(TICK_NOW));
    } finally {
      vi.unstubAllGlobals();
    }

    expect(h.action.badgeTexts).toEqual(['32%']); // WU-D2: the chosen default (zai) badges once — qwen records, never appends
  });
});

describe('background — Error State (usage-badge spec)', () => {
  it('a chosen provider that never ran keeps the badge cleared across a failing and a recovering tick (retained kimi graph)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['kimi']);

    // Tick 1 — injected failure: a FixtureTransport with NO routes throws on
    // every fetch; there is no fallback, so the refresh fails.
    const failing = engineForProviders(h.api, ['kimi'], {
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
      const recovering = engineForProviders(h.api, ['kimi'], { clock: new FakeClock(TICK_NOW) });
      await refreshTick(h.api, recovering, new FakeClock(TICK_NOW));
    } finally {
      vi.unstubAllGlobals();
    }

    expect(h.action.badgeTexts).toEqual(['', '']); // WU-D2: both ticks clear — the default choice never ran in this graph
  });

  it('badges the chosen provider failure even when a later provider succeeds (retained zai+kimi graph)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai', 'kimi']);
    // Recorded ZAI failure fixture routed at the monitor URL — the
    // recorded-flow way to inject a provider error.
    const routes = {
      ...liveRoutes(),
      [zaiMonitorUrl()]: FIXTURE_RESPONSES['zai/monitor--code-string-200'],
    };
    const engine = engineForProviders(h.api, ['zai', 'kimi'], {
      transport: new FixtureTransport(routes),
      clock: new FakeClock(TICK_NOW),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['ERR']); // WU-D2: the chosen zai failure badges ERR; the successful kimi never replaces it this tick
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
  ] as const)('classifies %s: the snapshot entry carries the class and the absent choice clears the badge (retained kimi graph)', async (expected, makeError) => {
    const h = makeApi();
    await saveKeys(h.local, ['kimi']);
    const engine = engineForProviders(h.api, ['kimi'], {
      transport: new FailingTransport(makeError()),
      clock: new FakeClock(TICK_NOW),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['']); // WU-D2: ERR belongs to the chosen provider — unchosen kimi failures never badge
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.kimi).toEqual({ status: 'error', errorClass: expected });
  });

  it('a body-level provider failure (ZAI string "200" code) classifies as server', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai']);
    const engine = createRefreshEngine(h.api, {
      transport: new FixtureTransport({ [zaiMonitorUrl()]: FIXTURE_RESPONSES['zai/monitor--code-string-200'] }),
      clock: new FakeClock(TICK_NOW),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['ERR']);
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.zai).toEqual({ status: 'error', errorClass: 'server' });
  });

  it('a plain-text 401 body classifies auth with no parse failure (§Status-First Error Classification)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai']);
    // The recorded 401 fixture carries a plain-text body; StatusFirstTransport
    // mirrors FetchTransport (status checked BEFORE any body read), so the
    // plain-text body can never reach a parser.
    const engine = createRefreshEngine(h.api, {
      transport: new StatusFirstTransport({ [zaiMonitorUrl()]: FIXTURE_RESPONSES['zai/monitor--plain-text-401'] }),
      clock: new FakeClock(TICK_NOW),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['ERR']);
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.zai).toEqual({ status: 'error', errorClass: 'auth' }); // auth — not a parse/server class
  });
});

describe('background — Cycle Snapshot (popup-ui spec §Current Cycle Data on Open)', () => {
  it('tick writes exactly one snapshot per completed cycle: the shipped ok entry carries the monitor windows', async () => {
    const h = makeApi();
    await saveKeys(h.local, ALL_KEYS); // unshipped keys sit inert (hito-10)
    startWorker(h.api, {
      clock: new FixedClock(),
      transport: new SignedQwenRouteTransport(liveRoutes()),
    });
    h.fireInstalled();
    await flushTasks();

    const perTick = ['32%']; // WU-D2: one badge write per tick, from the chosen default (zai)
    h.alarms.fire(USAGE_REFRESH_ALARM);
    // The snapshot write is the tick's LAST operation — once it lands, the
    // badge sequence is final, so both can be asserted deterministically.
    await vi.waitFor(() => expect(snapshotWrites(h.local)).toBe(1));
    expect(h.action.badgeTexts).toEqual(perTick);

    h.alarms.fire(USAGE_REFRESH_ALARM); // repeated tick — still one write per cycle
    await vi.waitFor(() => expect(snapshotWrites(h.local)).toBe(2));
    expect(h.action.badgeTexts).toEqual([...perTick, ...perTick]);

    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(Object.keys(stored.results)).toEqual(['zai', 'qwen']); // shipped providers only (hito-12 re-ship)
    expect(stored.results.zai).toEqual({
      status: 'ok',
      usage: expect.objectContaining({
        providerId: 'zai',
        kind: 'cost',
        // The single cycle write carries the monitor windows verbatim (AD-26);
        // this is the live-captured plan-pro parse (no weekly, no totals).
        windows: {
          level: 'pro',
          fiveHour: { percentage: 32, resetAt: 1_788_656_274_505 },
          mcp: {
            used: 0,
            ceiling: 1000,
            tools: [
              { name: 'search-prime', used: 0 },
              { name: 'web-reader', used: 0 },
              { name: 'zread', used: 0 },
            ],
          },
        },
      }),
    });
  });

  it('unkeyed providers have no snapshot entry and no credential material reaches the snapshot (retained zai+kimi graph)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai', 'kimi']);
    const engine = engineForProviders(h.api, ['zai', 'kimi'], {
      clock: new FixedClock(),
      transport: new FixtureTransport(liveRoutes()),
    });

    await refreshTick(h.api, engine, new FixedClock());

    expect(h.action.badgeTexts).toEqual(['32%']); // WU-D2: chosen zai badges once; the kimi result records without moving it
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(Object.keys(stored.results)).toEqual(['zai', 'kimi']); // unkeyed qwen + openai absent
    expect(JSON.stringify(stored)).not.toContain('fixture-milestone-key');
  });

  it('a failed provider records its class entry while its badge path stays unchanged (retained zai+kimi graph)', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai', 'kimi']);
    const routes = {
      ...liveRoutes(),
      [zaiMonitorUrl()]: FIXTURE_RESPONSES['zai/monitor--code-string-200'],
    };
    const engine = engineForProviders(h.api, ['zai', 'kimi'], {
      transport: new FixtureTransport(routes),
      clock: new FixedClock(),
    });

    await refreshTick(h.api, engine, new FixedClock());

    expect(h.action.badgeTexts).toEqual(['ERR']); // WU-D2: the chosen zai error renders the marker once, byte-identical in the single-write model
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.zai).toEqual({ status: 'error', errorClass: 'server' }); // class only (AD-13/21)
    expect(stored.results.kimi).toMatchObject({ status: 'ok' });
  });
});

describe('background — Badge Provider Choice (hito-12 WU-D2, single badge write per tick)', () => {
  /**
   * Host-routing double for the choice cases: mint/gateway serve the quota
   * two-hop, everything else (BSS balance) answers the default leg. Local to
   * this describe — the WU-C2 hybrid class stays where its own tests put it.
   */
  class QuotaChoiceTransport implements Transport {
    constructor(
      private readonly balance: () => TransportResponse = () => FIXTURE_RESPONSES['qwen/query-account-balance--ok'],
      private readonly usage: () => TransportResponse = () => FIXTURE_RESPONSES['qwen/token-plan-usage--ok'],
    ) {}

    async fetch(request: AuthorizedRequest): Promise<TransportResponse> {
      const host = new URL(request.url).hostname;
      if (host === QWEN_TOKEN_MINT_HOST) {
        return { status: 200, body: { cliAccessToken: 'sess-choice-quota-token-d1' } };
      }
      if (host === QWEN_TOKEN_PLAN_GATEWAY_HOST) {
        return this.usage();
      }
      return this.balance();
    }
  }

  it('the chosen zai renders its 5h percentage once while the keyed qwen success only records', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai', 'qwen']);
    await writeBadgeProvider(h.local, 'zai'); // the explicit choice — same outcome as the default, but proven through the store
    const engine = engineForProviders(h.api, ['zai', 'qwen'], {
      clock: new FixedClock(),
      transport: new SignedQwenRouteTransport(liveRoutes()),
    });

    await refreshTick(h.api, engine, new FixedClock());

    expect(h.action.badgeTexts).toEqual(['32%']);
    expect(h.action.badgeBackgrounds).toEqual(['#E2E8F0']); // 32 < 50 → neutral light band
    expect(h.action.badgeTextColors).toEqual(['#0F172A']);
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(Object.keys(stored.results)).toEqual(['zai', 'qwen']); // qwen RECORDED — recording and badging are decoupled
  });

  it('the chosen qwen with quota badges the quota percentage — recorded the same tick it merges', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await writeBadgeProvider(h.local, 'qwen');
    const transport = new QuotaChoiceTransport();
    // Registry WITHOUT qwen: the quota step synthesizes the ok entry — chosen
    // AND shipped, so the tick-end resolution badges the merged result (WU-C2
    // merge + WU-D2 render).
    const engine = engineForProviders(h.api, [], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW), undefined, createQwenQuotaStep(h.api, { clock: new FakeClock(TICK_NOW), transport }));

    expect(h.action.badgeTexts).toEqual(['15%']); // quota percentage 14.56 through the shared zai-path formatter
    expect(h.action.badgeBackgrounds).toEqual(['#E2E8F0']); // 14.56 < 50 → neutral band from the QUOTA percentage
  });

  it('the threshold band follows the quota percentage — 84% renders the deep-orange band', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await writeBadgeProvider(h.local, 'qwen');
    const highPctBody = structuredClone(FIXTURE_RESPONSES['qwen/token-plan-usage--ok'].body) as {
      data: { DataV2: { data: { data: { per1MonthPercentage: number } } } };
    };
    highPctBody.data.DataV2.data.data.per1MonthPercentage = 0.84; // gateway USED fraction
    const transport = new QuotaChoiceTransport(undefined, () => ({ status: 200, body: highPctBody }));
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW), undefined, createQwenQuotaStep(h.api, { clock: new FakeClock(TICK_NOW), transport }));

    expect(h.action.badgeTexts).toEqual(['84%']); // uncapped passthrough through the same formatter
    expect(h.action.badgeBackgrounds).toEqual(['#EA580C']); // ≥80 deep-orange band from quota.percentage
    expect(h.action.badgeTextColors).toEqual(['#FFFFFF']);
  });

  it('the chosen qwen without quota renders the balance format', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await writeBadgeProvider(h.local, 'qwen');
    const transport = new QwenUrlCaptureTransport();
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['¥100']); // existing formatBadgeText balance path (hito-8 shape)
    expect(h.action.badgeBackgrounds).toEqual(['#E2E8F0']); // no percentage exists → neutral band
  });

  it('the chosen qwen error renders ERR on the neutral band', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['qwen']);
    await writeBadgeProvider(h.local, 'qwen');
    const transport = new QuotaChoiceTransport(() => {
      throw new HttpStatusError(401);
    });
    const engine = engineForProviders(h.api, ['qwen'], { clock: new FakeClock(TICK_NOW), transport });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['ERR']); // the chosen provider's error arm — hito-10 marker, unchanged
    expect(h.action.badgeBackgrounds).toEqual(['#E2E8F0']); // never a threshold band
    expect(h.action.badgeTextColors).toEqual(['#0F172A']); // legible dark text on the light band
  });

  it('an unchosen provider failing never moves the badge', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai', 'qwen']); // chosen default zai
    const engine = engineForProviders(h.api, ['zai', 'qwen'], {
      clock: new FakeClock(TICK_NOW),
      // zai route only: the qwen intl dispatch misses → the qwen arm fails.
      transport: new FixtureTransport({ [zaiMonitorUrl()]: FIXTURE_RESPONSES['zai/monitor--pro-plan'] }),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['32%']); // the qwen failure classifies into the snapshot but never badges
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.qwen).toEqual({ status: 'error', errorClass: 'unknown' }); // class recorded, badge untouched
  });

  it('the chosen qwen absent — its key revoked, zai ok — clears the badge with the neutral band', async () => {
    const h = makeApi();
    await saveKeys(h.local, ['zai']); // qwen unkeyed: the engine produces no qwen entry
    await writeBadgeProvider(h.local, 'qwen');
    const engine = engineForProviders(h.api, ['zai', 'qwen'], {
      clock: new FixedClock(),
      transport: new FixtureTransport({ [zaiMonitorUrl()]: FIXTURE_RESPONSES['zai/monitor--pro-plan'] }),
    });

    await refreshTick(h.api, engine, new FixedClock());

    expect(h.action.badgeTexts).toEqual(['']); // choice ran no entry → cleared, NOT the successful zai, NOT ERR
    expect(h.action.badgeBackgrounds).toEqual(['#E2E8F0']);
    expect(h.action.badgeTextColors).toEqual(['#0F172A']);
  });

  it('an unshipped stored choice (kimi, fully keyed) behaves as absent — cleared badge', async () => {
    const h = makeApi();
    await saveKeys(h.local, ALL_KEYS); // kimi keyed AND its route served — still never badges while unshipped
    await writeBadgeProvider(h.local, 'kimi');
    const engine = engineForProviders(h.api, ['kimi'], {
      clock: new FakeClock(TICK_NOW),
      transport: new FixtureTransport({ 'https://api.moonshot.cn/v1/users/me/balance': FIXTURE_RESPONSES['kimi/users-me-balance--ok'] }),
    });

    await refreshTick(h.api, engine, new FakeClock(TICK_NOW));

    expect(h.action.badgeTexts).toEqual(['']); // ProviderId-wide validation + shipped-gated render
    expect(h.action.badgeBackgrounds).toEqual(['#E2E8F0']);
    const stored = h.local.snapshot()[SNAPSHOT_STORAGE_KEY] as CycleSnapshot;
    expect(stored.results.kimi).toMatchObject({ status: 'ok' }); // the entry exists — the gate is at the badge, not the record
  });
});

describe('background — resolveChosenBadge (hito-12 WU-D2 badge resolution, pure)', () => {
  const qwenEntry = (overrides: Partial<NormalizedUsage>): Partial<Record<ProviderId, ProviderSnapshotEntry>> => ({
    qwen: { status: 'ok', usage: { providerId: 'qwen', kind: 'balance', fetchedAt: TICK_NOW, ...overrides } },
  });

  it('an absent choice clears — empty text, no percentage', () => {
    expect(resolveChosenBadge({}, 'zai')).toEqual({ text: '' });
  });

  it('an UNshipped choice behaves as absent even when its entry exists', () => {
    const okEntry = qwenEntry({ value: 100.28, currency: 'CNY' });
    expect(resolveChosenBadge({ kimi: { status: 'error', errorClass: 'auth' } }, 'kimi')).toEqual({ text: '' });
    expect(resolveChosenBadge({ ...okEntry, kimi: { status: 'ok', usage: { providerId: 'kimi', kind: 'balance', value: 88.88, currency: 'CNY', fetchedAt: TICK_NOW } } }, 'kimi')).toEqual({
      text: '',
    });
  });

  it('the chosen error entry renders the ERR marker — the class never changes the render', () => {
    expect(resolveChosenBadge({ zai: { status: 'error', errorClass: 'rate-limit' } }, 'zai')).toEqual({ text: 'ERR' });
  });

  it('chosen zai renders the 5h percentage and hands it to the threshold band', () => {
    const render = resolveChosenBadge(
      { zai: { status: 'ok', usage: { providerId: 'zai', kind: 'cost', windows: { fiveHour: { percentage: 32 } }, fetchedAt: TICK_NOW } } },
      'zai',
    );
    expect(render).toEqual({ text: '32%', percentage: 32 });
  });

  it('chosen zai without a percentage falls back to the plan level', () => {
    expect(
      resolveChosenBadge({ zai: { status: 'ok', usage: { providerId: 'zai', kind: 'cost', windows: { level: 'Lite' }, fetchedAt: TICK_NOW } } }, 'zai'),
    ).toEqual({ text: 'Lite' });
  });

  it('chosen qwen renders the quota percentage and hands it to the band — UNCAPPED passthrough', () => {
    expect(resolveChosenBadge(qwenEntry({ quota: { percentage: 11.72, fetchedAt: TICK_NOW } }), 'qwen')).toEqual({
      text: '12%',
      percentage: 11.72,
    });
    expect(resolveChosenBadge(qwenEntry({ quota: { percentage: 137.4, fetchedAt: TICK_NOW } }), 'qwen')).toEqual({
      text: '137%',
      percentage: 137.4,
    });
  });

  it('the quota percentage renders EXACTLY like the zai 5h path for the same number — no rounding drift', () => {
    const percentage = 12.8;
    const quotaRender = resolveChosenBadge(qwenEntry({ quota: { percentage, fetchedAt: TICK_NOW } }), 'qwen');
    const zaiRender = resolveChosenBadge(
      { zai: { status: 'ok', usage: { providerId: 'zai', kind: 'cost', windows: { fiveHour: { percentage } }, fetchedAt: TICK_NOW } } },
      'zai',
    );
    expect(quotaRender.text).toBe(zaiRender.text);
  });

  it('chosen qwen without quota falls back to the balance format', () => {
    expect(resolveChosenBadge(qwenEntry({ value: 100.28, currency: 'CNY' }), 'qwen')).toEqual({ text: '¥100' });
  });

  it('chosen qwen with neither quota nor balance clears — the honest empty badge', () => {
    expect(resolveChosenBadge(qwenEntry({ plan: { status: 'available' } }), 'qwen')).toEqual({ text: '' });
  });
});
