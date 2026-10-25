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
// - One-Shot Refresh Alarm: `refresh-now` (created by the popup) drives the
//   SAME refresh tick; the periodic registration and cadence stay untouched.
// - Live refresh per tick: every alarm tick reads the ZAI platform
//   preference (qd:pref:zai-platform), the Qwen site preference
//   (qd:pref:qwen-site) and the badge provider preference
//   (qd:pref:badge-provider), derives the whole UsageQuery from the injected
//   Clock + both selections (buildTickQuery) and refreshes each keyed
//   provider live; at tick end ONE badge write renders the user-chosen
//   provider (hito-12 WU-D2) — unchosen results only record into the
//   snapshot.
// - Error State + Taxonomy: a failed refresh persists ERROR_BADGE_TEXT only
//   when its provider is the chosen one; every failure still carries its
//   taxonomy class into the snapshot (AD-13/21).
// - Gateway Origin Rule Install (hito-12 WU-F): every worker start installs
//   ONE declarativeNetRequest session rule that rewrites the quota gateway
//   request's forbidden chrome-extension:// Origin to a PUBLIC console-origin
//   constant (Alibaba's WAF 302s the SW's own Origin to err.taobao.com before
//   app auth — see dnr/gateway-origin-rule.ts for the hito-9 §Lane 1(c)
//   contrast: public constants only, zero credentials, the Bearer still rides
//   exclusively through the client's session-marker seam). updateSessionRules
//   replaces by id, so repeat installs across SW restarts stay idempotent.
import { SystemClock, type Clock } from './core/clock';
import type { ProviderId, UsageQuery } from './core/provider';
import { SHIPPED_PROVIDER_IDS } from './core/provider-metadata';
import type { QwenSite } from './core/qwen-sites';
import type { ZaiPlatform } from './core/zai-platforms';
import { badgeBackgroundColor, badgeTextColor, ERROR_BADGE_TEXT, formatBadgeText, formatPercentageBadgeText } from './core/usage';
import { buildGatewayOriginSessionRule } from './dnr/gateway-origin-rule';
import { AllowlistNetworkClient } from './network/client';
import { FetchTransport } from './network/fetch-transport';
import type { Transport } from './network/transport';
import { ChromeBrowserApi, type BrowserApi, type WorkerBrowserApi } from './platform/browser-api';
import { createDefaultRegistry } from './providers';
import { classifyRefreshError } from './refresh/error-taxonomy';
import { RefreshEngine } from './refresh/engine';
import { QwenPlanStep } from './refresh/qwen-plan';
import { QwenQuotaStep } from './refresh/qwen-quota';
import { readBadgeProvider } from './storage/badge-provider-store';
import { KeyStore } from './storage/key-store';
import { QwenPlanStore } from './storage/qwen-plan-store';
import { readQwenSite } from './storage/qwen-site-store';
import { SnapshotStore, type ProviderSnapshotEntry } from './storage/snapshot-store';
import { readZaiPlatform } from './storage/zai-platform-store';

/** The single periodic alarm name the worker owns (usage-badge §One-Minute Alarm Schedule). */
export const USAGE_REFRESH_ALARM = 'usage-refresh';
/**
 * One-shot manual refresh alarm (usage-badge §One-Shot Refresh Alarm): fired
 * by the popup, handled by the SAME refresh tick as the periodic alarm. The
 * popup defines its own module-local copy of this name (AD-24: it must not
 * import this module), so the two literals are pinned equal by tests.
 */
export const REFRESH_NOW_ALARM = 'refresh-now';
/** Spec-pinned refresh period. */
export const REFRESH_PERIOD_MINUTES = 1;

/**
 * OpenAI trailing cost window in seconds (`bucket_width=1d`). Product default
 * per the design's open questions — revisable without architectural change.
 */
const OPENAI_WINDOW_SECONDS = 24 * 3_600;

