import { describe, expect, it } from 'vitest';
import { PROVIDER_METADATA, SHIPPED_PROVIDER_IDS } from './provider-metadata';

// AD-24: popup-safe provider metadata in the fixed AD-6 order. The popup
// imports THIS module only — provider classes (and their endpoint constants)
// never enter the popup bundle. providers/index.ts builds the registry from it.
describe('PROVIDER_METADATA (AD-24)', () => {
  it('pins the AD-6 order zai, qwen, deepseek, openai, kimi with credential types (hito-13: deepseek third)', () => {
    expect(PROVIDER_METADATA).toEqual([
      { id: 'zai', displayName: 'ZAI (Zhipu AI)', credentialType: 'raw' },
      { id: 'qwen', displayName: 'Qwen (Alibaba Cloud BSS)', credentialType: 'ak-sk' },
      { id: 'deepseek', displayName: 'DeepSeek', credentialType: 'bearer' },
      { id: 'openai', displayName: 'OpenAI', credentialType: 'openai-admin-read' },
      { id: 'kimi', displayName: 'Kimi (Moonshot AI)', credentialType: 'bearer' },
    ]);
  });

  it('covers every provider id exactly once', () => {
    const ids = PROVIDER_METADATA.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(['deepseek', 'kimi', 'openai', 'qwen', 'zai']);
  });
});

describe('SHIPPED_PROVIDER_IDS (hito-13 deepseek ships third)', () => {
  it('ships exactly zai, qwen, deepseek in AD-6 order — deepseek flipped on in WU-B together with its manifest host (hito-13)', () => {
    expect(SHIPPED_PROVIDER_IDS).toEqual(['zai', 'qwen', 'deepseek']);
  });

  it('is a subset of the known provider ids', () => {
    for (const id of SHIPPED_PROVIDER_IDS) {
      expect(PROVIDER_METADATA.some((entry) => entry.id === id)).toBe(true);
    }
  });
});
