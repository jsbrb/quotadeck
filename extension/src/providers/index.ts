// Default registry wiring (AD-6, AD-24). Lives in providers/, not core/, so
// the core stays free of provider implementations (AD-1). The registration
// order comes from PROVIDER_METADATA (AD-6 order: zai, qwen, openai, kimi) —
// the engine refreshes in registration order, which makes the badge's "last
// result wins" deterministic.
import { ProviderRegistry } from '../core/registry';
import { PROVIDER_METADATA } from '../core/provider-metadata';
import type { Provider, ProviderId } from '../core/provider';
import { KimiProvider } from './kimi';
import { OpenAiProvider } from './openai';
import { QwenProvider } from './qwen';
import { ZaiProvider } from './zai';

export { KimiProvider, OpenAiProvider, QwenProvider, ZaiProvider };

/** Concrete class per metadata id — metadata stays free of implementations. */
const PROVIDER_CLASSES: Readonly<Record<ProviderId, () => Provider>> = {
  zai: () => new ZaiProvider(),
  qwen: () => new QwenProvider(),
  openai: () => new OpenAiProvider(),
  kimi: () => new KimiProvider(),
};

/** Registry built from PROVIDER_METADATA in its pinned order. */
export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const { id } of PROVIDER_METADATA) {
    registry.register(PROVIDER_CLASSES[id]());
  }
  return registry;
}
