// BrowserApi port tests (AD-1) — two legs, zero Chrome runtime required:
// - ChromeBrowserApi runs against a STUBBED `chrome` global (the only place
//   the adapter is exercised; the rest of the suite is fake-only), proving
//   the one-shot `{ when }` alarm form and the storage.onChanged wiring
//   reach the real chrome surfaces unchanged.
// - FakeAlarms / FakeBrowser prove the hermetic doubles mirror the widened
//   port: one-shot creations are queryable and local writes fire change
//   events with chrome-shaped oldValue/newValue payloads.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChromeBrowserApi, type StorageChange } from './browser-api';
import { FakeAlarms, FakeBrowser } from '../testing/fake-browser';

/** chrome.alarms.create calls recorded by the stub. */
interface RecordedCreate {
  readonly name: string;
  readonly info: Record<string, unknown>;
}

/**
 * Minimal chrome surface ChromeBrowserApi dereferences: storage areas at
 * construction, alarms/onChanged inside methods. Registered listeners are
 * dispatchable to simulate chrome-originated events.
 */
function stubChrome(): {
  creates: RecordedCreate[];
  dispatchStorageChange: (changes: Record<string, StorageChange>, area: string) => void;
} {
  const creates: RecordedCreate[] = [];
  const storageListeners: Array<(changes: Record<string, StorageChange>, area: string) => void> = [];
  vi.stubGlobal('chrome', {
    alarms: {
      create: (name: string, info: Record<string, unknown>) => {
        creates.push({ name, info });
      },
    },
    storage: {
      local: {},
      sync: {},
      onChanged: {
        addListener: (listener: (changes: Record<string, StorageChange>, area: string) => void) => {
          storageListeners.push(listener);
        },
      },
    },
  });
  return {
    creates,
    dispatchStorageChange: (changes, area) => {
      for (const listener of storageListeners) {
        listener(changes, area);
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChromeBrowserApi — one-shot alarms (stubbed chrome)', () => {
  it("forwards create('refresh-now', { when }) to chrome.alarms.create unchanged", () => {
    const chromeStub = stubChrome();

    new ChromeBrowserApi().alarms.create('refresh-now', { when: 1_788_656_400_001 });

    expect(chromeStub.creates).toEqual([{ name: 'refresh-now', info: { when: 1_788_656_400_001 } }]);
  });

  it("still forwards the periodic create(name, { periodInMinutes }) form unchanged", () => {
    const chromeStub = stubChrome();

    new ChromeBrowserApi().alarms.create('usage-refresh', { periodInMinutes: 1 });

    expect(chromeStub.creates).toEqual([{ name: 'usage-refresh', info: { periodInMinutes: 1 } }]);
  });
});

describe('ChromeBrowserApi — storage.onChanged port (stubbed chrome)', () => {
  it('wires listen through chrome.storage.onChanged.addListener and delivers the change payload with its area', () => {
    const chromeStub = stubChrome();
    const seen: Array<{ changes: Record<string, StorageChange>; area: string }> = [];
    new ChromeBrowserApi().storage.onChanged.listen((changes, area) => {
      seen.push({ changes, area });
    });

    const changes: Record<string, StorageChange> = { 'qd:snapshot': { newValue: { results: {} } } };
    chromeStub.dispatchStorageChange(changes, 'local');

    expect(seen).toEqual([{ changes, area: 'local' }]);
  });

  it('passes the sync area through and drops areas outside the port', () => {
    const chromeStub = stubChrome();
    const seen: Array<{ changes: Record<string, StorageChange>; area: string }> = [];
    new ChromeBrowserApi().storage.onChanged.listen((changes, area) => {
      seen.push({ changes, area });
    });

    const changes: Record<string, StorageChange> = { 'qd:snapshot': { oldValue: 1, newValue: 2 } };
    chromeStub.dispatchStorageChange(changes, 'sync');
    chromeStub.dispatchStorageChange(changes, 'managed'); // not modeled by the port

    expect(seen).toEqual([{ changes, area: 'sync' }]);
  });
});

describe('FakeAlarms — one-shot { when } registration', () => {
  it('stores { when } and surfaces it through get()', async () => {
    const alarms = new FakeAlarms();

    alarms.create('refresh-now', { when: 42 });

    await expect(alarms.get('refresh-now')).resolves.toEqual({ name: 'refresh-now', when: 42 });
  });

  it('keeps the periodic shape for periodic registrations', async () => {
    const alarms = new FakeAlarms();

    alarms.create('usage-refresh', { periodInMinutes: 1 });

    await expect(alarms.get('usage-refresh')).resolves.toEqual({ name: 'usage-refresh', periodInMinutes: 1 });
  });
});

describe('FakeBrowser — storage.onChanged fires on local set', () => {
  it('emits one change event per set: key, newValue, no oldValue for a new key, area local', async () => {
    const browser = new FakeBrowser();
    const seen: Array<{ changes: Record<string, StorageChange>; area: string }> = [];
    browser.storage.onChanged.listen((changes, area) => {
      seen.push({ changes, area });
    });

    await browser.local.set({ 'qd:snapshot': { results: {} } });

    expect(seen).toEqual([{ changes: { 'qd:snapshot': { newValue: { results: {} } } }, area: 'local' }]);
  });

  it('carries the previous value as oldValue on a second write to the same key', async () => {
    const browser = new FakeBrowser();
    const seen: Array<{ changes: Record<string, StorageChange>; area: string }> = [];
    browser.storage.onChanged.listen((changes, area) => {
      seen.push({ changes, area });
    });
    await browser.local.set({ 'qd:snapshot': { results: { zai: 1 } } });

    await browser.local.set({ 'qd:snapshot': { results: { zai: 2 } } });

    expect(seen[1]).toEqual({
      changes: { 'qd:snapshot': { oldValue: { results: { zai: 1 } }, newValue: { results: { zai: 2 } } } },
      area: 'local',
    });
  });
});