/**
 * Derives the provider-agnostic tick query from the injected clock and the
 * stored preference selections (spec §Live refresh per tick — no wall-clock
 * reads inside provider logic): the selected ZAI platform determines the base
 * URL of every ZAI monitor request (AD-28), the selected Qwen site determines
 * the base URL of every Qwen BSS request (AD-28 mirror, default
 * international), and the OpenAI window is the trailing 24h. The query
 * carries NO billing months and NO tier limits (hito-4).
 */
export function buildTickQuery(clock: Clock, zaiPlatform: ZaiPlatform, qwenSite: QwenSite): UsageQuery {
  const now = clock.now();
  const endTime = Math.floor(now / 1000);
  return {
    zaiPlatform,
    qwenSite,
    now,
    startTime: endTime - OPENAI_WINDOW_SECONDS,
    endTime,
  };
}

/** The badge render the chosen provider's cycle entry resolves to (hito-12 WU-D2). */
export interface ChosenBadge {
  /** The single text written this tick — `''` clears the badge. */
  readonly text: string;
  /** Threshold-band percentage when one exists (zai 5h or qwen quota); `undefined` renders neutral. */
  readonly percentage?: number;
}

/**
 * Resolve the tick's ONE badge write (hito-12 WU-D2): the badge shows exactly
 * ONE provider — the user's stored choice. Ratified rules:
 * - an UNshipped choice (e.g. a stored 'kimi') behaves as absent — the badge
 *   clears; validation stays ProviderId-wide, so re-shipping never
 *   invalidates stored preferences;
 * - an absent choice (no credentials / did not run) CLEARS the badge — `''`
 *   on the neutral band, NOT `ERR`;
 * - the chosen provider's error entry renders the ERR marker on the neutral
 *   band (every class, unchanged hito-10 rendering);
 * - a chosen qwen entry carries the quota percentage when present —
 *   formatted through the SAME helper the zai 5h path uses (no rounding
 *   games) — falls back to the balance rendering, and with neither figure
 *   the honest badge is the empty clear;
 * - anything else renders `formatBadgeText` with the zai 5h percentage
 *   coloring the threshold band when present.
 */
export function resolveChosenBadge(
  results: Partial<Record<ProviderId, ProviderSnapshotEntry>>,
  chosen: ProviderId,
): ChosenBadge {
  const entry = SHIPPED_PROVIDER_IDS.includes(chosen) ? results[chosen] : undefined;
  if (entry === undefined) {
    return { text: '' };
  }
  if (entry.status === 'error') {
    return { text: ERROR_BADGE_TEXT };
  }
  const usage = entry.usage;
  if (usage.providerId === 'qwen' && usage.quota?.percentage !== undefined) {
    return { text: formatPercentageBadgeText(usage.quota.percentage), percentage: usage.quota.percentage };
  }
  return { text: formatBadgeText(usage), percentage: usage.windows?.fiveHour?.percentage };
}

/** Test-visible injection points; production uses the live defaults. */
export interface WorkerOptions {
  /** Defaults to FetchTransport over the ambient worker fetch (AD-19). */
  readonly transport?: Transport;
  /** Defaults to SystemClock. */
  readonly clock?: Clock;
}

/** Builds the production engine graph over the injected browser + options. */
export function createRefreshEngine(browser: BrowserApi, options: WorkerOptions = {}): RefreshEngine {
  return new RefreshEngine({
    registry: createDefaultRegistry(),
    client: new AllowlistNetworkClient(options.transport ?? new FetchTransport()),
    keys: new KeyStore(browser.storage.local),
    clock: options.clock ?? new SystemClock(),
  });
}

/**
 * Builds the tick-level qwen plan probe step (hito-8 design note 2) over the
 * same injected transport as the engine — the probe dispatches through the
 * identical AllowlistNetworkClient seam in tests and production alike.
 */
export function createQwenPlanStep(browser: BrowserApi, options: WorkerOptions = {}): QwenPlanStep {
  return new QwenPlanStep({
    client: new AllowlistNetworkClient(options.transport ?? new FetchTransport()),
    keys: new KeyStore(browser.storage.local),
    store: new QwenPlanStore(browser.storage.local),
  });
}

