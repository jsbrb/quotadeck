import { describe, expect, it } from 'vitest';
import { PROVIDER_METADATA, SHIPPED_PROVIDER_IDS } from './provider-metadata';

// AD-24: popup-safe provider metadata in the fixed AD-6 order. The popup
// imports THIS module only — provider classes (and their endpoint constants)
// never enter the popup bundle. providers/index.ts builds the registry from it.
describe('PROVIDER_METADATA (AD-24)', () => {
  it('pins the AD-6 order zai, qwen, openai, kimi with credential types', () => {
    expect(PROVIDER_METADATA).toEqual([
      { id: 'zai', displayName: 'ZAI (Zhipu AI)', credentialType: 'raw' },
      { id: 'qwen', displayName: 'Qwen (Alibaba Cloud BSS)', credentialType: 'ak-sk' },
      { id: 'openai', displayName: 'OpenAI', credentialType: 'openai-admin-read' },
      { id: 'kimi', displayName: 'Kimi (Moonshot AI)', credentialType: 'bearer' },
    ]);
  });

  it('covers every provider id exactly once', () => {
    const ids = PROVIDER_METADATA.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(['kimi', 'openai', 'qwen', 'zai']);
  });
});

describe('SHIPPED_PROVIDER_IDS (hito-10 GLM-only store release)', () => {
  it('ships exactly zai — the single source of the shipping filter', () => {
    expect(SHIPPED_PROVIDER_IDS).toEqual(['zai']);
  });

  it('is a subset of the known provider ids', () => {
    for (const id of SHIPPED_PROVIDER_IDS) {
      expect(PROVIDER_METADATA.some((entry) => entry.id === id)).toBe(true);
    }
  });
});
