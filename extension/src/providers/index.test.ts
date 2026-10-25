import { describe, expect, it } from 'vitest';
import type { CredentialType, ProviderId } from '../core/provider';
import { PROVIDER_METADATA } from '../core/provider-metadata';
import { FIXTURE_RESPONSES } from '../fixtures';
import { createDefaultRegistry, ENGINE_DISPATCHED_PROVIDER_IDS, QwenProvider } from './index';

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

describe('createDefaultRegistry (AD-6; hito-10 shipping filter, hito-12 WU-L engine dispatch)', () => {
  it('registers exactly the ENGINE_DISPATCHED_PROVIDER_IDS in pinned order — zai only (WU-L: qwen is quota-only via the tick-level steps)', () => {
    expect(ENGINE_DISPATCHED_PROVIDER_IDS).toEqual(['zai']);
    expect(createDefaultRegistry().ids()).toEqual([...ENGINE_DISPATCHED_PROVIDER_IDS]);
  });

  it('qwen no longer registers — the BSS balance dispatch is suspended by product decision 2026-10-25 (WU-L)', () => {
    const registry = createDefaultRegistry();
    expect(() => registry.get('qwen')).toThrow(new RegExp('Unknown provider id: qwen'));
    expect(QwenProvider).toBeDefined(); // the class stays in source for a future pay-as-you-go balance
  });

  it('is built from the engine-dispatched subset of PROVIDER_METADATA: ids, displayNames and credential types all match', () => {
    const registry = createDefaultRegistry();
    const dispatched = PROVIDER_METADATA.filter((entry) => ENGINE_DISPATCHED_PROVIDER_IDS.includes(entry.id));
    expect(registry.ids()).toEqual(dispatched.map((entry) => entry.id));
    for (const entry of dispatched) {
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

  it('rejects unshipped ids — openai/kimi stay in source but never register (qwen rejection pinned above, WU-L)', () => {
    const registry = createDefaultRegistry();
    for (const id of ['openai', 'kimi'] as const) {
      expect(() => registry.get(id)).toThrow(new RegExp(`Unknown provider id: ${id}`));
    }
  });
});