/**
 * Builds the tick-level qwen quota two-hop step (hito-12 WU-C2) over the same
 * injected transport as the engine and the probe step — the mint hop signs
 * through the client's acs3 seam and the gateway hop attaches through the
 * session seam, identical in tests and production alike.
 */
export function createQwenQuotaStep(browser: BrowserApi, options: WorkerOptions = {}): QwenQuotaStep {
  return new QwenQuotaStep({
    client: new AllowlistNetworkClient(options.transport ?? new FetchTransport()),
    keys: new KeyStore(browser.storage.local),
  });
}

/**
 * One alarm tick: read the platform/site/badge-provider preferences, derive
 * the live query from the clock + selections, refresh every keyed provider
 * sequentially (recording every outcome into the cycle results), merge the
 * qwen plan probe (hito-8) and quota two-hop (hito-12 WU-C2) steps, then
 * make the tick's ONE badge write from the chosen provider's entry
 * (`resolveChosenBadge`, hito-12 WU-D2) and persist the cycle snapshot.
 * The plan probe runs AFTER refreshAll and BEFORE the snapshot write: its
 * status merges into the qwen entry only when that entry is ok or absent —
 * the error arm wins. The quota step runs beside it with the EXACT same
 * merge discipline — error arm wins, absent entry synthesizes. Because both
 * merges land BEFORE the badge resolution, a chosen qwen entry badges its
 * quota percentage the same tick it first arrives. Finally the cycle's
 * per-provider outcomes are persisted as ONE `qd:snapshot` write for the
 * popup (AD-13) — usage+windows+plan+quota on the ok arm, the classified
 * ErrorClass on the error arm.
 */
export async function refreshTick(
  browser: BrowserApi,
  engine: RefreshEngine,
  clock: Clock,
  planStep?: QwenPlanStep,
  quotaStep?: QwenQuotaStep,
): Promise<void> {
  const zaiPlatform = await readZaiPlatform(browser.storage.local); // qd:pref:zai-platform (AD-28)
  const qwenSite = await readQwenSite(browser.storage.local); // qd:pref:qwen-site (AD-28 mirror)
  const badgeProvider = await readBadgeProvider(browser.storage.local); // qd:pref:badge-provider (hito-12 WU-D2)
  const query = buildTickQuery(clock, zaiPlatform, qwenSite);
  const results: Partial<Record<ProviderId, ProviderSnapshotEntry>> = {};
  await engine.refreshAll(query, {
    onUsage: (usage) => {
      // WU-D2: successes only RECORD — the tick's single badge write happens
      // after the merges, from the chosen provider's entry (see below).
      results[usage.providerId] = { status: 'ok', usage };
    },
    onError: (providerId, error) => {
      // Permanent diagnostics (hito-7): the worker console is the only
      // live-observable signal for provider refresh failures, and since
      // §Error Body Surfacing the message carries the server's own error
      // Code/Message snippet — without this log that evidence is lost. The
      // console is developer-only and stores nothing; the snapshot still
      // persists only the taxonomy class (AD-13/21).
      console.error(
        `[quotadeck] ${providerId} refresh failed:`,
        error instanceof Error ? `${error.name}: ${error.message}` : error,
      );
      // AD-13/21: the thrown value is dropped — only its taxonomy class
      // survives into the snapshot. The ERR badge belongs to the chosen
      // provider alone (WU-D2): unchosen failures never move the badge.
      results[providerId] = { status: 'error', errorClass: classifyRefreshError(error) };
    },
  });
  // Qwen plan probe (usage-badge §Qwen Plan Probe Cadence): tick-level step
  // after refreshAll, before the snapshot write. A plan-only user (no AK/SK)
  // gets a value-less ok entry; an ok balance entry gains the plan field; an
  // error entry is left untouched (something IS broken — the class wins).
  if (planStep !== undefined) {
    const plan = await planStep.resolve(clock.now());
    if (plan !== undefined) {
      const entry = results.qwen;
      if (entry === undefined) {
        results.qwen = { status: 'ok', usage: { providerId: 'qwen', kind: 'balance', plan, fetchedAt: clock.now() } };
      } else if (entry.status === 'ok') {
        results.qwen = { status: 'ok', usage: { ...entry.usage, plan } };
      }
    }
  }
  // Qwen token-plan quota (hito-12 WU-C2): the two-hop step beside the probe —
  // after refreshAll, before the snapshot write. EXACT plan merge precedence:
  // an error entry keeps its class (something IS broken — quota never
  // overwrites it), an ok entry gains the quota field and keeps everything
  // else, an absent entry synthesizes a quota-only ok entry. The minted
  // session token lived and died inside the step — the snapshot carries only
  // the mapped window. The merges land BEFORE the tick's single badge write,
  // so a chosen qwen entry renders its quota percentage the same tick
  // (hito-12 WU-D2).
  if (quotaStep !== undefined) {
    const quota = await quotaStep.resolve(clock.now(), qwenSite);
    if (quota !== undefined) {
      const entry = results.qwen;
      if (entry === undefined) {
        results.qwen = { status: 'ok', usage: { providerId: 'qwen', kind: 'balance', quota, fetchedAt: clock.now() } };
      } else if (entry.status === 'ok') {
        results.qwen = { status: 'ok', usage: { ...entry.usage, quota } };
      }
    }
  }
  // The tick's ONE badge write (hito-12 WU-D2): the chosen provider's entry
  // resolves after the merges and before the snapshot write. Threshold
  // alerting (hito-10) keeps its shape — background + text color follow the
  // chosen percentage (zai 5h, or the quota window for qwen): near-black
  // text on the light neutral band below 50, white text on the saturated
  // bands above; no percentage (error, balance-only, cleared) renders the
  // neutral slate with near-black text, so the marker and the empty badge
  // both stay legible.
  const badge = resolveChosenBadge(results, badgeProvider);
  browser.action.setBadgeText({ text: badge.text });
  browser.action.setBadgeBackgroundColor({ color: badgeBackgroundColor(badge.percentage) });
  browser.action.setBadgeTextColor({ color: badgeTextColor(badge.percentage) });
  await new SnapshotStore(browser.storage.local).write({ results });
}

