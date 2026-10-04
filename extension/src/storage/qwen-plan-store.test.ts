// QwenPlanStore tests (key-storage/usage-badge specs — hito-8 §Qwen Plan
// Probe Cadence cache `qd:qwen-plan-status`). Hermetic node-env suite over
// the FakeBrowser local area — the SnapshotStore validation pattern: reads
// are shape-validated, invalid bytes read as undefined ("no cache yet").
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeBrowser } from '../testing/fake-browser';
import { KEY_STORAGE_PREFIX } from './key-store';
import { type QwenPlanStatus, QWEN_PLAN_STATUS_STORAGE_KEY, QwenPlanStore } from './qwen-plan-store';

describe('QwenPlanStore — qd:qwen-plan-status round-trip', () => {
  let browser: FakeBrowser;
  let store: QwenPlanStore;

  beforeEach(() => {
    browser = new FakeBrowser();
    store = new QwenPlanStore(browser.local);
  });

  it('round-trips {status, resetAt, probedAt} in storage.local under qd:qwen-plan-status only', async () => {
    const entry: QwenPlanStatus = { status: 'exhausted', resetAt: 1_788_656_274_505, probedAt: 1_754_000_000_000 };
    await store.write(entry);

    expect(await store.read()).toEqual(entry);
    expect(browser.local.snapshot()).toEqual({ [QWEN_PLAN_STATUS_STORAGE_KEY]: entry });
  });

  it('round-trips entries without resetAt (available / unparseable 429 shapes)', async () => {
    const entry: QwenPlanStatus = { status: 'available', probedAt: 1_754_000_000_000 };
    await store.write(entry);

    expect(await store.read()).toEqual(entry);
  });

  it.each(['available', 'exhausted', 'key-rejected'] as const)('every status round-trips: %s', async (status) => {
    const entry: QwenPlanStatus = { status, probedAt: 42 };
    await store.write(entry);

    expect((await store.read())?.status).toBe(status);
  });

  it('returns undefined when no cache exists yet', async () => {
    expect(await store.read()).toBeUndefined();
    expect(QWEN_PLAN_STATUS_STORAGE_KEY in browser.local.snapshot()).toBe(false);
  });

  it('shape-invalid bytes read as undefined — never as garbage for the tick', async () => {
    for (const invalid of [
      'plain-string', // not an object
      { status: 'weird', probedAt: 1 }, // unknown status
      { status: 'available' }, // missing probedAt
      { status: 'exhausted', resetAt: 'tomorrow', probedAt: 1 }, // non-numeric resetAt
      { status: 'available', probedAt: 'now' }, // non-numeric probedAt
      null,
    ]) {
      await browser.local.set({ [QWEN_PLAN_STATUS_STORAGE_KEY]: invalid });
      expect(await store.read(), `invalid bytes ${JSON.stringify(invalid)}`).toBeUndefined();
    }
  });

  it('never calls chrome.storage.sync across every wrapper operation', async () => {
    await store.write({ status: 'available', probedAt: 1 });
    await store.read();

    expect(browser.sync.calls).toHaveLength(0);
    expect(QWEN_PLAN_STATUS_STORAGE_KEY).toBe('qd:qwen-plan-status');
    expect(QWEN_PLAN_STATUS_STORAGE_KEY.startsWith(KEY_STORAGE_PREFIX)).toBe(false); // cache, not a credential
  });
});
