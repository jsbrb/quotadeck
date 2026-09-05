import { describe, expect, it } from 'vitest';
import { DEFAULT_TIER_LIMITS } from '../core/tier-budget';
import { FakeStorageArea } from '../testing/fake-browser';
import { TIER_LIMITS_STORAGE_KEY, readTierLimits } from './limit-store';

// Limit-store (AD-20): `qd:tier-limits` is an OPTIONAL override over the code
// defaults. Absent or invalid stored shapes must fall back to the defaults —
// a user hand-editing chrome.storage.local can never break the budget fold.

describe('readTierLimits (AD-20 — configurable tier limits override)', () => {
  it('returns a valid stored override as-is', async () => {
    const local = new FakeStorageArea();
    await local.set({ [TIER_LIMITS_STORAGE_KEY]: { Lite: 100, Pro: 9999 } });

    await expect(readTierLimits(local)).resolves.toEqual({ Lite: 100, Pro: 9999 });
  });

  it('reads from the qd:tier-limits key only', async () => {
    const local = new FakeStorageArea();
    await local.set({ [TIER_LIMITS_STORAGE_KEY]: { Max: 50_000 } });

    await readTierLimits(local);

    expect(local.calls).toContainEqual({ op: 'get', args: [TIER_LIMITS_STORAGE_KEY] });
  });

  it('falls back to the defaults when the key is absent', async () => {
    const local = new FakeStorageArea();

    await expect(readTierLimits(local)).resolves.toEqual(DEFAULT_TIER_LIMITS);
  });

  it('falls back to the defaults on invalid stored shapes', async () => {
    const invalid: readonly unknown[] = [
      '2400', // plain string
      2400, // plain number
      ['Lite', 2400], // array
      { Lite: '2400' }, // string limit value
      { Lite: Number.NaN }, // non-finite value
      { Lite: 0 }, // non-positive limit
      { Pro: -12_000 }, // negative limit
      null, // JSON null
    ];
    for (const value of invalid) {
      const local = new FakeStorageArea();
      await local.set({ [TIER_LIMITS_STORAGE_KEY]: value });
      await expect(readTierLimits(local)).resolves.toEqual(DEFAULT_TIER_LIMITS);
    }
  });

  it('treats an empty override object as valid — defaults apply downstream', async () => {
    const local = new FakeStorageArea();
    await local.set({ [TIER_LIMITS_STORAGE_KEY]: {} });

    await expect(readTierLimits(local)).resolves.toEqual({});
  });
});
