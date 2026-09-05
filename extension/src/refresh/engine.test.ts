import { describe, expect, it } from 'vitest';
import type { Credential, ProviderId, UsageQuery } from '../core/provider';
import type { NormalizedUsage } from '../core/usage';
import { ProviderRegistry } from '../core/registry';
import { FIXTURE_RESPONSES } from '../fixtures';
import { createDefaultRegistry } from '../providers';
import { AllowlistNetworkClient } from '../network/client';
import { KeyStore } from '../storage/key-store';
import { FakeBrowser } from '../testing/fake-browser';
import { FakeClock } from '../testing/fake-clock';
import { RecordingTransport } from '../testing/recording-transport';
import { RefreshEngine, type RefreshCallbacks } from './engine';

// Hermetic (spec §Fixture-Only Data): the generic engine is proven against the
// three real provider shapes — multi-page ZAI with a declared jitter window,
// multi-page OpenAI without one, and single-page Kimi — through the real
// AllowlistNetworkClient over a RecordingTransport. No network I/O can occur,
// and jitter assertions read FakeClock.sleeps, never the wall clock.
const QUERY: UsageQuery = { billingMonth: '2026-08', startTime: 1754006400, endTime: 1754179200 };

/** Registry containing exactly the given ids, in the default registration order. */
function keyedRegistry(ids: readonly ProviderId[]): ProviderRegistry {
  const full = createDefaultRegistry();
  const registry = new ProviderRegistry();
  for (const id of full.ids()) {
    if (ids.includes(id)) {
      registry.register(full.get(id));
    }
  }
  return registry;
}

/** Callback recorder capturing usages and errors in call order. */
function recorder(): RefreshCallbacks & {
  usages: NormalizedUsage[];
  errors: Array<[ProviderId, unknown]>;
} {
  const usages: NormalizedUsage[] = [];
  const errors: Array<[ProviderId, unknown]> = [];
  return {
    usages,
    errors,
    onUsage: (usage) => {
      usages.push(usage);
    },
    onError: (providerId, error) => {
      errors.push([providerId, error]);
    },
  };
}

/** Typed test credentials per provider (saveCredential is type-aware). */
const TEST_CREDENTIALS: Readonly<Record<ProviderId, Credential>> = {
  zai: { type: 'bearer', token: 'engine-test-credential' },
  qwen: { type: 'ak-sk', accessKeyId: 'LTAI5tEngineTestAK00', accessKeySecret: 'EngineTestSecret000000000000' },
  openai: { type: 'openai-admin-read', token: 'engine-test-credential' },
  kimi: { type: 'bearer', token: 'engine-test-credential' },
};

async function makeEngine(
  options: { transport?: RecordingTransport; rng?: () => number; keyed?: readonly ProviderId[] } = {},
): Promise<{ engine: RefreshEngine; registry: ProviderRegistry; transport: RecordingTransport; clock: FakeClock }> {
  const keyed = options.keyed ?? ['zai', 'qwen', 'openai', 'kimi'];
  const registry = keyedRegistry(keyed);
  const transport = options.transport ?? zaiTransport();
  const clock = new FakeClock();
  const keys = new KeyStore(new FakeBrowser().local);
  for (const id of keyed) {
    await keys.saveCredential(id, TEST_CREDENTIALS[id]);
  }
  const engine = new RefreshEngine({
    registry,
    client: new AllowlistNetworkClient(transport),
    keys,
    clock,
    ...(options.rng !== undefined ? { rng: options.rng } : {}),
  });
  return { engine, registry, transport, clock };
}

function zaiTransport(): RecordingTransport {
  return new RecordingTransport([
    FIXTURE_RESPONSES['zai/expense-bill-list--page-1'],
    FIXTURE_RESPONSES['zai/expense-bill-list--page-2'],
    FIXTURE_RESPONSES['zai/expense-bill-list--page-3'],
  ]);
}

