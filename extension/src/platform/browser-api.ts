// BrowserApi port + ChromeBrowserApi adapter (AD-1).
//
// This is the ONLY module besides background.ts allowed to touch the `chrome`
// global: everything else depends on the injected BrowserApi interface, so the
// hermetic vitest suite runs against FakeBrowser-shaped fakes with no Chrome
// runtime at all (src/testing/fake-browser.ts mirrors this shape).
//
// The interface follows design.md's contract (storage / alarms / action) and
// adds `runtime` lifecycle events (onInstalled / onStartup) because task 5.3
// requires registering the refresh alarm "on install and on startup when
// absent" — those events must flow through the port to stay testable.
import type { StorageArea } from '../storage/key-store';

/**
 * Alarm schedule info: a repeating `periodInMinutes` period or a one-shot
 * absolute `when` timestamp (epoch ms) — chrome.alarms accepts both forms.
 */
export type AlarmCreateInfo = { periodInMinutes: number } | { when: number };

/** Alarms surface the worker needs: create, query, and tick events. */
export interface BrowserAlarms {
  create(name: string, info: AlarmCreateInfo): void;
  get(name: string): Promise<{ name: string } | undefined>;
  onAlarm: { listen(listener: (alarm: { name: string }) => void): void };
}

/** A per-key storage change as delivered by the onChanged surface. */
export interface StorageChange {
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

/**
 * Storage change events: fired after writes land in an area, chrome-style —
 * one changes record per affected key plus the area the write targeted.
 */
export interface BrowserStorageOnChanged {
  listen(listener: (changes: Record<string, StorageChange>, area: 'local' | 'sync') => void): void;
}

/** Badge surface: text + color setters, promise-based like the MV3 runtime. */
export interface BrowserAction {
  setBadgeText(options: { text: string }): Promise<void>;
  setBadgeBackgroundColor(options: { color: string }): Promise<void>;
  setBadgeTextColor(options: { color: string }): Promise<void>;
}

/** One request-header operation inside a `modifyHeaders` session-rule action. */
export interface DnrHeaderOperation {
  readonly header: string;
  /** chrome.declarativeNetRequest.HeaderOperation as its literal union. */
  readonly operation: 'set' | 'append' | 'remove';
  readonly value?: string;
}

/**
 * The minimal session-rule shape this worker installs (hito-12 WU-F). Same
 * modeling philosophy as `AlarmCreateInfo`: the port declares exactly the
 * forms the worker uses (a modifyHeaders rule over an xhr condition), not
 * the full chrome union surface. NO SECRET VALUES may ever enter rule data —
 * a rule payload carries public constants only (contrast the DNR
 * cookie-VALUE injection rejected in hito-9 exploration.md §Lane 1(c)).
 */
export interface DnrSessionRule {
  readonly id: number;
  readonly action: {
    readonly type: 'modifyHeaders';
    readonly requestHeaders: DnrHeaderOperation[];
  };
  readonly condition: {
    readonly urlFilter: string;
    readonly requestDomains: string[];
    readonly initiatorDomains: string[];
    readonly resourceTypes: 'xmlhttprequest'[];
  };
}

/** Session-rule update payload: chrome-style add (replace-by-id) and remove. */
export interface DnrSessionRulesUpdate {
  readonly removeRuleIds?: number[];
  readonly addRules?: DnrSessionRule[];
}

/**
 * DeclarativeNetRequest surface the worker needs (hito-12 WU-F): session-rule
 * installs only — no static/dynamic rule lists, no query methods. Session
 * rules live in browser-managed memory for the browser run and never persist
 * across restarts; the minimal rule shape assigns to chrome's UpdateRuleOptions
 * directly (every port literal is a member of the enum-literal union).
 */
export interface DeclarativeNetRequestApi {
  updateSessionRules(update: DnrSessionRulesUpdate): Promise<void>;
}

/** Worker lifecycle events that (re)ensure alarm registration. */
export interface BrowserRuntime {
  onInstalled: { listen(listener: () => void): void };
  onStartup: { listen(listener: () => void): void };
}

/** BrowserRuntime plus the per-install extension id (chrome.runtime.id). */
export interface WorkerBrowserRuntime extends BrowserRuntime {
  /**
   * This install's own extension id — the gateway-origin session rule's
   * initiator scope (hito-12 WU-F). Read lazily by the adapter, never at
   * construction, so vitest chrome stubs without `runtime` stay valid.
   */
  readonly id: string;
}

/** The single browser-facing port of the extension (AD-1). */
export interface BrowserApi {
  /** `sync` is exposed ONLY so tests can assert it is never called. */
  readonly storage: {
    readonly local: StorageArea;
    readonly sync: StorageArea;
    readonly onChanged: BrowserStorageOnChanged;
  };
  readonly alarms: BrowserAlarms;
  readonly action: BrowserAction;
  readonly runtime: BrowserRuntime;
}

/**
 * Worker-scoped port extension (hito-12 WU-F, interface segregation). The
 * gateway-origin mitigation composes two SERVICE-WORKER-ONLY capabilities —
 * declarativeNetRequest session rules and chrome.runtime.id — and belongs to
 * `startWorker` alone. The popup keeps consuming the plain `BrowserApi`
 * above: widening the shared port would force every popup double to grow
 * surfaces it must never call. `ChromeBrowserApi` implements this shape, so
 * the production boot object satisfies both ports.
 */
export interface WorkerBrowserApi extends BrowserApi {
  readonly declarativeNetRequest: DeclarativeNetRequestApi;
  /** Narrowed override: the worker additionally reads the install's own id. */
  readonly runtime: WorkerBrowserRuntime;
}

/**
 * Production adapter over the real `chrome.*` globals. All chrome access is
 * lazy (inside methods/arrow functions), so importing this module outside a
 * worker — e.g. under vitest — never dereferences the global.
 *
 * `chrome.storage.local` / `chrome.storage.sync` are assigned directly: the
 * promise-based MV3 overloads of @types/chrome are structurally compatible
 * with the StorageArea port (get/set/remove returning promises).
 */
export class ChromeBrowserApi implements WorkerBrowserApi {
  readonly storage = {
    local: chrome.storage.local,
    sync: chrome.storage.sync,
    onChanged: {
      listen: (listener: (changes: Record<string, StorageChange>, area: 'local' | 'sync') => void) => {
        // The port models only local/sync; other chrome areas never reach it.
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName !== 'local' && areaName !== 'sync') {
            return;
          }
          listener(changes, areaName);
        });
      },
    },
  };

  readonly alarms: BrowserAlarms = {
    create: (name, info) => {
      void chrome.alarms.create(name, info);
    },
    get: async (name) => {
      const alarm = await chrome.alarms.get(name);
      return alarm === undefined ? undefined : { name: alarm.name };
    },
    onAlarm: {
      listen: (listener) => {
        chrome.alarms.onAlarm.addListener((alarm) => listener({ name: alarm.name }));
      },
    },
  };

  readonly action: BrowserAction = {
    setBadgeText: (options) => chrome.action.setBadgeText({ text: options.text }),
    setBadgeBackgroundColor: (options) => chrome.action.setBadgeBackgroundColor({ color: options.color }),
    setBadgeTextColor: (options) => chrome.action.setBadgeTextColor({ color: options.color }),
  };

  readonly declarativeNetRequest: DeclarativeNetRequestApi = {
    // Thin pass-through: every port literal (action.type, header operation,
    // resource type) is a member of chrome's corresponding enum-literal
    // union, so the minimal rule shape assigns to chrome's UpdateRuleOptions
    // directly. `chrome.declarativeNetRequest` is touched per call only.
    updateSessionRules: (update) => chrome.declarativeNetRequest.updateSessionRules(update),
  };

  readonly runtime: WorkerBrowserRuntime = {
    // Lazy like every other adapter slice: `chrome.runtime` is dereferenced
    // only when startWorker installs the gateway-origin rule (hito-12 WU-F),
    // never at construction — browser-api.test.ts stubs chrome WITHOUT a
    // runtime global and stays green.
    get id() {
      return chrome.runtime.id;
    },
    onInstalled: {
      listen: (listener) => {
        chrome.runtime.onInstalled.addListener(() => listener());
      },
    },
    onStartup: {
      listen: (listener) => {
        chrome.runtime.onStartup.addListener(() => listener());
      },
    },
  };
}
