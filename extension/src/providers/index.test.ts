import { describe, expect, it } from 'vitest';
import type { CredentialType, ProviderId } from '../core/provider';
import { PROVIDER_METADATA, SHIPPED_PROVIDER_IDS } from '../core/provider-metadata';
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
  deepseek: 'bearer',
};

/** The ids createDefaultRegistry actually registers: the shipped ∩ dispatched filter. */
const REGISTERED_IDS = PROVIDER_METADATA.filter(
  ({ id }) => SHIPPED_PROVIDER_IDS.includes(id) && ENGINE_DISPATCHED_PROVIDER_IDS.includes(id),
).map(({ id }) => id);

describe('createDefaultRegistry (AD-6; hito-10 shipping filter, hito-12 WU-L engine dispatch)', () => {
  it('registers exactly the SHIPPED ∩ ENGINE_DISPATCHED intersection in PROVIDER_METADATA order', () => {
    expect(createDefaultRegistry().ids()).toEqual(REGISTERED_IDS);
  });

  it('pins ENGINE_DISPATCHED_PROVIDER_IDS: zai + deepseek (hito-13 WU-A — registry-dispatched like zai, never a tick step)', () => {
    expect(ENGINE_DISPATCHED_PROVIDER_IDS).toEqual(['zai', 'deepseek']);
  });

  it('qwen no longer registers — the BSS balance dispatch is suspended by product decision 2026-10-25 (WU-L)', () => {
    const registry = createDefaultRegistry();
    expect(() => registry.get('qwen')).toThrow(new RegExp('Unknown provider id: qwen'));
    expect(QwenProvider).toBeDefined(); // the class stays in source for a future pay-as-you-go balance
  });

  it('is built from the registered subset of PROVIDER_METADATA: ids, displayNames and credential types all match', () => {
    const registry = createDefaultRegistry();
    const registered = PROVIDER_METADATA.filter((entry) => REGISTERED_IDS.includes(entry.id));
    expect(registry.ids()).toEqual(registered.map((entry) => entry.id));
    for (const entry of registered) {
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

  it('rejects unshipped ids — they stay in source but never register (openai/kimi; deepseek until WU-B ships it with its allowlist host)', () => {
    const registry = createDefaultRegistry();
    const unshipped = PROVIDER_METADATA.map(({ id }) => id).filter((id) => !SHIPPED_PROVIDER_IDS.includes(id));
    expect(unshipped.length).toBeGreaterThan(0); // the filter stays a real filter
    for (const id of unshipped) {
      expect(() => registry.get(id)).toThrow(new RegExp(`Unknown provider id: ${id}`));
    }
  });
});
