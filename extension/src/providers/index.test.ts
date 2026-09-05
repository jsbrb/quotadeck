import { describe, expect, it } from 'vitest';
import type { CredentialType, ProviderId } from '../core/provider';
import { FIXTURE_RESPONSES } from '../fixtures';
import { createDefaultRegistry } from './index';

// Spec §Provider Contract — Contract compliance of the four stubs: every id
// resolves to a Provider satisfying the contract, and each stub consumes its
// documented response shape. (Duplicate/unknown id failures are proven in
// core/registry.test.ts against the same registry class.)
const EXPECTED_CREDENTIALS: Readonly<Record<ProviderId, CredentialType>> = {
  zai: 'bearer',
  qwen: 'ak-sk',
  openai: 'openai-admin-read',
  kimi: 'bearer',
};

describe('createDefaultRegistry (AD-6)', () => {
  it('registers exactly the four stubs in the fixed order zai, qwen, openai, kimi', () => {
    expect(createDefaultRegistry().ids()).toEqual(['zai', 'qwen', 'openai', 'kimi']);
  });

  it('resolves every provider id to a contract-compliant provider', () => {
    const registry = createDefaultRegistry();
    for (const id of registry.ids()) {
      const provider = registry.get(id);
      expect(provider.id).toBe(id);
      expect(provider.displayName.length).toBeGreaterThan(0);
      expect(provider.credentialType).toBe(EXPECTED_CREDENTIALS[id]);
      expect(typeof provider.firstRequest).toBe('function');
      expect(typeof provider.parsePage).toBe('function');
    }
  });

  it('each stub accepts its documented response shape as parse input', () => {
    const registry = createDefaultRegistry();

    const zai = registry.get('zai');
    zai.firstRequest({ billingMonth: '2026-08' });
    expect(zai.parsePage(FIXTURE_RESPONSES['zai/expense-bill-list--page-1'].body, null).done).toBe(false);

    const qwen = registry.get('qwen');
    expect(qwen.parsePage(FIXTURE_RESPONSES['qwen/query-account-balance--ok'].body, null).done).toBe(true);

    const openai = registry.get('openai');
    openai.firstRequest({ startTime: 1754006400 });
    expect(openai.parsePage(FIXTURE_RESPONSES['openai/costs--page-1'].body, null).done).toBe(false);

    const kimi = registry.get('kimi');
    expect(kimi.parsePage(FIXTURE_RESPONSES['kimi/users-me-balance--ok'].body, null).done).toBe(true);
  });
});
