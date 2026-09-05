// Test doubles for hermetic vitest suites (AD-1: no Chrome runtime, no network).
//
// NOTHING in src/ outside tests may import from this directory — in particular
// `background.ts` must not, so esbuild never bundles these into the worker.
//
// FakeBrowser intentionally mirrors the shape of `platform/browser-api.ts`
// (Phase 5) structurally: same members, in-memory behavior, plus recording
// hooks the specs pin assertions on (sync-area access, badge texts, alarms).
import type { StorageArea } from '../storage/key-store';

export interface RecordedCall {
  readonly op: string;
  readonly args: readonly unknown[];
}

/** In-memory `chrome.storage` area that records every call made to it. */
export class FakeStorageArea {
  readonly calls: RecordedCall[] = [];
  private readonly data = new Map<string, unknown>();

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
    for (const [key, value] of Object.entries(items)) {
      this.data.set(key, value);
    }
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
  private readonly created = new Map<string, { periodInMinutes: number }>();
  private readonly listeners: Array<(alarm: { name: string }) => void> = [];

  create(name: string, info: { periodInMinutes: number }): void {
    this.created.set(name, { periodInMinutes: info.periodInMinutes });
  }

  async get(name: string): Promise<{ name: string; periodInMinutes: number } | undefined> {
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

/** Records every badge text the worker sets, in order. */
export class FakeAction {
  readonly badgeTexts: string[] = [];

  async setBadgeText(options: { text: string }): Promise<void> {
    this.badgeTexts.push(options.text);
  }
}

/**
 * BrowserApi-shaped in-memory double. `storage.sync` exists ONLY so tests can
 * assert it is never called (key-storage spec §Sync never used) — the KeyStore
 * receives `fakeBrowser.storage.local` and has no `.sync` path.
 */
export class FakeBrowser {
  readonly local = new FakeStorageArea();
  readonly sync = new FakeStorageArea();
  readonly alarms = new FakeAlarms();
  readonly action = new FakeAction();
  readonly storage: { readonly local: StorageArea; readonly sync: StorageArea } = {
    local: this.local,
    sync: this.sync,
  };
}