describe('RefreshEngine — single-provider cycle (AD-2)', () => {
  it('threads opaque pagination state across pages and folds the final usage', async () => {
    const { engine, registry, transport } = await makeEngine({ rng: () => 0 });

    const usage = await engine.refresh(registry.get('zai'), QUERY, { type: 'bearer', token: 'cred' });

    expect(usage.providerId).toBe('zai');
    expect(usage.kind).toBe('cost');
    expect(usage.value).toBe(39); // Σ costPrice/1000×deductUsage over the deduped 3-page flow
    expect(usage.currency).toBe('CNY');
    expect(usage.tier).toBe('Lite'); // tokenResourceName of the final record (community-shape fixtures)
    expect(transport.requests).toHaveLength(3); // firstRequest + two PageParse.next dispatches
  });

  it('stamps fetchedAt from the injected Clock — providers emit 0 by contract', async () => {
    const { engine, registry, clock } = await makeEngine({ rng: () => 0 });

    const usage = await engine.refresh(registry.get('zai'), QUERY, { type: 'bearer', token: 'cred' });

    // FakeClock start 1_700_000_000_000 plus two 500 ms sleeps → fold time.
    expect(usage.fetchedAt).toBe(1_700_000_001_000);
    expect(usage.fetchedAt).toBe(clock.now());
    expect(usage.fetchedAt).not.toBe(0);
  });

  it('sleeps exactly N−1 times on the injected Clock, each draw inside [500, 2000] ms', async () => {
    const min = await makeEngine({ rng: () => 0 });
    await min.engine.refresh(min.registry.get('zai'), QUERY, { type: 'bearer', token: 'cred' });
    expect(min.clock.sleeps).toEqual([500, 500]); // 3 pages → 2 sleeps, rng 0 → window minimum

    const max = await makeEngine({ rng: () => 1 });
    await max.engine.refresh(max.registry.get('zai'), QUERY, { type: 'bearer', token: 'cred' });
    expect(max.clock.sleeps).toEqual([2000, 2000]); // rng 1 → window maximum

    for (const sleep of [...min.clock.sleeps, ...max.clock.sleeps]) {
      expect(sleep).toBeGreaterThanOrEqual(500);
      expect(sleep).toBeLessThanOrEqual(2000);
    }
  });

  it('never sleeps for a multi-page provider without a declared delay window', async () => {
    const { engine, registry, clock } = await makeEngine({
      transport: new RecordingTransport([
        FIXTURE_RESPONSES['openai/costs--page-1'],
        FIXTURE_RESPONSES['openai/costs--page-2-final'],
      ]),
    });

    const usage = await engine.refresh(registry.get('openai'), QUERY, { type: 'bearer', token: 'cred' });

    expect(usage.value).toBe(20);
    expect(usage.providerId).toBe('openai');
    expect(clock.sleeps).toEqual([]); // OpenAI declares no politeness window
  });

  it('propagates provider parse failures to the caller', async () => {
    const { engine, registry } = await makeEngine({
      transport: new RecordingTransport([FIXTURE_RESPONSES['zai/expense-bill-list--code-500']]),
    });

    await expect(engine.refresh(registry.get('zai'), QUERY, { type: 'bearer', token: 'cred' })).rejects.toThrow(
      /numeric code 200.*got number 500/i,
    );
  });

  it('propagates transport failures to the caller — no silent fallback', async () => {
    const { engine, registry } = await makeEngine({ transport: new RecordingTransport() }); // empty queue

    await expect(engine.refresh(registry.get('zai'), QUERY, { type: 'bearer', token: 'cred' })).rejects.toThrow(/unexpected fetch/i);
  });
});

