// Composition root (AD-1) — the MV3 service worker entry.
//
// Together with platform/browser-api.ts this is the only production module
// that may touch the `chrome` global, and it does so exclusively through the
// ChromeBrowserApi adapter. Everything the tick needs is composed here:
// registry → AllowlistNetworkClient over a FetchTransport (AD-19) →
// RefreshEngine → badge via formatBadgeText (usage-badge spec).
//
// Behavior (usage-badge spec):
// - One-Minute Alarm Schedule: `usage-refresh` is registered with a 1-minute
//   period on install and on startup WHEN ABSENT.
// - Live refresh per tick: every alarm tick derives the whole UsageQuery from
//   the injected Clock (buildTickQuery) and refreshes each keyed provider
//   live; each success updates the badge (registry order, last result wins).
// - Error State + Taxonomy: a failed provider renders ERROR_BADGE_TEXT for
//   every class; the cycle snapshot carries only its ErrorClass (AD-13/21).
import { SystemClock, type Clock } from './core/clock';
import type { ProviderId, UsageQuery } from './core/provider';
import { billingMonthsFor } from './core/tier-budget';
import { ERROR_BADGE_TEXT, formatBadgeText } from './core/usage';
import { AllowlistNetworkClient } from './network/client';
import { FetchTransport } from './network/fetch-transport';
import type { Transport } from './network/transport';
import { ChromeBrowserApi, type BrowserApi } from './platform/browser-api';
import { createDefaultRegistry } from './providers';
import { classifyRefreshError } from './refresh/error-taxonomy';
import { RefreshEngine } from './refresh/engine';
import { KeyStore } from './storage/key-store';
import { readTierLimits } from './storage/limit-store';
import { SnapshotStore, type ProviderSnapshotEntry } from './storage/snapshot-store';

/** The single alarm name the worker owns (usage-badge §One-Minute Alarm Schedule). */
export const USAGE_REFRESH_ALARM = 'usage-refresh';
/** Spec-pinned refresh period. */
export const REFRESH_PERIOD_MINUTES = 1;

/**
 * OpenAI trailing cost window in seconds (`bucket_width=1d`). Product default
 * per the design's open questions — revisable without architectural change.
 */
const OPENAI_WINDOW_SECONDS = 24 * 3_600;

/**
 * Derives the provider-agnostic tick query from the injected clock (spec §Live
 * refresh per tick — no wall-clock reads inside provider logic): the ZAI
 * billing months and window anchor come from +08:00 month arithmetic (AD-20),
 * the OpenAI window is the trailing 24h, and the tier-limit feed from the
 * limit store passes through verbatim.
 */
export function buildTickQuery(clock: Clock, tierLimits: Readonly<Record<string, number>>): UsageQuery {
  const now = clock.now();
  const endTime = Math.floor(now / 1000);
  return {
    billingMonths: billingMonthsFor(now),
    now,
    startTime: endTime - OPENAI_WINDOW_SECONDS,
    endTime,
    tierLimits,
  };
}

/** Test-visible injection points; production uses the live defaults. */
export interface WorkerOptions {
  /** Defaults to FetchTransport over the ambient worker fetch (AD-19). */
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
    client: new AllowlistNetworkClient(options.transport ?? new FetchTransport()),
    keys: new KeyStore(browser.storage.local),
    clock: options.clock ?? new SystemClock(),
    rng: options.rng,
  });
}

/**
 * One alarm tick: derive the live query from the clock and the tier-limit
 * store, refresh every keyed provider sequentially and render each outcome —
 * usage text per success, ERROR_BADGE_TEXT per failure (replaced by the next
 * success). After the cycle completes, its per-provider outcomes are persisted
 * as ONE `qd:snapshot` write for the popup (AD-13) — usage+budget on the ok
 * arm, the classified ErrorClass on the error arm.
 */
export async function refreshTick(browser: BrowserApi, engine: RefreshEngine, clock: Clock): Promise<void> {
  const tierLimits = await readTierLimits(browser.storage.local); // qd:tier-limits override (AD-20)
  const query = buildTickQuery(clock, tierLimits);
  const results: Partial<Record<ProviderId, ProviderSnapshotEntry>> = {};
  await engine.refreshAll(query, {
    onUsage: (usage) => {
      results[usage.providerId] = { status: 'ok', usage };
      browser.action.setBadgeText({ text: formatBadgeText(usage) });
    },
    onError: (providerId, error) => {
      // AD-13/21: the thrown value is dropped — only its taxonomy class
      // survives into the snapshot, and the badge shows ERR for every class.
      results[providerId] = { status: 'error', errorClass: classifyRefreshError(error) };
      browser.action.setBadgeText({ text: ERROR_BADGE_TEXT });
    },
  });
  await new SnapshotStore(browser.storage.local).write({ results });
}

/** Wires alarm registration and the tick handler onto the injected browser. */
export function startWorker(browser: BrowserApi, options: WorkerOptions = {}): void {
  // One clock instant per worker: the same source feeds the engine (sleeps,
  // fetchedAt) and the tick query derivation.
  const clock = options.clock ?? new SystemClock();
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
    void refreshTick(browser, engine, clock).catch((error) => {
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
