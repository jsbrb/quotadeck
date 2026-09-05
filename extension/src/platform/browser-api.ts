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

/** Alarms surface the worker needs: create, query, and tick events. */
export interface BrowserAlarms {
  create(name: string, info: { periodInMinutes: number }): void;
  get(name: string): Promise<{ name: string } | undefined>;
  onAlarm: { listen(listener: (alarm: { name: string }) => void): void };
}

/** Badge surface: one setter, promise-based like the MV3 runtime. */
export interface BrowserAction {
  setBadgeText(options: { text: string }): Promise<void>;
}

/** Worker lifecycle events that (re)ensure alarm registration. */
export interface BrowserRuntime {
  onInstalled: { listen(listener: () => void): void };
  onStartup: { listen(listener: () => void): void };
}

/** The single browser-facing port of the extension (AD-1). */
export interface BrowserApi {
  /** `sync` is exposed ONLY so tests can assert it is never called. */
  readonly storage: { readonly local: StorageArea; readonly sync: StorageArea };
  readonly alarms: BrowserAlarms;
  readonly action: BrowserAction;
  readonly runtime: BrowserRuntime;
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
export class ChromeBrowserApi implements BrowserApi {
  readonly storage = {
    local: chrome.storage.local,
    sync: chrome.storage.sync,
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
  };

  readonly runtime: BrowserRuntime = {
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