/**
 * Wires alarm registration and the tick handler onto the injected browser,
 * and installs the gateway-origin session rule (hito-12 WU-F) — the one
 * worker-only DNR/runtime-id capability, taken through the worker port.
 */
export function startWorker(browser: WorkerBrowserApi, options: WorkerOptions = {}): void {
  // One clock instant per worker: the same source feeds the engine (sleeps,
  // fetchedAt) and the tick query derivation.
  const clock = options.clock ?? new SystemClock();
  const engine = createRefreshEngine(browser, options);
  const planStep = createQwenPlanStep(browser, options);
  const quotaStep = createQwenQuotaStep(browser, options);

  // Gateway-origin session rule install (hito-12 WU-F), once per SW start and
  // BEFORE the alarm wiring: the quota gateway hop is dead without it (WAF 302
  // on the chrome-extension:// Origin). updateSessionRules replaces by id, so
  // every worker restart re-installs idempotently. The payload carries public
  // constants plus our own runtime id as initiator scope — no secret ever
  // enters rule data (hito-9 §Lane 1(c)). A failed install never blocks the
  // alarms/tick wiring but surfaces on the worker console, like every other
  // permanent diagnostic; the log line names only the fixed prefix and the
  // chrome error itself.
  browser.declarativeNetRequest
    .updateSessionRules({
      addRules: [buildGatewayOriginSessionRule({ extensionId: browser.runtime.id })],
    })
    .catch((error: unknown) => {
      console.error('[quotadeck] gateway origin session rule install failed:', error);
    });

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
    // Both names drive the SAME tick (usage-badge §One-Shot Refresh Alarm);
    // handling refresh-now never touches the periodic registration above.
    if (alarm.name !== USAGE_REFRESH_ALARM && alarm.name !== REFRESH_NOW_ALARM) {
      return;
    }
    void refreshTick(browser, engine, clock, planStep, quotaStep).catch((error) => {
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
