// SnapshotStore tests (popup-ui spec §Current Cycle Data on Open; AD-10/AD-12).
//
// Hermetic node-env unit suite over the FakeBrowser local area — the same
// injected-port pattern as key-store.test.ts. Usage fixtures mirror the
// recorded cycle values proven in the provider suites (zai 39 CNY with tier
// GLM-4.5-Air, qwen 100.28 CNY, openai 20 usd, kimi 88.88 CNY).
import { beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedUsage } from '../core/usage';
import { FakeBrowser } from '../testing/fake-browser';
import { KeyStore } from './key-store';
import {
  type CycleSnapshot,
  type ProviderSnapshotEntry,
  SNAPSHOT_STORAGE_KEY,
  SnapshotStore,
} from './snapshot-store';

const FETCHED_AT = 1_700_000_000_000;

const zaiUsage: NormalizedUsage = {
  providerId: 'zai',
  kind: 'cost',
  value: 39,
  currency: 'CNY',
  tier: 'GLM-4.5-Air',
  fetchedAt: FETCHED_AT,
};

const openaiUsage: NormalizedUsage = {
  providerId: 'openai',
  kind: 'cost',
  value: 20,
  currency: 'usd',
  breakdown: [
    { model: 'gpt-5.3', usageType: 'input_tokens', value: 12.5 },
    { model: 'gpt-5.3', usageType: 'output_tokens', value: 4.25 },
    { model: 'gpt-5-mini', usageType: 'input_tokens', value: 3.25 },
  ],
  fetchedAt: FETCHED_AT,
};

describe('SnapshotStore', () => {
  let browser: FakeBrowser;
  let store: SnapshotStore;

  beforeEach(() => {
    browser = new FakeBrowser();
    store = new SnapshotStore(browser.storage.local);
  });

  it('round-trips a cycle snapshot and stores it in storage.local under qd:snapshot only', async () => {
    const snapshot: CycleSnapshot = {
      results: { zai: { status: 'ok', usage: zaiUsage }, qwen: { status: 'error' } },
    };

    await store.write(snapshot);

    expect(await store.read()).toEqual(snapshot);
    // The value resides in the local area, under the single namespace key — nowhere else.
    expect(browser.local.snapshot()).toEqual({ [SNAPSHOT_STORAGE_KEY]: snapshot });
  });

  it('an error entry round-trips as a bare { status: "error" } with no payload', async () => {
    await store.write({ results: { qwen: { status: 'error' } } });

    const entry = (await store.read())?.results.qwen;
    expect(entry).toEqual({ status: 'error' });
    expect(Object.keys(entry ?? {})).toEqual(['status']);
  });

  it('ok entries keep the full normalized usage: value, currency, tier, fetchedAt', async () => {
    await store.write({
      results: { zai: { status: 'ok', usage: zaiUsage }, openai: { status: 'ok', usage: openaiUsage } },
    });

    const read = await store.read();
    expect(read?.results.zai).toEqual({ status: 'ok', usage: zaiUsage });
    expect(read?.results.openai).toEqual({ status: 'ok', usage: openaiUsage });
  });

  it('returns undefined when no snapshot exists yet', async () => {
    expect(await store.read()).toBeUndefined();
    expect(SNAPSHOT_STORAGE_KEY in browser.local.snapshot()).toBe(false);
  });

  it.each([
    ['stored value is a plain string', 'garbage'],
    ['results is not a record', { results: 42 }],
    ['results is missing', {}],
    ['entry status is unknown', { results: { zai: { status: 'pending' } } }],
    ['ok entry has no usage', { results: { zai: { status: 'ok' } } }],
    ['ok entry usage has a non-number value', { results: { zai: { status: 'ok', usage: { ...zaiUsage, value: '39' } } } }],
    ['ok entry usage has an invalid kind', { results: { zai: { status: 'ok', usage: { ...zaiUsage, kind: 'budget' } } } }],
    ['ok entry usage has a non-array breakdown', { results: { zai: { status: 'ok', usage: { ...openaiUsage, breakdown: 'nope' } } } }],
  ])('malformed stored shape reads as undefined: %s', async (_label, stored) => {
    await browser.local.set({ [SNAPSHOT_STORAGE_KEY]: stored });

    expect(await store.read()).toBeUndefined();
  });

  it('carries no credential material: no credential field on the snapshot types, none in stored bytes', async () => {
    // Structural proof (AD-15): adding a credential-carrying field to any
    // snapshot type breaks THIS compile — Extract yields the field name and
    // the assignment target becomes `never`.
    type KeysOf<T> = T extends unknown ? keyof T : never;
    type SnapshotFieldNames =
      | KeysOf<ProviderSnapshotEntry>
      | keyof NormalizedUsage
      | keyof CycleSnapshot;
    type ForbiddenCredentialFields = Extract<
      SnapshotFieldNames,
      'credential' | 'apiKey' | 'secret' | 'token' | 'password' | 'key'
    >;
    const noCredentialFields: ForbiddenCredentialFields extends never ? true : never = true;
    expect(noCredentialFields).toBe(true);

    // Behavioral proof: with key material living in the SAME storage area,
    // the persisted snapshot bytes contain none of it.
    await new KeyStore(browser.local).saveKey('zai', 'sk-zai-secret-credential-material');
    await store.write({ results: { zai: { status: 'ok', usage: zaiUsage }, qwen: { status: 'error' } } });

    expect(JSON.stringify(browser.local.snapshot()[SNAPSHOT_STORAGE_KEY])).not.toContain(
      'sk-zai-secret-credential-material',
    );
  });
});
