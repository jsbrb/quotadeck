import { describe, expect, it } from 'vitest';
import type { CredentialType, ProviderId } from '../core/provider';
import { PROVIDER_METADATA, SHIPPED_PROVIDER_IDS } from '../core/provider-metadata';
import { FIXTURE_RESPONSES } from '../fixtures';
import { createDefaultRegistry } from './index';

// Spec §Provider Contract — Contract compliance of the shipped stubs: every
// registered id resolves to a Provider satisfying the contract, and each stub
// consumes its documented response shape. (Duplicate/unknown id failures are
// proven in core/registry.test.ts against the same registry class.)
const EXPECTED_CREDENTIALS: Readonly<Record<ProviderId, CredentialType>> = {
  zai: 'raw',
  qwen: 'ak-sk',
  openai: 'openai-admin-read',
  kimi: 'bearer',
};

describe('createDefaultRegistry (AD-6, hito-10 shipping filter)', () => {
  it('registers exactly SHIPPED_PROVIDER_IDS in pinned order — zai only in the GLM-only build', () => {
    expect(createDefaultRegistry().ids()).toEqual([...SHIPPED_PROVIDER_IDS]);
  });

  it('is built from the shipped subset of PROVIDER_METADATA: ids, displayNames and credential types all match', () => {
    const registry = createDefaultRegistry();
    const shipped = PROVIDER_METADATA.filter((entry) => SHIPPED_PROVIDER_IDS.includes(entry.id));
    expect(registry.ids()).toEqual(shipped.map((entry) => entry.id));
    for (const entry of shipped) {
      const provider = registry.get(entry.id);
      expect(provider.displayName).toBe(entry.displayName);
      expect(provider.credentialType).toBe(entry.credentialType);
    }
  });

  it('resolves every shipped provider id to a contract-compliant provider', () => {
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

  it('each shipped stub accepts its documented response shape as parse input', () => {
    const registry = createDefaultRegistry();

    const zai = registry.get('zai');
    zai.firstRequest({}); // no platform → default base; single-shot parse below
    expect(zai.parsePage(FIXTURE_RESPONSES['zai/monitor--pro-plan'].body, null).done).toBe(true);
  });

  it('rejects unshipped ids — qwen/openai/kimi stay in source but never register (hito-10)', () => {
    const registry = createDefaultRegistry();
    for (const id of ['qwen', 'openai', 'kimi'] as const) {
      expect(() => registry.get(id)).toThrow(new RegExp(`Unknown provider id: ${id}`));
    }
  });
});
