import { describe, expect, it } from 'vitest';
import type { Provider, ProviderId, UsageQuery } from './provider';
import { ProviderRegistry } from './registry';

// Inline fake providers — the registry is proven against the contract, not against
// concrete implementations (those land in Phase 4 with their own suites).
function fakeProvider(id: ProviderId): Provider {
  const boom = (): never => {
    throw new Error('not implemented in registry test double');
  };
  return {
    id,
    displayName: `Fake ${id}`,
    credentialType: 'bearer',
    firstRequest: (_query: UsageQuery) => boom(),
    parsePage: (_body: unknown) => boom(),
  };
}

describe('ProviderRegistry', () => {
  it('rejects a duplicate id at registration time', () => {
    const registry = new ProviderRegistry().register(fakeProvider('zai'));
    expect(() => registry.register(fakeProvider('zai'))).toThrow(/duplicate provider id: zai/i);
  });

  it('rejects an unknown id at lookup time', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.get('openai')).toThrow(/unknown provider id: openai/i);
  });

  it('round-trips a registered provider by id', () => {
    const zai = fakeProvider('zai');
    const registry = new ProviderRegistry().register(zai);
    expect(registry.get('zai')).toBe(zai);
    expect(registry.has('zai')).toBe(true);
    expect(registry.has('kimi')).toBe(false);
  });

  it('preserves registration order for deterministic refresh sequencing', () => {
    const registry = new ProviderRegistry()
      .register(fakeProvider('zai'))
      .register(fakeProvider('qwen'))
      .register(fakeProvider('openai'))
      .register(fakeProvider('kimi'));
    expect(registry.ids()).toEqual(['zai', 'qwen', 'openai', 'kimi']);
  });
});
