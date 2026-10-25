// SnapshotStore tests (popup-ui spec §Current Cycle Data on Open; AD-10/AD-12;
// AD-21/26 error class + monitor-windows shape validation).
//
// Hermetic node-env unit suite over the FakeBrowser local area — the same
// injected-port pattern as key-store.test.ts. Usage fixtures mirror the
// recorded cycle values proven in the provider suites (zai monitor windows,
// qwen 100.28 CNY, openai 20 usd, kimi 88.88 CNY).
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
  tier: 'Lite',
  fetchedAt: FETCHED_AT,
};

const zaiMonitorUsage: NormalizedUsage = {
  providerId: 'zai',
  kind: 'cost',
  windows: {
    level: 'Pro',
    fiveHour: { percentage: 137, used: 16_440, total: 12_000, resetAt: FETCHED_AT + 3_600_000 },
    // used implies percentage (parser derives used only when both exist).
    weekly: { percentage: 42, used: 5_040, total: 12_000 },
    mcp: { used: 3, ceiling: 60, tools: [{ name: 'web-search', used: 2 }, { name: 'code-execution', used: 1 }] },
  },
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

const qwenUsage: NormalizedUsage = {
  providerId: 'qwen',
  kind: 'balance',
  value: 100.28,
  currency: 'CNY',
  fetchedAt: FETCHED_AT,
};

// hito-13 WU-A: the DeepSeek wallet rides the usage additively, exactly like
// `quota` does — figures are the DERIVED wallet (see core/usage.ts).
const deepseekUsage: NormalizedUsage = {
  providerId: 'deepseek',
  kind: 'balance',
  value: 2,
  currency: 'USD',
  wallet: { currency: 'USD', total: 2, consumed: 0, percentage: 0 },
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
      results: { zai: { status: 'ok', usage: zaiUsage }, qwen: { status: 'error', errorClass: 'rate-limit' } },
    };

    await store.write(snapshot);

    // write owns the additive lastKnown map (hito-11): the cycle's ok arm is
    // carried under the SAME single key; the error arm never enters it.
    const expected: CycleSnapshot = { results: snapshot.results, lastKnown: { zai: { status: 'ok', usage: zaiUsage } } };
    expect(await store.read()).toEqual(expected);
    // The value resides in the local area, under the single namespace key — nowhere else.
    expect(browser.local.snapshot()).toEqual({ [SNAPSHOT_STORAGE_KEY]: expected });
  });

  it('an error entry round-trips as { status, errorClass } with no other payload (AD-13/21)', async () => {
    await store.write({ results: { qwen: { status: 'error', errorClass: 'auth' } } });

    const entry = (await store.read())?.results.qwen;
    expect(entry).toEqual({ status: 'error', errorClass: 'auth' });
    expect(Object.keys(entry ?? {}).sort()).toEqual(['errorClass', 'status']);
  });

  it.each(['auth', 'rate-limit', 'server', 'network', 'unknown'] as const)(
    'every taxonomy class round-trips: %s',
    async (errorClass) => {
      await store.write({ results: { kimi: { status: 'error', errorClass } } });
      expect((await store.read())?.results.kimi).toEqual({ status: 'error', errorClass });
    },
  );

  it('ok entries keep the full normalized usage: value, currency, tier, fetchedAt, windows', async () => {
    await store.write({
      results: { zai: { status: 'ok', usage: zaiMonitorUsage }, openai: { status: 'ok', usage: openaiUsage } },
    });

    const read = await store.read();
    expect(read?.results.zai).toEqual({ status: 'ok', usage: zaiMonitorUsage });
    expect(read?.results.openai).toEqual({ status: 'ok', usage: openaiUsage });
  });

  it('a legacy budget field is ignored — pre-hitó-4 snapshots read as valid (AD-26 migration)', async () => {
    // BudgetReport validation is gone with the model: a stored usage carrying
    // ANY budget value (even garbage) must still read as valid — unknown keys
    // don't invalidate, and the stale field is rewritten by the next tick.
    const legacy: Record<string, unknown> = { ...zaiMonitorUsage, budget: { percent: '100', used: 'x' } };
    await browser.local.set({ [SNAPSHOT_STORAGE_KEY]: { results: { zai: { status: 'ok', usage: legacy } } } });

    const read = await store.read();
    expect(read?.results.zai?.status).toBe('ok');
    expect((read?.results.zai as { usage: NormalizedUsage }).usage.windows?.level).toBe('Pro');
  });

  it('returns undefined when no snapshot exists yet', async () => {
    expect(await store.read()).toBeUndefined();
    expect(SNAPSHOT_STORAGE_KEY in browser.local.snapshot()).toBe(false);
  });

  it('a monitor usage without value/currency round-trips (n1: optional since AD-26)', async () => {
    const snapshot: CycleSnapshot = { results: { zai: { status: 'ok', usage: zaiMonitorUsage } } };

    await store.write(snapshot);

    expect(await store.read()).toEqual({ results: snapshot.results, lastKnown: { zai: snapshot.results.zai } });
  });

  it('a total-less live-shaped window round-trips (percentage-only is valid)', async () => {
    // Live-pinned plan-pro shape (2026-09-05): a TOKENS_LIMIT window carries
    // percentage + resetAt with NO total. Valid: at least one of
    // percentage/total present; used requires both (absent here).
    const snapshot: CycleSnapshot = {
      results: {
        zai: {
          status: 'ok',
          usage: {
            ...zaiMonitorUsage,
            windows: { level: 'pro', fiveHour: { percentage: 32, resetAt: FETCHED_AT + 3_600_000 } },
          },
        },
      },
    };

    await store.write(snapshot);

    expect(await store.read()).toEqual({ results: snapshot.results, lastKnown: { zai: snapshot.results.zai } });
  });

  it('a monitor usage alongside monetary results round-trips together', async () => {
    const snapshot: CycleSnapshot = {
      results: {
        zai: { status: 'ok', usage: zaiMonitorUsage },
        openai: { status: 'ok', usage: openaiUsage },
        qwen: { status: 'error', errorClass: 'auth' },
      },
    };

    await store.write(snapshot);

    // Both ok arms land in lastKnown; the qwen error arm never does (hito-11).
    expect(await store.read()).toEqual({
      results: snapshot.results,
      lastKnown: { zai: snapshot.results.zai, openai: snapshot.results.openai },
    });
  });

  it.each([
    ['windows is not an object', { ...zaiMonitorUsage, value: 39, currency: 'CNY', windows: 'full' }],
    [
      'level is not a string',
      { ...zaiMonitorUsage, value: 39, currency: 'CNY', windows: { ...zaiMonitorUsage.windows!, level: 7 } },
    ],
    [
      'fiveHour total is not a number',
      { ...zaiMonitorUsage, value: 39, currency: 'CNY', windows: { ...zaiMonitorUsage.windows!, fiveHour: { total: '12000' } } },
    ],
    [
      'fiveHour has neither percentage nor total',
      { ...zaiMonitorUsage, value: 39, currency: 'CNY', windows: { ...zaiMonitorUsage.windows!, fiveHour: { resetAt: 1 } } },
    ],
    [
      'fiveHour percentage is not a number',
      {
        ...zaiMonitorUsage,
        value: 39,
        currency: 'CNY',
        windows: { ...zaiMonitorUsage.windows!, fiveHour: { percentage: '137', total: 12_000 } },
      },
    ],
    [
      'fiveHour resetAt is not a number',
      {
        ...zaiMonitorUsage,
        value: 39,
        currency: 'CNY',
        windows: { ...zaiMonitorUsage.windows!, fiveHour: { total: 1, resetAt: 'soon' } },
      },
    ],
    [
      'weekly is not an object',
      { ...zaiMonitorUsage, value: 39, currency: 'CNY', windows: { ...zaiMonitorUsage.windows!, weekly: 5 } },
    ],
    [
      'mcp used is not a number',
      {
        ...zaiMonitorUsage,
        value: 39,
        currency: 'CNY',
        windows: { ...zaiMonitorUsage.windows!, mcp: { used: '3', ceiling: 60, tools: [] } },
      },
    ],
    [
      'mcp ceiling is not a number',
      {
        ...zaiMonitorUsage,
        value: 39,
        currency: 'CNY',
        windows: { ...zaiMonitorUsage.windows!, mcp: { used: 3, ceiling: null, tools: [] } },
      },
    ],
    [
      'mcp tools is not an array',
      {
        ...zaiMonitorUsage,
        value: 39,
        currency: 'CNY',
        windows: { ...zaiMonitorUsage.windows!, mcp: { used: 3, ceiling: 60, tools: 'none' } },
      },
    ],
    [
      'a mcp tool entry is malformed',
      {
        ...zaiMonitorUsage,
        value: 39,
        currency: 'CNY',
        windows: { ...zaiMonitorUsage.windows!, mcp: { used: 3, ceiling: 60, tools: [{ name: 'web-search' }] } },
      },
    ],
  ])('a malformed windows report reads as undefined: %s', async (_label, storedUsage) => {
    // value/currency stay present so ONLY the windows field can invalidate
    // the entry — the reject proof belongs to isMonitorWindows alone.
    await browser.local.set({
      [SNAPSHOT_STORAGE_KEY]: { results: { zai: { status: 'ok', usage: storedUsage } } },
    });

    expect(await store.read()).toBeUndefined();
  });

  it.each([
    ['stored value is a plain string', 'garbage'],
    ['results is not a record', { results: 42 }],
    ['results is missing', {}],
    ['entry status is unknown', { results: { zai: { status: 'pending' } } }],
    ['ok entry has no usage', { results: { zai: { status: 'ok' } } }],
    ['ok entry usage has a non-number value', { results: { zai: { status: 'ok', usage: { ...zaiUsage, value: '39' } } } }],
    ['ok entry usage has an invalid kind', { results: { zai: { status: 'ok', usage: { ...zaiUsage, kind: 'balance-sheet' } } } }],
    ['ok entry usage has a non-array breakdown', { results: { zai: { status: 'ok', usage: { ...openaiUsage, breakdown: 'nope' } } } }],
    ['error entry carries no errorClass', { results: { zai: { status: 'error' } } }],
    ['error entry carries a non-class string', { results: { zai: { status: 'error', errorClass: 'fatal' } } }],
    ['ok entry usage has an unknown plan status', { results: { qwen: { status: 'ok', usage: { ...qwenUsage, plan: { status: 'weird' } } } } }],
    ['ok entry usage has a non-number plan resetAt', { results: { qwen: { status: 'ok', usage: { ...qwenUsage, plan: { status: 'exhausted', resetAt: 'soon' } } } } }],
    ['ok entry usage has a non-object plan', { results: { qwen: { status: 'ok', usage: { ...qwenUsage, plan: 'available' } } } }],
  ])('malformed stored shape reads as undefined: %s', async (_label, stored) => {
    await browser.local.set({ [SNAPSHOT_STORAGE_KEY]: stored });

    expect(await store.read()).toBeUndefined();
  });

  it('qwen ok entries round-trip with plan status in every form (hito-8)', async () => {
    for (const plan of [
      { status: 'available' },
      { status: 'exhausted', resetAt: FETCHED_AT + 3_600_000 },
      { status: 'key-rejected' },
    ] as const) {
      const snapshot: CycleSnapshot = { results: { qwen: { status: 'ok', usage: { ...qwenUsage, plan } } } };
      await store.write(snapshot);
      expect(await store.read()).toEqual({ results: snapshot.results, lastKnown: { qwen: snapshot.results.qwen } });
      await browser.local.remove(SNAPSHOT_STORAGE_KEY); // isolate per form
    }
  });

  it('a plan-only value-less qwen usage round-trips (§Qwen Plan Line plan-only card)', async () => {
    const planOnly: NormalizedUsage = {
      providerId: 'qwen',
      kind: 'balance',
      plan: { status: 'exhausted', resetAt: 1 },
      fetchedAt: FETCHED_AT,
    };
    const snapshot: CycleSnapshot = { results: { qwen: { status: 'ok', usage: planOnly } } };

    await store.write(snapshot);

    expect(await store.read()).toEqual({ results: snapshot.results, lastKnown: { qwen: snapshot.results.qwen } });
  });

  describe('lastKnown — per-provider last-successful survival (hito-11)', () => {
    const okZai: ProviderSnapshotEntry = { status: 'ok', usage: zaiUsage };
    const okZaiV2: ProviderSnapshotEntry = { status: 'ok', usage: { ...zaiUsage, value: 42 } };
    const authError: ProviderSnapshotEntry = { status: 'error', errorClass: 'auth' };

    it('a later error tick keeps the most recent successful entry in lastKnown', async () => {
      await store.write({ results: { zai: okZai } });
      await store.write({ results: { zai: authError } });

      const read = await store.read();
      expect(read?.results.zai).toEqual(authError); // the cycle arm is the error…
      expect(read?.lastKnown?.zai).toEqual(okZai); // …and the last success survives
    });

    it('a later ok tick UPDATES lastKnown to the newest success', async () => {
      await store.write({ results: { zai: okZai } });
      await store.write({ results: { zai: okZaiV2 } });

      expect((await store.read())?.lastKnown?.zai).toEqual(okZaiV2);
    });

    it('providers never seen ok carry no entry — an all-error cycle stores no lastKnown key at all', async () => {
      await store.write({ results: { zai: authError, kimi: { status: 'error', errorClass: 'network' } } });

      expect(SNAPSHOT_STORAGE_KEY in browser.local.snapshot()).toBe(true);
      expect(Object.keys(browser.local.snapshot()[SNAPSHOT_STORAGE_KEY] as object)).toEqual(['results']);
      expect((await store.read())?.lastKnown).toBeUndefined();
    });

    it('a provider absent from a later cycle keeps its lastKnown entry (revoked-key silence never wipes it)', async () => {
      await store.write({ results: { zai: okZai, kimi: { status: 'ok', usage: { ...qwenUsage, providerId: 'kimi' } } } });
      await store.write({ results: { kimi: authError } }); // zai not refreshed this cycle

      const read = await store.read();
      expect(read?.results.zai).toBeUndefined();
      expect(read?.lastKnown?.zai).toEqual(okZai);
    });

    it('write owns lastKnown: a caller-provided lastKnown field is recomputed from the stored cycle history', async () => {
      await store.write({ results: { zai: okZai } });
      // A caller (e.g. a stale tab) passing its own lastKnown cannot forge or
      // drop entries — the merge derives the map from previous + results.
      await store.write({ results: { qwen: authError }, lastKnown: { zai: okZaiV2 } } as CycleSnapshot);

      expect((await store.read())?.lastKnown).toEqual({ zai: okZai });
    });

    it('a legacy snapshot without lastKnown still reads as valid (additive shape)', async () => {
      await browser.local.set({ [SNAPSHOT_STORAGE_KEY]: { results: { zai: okZai } } });

      const read = await store.read();
      expect(read?.results.zai).toEqual(okZai);
      expect(read?.lastKnown).toBeUndefined();
    });

    it.each([
      ['lastKnown is not an object', { results: {}, lastKnown: 'frozen' }],
      ['a lastKnown entry is an error arm', { results: {}, lastKnown: { zai: { status: 'error', errorClass: 'auth' } } }],
      ['a lastKnown entry has a malformed usage', { results: {}, lastKnown: { zai: { status: 'ok', usage: { providerId: 'zai' } } } }],
    ])('a malformed lastKnown reads as undefined: %s', async (_label, stored) => {
      await browser.local.set({ [SNAPSHOT_STORAGE_KEY]: stored });

      expect(await store.read()).toBeUndefined();
    });
  });

  it('qwen usage with token-plan quota round-trips in every live shape (hito-12 WU-C2)', async () => {
    for (const quota of [
      { percentage: 11.72, resetAt: 1_793_721_600_000, fetchedAt: FETCHED_AT }, // full live pair
      { percentage: 150, fetchedAt: FETCHED_AT }, // uncapped passthrough survives storage untouched
      { resetAt: 1, fetchedAt: FETCHED_AT }, // percentage absent stays absent
      { fetchedAt: FETCHED_AT }, // shape-valid floor (the step never emits it; the validator is shape-only)
    ] as const) {
      const snapshot: CycleSnapshot = { results: { qwen: { status: 'ok', usage: { ...qwenUsage, quota } } } };
      await store.write(snapshot);
      // hito-11 storage work: write() mirrors the qwen ok arm into the
      // additive lastKnown map, so the persisted shape now carries it. The
      // WU-C2 claim is unchanged — the quota fields round-trip VERBATIM —
      // pinned here as full deep equality against the new shape.
      expect(await store.read()).toEqual({ results: snapshot.results, lastKnown: { qwen: snapshot.results.qwen } });
      await browser.local.remove(SNAPSHOT_STORAGE_KEY); // isolate per form
    }
  });

  it.each([
    ['quota is not an object', 'quota-string'],
    ['quota percentage is a string', { percentage: '11.72', fetchedAt: FETCHED_AT }],
    ['quota percentage is NaN', { percentage: Number.NaN, fetchedAt: FETCHED_AT }],
    ['quota resetAt is not a number', { resetAt: 'soon', fetchedAt: FETCHED_AT }],
    ['quota resetAt is infinite', { resetAt: Number.POSITIVE_INFINITY, fetchedAt: FETCHED_AT }],
    ['quota carries no fetchedAt', { percentage: 1 }],
    ['quota fetchedAt is a string', { percentage: 1, fetchedAt: 'now' }],
    ['quota fetchedAt is NaN', { fetchedAt: Number.NaN }],
  ])('a malformed quota report reads as undefined: %s', async (_label, quota) => {
    await browser.local.set({
      [SNAPSHOT_STORAGE_KEY]: { results: { qwen: { status: 'ok', usage: { ...qwenUsage, quota } } } },
    });

    expect(await store.read()).toBeUndefined();
  });

  it('deepseek ok entries round-trip with the derived wallet in every live shape (hito-13 WU-A)', async () => {
    for (const wallet of [
      { currency: 'USD', total: 2, consumed: 0, percentage: 0 }, // fresh-account pair
      { currency: 'CNY', total: 10, consumed: 6, percentage: 60 }, // derived consumed share
      { currency: 'USD', total: 2, consumed: 4, percentage: 200 }, // UNCAPPED passthrough survives storage untouched
      { currency: 'USD', total: 0, consumed: 0 }, // zero-total honest absence (percentage omitted)
    ] as const) {
      const snapshot: CycleSnapshot = {
        results: { deepseek: { status: 'ok', usage: { ...deepseekUsage, wallet } } },
      };
      await store.write(snapshot);
      // Same lastKnown mirroring as the quota claim: the wallet fields
      // round-trip VERBATIM, pinned as full deep equality against the shape.
      expect(await store.read()).toEqual({
        results: snapshot.results,
        lastKnown: { deepseek: snapshot.results.deepseek },
      });
      await browser.local.remove(SNAPSHOT_STORAGE_KEY); // isolate per form
    }
  });

  it.each([
    ['wallet is not an object', 'wallet-string'],
    ['wallet currency is not a string', { currency: 840, total: 2, consumed: 0 }],
    ['wallet total is a string', { currency: 'USD', total: '2.00', consumed: 0 }],
    ['wallet total is NaN', { currency: 'USD', total: Number.NaN, consumed: 0 }],
    ['wallet total is infinite', { currency: 'USD', total: Number.POSITIVE_INFINITY, consumed: 0 }],
    ['wallet consumed is not a number', { currency: 'USD', total: 2, consumed: null }],
    ['wallet consumed is infinite', { currency: 'USD', total: 2, consumed: Number.NEGATIVE_INFINITY }],
    ['wallet percentage is a string', { currency: 'USD', total: 2, consumed: 0, percentage: '60' }],
    ['wallet percentage is NaN', { currency: 'USD', total: 2, consumed: 0, percentage: Number.NaN }],
  ])('a malformed wallet report reads as undefined: %s', async (_label, wallet) => {
    await browser.local.set({
      [SNAPSHOT_STORAGE_KEY]: {
        results: { deepseek: { status: 'ok', usage: { ...deepseekUsage, wallet } } },
      },
    });

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
    await new KeyStore(browser.local).saveCredential('zai', {
      type: 'bearer',
      token: 'sk-zai-secret-credential-material',
    });
    await store.write({ results: { zai: { status: 'ok', usage: zaiUsage }, qwen: { status: 'error', errorClass: 'auth' } } });

    expect(JSON.stringify(browser.local.snapshot()[SNAPSHOT_STORAGE_KEY])).not.toContain(
      'sk-zai-secret-credential-material',
    );
  });
});