describe('RefreshEngine — refreshAll (sequential, keyed-only, error marker feed)', () => {
  it('refreshes keyed providers sequentially in registry order; unkeyed providers are skipped', async () => {
    const { engine, transport } = await makeEngine({
      keyed: ['zai', 'kimi'],
      transport: new RecordingTransport([
        FIXTURE_RESPONSES['zai/expense-bill-list--page-1'],
        FIXTURE_RESPONSES['zai/expense-bill-list--page-2'],
        FIXTURE_RESPONSES['zai/expense-bill-list--page-3'],
        FIXTURE_RESPONSES['kimi/users-me-balance--ok'],
      ]),
    });
    const calls = recorder();

    await engine.refreshAll(QUERY, calls);

    expect(calls.usages.map((usage) => usage.providerId)).toEqual(['zai', 'kimi']);
    expect(calls.usages.map((usage) => usage.value)).toEqual([39, 88.88]);
    expect(calls.errors).toEqual([]);
    // Sequential proof: all ZAI pages complete before Kimi dispatches.
    expect(transport.requests.map((request) => request.url)).toEqual([
      'https://bigmodel.cn/api/finance/expenseBill/expenseBillList?billingMonth=2026-08&pageNum=1&pageSize=2',
      'https://bigmodel.cn/api/finance/expenseBill/expenseBillList?billingMonth=2026-08&pageNum=2&pageSize=2',
      'https://bigmodel.cn/api/finance/expenseBill/expenseBillList?billingMonth=2026-08&pageNum=3&pageSize=2',
      'https://api.moonshot.cn/v1/users/me/balance',
    ]);
  });

  it('reports a provider failure via onError and continues; a later success replaces it', async () => {
    const { engine, transport } = await makeEngine({
      keyed: ['zai', 'kimi'],
      transport: new RecordingTransport([
        FIXTURE_RESPONSES['zai/expense-bill-list--code-500'], // zai fails on page 1
        FIXTURE_RESPONSES['kimi/users-me-balance--ok'],
      ]),
    });
    const calls = recorder();

    await engine.refreshAll(QUERY, calls);

    expect(calls.errors.map(([id]) => id)).toEqual(['zai']);
    expect(String(calls.errors[0]?.[1])).toMatch(/numeric code 200/i);
    expect(calls.usages.map((usage) => usage.providerId)).toEqual(['kimi']);
    expect(transport.requests).toHaveLength(2); // failure aborted zai, not the loop
  });

  it('refreshes nothing when no keys are stored', async () => {
    const { engine, transport } = await makeEngine({ keyed: [] });
    const calls = recorder();

    await engine.refreshAll(QUERY, calls);

    expect(transport.requests).toEqual([]);
    expect(calls.usages).toEqual([]);
    expect(calls.errors).toEqual([]);
  });
});

describe('RefreshEngine — credential threading (AD-17/19)', () => {
  const QWEN_PAIR: Credential = {
    type: 'ak-sk',
    accessKeyId: 'LTAI5tEnginePairAK000',
    accessKeySecret: 'EnginePairSecret000000000000000000',
  };

  it('refreshAll reads the qwen pair via readCredential(id, type) and threads it to send as a signed query', async () => {
    const registry = new ProviderRegistry().register(createDefaultRegistry().get('qwen'));
    const transport = new RecordingTransport([FIXTURE_RESPONSES['qwen/query-account-balance--ok']]);
    const keys = new KeyStore(new FakeBrowser().local);
    await keys.saveCredential('qwen', QWEN_PAIR);
    const engine = new RefreshEngine({
      registry,
      client: new AllowlistNetworkClient(transport, { clock: new FakeClock(), nonce: () => 'engine-nonce-1' }),
      keys,
      clock: new FakeClock(),
    });
    const calls = recorder();

    await engine.refreshAll(QUERY, calls);

    expect(transport.requests).toHaveLength(1);
    const sent = transport.requests[0]!;
    expect(sent.headers).toEqual({}); // ak-sk: no Authorization header, signed query carries auth
    expect(sent.url).toContain('AccessKeyId=LTAI5tEnginePairAK000');
    expect(sent.url).toContain('Signature=');
    expect(calls.usages.map((usage) => usage.value)).toEqual([100.28]); // qwen balance fixture folds
    expect(calls.errors).toEqual([]);
  });

  it('skips qwen when only a legacy plain string is stored — zero dispatch, zero errors', async () => {
    const registry = new ProviderRegistry().register(createDefaultRegistry().get('qwen'));
    const transport = new RecordingTransport(); // empty queue: any dispatch would throw
    const browser = new FakeBrowser();
    await browser.local.set({ 'qd:key:qwen': 'legacy-hito2-string-key' }); // pre-Credential shape
    const engine = new RefreshEngine({
      registry,
      client: new AllowlistNetworkClient(transport),
      keys: new KeyStore(browser.local),
      clock: new FakeClock(),
    });
    const calls = recorder();

    await engine.refreshAll(QUERY, calls);

    expect(transport.requests).toHaveLength(0);
    expect(calls.usages).toEqual([]);
    expect(calls.errors).toEqual([]);
  });
});
