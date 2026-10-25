// Test doubles for hermetic vitest suites (AD-1: no Chrome runtime, no network).
//
// NOTHING in src/ outside tests may import from this directory — in particular
// `background.ts` must not, so esbuild never bundles these into the worker.
//
// FakeBrowser intentionally mirrors the shape of `platform/browser-api.ts`
// (Phase 5) structurally: same members, in-memory behavior, plus recording
// hooks the specs pin assertions on (sync-area access, badge texts, alarms).
import type { StorageArea } from '../storage/key-store';
import type { AlarmCreateInfo, BrowserStorageOnChanged, DnrSessionRule, DnrSessionRulesUpdate, StorageChange } from '../platform/browser-api';

export interface RecordedCall {
  readonly op: string;
  readonly args: readonly unknown[];
}

/**
 * In-memory `chrome.storage` area that records every call made to it. An
 * optional emitter receives chrome-shaped change records after each `set` —
 * FakeBrowser wires it so `storage.onChanged` fires exactly like the port.
 */
export class FakeStorageArea {
  readonly calls: RecordedCall[] = [];
  private readonly data = new Map<string, unknown>();

  constructor(private readonly emitChanges?: (changes: Record<string, StorageChange>) => void) {}

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    this.calls.push({ op: 'get', args: [keys] });
    const wanted =
      keys === null
        ? [...this.data.keys()]
        : Array.isArray(keys)
          ? keys
          : [keys];
    const out: Record<string, unknown> = {};
    for (const key of wanted) {
      if (this.data.has(key)) {
        out[key] = this.data.get(key);
      }
    }
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.calls.push({ op: 'set', args: [items] });
    const changes: Record<string, StorageChange> = {};
    for (const [key, value] of Object.entries(items)) {
      // chrome.storage semantics: oldValue only present when a value existed.
      const change: { oldValue?: unknown; newValue?: unknown } = { newValue: value };
      if (this.data.has(key)) {
        change.oldValue = this.data.get(key);
      }
      changes[key] = change;
      this.data.set(key, value);
    }
    this.emitChanges?.(changes);
  }

  async remove(keys: string | string[]): Promise<void> {
    this.calls.push({ op: 'remove', args: [keys] });
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.data.delete(key);
    }
  }

  /** Raw stored entries — lets tests prove WHERE a value resides (e.g. `qd:key:zai`). */
  snapshot(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(this.data.entries());
  }
}

/** In-memory alarms: registerable listeners, fireable ticks, queryable state. */
export class FakeAlarms {
  private readonly created = new Map<string, AlarmCreateInfo>();
  private readonly listeners: Array<(alarm: { name: string }) => void> = [];

  create(name: string, info: AlarmCreateInfo): void {
    this.created.set(name, info);
  }

  async get(name: string): Promise<{ name: string; periodInMinutes?: number; when?: number } | undefined> {
    const found = this.created.get(name);
    return found === undefined ? undefined : { name, ...found };
  }

  readonly onAlarm = {
    listen: (fn: (alarm: { name: string }) => void): void => {
      this.listeners.push(fn);
    },
  };

  /** Test hook: dispatch an alarm tick to all registered listeners. */
  fire(name: string): void {
    for (const listener of this.listeners) {
      listener({ name });
    }
  }
}

/**
 * In-memory storage change bus behind `storage.onChanged`: registerable
 * listeners, dispatchable events (FakeBrowser dispatches on every area set).
 */
export class FakeStorageOnChanged implements BrowserStorageOnChanged {
  private readonly listeners: Array<(changes: Record<string, StorageChange>, area: 'local' | 'sync') => void> = [];

  listen(listener: (changes: Record<string, StorageChange>, area: 'local' | 'sync') => void): void {
    this.listeners.push(listener);
  }

  /** Test hook: dispatch a change event to all registered listeners. */
  dispatch(changes: Record<string, StorageChange>, area: 'local' | 'sync'): void {
    for (const listener of this.listeners) {
      listener(changes, area);
    }
  }
}

/** Records every badge text/color the worker sets, in order. */
export class FakeAction {
  readonly badgeTexts: string[] = [];
  readonly badgeBackgrounds: string[] = [];
  readonly badgeTextColors: string[] = [];

  async setBadgeText(options: { text: string }): Promise<void> {
    this.badgeTexts.push(options.text);
  }

  async setBadgeBackgroundColor(options: { color: string }): Promise<void> {
    this.badgeBackgrounds.push(options.color);
  }

  async setBadgeTextColor(options: { color: string }): Promise<void> {
    this.badgeTextColors.push(options.color);
  }
}

/**
 * Records every updateSessionRules call and applies chrome's session-rule
 * semantics in memory: addRules REPLACE by id, removeRuleIds delete — so
 * `sessionRules` is the live rule state a test reads (the WU-F install-once
 * and replace-by-id pins hang off this recording).
 */
export class FakeDeclarativeNetRequest {
  readonly calls: RecordedCall[] = [];
  readonly sessionRules = new Map<number, DnrSessionRule>();

  async updateSessionRules(update: DnrSessionRulesUpdate): Promise<void> {
    this.calls.push({ op: 'updateSessionRules', args: [update] });
    for (const id of update.removeRuleIds ?? []) {
      this.sessionRules.delete(id);
    }
    for (const rule of update.addRules ?? []) {
      this.sessionRules.set(rule.id, rule);
    }
  }
}

/**
 * BrowserApi-shaped in-memory double. `storage.sync` exists ONLY so tests can
 * assert it is never called (key-storage spec §Sync never used) — the KeyStore
 * receives `fakeBrowser.storage.local` and has no `.sync` path.
 */
export class FakeBrowser {
  /** Change bus behind storage.onChanged — every local/sync set dispatches here. */
  readonly onChanged = new FakeStorageOnChanged();
  readonly local = new FakeStorageArea((changes) => this.onChanged.dispatch(changes, 'local'));
  readonly sync = new FakeStorageArea((changes) => this.onChanged.dispatch(changes, 'sync'));
  readonly alarms = new FakeAlarms();
  readonly action = new FakeAction();
  /** Worker-port double (hito-12 WU-F): records the gateway-origin installs. */
  readonly declarativeNetRequest = new FakeDeclarativeNetRequest();
  readonly storage: {
    readonly local: StorageArea;
    readonly sync: StorageArea;
    readonly onChanged: BrowserStorageOnChanged;
  } = {
    local: this.local,
    sync: this.sync,
    onChanged: this.onChanged,
  };
}
