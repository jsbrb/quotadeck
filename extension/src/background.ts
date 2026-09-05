// Composition root (AD-1) — the MV3 service worker entry.
//
// Together with platform/browser-api.ts this is the only production module
// that may touch the `chrome` global, and it does so exclusively through the
// ChromeBrowserApi adapter. Everything the tick needs is composed here:
// registry → AllowlistNetworkClient over a FixtureTransport (AD-8) →
// RefreshEngine → badge via formatBadgeText (usage-badge spec).
//
// Behavior (usage-badge spec):
// - One-Minute Alarm Schedule: `usage-refresh` is registered with a 1-minute
//   period on install and on startup WHEN ABSENT.
// - Badge refresh per tick: every alarm tick runs refreshAll; each successful
//   provider updates the badge (registry order, last result wins).
// - Error State: a failed provider renders ERROR_BADGE_TEXT; the next success
//   (same tick or a later tick) replaces it.
// - No Live Calls: this milestone's transport is the bundled fixture table —
//   an unrouted URL throws, there is no network path at all.
import { SystemClock, type Clock } from './core/clock';
import type { UsageQuery } from './core/provider';
import { ERROR_BADGE_TEXT, formatBadgeText } from './core/usage';
import { FIXTURE_RESPONSES } from './fixtures';
import { AllowlistNetworkClient } from './network/client';
import { FixtureTransport, type Transport, type TransportResponse } from './network/transport';
import { ChromeBrowserApi, type BrowserApi } from './platform/browser-api';
import { createDefaultRegistry } from './providers';
import { RefreshEngine } from './refresh/engine';
import { KeyStore } from './storage/key-store';

/** The single alarm name the worker owns (usage-badge §One-Minute Alarm Schedule). */
export const USAGE_REFRESH_ALARM = 'usage-refresh';
/** Spec-pinned refresh period. */
export const REFRESH_PERIOD_MINUTES = 1;

// Fixture-milestone constants (AD-8): the recorded fixture set pins one ZAI
// billing month and one OpenAI cost window. The tick query AND the transport
// route table below derive from these, so every dispatched URL resolves to a
// recorded fixture. The live milestone replaces the transport, not these
// query semantics.
const ZAI_BILLING_MONTH = '2026-08';
const OPENAI_START_TIME = 1_754_006_400;
const OPENAI_END_TIME = 1_754_179_200;

/** The query every tick dispatches; each provider consumes its own fields. */
export const FIXTURE_QUERY: UsageQuery = {
  billingMonth: ZAI_BILLING_MONTH,
  startTime: OPENAI_START_TIME,
  endTime: OPENAI_END_TIME,
};

function zaiPageUrl(pageNum: number): string {
  return `https://bigmodel.cn/api/finance/expenseBill/expenseBillList?billingMonth=${ZAI_BILLING_MONTH}&pageNum=${pageNum}&pageSize=2`;
}

/**
 * FixtureTransport route table: exact full URLs → recorded responses. URL
 * shapes are the ones the providers build (proven byte-exact in the slice-2
 * provider tests), so the unpacked worker replays the recorded flows.
 */
export const FIXTURE_ROUTES: Readonly<Record<string, TransportResponse>> = {
  [zaiPageUrl(1)]: FIXTURE_RESPONSES['zai/expense-bill-list--page-1'],
  [zaiPageUrl(2)]: FIXTURE_RESPONSES['zai/expense-bill-list--page-2'],
  [zaiPageUrl(3)]: FIXTURE_RESPONSES['zai/expense-bill-list--page-3'],
  'https://business.aliyuncs.com/?Action=QueryAccountBalance&Version=2017-12-14':
    FIXTURE_RESPONSES['qwen/query-account-balance--ok'],
  'https://api.openai.com/v1/organization/costs?start_time=1754006400&bucket_width=1d&end_time=1754179200':
    FIXTURE_RESPONSES['openai/costs--page-1'],
  'https://api.openai.com/v1/organization/costs?start_time=1754006400&bucket_width=1d&end_time=1754179200&page=costs_page2_cursor_9f3ab2c1':
    FIXTURE_RESPONSES['openai/costs--page-2-final'],
  'https://api.moonshot.cn/v1/users/me/balance': FIXTURE_RESPONSES['kimi/users-me-balance--ok'],
};

/** Test-visible injection points; production uses the fixture defaults. */
export interface WorkerOptions {
  /** Defaults to the bundled fixture route table (AD-8). */
  readonly transport?: Transport;
  /** Defaults to SystemClock. */
  readonly clock?: Clock;
  /** Jitter draw; defaults to Math.random inside the engine. */
  readonly rng?: () => number;
}

/** Builds the production engine graph over the injected browser + options. */
export function createRefreshEngine(browser: BrowserApi, options: WorkerOptions = {}): RefreshEngine {
  return new RefreshEngine({
    registry: createDefaultRegistry(),
    client: new AllowlistNetworkClient(options.transport ?? new FixtureTransport(FIXTURE_ROUTES)),
    keys: new KeyStore(browser.storage.local),
    clock: options.clock ?? new SystemClock(),
    rng: options.rng,
  });
}

/**
 * One alarm tick: refresh every keyed provider sequentially and render each
 * outcome — usage text per success, ERROR_BADGE_TEXT per failure (replaced by
 * the next success).
 */
export async function refreshTick(browser: BrowserApi, engine: RefreshEngine): Promise<void> {
  await engine.refreshAll(FIXTURE_QUERY, {
    onUsage: (usage) => browser.action.setBadgeText({ text: formatBadgeText(usage) }),
    onError: (_providerId, _error) => browser.action.setBadgeText({ text: ERROR_BADGE_TEXT }),
  });
}

/** Wires alarm registration and the tick handler onto the injected browser. */
export function startWorker(browser: BrowserApi, options: WorkerOptions = {}): void {
  const engine = createRefreshEngine(browser, options);

  const ensureAlarm = async (): Promise<void> => {
    if ((await browser.alarms.get(USAGE_REFRESH_ALARM)) === undefined) {
      browser.alarms.create(USAGE_REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MINUTES });
    }
  };
  browser.runtime.onInstalled.listen(() => {
    void ensureAlarm();
  });
  browser.runtime.onStartup.listen(() => {
    void ensureAlarm();
  });

  browser.alarms.onAlarm.listen((alarm) => {
    if (alarm.name !== USAGE_REFRESH_ALARM) {
      return;
    }
    void refreshTick(browser, engine).catch((error) => {
      console.error('[quotadeck] refresh tick failed:', error);
    });
  });
}

// Production boot. vitest imports this module in Node, where no `chrome`
// global exists — the guard keeps tests hermetic (AD-1). The unpacked worker
// always has the global, so the worker self-starts on load.
if (typeof chrome !== 'undefined') {
  startWorker(new ChromeBrowserApi());
}
